// Staff API. Access rules enforced here, server-side (§2.2, §6):
//   - market isolation: non-founder staff only see their own market
//   - referral fee accounting is founder-only
//   - contractor gating: no referral without current license + insurance
//   - three-complaint rule: auto-probation
//   - rules are deactivated, never deleted

const { open, audit, today } = require('./db');
const { hashPassword } = require('./auth');
const rulesEngine = require('./rules-engine');
const { SYSTEM_CATEGORIES, TRADES, TIERS, SCOPE_DISCLAIMER } = require('./vocab');
const { sendJson, sendError, readJson } = require('./http-util');

const DAY = 24 * 60 * 60 * 1000;
const rel = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// ── scoping helpers ────────────────────────────────────────────────────────

function marketScope(staff, query) {
  if (staff.role === 'founder') {
    const m = query.get('market_id');
    return m ? Number(m) : null; // null = all markets
  }
  return staff.market_id;
}

function scopedWhere(marketId, column = 'market_id') {
  return marketId == null ? { sql: '1=1', params: [] } : { sql: `${column} = ?`, params: [marketId] };
}

function assertPropertyAccess(db, staff, propertyId) {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!p) throw Object.assign(new Error('Property not found'), { status: 404 });
  if (staff.role !== 'founder' && p.market_id !== staff.market_id) {
    throw Object.assign(new Error('Forbidden: property is outside your market'), { status: 403 });
  }
  return p;
}

function assertContractorReferable(db, contractorId) {
  if (!contractorId) return null;
  const c = db.prepare('SELECT * FROM contractors WHERE id = ?').get(contractorId);
  if (!c) throw Object.assign(new Error('Contractor not found'), { status: 404 });
  if (!c.license_current || !c.insurance_on_file) {
    throw Object.assign(new Error(
      `Referral blocked: ${c.company_name} does not have a current license and insurance certificate on file (business rule #3).`), { status: 409 });
  }
  if (c.status === 'removed' || c.status === 'inactive') {
    throw Object.assign(new Error(`Referral blocked: ${c.company_name} is ${c.status}.`), { status: 409 });
  }
  return c;
}

function feeAmount(row) {
  return row.invoice_amount != null && row.fee_rate != null
    ? Math.round(row.invoice_amount * row.fee_rate * 100) / 100 : null;
}

// Generic helpers for insert/update from a whitelist of columns.
function buildInsert(table, cols, body) {
  const present = cols.filter((c) => body[c] !== undefined);
  const sql = `INSERT INTO ${table} (${present.join(',')}) VALUES (${present.map(() => '?').join(',')})`;
  return { sql, params: present.map((c) => body[c]) };
}
function buildUpdate(table, cols, body, id) {
  const present = cols.filter((c) => body[c] !== undefined);
  if (!present.length) throw Object.assign(new Error('No updatable fields in body'), { status: 400 });
  const sql = `UPDATE ${table} SET ${present.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return { sql, params: [...present.map((c) => body[c]), id] };
}

// ── route table ────────────────────────────────────────────────────────────
// Each handler: async (req, res, { staff, params, query }) — staff session
// already verified by index.js.

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Meta for UI pickers
route('GET', /^\/api\/meta$/, async (req, res, { staff }) => {
  const db = open();
  const markets = staff.role === 'founder'
    ? db.prepare('SELECT id, name, city, state, status FROM markets ORDER BY name').all()
    : db.prepare('SELECT id, name, city, state, status FROM markets WHERE id = ?').all(staff.market_id);
  const advisors = db.prepare(
    `SELECT id, full_name, role, market_id FROM users WHERE active = 1 AND role IN ('founder','sme','advisor')`).all()
    .filter((u) => staff.role === 'founder' || u.market_id === staff.market_id);
  sendJson(res, 200, { categories: SYSTEM_CATEGORIES, trades: TRADES, tiers: TIERS, disclaimer: SCOPE_DISCLAIMER, markets, advisors });
});

// ── Advisor dashboard (US-A8: the single most important screen) ──────────
route('GET', /^\/api\/dashboard$/, async (req, res, { staff, query }) => {
  const db = open();
  const marketId = marketScope(staff, query);
  const mine = query.get('mine') !== '0' && ['sme', 'advisor'].includes(staff.role);

  const scope = mine
    ? { sql: 'c.advisor_id = ?', params: [staff.id] }
    : scopedWhere(marketId, 'c.market_id');

  const clients = db.prepare(
    `SELECT c.*, m.name AS market_name, u.full_name AS advisor_name,
            (SELECT COUNT(*) FROM properties p WHERE p.client_id = c.id AND p.active = 1) AS property_count
     FROM clients c
     JOIN markets m ON m.id = c.market_id
     LEFT JOIN users u ON u.id = c.advisor_id
     WHERE ${scope.sql} AND c.status IN ('active','paused','prospect')
     ORDER BY c.last_name`).all(...scope.params)
    .map(({ password_hash, ...c }) => ({ ...c, has_portal_password: Boolean(password_hash) }));

  const items = db.prepare(
    `SELECT f.*, p.address_line1, p.city, c.first_name, c.last_name, c.tier, c.id AS client_id,
            s.system_name, ct.company_name AS contractor_name
     FROM forward_schedule f
     JOIN properties p ON p.id = f.property_id
     JOIN clients c ON c.id = p.client_id
     LEFT JOIN systems s ON s.id = f.system_id
     LEFT JOIN contractors ct ON ct.id = f.assigned_contractor_id
     WHERE f.status IN ('upcoming','scheduled')
       AND f.due_date <= ? AND ${mine ? 'c.advisor_id = ?' : scope.sql.replaceAll('c.', 'p.')}
     ORDER BY f.due_date`).all(rel(90), ...(mine ? [staff.id] : scope.params));

  const t = today();
  for (const it of items) it.overdue = it.due_date && it.due_date < t ? 1 : 0;

  const visitsToday = db.prepare(
    `SELECT v.*, p.address_line1, p.city, c.first_name, c.last_name, u.full_name AS advisor_name
     FROM visits v
     JOIN properties p ON p.id = v.property_id
     JOIN clients c ON c.id = p.client_id
     JOIN users u ON u.id = v.advisor_id
     WHERE v.visit_date = ? AND ${scopedWhere(staff.role === 'founder' ? marketId : staff.market_id, 'p.market_id').sql}`
  ).all(t, ...scopedWhere(staff.role === 'founder' ? marketId : staff.market_id, 'p.market_id').params);

  const requests = db.prepare(
    `SELECT r.*, c.first_name, c.last_name, p.address_line1
     FROM client_requests r
     JOIN clients c ON c.id = r.client_id
     LEFT JOIN properties p ON p.id = r.property_id
     WHERE r.status IN ('open','in_progress') AND ${mine ? 'c.advisor_id = ?' : scope.sql}
     ORDER BY r.created_at DESC`).all(...(mine ? [staff.id] : scope.params));

  // Visit cadence vs tier promise (US-A13)
  const cadence = clients.filter((c) => c.status === 'active').map((c) => {
    const per = TIERS[c.tier]?.visits_per_year || 0;
    if (!per) return null;
    const windowDays = Math.round(365 / per);
    const lastVisit = db.prepare(
      `SELECT MAX(v.visit_date) AS d FROM visits v JOIN properties p ON p.id = v.property_id WHERE p.client_id = ?`).get(c.id).d;
    const overdue = !lastVisit || lastVisit < rel(-windowDays);
    return overdue ? {
      client_id: c.id, name: `${c.first_name} ${c.last_name}`, tier: c.tier,
      last_visit: lastVisit, expected_every_days: windowDays,
    } : null;
  }).filter(Boolean);

  sendJson(res, 200, { clients, items, visitsToday, requests, cadence, today: t });
});

// ── Clients ───────────────────────────────────────────────────────────────
const CLIENT_COLS = ['first_name','last_name','email','phone','preferred_contact','market_id','advisor_id','tier',
  'subscription_start','subscription_renewal','annual_rate','charter_member','intake_fee_paid','intake_fee_date',
  'referral_source','status','notes','password_hash'];

function clientResponse(db, id) {
  const { password_hash, ...row } = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  row.has_portal_password = Boolean(password_hash);
  return row;
}

// Staff may set a client's portal password via a plain `password` field; the
// raw hash column is never writable from a request body.
function applyClientPassword(body) {
  delete body.password_hash;
  if (body.password != null && body.password !== '') {
    if (String(body.password).length < 8) {
      throw Object.assign(new Error('Portal password must be at least 8 characters'), { status: 400 });
    }
    body.password_hash = hashPassword(String(body.password));
  }
  delete body.password;
}

route('GET', /^\/api\/clients\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(params[0]));
  if (!row) return sendError(res, 404, 'Client not found');
  if (staff.role !== 'founder' && row.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');
  const { password_hash, ...c } = row;
  c.has_portal_password = Boolean(password_hash);
  c.properties = db.prepare('SELECT * FROM properties WHERE client_id = ? AND active = 1').all(c.id);
  c.subscriptions = db.prepare('SELECT * FROM subscriptions WHERE client_id = ? ORDER BY period_start DESC').all(c.id);
  sendJson(res, 200, c);
});

route('POST', /^\/api\/clients$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (staff.role !== 'founder') body.market_id = staff.market_id;
  if (!body.first_name || !body.last_name || !body.tier || !body.market_id) {
    return sendError(res, 400, 'first_name, last_name, tier, market_id are required');
  }
  applyClientPassword(body);
  const { sql, params: p } = buildInsert('clients', CLIENT_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'clients', id, `${body.first_name} ${body.last_name}`);
  sendJson(res, 201, clientResponse(db, id));
});

route('PATCH', /^\/api\/clients\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!existing) return sendError(res, 404, 'Client not found');
  if (staff.role !== 'founder' && existing.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');
  const body = await readJson(req);
  applyClientPassword(body);
  const { sql, params: p } = buildUpdate('clients', CLIENT_COLS, body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'clients', id, Object.keys(body).join(','));
  sendJson(res, 200, clientResponse(db, id));
});

// ── Properties & the Home Record ──────────────────────────────────────────
const PROPERTY_COLS = ['address_line1','address_line2','city','state','zip','client_id','market_id','year_built',
  'square_footage','stories','bedrooms','bathrooms','property_type','construction_type','foundation_type',
  'ownership_date','permit_jurisdiction','intake_date','advisor_id','record_completeness','narrative_summary','active'];

route('GET', /^\/api\/properties$/, async (req, res, { staff, query }) => {
  const db = open();
  const marketId = marketScope(staff, query);
  const scope = scopedWhere(marketId, 'p.market_id');
  const rows = db.prepare(
    `SELECT p.*, c.first_name, c.last_name, c.tier, u.full_name AS advisor_name, m.name AS market_name
     FROM properties p JOIN clients c ON c.id = p.client_id
     LEFT JOIN users u ON u.id = p.advisor_id
     JOIN markets m ON m.id = p.market_id
     WHERE p.active = 1 AND ${scope.sql} ORDER BY c.last_name`).all(...scope.params);
  sendJson(res, 200, rows);
});

// US-A10: the full Home Record in one call — the 2-minute pre-call review.
route('GET', /^\/api\/properties\/(\d+)\/record$/, async (req, res, { staff, params }) => {
  const db = open();
  const property = assertPropertyAccess(db, staff, Number(params[0]));
  const pid = property.id;

  const client = db.prepare(
    `SELECT c.*, u.full_name AS advisor_name FROM clients c LEFT JOIN users u ON u.id = c.advisor_id WHERE c.id = ?`
  ).get(property.client_id);

  const systems = db.prepare('SELECT * FROM systems WHERE property_id = ?').all(pid)
    .map((s) => ({
      ...s,
      age_years: rulesEngine.systemAgeYears(s, property) != null
        ? Math.round(rulesEngine.systemAgeYears(s, property) * 10) / 10 : null,
      remaining_life: rulesEngine.remainingLife(s, property),
    }))
    .sort((a, b) => (a.remaining_life ?? 999) - (b.remaining_life ?? 999));

  const schedule = db.prepare(
    `SELECT f.*, s.system_name, ct.company_name AS contractor_name
     FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
     LEFT JOIN contractors ct ON ct.id = f.assigned_contractor_id
     WHERE f.property_id = ? ORDER BY CASE WHEN f.status IN ('upcoming','scheduled') THEN 0 ELSE 1 END, f.due_date`).all(pid);
  const t = today();
  for (const it of schedule) it.overdue = ['upcoming','scheduled'].includes(it.status) && it.due_date && it.due_date < t ? 1 : 0;

  const log = db.prepare(
    `SELECT l.*, s.system_name, ct.company_name AS contractor_name
     FROM maintenance_log l LEFT JOIN systems s ON s.id = l.system_id
     LEFT JOIN contractors ct ON ct.id = l.contractor_id
     WHERE l.property_id = ? ORDER BY l.date DESC`).all(pid);

  const permits = db.prepare(
    `SELECT pm.*, u.full_name AS researched_by_name FROM permits pm
     LEFT JOIN users u ON u.id = pm.researched_by WHERE pm.property_id = ? ORDER BY pm.date_filed DESC`).all(pid);

  const visits = db.prepare(
    `SELECT v.*, u.full_name AS advisor_name FROM visits v JOIN users u ON u.id = v.advisor_id
     WHERE v.property_id = ? ORDER BY v.visit_date DESC`).all(pid);

  const documents = db.prepare(
    `SELECT d.*, u.full_name AS uploaded_by_name FROM documents d
     LEFT JOIN users u ON u.id = d.uploaded_by_user WHERE d.property_id = ? ORDER BY d.upload_date DESC`).all(pid);

  sendJson(res, 200, { property, client, systems, schedule, log, permits, visits, documents, disclaimer: SCOPE_DISCLAIMER });
});

route('POST', /^\/api\/properties$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (staff.role !== 'founder') body.market_id = staff.market_id;
  if (!body.address_line1 || !body.client_id || !body.market_id) {
    return sendError(res, 400, 'address_line1, client_id, market_id are required');
  }
  const { sql, params: p } = buildInsert('properties', PROPERTY_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'properties', id, body.address_line1);
  sendJson(res, 201, db.prepare('SELECT * FROM properties WHERE id = ?').get(id));
});

route('PATCH', /^\/api\/properties\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const property = assertPropertyAccess(db, staff, Number(params[0]));
  const body = await readJson(req);
  const { sql, params: p } = buildUpdate('properties', PROPERTY_COLS, body, property.id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'properties', property.id, Object.keys(body).join(','));
  sendJson(res, 200, db.prepare('SELECT * FROM properties WHERE id = ?').get(property.id));
});

// US-A4 / §3.4 v2 behavior: on-demand recompute for a property.
route('POST', /^\/api\/properties\/(\d+)\/recompute$/, async (req, res, { staff, params }) => {
  const db = open();
  const property = assertPropertyAccess(db, staff, Number(params[0]));
  const result = rulesEngine.generateForProperty(property.id, { kind: 'staff', id: staff.id });
  sendJson(res, 200, result);
});

// ── Systems (US-A3: the 60-second capture) ────────────────────────────────
const SYSTEM_COLS = ['system_name','property_id','category','description','install_date','age_at_intake',
  'expected_lifespan','condition_rating','model_number','serial_number','warranty_expiry','last_service_date',
  'needs_specialist','advisor_notes'];

function validateCategory(body) {
  if (body.category !== undefined && !SYSTEM_CATEGORIES.includes(body.category)) {
    throw Object.assign(new Error(`Unknown system category "${body.category}" — must match the controlled vocabulary (§3.3)`), { status: 400 });
  }
}

route('POST', /^\/api\/systems$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.system_name || !body.property_id || !body.category) {
    return sendError(res, 400, 'system_name, property_id, category are required');
  }
  validateCategory(body);
  assertPropertyAccess(db, staff, body.property_id);
  const { sql, params: p } = buildInsert('systems', SYSTEM_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'systems', id, body.system_name);
  // Rules engine runs automatically on system create (§3.4 v2 behavior).
  const gen = rulesEngine.generateForProperty(body.property_id, { kind: 'staff', id: staff.id });
  sendJson(res, 201, { ...db.prepare('SELECT * FROM systems WHERE id = ?').get(id), generated_items: gen.created });
});

route('PATCH', /^\/api\/systems\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  if (!existing) return sendError(res, 404, 'System not found');
  assertPropertyAccess(db, staff, existing.property_id);
  const body = await readJson(req);
  validateCategory(body);
  const { sql, params: p } = buildUpdate('systems', SYSTEM_COLS.filter((c) => c !== 'property_id'), body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'systems', id, Object.keys(body).join(','));
  const gen = rulesEngine.generateForProperty(existing.property_id, { kind: 'staff', id: staff.id });
  sendJson(res, 200, { ...db.prepare('SELECT * FROM systems WHERE id = ?').get(id), generated_items: gen.created });
});

// ── Permits ───────────────────────────────────────────────────────────────
const PERMIT_COLS = ['property_id','permit_number','date_filed','date_finaled','status','permit_type',
  'scope_description','contractor_of_record','final_inspection_passed','gap_flag','gap_notes','researched_date','researched_by'];

route('POST', /^\/api\/permits$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.property_id) return sendError(res, 400, 'property_id is required');
  assertPropertyAccess(db, staff, body.property_id);
  body.researched_by = body.researched_by ?? staff.id;
  body.researched_date = body.researched_date ?? today();
  const { sql, params: p } = buildInsert('permits', PERMIT_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'permits', id, body.permit_number || '(gap flag)');
  sendJson(res, 201, db.prepare('SELECT * FROM permits WHERE id = ?').get(id));
});

// ── Visits ────────────────────────────────────────────────────────────────
const VISIT_COLS = ['property_id','advisor_id','visit_date','visit_type','duration_hrs','systems_reviewed',
  'findings_summary','home_record_updated','forward_items_generated','client_satisfaction','follow_up_required','follow_up_notes'];

route('POST', /^\/api\/visits$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.property_id || !body.visit_date || !body.visit_type) {
    return sendError(res, 400, 'property_id, visit_date, visit_type are required');
  }
  assertPropertyAccess(db, staff, body.property_id);
  body.advisor_id = body.advisor_id ?? staff.id;
  const { sql, params: p } = buildInsert('visits', VISIT_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'visits', id, body.visit_type);
  sendJson(res, 201, db.prepare('SELECT * FROM visits WHERE id = ?').get(id));
});

// ── Maintenance Log — job completion flow (US-A11) ────────────────────────
// One action: log the job, close the matching Forward Schedule item, update
// the system's last-service date, regenerate the next recurrence, and open a
// referral fee record when a network contractor did the work.
route('POST', /^\/api\/maintenance-log$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.property_id || !body.date || !body.description) {
    return sendError(res, 400, 'property_id, date, description are required');
  }
  assertPropertyAccess(db, staff, body.property_id);
  const contractor = assertContractorReferable(db, body.contractor_id);

  const LOG_COLS = ['property_id','system_id','date','description','contractor_id','invoice_amount',
    'invoice_reference','advisor_present','outcome_notes','updated_system_record','forward_item_generated'];
  const { sql, params: p } = buildInsert('maintenance_log', LOG_COLS, body);
  const logId = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'maintenance_log', logId, body.description.slice(0, 80));

  let closedItem = null;
  if (body.forward_item_id) {
    const item = db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(body.forward_item_id);
    if (item && item.property_id === body.property_id) {
      db.prepare(
        `UPDATE forward_schedule SET status = 'completed', completed_date = ?, maintenance_log_id = ? WHERE id = ?`
      ).run(body.date, logId, item.id);
      closedItem = item.id;
      audit('staff', staff.id, 'update', 'forward_schedule', item.id, 'completed via job log');
    }
  }

  if (body.system_id) {
    db.prepare('UPDATE systems SET last_service_date = ? WHERE id = ?').run(body.date, body.system_id);
  }

  let fee = null;
  if (contractor && contractor.referral_fee_rate && body.invoice_amount) {
    const feeId = db.prepare(
      `INSERT INTO referral_fees (contractor_id, property_id, maintenance_log_id, job_date, invoice_amount, fee_rate, status)
       VALUES (?,?,?,?,?,?, 'pending')`
    ).run(contractor.id, body.property_id, logId, body.date, body.invoice_amount, contractor.referral_fee_rate).lastInsertRowid;
    fee = feeId;
    audit('staff', staff.id, 'create', 'referral_fees', feeId, `auto from job log ${logId}`);
  }

  // Next recurrence (the "reset" half of US-A11).
  const gen = rulesEngine.generateForProperty(body.property_id, { kind: 'staff', id: staff.id });

  sendJson(res, 201, {
    log: db.prepare('SELECT * FROM maintenance_log WHERE id = ?').get(logId),
    closed_forward_item: closedItem,
    referral_fee_created: fee,
    next_items_generated: gen.created,
    rate_contractor_within_48h: Boolean(contractor), // US-A12 prompt
  });
});

// ── Forward Schedule ──────────────────────────────────────────────────────
const FWD_COLS = ['item_name','property_id','system_id','due_date','due_window','priority','status',
  'est_cost_low','est_cost_high','capital_forecast_item','assigned_contractor_id','completed_date',
  'deferral_risk','advisor_notes'];

route('POST', /^\/api\/schedule$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.item_name || !body.property_id) return sendError(res, 400, 'item_name and property_id are required');
  assertPropertyAccess(db, staff, body.property_id);
  assertContractorReferable(db, body.assigned_contractor_id);
  if (body.due_date && !body.due_window) body.due_window = rulesEngine.dueWindowFor(body.due_date);
  const { sql, params: p } = buildInsert('forward_schedule', FWD_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'forward_schedule', id, body.item_name);
  sendJson(res, 201, db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(id));
});

route('PATCH', /^\/api\/schedule\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(id);
  if (!existing) return sendError(res, 404, 'Schedule item not found');
  assertPropertyAccess(db, staff, existing.property_id);
  const body = await readJson(req);
  if (body.assigned_contractor_id) assertContractorReferable(db, body.assigned_contractor_id);
  const { sql, params: p } = buildUpdate('forward_schedule', FWD_COLS.filter((c) => c !== 'property_id'), body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'forward_schedule', id, Object.keys(body).join(','));
  sendJson(res, 200, db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(id));
});

// ── Contractors & ratings ─────────────────────────────────────────────────
const CONTRACTOR_COLS = ['company_name','primary_contact','email','phone','market_id','trades','license_number',
  'license_expiry','license_current','insurance_on_file','insurance_expiry','first_vetted_date','vetting_notes',
  'referral_fee_rate','preferred_pricing','status','removal_reason'];

route('GET', /^\/api\/contractors$/, async (req, res, { staff, query }) => {
  const db = open();
  const marketId = marketScope(staff, query);
  const scope = scopedWhere(marketId, 'c.market_id');
  const rows = db.prepare(
    `SELECT c.*, m.name AS market_name,
       (SELECT COUNT(*) FROM referral_fees rf WHERE rf.contractor_id = c.id) AS total_referrals,
       (SELECT ROUND(AVG(score),2) FROM contractor_ratings cr WHERE cr.contractor_id = c.id) AS avg_rating,
       (SELECT COUNT(*) FROM contractor_ratings cr WHERE cr.contractor_id = c.id AND cr.complaint_flag = 1) AS complaint_count
     FROM contractors c JOIN markets m ON m.id = c.market_id
     WHERE ${scope.sql} ORDER BY c.company_name`).all(...scope.params);
  const flagDate = rel(90);
  for (const c of rows) {
    c.trades = JSON.parse(c.trades || '[]');
    c.license_expiring = c.license_expiry && c.license_expiry <= flagDate ? 1 : 0;
    c.insurance_expiring = c.insurance_expiry && c.insurance_expiry <= flagDate ? 1 : 0;
    c.referable = c.license_current && c.insurance_on_file && !['removed','inactive'].includes(c.status) ? 1 : 0;
    if (staff.role !== 'founder') delete c.referral_fee_rate; // fee accounting is founder-only in v1 (§2.2)
  }
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/contractors$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (staff.role !== 'founder') body.market_id = staff.market_id;
  if (!body.company_name || !body.market_id) return sendError(res, 400, 'company_name and market_id are required');
  if (Array.isArray(body.trades)) body.trades = JSON.stringify(body.trades);
  const { sql, params: p } = buildInsert('contractors', CONTRACTOR_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'contractors', id, body.company_name);
  sendJson(res, 201, db.prepare('SELECT * FROM contractors WHERE id = ?').get(id));
});

route('PATCH', /^\/api\/contractors\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM contractors WHERE id = ?').get(id);
  if (!existing) return sendError(res, 404, 'Contractor not found');
  if (staff.role !== 'founder' && existing.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');
  const body = await readJson(req);
  if (Array.isArray(body.trades)) body.trades = JSON.stringify(body.trades);
  if (body.referral_fee_rate !== undefined && staff.role !== 'founder') delete body.referral_fee_rate;
  const { sql, params: p } = buildUpdate('contractors', CONTRACTOR_COLS, body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'contractors', id, Object.keys(body).join(','));
  sendJson(res, 200, db.prepare('SELECT * FROM contractors WHERE id = ?').get(id));
});

// US-A12 + business rule #4: three complaint flags → automatic probation.
route('POST', /^\/api\/ratings$/, async (req, res, { staff }) => {
  const db = open();
  const body = await readJson(req);
  if (!body.contractor_id || !body.score) return sendError(res, 400, 'contractor_id and score are required');
  const complaint = body.score <= 2 ? 1 : 0;
  const id = db.prepare(
    `INSERT INTO contractor_ratings (contractor_id, property_id, maintenance_log_id, rating_date, score, client_comments, advisor_notes, complaint_flag)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(body.contractor_id, body.property_id ?? null, body.maintenance_log_id ?? null,
    body.rating_date ?? today(), body.score, body.client_comments ?? null, body.advisor_notes ?? null, complaint).lastInsertRowid;
  audit('staff', staff.id, 'create', 'contractor_ratings', id, `score ${body.score}`);

  let probationTriggered = false;
  if (complaint) {
    const flags = db.prepare(
      'SELECT COUNT(*) AS n FROM contractor_ratings WHERE contractor_id = ? AND complaint_flag = 1').get(body.contractor_id).n;
    const contractor = db.prepare('SELECT * FROM contractors WHERE id = ?').get(body.contractor_id);
    if (flags >= 3 && contractor.status === 'active') {
      db.prepare(`UPDATE contractors SET status = 'probation' WHERE id = ?`).run(body.contractor_id);
      audit('system', null, 'update', 'contractors', body.contractor_id,
        `AUTO: three complaint flags — moved to probation, founder review required (business rule #4)`);
      probationTriggered = true;
    }
  }
  sendJson(res, 201, { id, complaint_flag: complaint, probation_triggered: probationTriggered });
});

// ── Client requests (from the portal) ─────────────────────────────────────
route('PATCH', /^\/api\/requests\/(\d+)$/, async (req, res, { staff, params }) => {
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT r.*, c.market_id FROM client_requests r JOIN clients c ON c.id = r.client_id WHERE r.id = ?').get(id);
  if (!existing) return sendError(res, 404, 'Request not found');
  if (staff.role !== 'founder' && existing.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');
  const body = await readJson(req);
  db.prepare(`UPDATE client_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
    .run(body.status ?? existing.status, body.status === 'resolved' ? staff.id : existing.resolved_by,
      body.status === 'resolved' ? today() : existing.resolved_at, id);
  audit('staff', staff.id, 'update', 'client_requests', id, body.status);
  sendJson(res, 200, db.prepare('SELECT * FROM client_requests WHERE id = ?').get(id));
});

// ── Founder: market dashboard (US-F1, US-F4) ──────────────────────────────
route('GET', /^\/api\/founder\/dashboard$/, async (req, res, { staff, query }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Founder only');
  const db = open();
  const marketId = query.get('market_id') ? Number(query.get('market_id')) : null;
  const scope = scopedWhere(marketId, 'c.market_id');

  const byTier = db.prepare(
    `SELECT tier, COUNT(*) AS n, SUM(annual_rate) AS arr FROM clients c
     WHERE c.status = 'active' AND ${scope.sql} GROUP BY tier`).all(...scope.params);
  const totals = db.prepare(
    `SELECT COUNT(*) AS active_clients, COALESCE(SUM(annual_rate),0) AS arr FROM clients c
     WHERE c.status = 'active' AND ${scope.sql}`).get(...scope.params);
  const renewals = db.prepare(
    `SELECT c.id, c.first_name, c.last_name, c.tier, c.annual_rate, c.subscription_renewal, m.name AS market_name
     FROM clients c JOIN markets m ON m.id = c.market_id
     WHERE c.status = 'active' AND c.subscription_renewal BETWEEN ? AND ? AND ${scope.sql}
     ORDER BY c.subscription_renewal`).all(today(), rel(60), ...scope.params);
  const churn = db.prepare(
    `SELECT c.id, c.first_name, c.last_name, c.tier, c.status, m.name AS market_name
     FROM clients c JOIN markets m ON m.id = c.market_id
     WHERE c.status IN ('paused','cancelled') AND ${scope.sql}`).all(...scope.params);
  const overdueSubs = db.prepare(
    `SELECT s.*, c.first_name, c.last_name FROM subscriptions s JOIN clients c ON c.id = s.client_id
     WHERE s.status = 'overdue' AND ${scope.sql}`).all(...scope.params);

  const books = db.prepare(
    `SELECT u.id, u.full_name, u.role, m.name AS market_name,
            COUNT(c.id) AS client_count, COALESCE(SUM(c.annual_rate),0) AS book_arr
     FROM users u JOIN markets m ON m.id = u.market_id
     LEFT JOIN clients c ON c.advisor_id = u.id AND c.status = 'active'
     WHERE u.active = 1 AND u.role IN ('founder','sme','advisor') ${marketId ? 'AND u.market_id = ?' : ''}
     GROUP BY u.id ORDER BY book_arr DESC`).all(...(marketId ? [marketId] : []));
  for (const b of books) {
    const tiers = db.prepare(
      `SELECT tier, COUNT(*) AS n FROM clients WHERE advisor_id = ? AND status = 'active' GROUP BY tier`).all(b.id);
    b.hours_implied = tiers.reduce((h, t) => h + (TIERS[t.tier]?.advisor_hrs || 0) * t.n, 0);
    b.tiers = tiers;
  }

  const intakeFees = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total FROM intake_fees i JOIN clients c ON c.id = i.client_id WHERE ${scope.sql}`).get(...scope.params);

  sendJson(res, 200, {
    totals: { ...totals, mrr: Math.round(totals.arr / 12 * 100) / 100, intake_fees: intakeFees.total },
    byTier, renewals, churn, overdueSubs, books,
  });
});

// ── Founder: referral fee ledger (US-F2) ──────────────────────────────────
route('GET', /^\/api\/founder\/fees$/, async (req, res, { staff, query }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Referral fee accounting is founder-only (§2.2)');
  const db = open();
  const marketId = query.get('market_id') ? Number(query.get('market_id')) : null;
  const scope = scopedWhere(marketId, 'ct.market_id');
  const fees = db.prepare(
    `SELECT rf.*, ct.company_name, ct.market_id, m.name AS market_name, p.address_line1
     FROM referral_fees rf
     JOIN contractors ct ON ct.id = rf.contractor_id
     JOIN markets m ON m.id = ct.market_id
     LEFT JOIN properties p ON p.id = rf.property_id
     WHERE ${scope.sql} ORDER BY rf.job_date DESC`).all(...scope.params);
  for (const fee of fees) fee.fee_amount = feeAmount(fee);

  // Monthly rollup by contractor — the invoicing view.
  const rollup = {};
  for (const fee of fees) {
    if (!fee.job_date || fee.fee_amount == null) continue;
    const key = `${fee.job_date.slice(0, 7)}|${fee.contractor_id}`;
    rollup[key] ??= { month: fee.job_date.slice(0, 7), contractor_id: fee.contractor_id,
      company_name: fee.company_name, market_name: fee.market_name, jobs: 0, fee_total: 0, pending: 0 };
    rollup[key].jobs++;
    rollup[key].fee_total = Math.round((rollup[key].fee_total + fee.fee_amount) * 100) / 100;
    if (fee.status === 'pending') rollup[key].pending++;
  }
  sendJson(res, 200, { fees, rollup: Object.values(rollup).sort((a, b) => b.month.localeCompare(a.month)) });
});

route('PATCH', /^\/api\/founder\/fees\/(\d+)$/, async (req, res, { staff, params }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Founder only');
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM referral_fees WHERE id = ?').get(id);
  if (!existing) return sendError(res, 404, 'Fee record not found');
  const body = await readJson(req);
  const { sql, params: p } = buildUpdate('referral_fees',
    ['status','invoice_date','payment_date','payment_method','invoice_amount','fee_rate'], body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'referral_fees', id, Object.keys(body).join(','));
  const row = db.prepare('SELECT * FROM referral_fees WHERE id = ?').get(id);
  row.fee_amount = feeAmount(row);
  sendJson(res, 200, row);
});

// ── Founder: rules manager (US-F5) ────────────────────────────────────────
const RULE_COLS = ['task_name','system_category','frequency_type','frequency_value','frequency_unit','seasonal_timing',
  'lead_time_days','est_cost_low','est_cost_high','priority','capital_forecast_item','applies_age_min_yrs',
  'applies_age_max_yrs','home_vintage_before','condition_threshold','market_id','specialist_required','diy_possible',
  'advisor_talking_points','rule_source','active','last_reviewed'];

route('GET', /^\/api\/rules$/, async (req, res) => {
  const db = open();
  const rows = db.prepare(
    `SELECT r.*, m.name AS market_name FROM maintenance_rules r LEFT JOIN markets m ON m.id = r.market_id
     ORDER BY r.active DESC, r.system_category, r.task_name`).all();
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/rules\/preview$/, async (req, res) => {
  const body = await readJson(req);
  if (!body.system_category) return sendError(res, 400, 'system_category is required');
  sendJson(res, 200, rulesEngine.propagationPreview(body));
});

route('POST', /^\/api\/rules$/, async (req, res, { staff }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Rules manager is founder-only');
  const db = open();
  const body = await readJson(req);
  if (!body.task_name || !body.system_category || !body.frequency_type) {
    return sendError(res, 400, 'task_name, system_category, frequency_type are required');
  }
  if (!SYSTEM_CATEGORIES.includes(body.system_category)) {
    return sendError(res, 400, 'system_category must match the controlled vocabulary (§3.3) — the rules-engine join depends on it');
  }
  const { sql, params: p } = buildInsert('maintenance_rules', RULE_COLS, body);
  const id = db.prepare(sql).run(...p).lastInsertRowid;
  audit('staff', staff.id, 'create', 'maintenance_rules', id, body.task_name);
  sendJson(res, 201, db.prepare('SELECT * FROM maintenance_rules WHERE id = ?').get(id));
});

route('PATCH', /^\/api\/rules\/(\d+)$/, async (req, res, { staff, params }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Rules manager is founder-only');
  const db = open();
  const id = Number(params[0]);
  if (!db.prepare('SELECT id FROM maintenance_rules WHERE id = ?').get(id)) return sendError(res, 404, 'Rule not found');
  const body = await readJson(req);
  if (body.system_category && !SYSTEM_CATEGORIES.includes(body.system_category)) {
    return sendError(res, 400, 'system_category must match the controlled vocabulary (§3.3)');
  }
  const { sql, params: p } = buildUpdate('maintenance_rules', RULE_COLS, body, id);
  db.prepare(sql).run(...p);
  audit('staff', staff.id, 'update', 'maintenance_rules', id, Object.keys(body).join(','));
  sendJson(res, 200, db.prepare('SELECT * FROM maintenance_rules WHERE id = ?').get(id));
});

// Business rule #7: rules are deactivated, never deleted.
route('DELETE', /^\/api\/rules\/(\d+)$/, async (req, res, { staff, params }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Rules manager is founder-only');
  const db = open();
  const id = Number(params[0]);
  db.prepare('UPDATE maintenance_rules SET active = 0 WHERE id = ?').run(id);
  audit('staff', staff.id, 'update', 'maintenance_rules', id, 'deactivated (rules are never deleted — business rule #7)');
  sendJson(res, 200, { deactivated: id });
});

route('POST', /^\/api\/rules\/recompute$/, async (req, res, { staff }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Founder only');
  sendJson(res, 200, rulesEngine.recomputeAll({ kind: 'staff', id: staff.id }));
});

// ── Founder: network health (US-F3) ───────────────────────────────────────
route('GET', /^\/api\/founder\/network$/, async (req, res, { staff, query }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Founder only');
  const db = open();
  const marketId = query.get('market_id') ? Number(query.get('market_id')) : null;
  const scope = scopedWhere(marketId, 'c.market_id');
  const flagDate = rel(90);

  const expiring = db.prepare(
    `SELECT c.id, c.company_name, c.license_expiry, c.insurance_expiry, c.insurance_on_file, c.license_current, m.name AS market_name
     FROM contractors c JOIN markets m ON m.id = c.market_id
     WHERE ${scope.sql} AND c.status != 'removed'
       AND (c.license_expiry <= ? OR c.insurance_expiry <= ? OR c.insurance_on_file = 0 OR c.license_current = 0)`
  ).all(...scope.params, flagDate, flagDate);

  const flagged = db.prepare(
    `SELECT c.id, c.company_name, c.status, m.name AS market_name,
            (SELECT COUNT(*) FROM contractor_ratings cr WHERE cr.contractor_id = c.id AND cr.complaint_flag = 1) AS complaints,
            (SELECT ROUND(AVG(score),2) FROM contractor_ratings cr WHERE cr.contractor_id = c.id) AS avg_rating
     FROM contractors c JOIN markets m ON m.id = c.market_id
     WHERE ${scope.sql} AND (
       c.status = 'probation'
       OR (SELECT COUNT(*) FROM contractor_ratings cr WHERE cr.contractor_id = c.id AND cr.complaint_flag = 1) > 0)
     ORDER BY complaints DESC`).all(...scope.params);

  const volumeByTrade = {};
  const fees = db.prepare(
    `SELECT rf.invoice_amount, rf.fee_rate, c.trades FROM referral_fees rf JOIN contractors c ON c.id = rf.contractor_id WHERE ${scope.sql}`
  ).all(...scope.params);
  for (const fee of fees) {
    for (const trade of JSON.parse(fee.trades || '[]')) {
      volumeByTrade[trade] ??= { trade, referrals: 0, job_value: 0 };
      volumeByTrade[trade].referrals++;
      volumeByTrade[trade].job_value += fee.invoice_amount || 0;
    }
  }

  const recentRatings = db.prepare(
    `SELECT cr.*, c.company_name FROM contractor_ratings cr JOIN contractors c ON c.id = cr.contractor_id
     WHERE ${scope.sql} ORDER BY cr.rating_date DESC LIMIT 20`).all(...scope.params);

  sendJson(res, 200, {
    expiring, flagged,
    volumeByTrade: Object.values(volumeByTrade).sort((a, b) => b.job_value - a.job_value),
    recentRatings,
  });
});

// ── Audit trail (founder) ─────────────────────────────────────────────────
route('GET', /^\/api\/founder\/audit$/, async (req, res, { staff }) => {
  if (staff.role !== 'founder') return sendError(res, 403, 'Founder only');
  const db = open();
  sendJson(res, 200, db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
});

module.exports = { routes };
