// Client portal API. Everything here is scoped to the logged-in client's own
// records, and internal-only data is stripped SERVER-SIDE (business rule #9):
// advisor internal notes, client household notes, contractor vetting notes,
// and all referral-fee accounting never leave the API for a client session.

const path = require('node:path');
const fs = require('node:fs');
const { open, audit, today, FILES_DIR } = require('./db');
const rulesEngine = require('./rules-engine');
const { suggest, recordFeedback } = require('./suggest');
const { SYSTEM_CATEGORIES, TIERS, isSelfManaged, isBasic, BASIC_DOC_CAP, SCOPE_DISCLAIMER } = require('./vocab');
const { sendJson, sendError, readJson, readBody, pick, MAX_FILE_BODY } = require('./http-util');

const DAY = 24 * 60 * 60 * 1000;
const rel = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// Client-visible column whitelists — the enforcement mechanism for
// internal-vs-client-visible data. Add a column here to expose it.
const VISIBLE = {
  system: ['id','system_name','category','description','install_date','expected_lifespan','condition_rating',
    'model_number','warranty_expiry','last_service_date','age_years','remaining_life','active'],
  equipment: ['id','system_id','system_name','name','description','make','model_number','serial_number',
    'install_date','expected_lifespan','warranty_expiry','condition_rating','age_years','remaining_life','warranty_status','active'],
  schedule: ['id','item_name','system_id','system_name','equipment_id','equipment_name','due_date','due_window',
    'priority','status','est_cost_low','est_cost_high','capital_forecast_item','completed_date','deferral_risk',
    'contractor_name','overdue','custom','repeat_value','repeat_unit'],
  log: ['id','system_id','system_name','equipment_id','equipment_name','date','description','contractor_name',
    'performed_by','client_contractor_id','my_contractor_name','invoice_amount','outcome_notes'],
  my_contractor: ['id','name','company','specialty','phone','email','notes'],
  permit: ['id','permit_number','date_filed','date_finaled','status','permit_type','scope_description',
    'contractor_of_record','final_inspection_passed','gap_flag','gap_notes'],
  visit: ['id','visit_date','visit_type','advisor_name','systems_reviewed','findings_summary'],
  contractor: ['id','company_name','primary_contact','email','phone','trades','preferred_pricing'],
  document: ['id','document_name','document_type','mime_type','size_bytes','system_id','system_name',
    'equipment_id','equipment_name','maintenance_log_id','permit_id','description','upload_date'],
  property: ['id','address_line1','address_line2','city','state','zip','year_built','square_footage','stories',
    'bedrooms','bathrooms','property_type','construction_type','foundation_type','ownership_date',
    'permit_jurisdiction','intake_date','record_completeness','narrative_summary'],
};

function getClient(session) {
  const c = open().prepare('SELECT * FROM clients WHERE id = ?').get(session.user_id);
  if (!c) throw Object.assign(new Error('Client not found'), { status: 404 });
  return c;
}

function clientProperty(client, propertyIdRaw) {
  const db = open();
  const props = db.prepare('SELECT * FROM properties WHERE client_id = ? AND active = 1').all(client.id);
  if (!props.length) throw Object.assign(new Error('No property on record yet'), { status: 404 });
  if (propertyIdRaw) {
    const p = props.find((x) => x.id === Number(propertyIdRaw));
    if (!p) throw Object.assign(new Error('Not your property'), { status: 403 });
    return { property: p, all: props };
  }
  return { property: props[0], all: props };
}

// Assemble the sanitized record for one property.
function buildPortalRecord(client, property) {
  const db = open();
  const pid = property.id;
  const t = today();

  const shapeSystem = (s) => pick({
    ...s,
    age_years: rulesEngine.systemAgeYears(s, property) != null
      ? Math.round(rulesEngine.systemAgeYears(s, property) * 10) / 10 : null,
    remaining_life: rulesEngine.remainingLife(s, property),
  }, VISIBLE.system);
  const allSystemRows = db.prepare('SELECT * FROM systems WHERE property_id = ?').all(pid);
  const systems = allSystemRows.filter((s) => s.active !== 0).map(shapeSystem)
    .sort((a, b) => (a.remaining_life ?? 999) - (b.remaining_life ?? 999));
  const retiredSystems = allSystemRows.filter((s) => s.active === 0).map(shapeSystem);

  const shapeEquip = (e) => pick({
    ...e,
    age_years: rulesEngine.systemAgeYears(e, property) != null
      ? Math.round(rulesEngine.systemAgeYears(e, property) * 10) / 10 : null,
    remaining_life: rulesEngine.remainingLife(e, property),
    warranty_status: rulesEngine.warrantyStatus(e.warranty_expiry),
  }, VISIBLE.equipment);
  const allEquipRows = db.prepare(
    `SELECT e.*, s.system_name FROM equipment e LEFT JOIN systems s ON s.id = e.system_id
     WHERE e.property_id = ? ORDER BY e.name`).all(pid);
  const equipment = allEquipRows.filter((e) => e.active !== 0).map(shapeEquip);
  const retiredEquipment = allEquipRows.filter((e) => e.active === 0).map(shapeEquip);

  const schedule = db.prepare(
    `SELECT f.*, s.system_name, e.name AS equipment_name, ct.company_name AS contractor_name
     FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
     LEFT JOIN equipment e ON e.id = f.equipment_id
     LEFT JOIN contractors ct ON ct.id = f.assigned_contractor_id
     WHERE f.property_id = ? AND f.status IN ('upcoming','scheduled')
     ORDER BY f.due_date`).all(pid)
    .map((it) => pick({ ...it, overdue: it.due_date && it.due_date < t ? 1 : 0 }, VISIBLE.schedule));

  // Closed tasks feed the timeline view.
  const completedTasks = db.prepare(
    `SELECT f.id, f.item_name, f.completed_date, f.maintenance_log_id, s.system_name, e.name AS equipment_name
     FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
     LEFT JOIN equipment e ON e.id = f.equipment_id
     WHERE f.property_id = ? AND f.status = 'completed' AND f.completed_date IS NOT NULL
     ORDER BY f.completed_date DESC LIMIT 300`).all(pid);

  const log = db.prepare(
    `SELECT l.*, s.system_name, e.name AS equipment_name, ct.company_name AS contractor_name,
            cc.name AS my_contractor_name
     FROM maintenance_log l LEFT JOIN systems s ON s.id = l.system_id
     LEFT JOIN equipment e ON e.id = l.equipment_id
     LEFT JOIN contractors ct ON ct.id = l.contractor_id
     LEFT JOIN client_contractors cc ON cc.id = l.client_contractor_id
     WHERE l.property_id = ? ORDER BY l.date DESC`).all(pid)
    .map((r) => pick(r, VISIBLE.log));

  // Self-serve personal contractor book, with how many services each performed.
  const myContractors = db.prepare(
    `SELECT cc.*, (SELECT COUNT(*) FROM maintenance_log l WHERE l.client_contractor_id = cc.id) AS service_count
     FROM client_contractors cc WHERE cc.client_id = ? AND cc.active = 1 ORDER BY cc.name`).all(client.id)
    .map((c) => ({ ...pick(c, VISIBLE.my_contractor), service_count: c.service_count }));

  const permits = db.prepare('SELECT * FROM permits WHERE property_id = ? ORDER BY date_filed DESC').all(pid)
    .map((r) => pick(r, VISIBLE.permit));

  const visits = db.prepare(
    `SELECT v.*, u.full_name AS advisor_name FROM visits v JOIN users u ON u.id = v.advisor_id
     WHERE v.property_id = ? ORDER BY v.visit_date DESC`).all(pid)
    .map((r) => pick(r, VISIBLE.visit));

  // "My home's roster" (US-C4): contractors who have actually worked on or
  // are assigned to this home. Fee data intentionally absent; the referral
  // relationship itself is disclosed (business rule #6).
  const contractors = db.prepare(
    `SELECT DISTINCT c.* FROM contractors c
     WHERE c.status IN ('active','probation') AND (
       c.id IN (SELECT contractor_id FROM maintenance_log WHERE property_id = ? AND contractor_id IS NOT NULL)
       OR c.id IN (SELECT assigned_contractor_id FROM forward_schedule WHERE property_id = ? AND assigned_contractor_id IS NOT NULL)
     ) ORDER BY c.company_name`).all(pid, pid)
    .map((c) => pick({ ...c, trades: JSON.parse(c.trades || '[]') }, VISIBLE.contractor));

  const documents = db.prepare(
    `SELECT d.*, s.system_name, e.name AS equipment_name FROM documents d
     LEFT JOIN systems s ON s.id = d.system_id
     LEFT JOIN equipment e ON e.id = d.equipment_id
     WHERE d.property_id = ? ORDER BY d.upload_date DESC`).all(pid)
    .map((r) => pick(r, VISIBLE.document));

  // Capital forecast (business rule #8, retargeted): the full itemized forecast
  // is Enhanced and up; Basic (free) sees only a headline number. The line
  // items are computed once, then exposed or summarized by tier.
  const forecastItems = db.prepare(
    `SELECT f.item_name, f.due_date, f.est_cost_low, f.est_cost_high, s.system_name
     FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
     WHERE f.property_id = ? AND f.capital_forecast_item = 1 AND f.status IN ('upcoming','scheduled')
     ORDER BY f.due_date`).all(pid)
    .map((r) => ({ ...r, est_year: r.due_date ? Number(r.due_date.slice(0, 4)) : null }));
  const forecastHeadline = {
    count: forecastItems.length,
    low: forecastItems.reduce((s, f) => s + (f.est_cost_low || 0), 0),
    high: forecastItems.reduce((s, f) => s + (f.est_cost_high || 0), 0),
  };
  const forecastEligible = !isBasic(client.tier);
  const forecast = forecastEligible ? forecastItems : null;

  const advisor = client.advisor_id
    ? open().prepare('SELECT full_name, email, phone FROM users WHERE id = ?').get(client.advisor_id)
    : null;

  return {
    client: pick(client, ['id','first_name','last_name','email','phone','preferred_contact','tier',
      'subscription_start','subscription_renewal','charter_member','status']),
    tier_label: TIERS[client.tier]?.label || client.tier,
    self_serve: isSelfManaged(client.tier),
    is_basic: isBasic(client.tier),
    enhanced_price: TIERS.enhanced.price,
    categories: SYSTEM_CATEGORIES,
    warranty_flags: equipment.filter((e) => ['expired', 'expiring'].includes(e.warranty_status))
      .map((e) => ({ id: e.id, name: e.name, warranty_expiry: e.warranty_expiry, status: e.warranty_status })),
    advisor,
    property: pick(property, VISIBLE.property),
    properties_count: undefined,
    systems, schedule, log, permits, visits, contractors, documents,
    forecast, forecast_eligible: forecastEligible, forecast_headline: forecastHeadline,
    fee_disclosure: 'Steward receives a referral fee from network contractors, paid by the contractor and disclosed in your service agreement. You are never charged more because of it.',
    disclaimer: SCOPE_DISCLAIMER,
    today: t,
    equipment,
    retired_systems: retiredSystems,
    retired_equipment: retiredEquipment,
    completed_tasks: completedTasks,
    my_contractors: myContractors,
  };
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/portal\/record$/, async (req, res, { session, query }) => {
  const client = getClient(session);

  // Self-serve clients build their own record (US-S1): a brand-new account
  // has no property yet, so the portal shows guided onboarding instead of 404.
  const hasProperty = open().prepare(
    'SELECT id FROM properties WHERE client_id = ? AND active = 1').get(client.id);
  if (!hasProperty) {
    return sendJson(res, 200, {
      needs_onboarding: true,
      self_serve: isSelfManaged(client.tier),
      is_basic: isBasic(client.tier),
      client: pick(client, ['id','first_name','last_name','email','tier']),
      tier_label: TIERS[client.tier]?.label || client.tier,
      categories: SYSTEM_CATEGORIES,
      disclaimer: SCOPE_DISCLAIMER,
    });
  }

  const { property, all } = clientProperty(client, query.get('property_id'));
  const record = buildPortalRecord(client, property);
  record.all_properties = all.map((p) => ({ id: p.id, address_line1: p.address_line1, city: p.city }));

  // Hero stats for the overview screen (§5.2.1)
  const openItems = record.schedule;
  const next = openItems.find((i) => i.due_date >= record.today) || openItems[0] || null;
  record.hero = {
    record_completeness: property.record_completeness,
    next_item: next ? { name: next.item_name, due_date: next.due_date, overdue: next.overdue } : null,
    open_items: openItems.length,
    overdue_items: openItems.filter((i) => i.overdue).length,
    systems_healthy: record.systems.filter((s) => (s.condition_rating ?? 3) >= 4).length,
    systems_aging: record.systems.filter((s) => (s.condition_rating ?? 3) <= 2 || (s.remaining_life != null && s.remaining_life <= 3)).length,
    systems_total: record.systems.length,
  };
  sendJson(res, 200, record);
});

route('POST', /^\/api\/portal\/requests$/, async (req, res, { session }) => {
  const client = getClient(session);
  const body = await readJson(req);
  if (!body.subject) return sendError(res, 400, 'subject is required');
  // Requests are allowed before any property exists (e.g. a self-serve
  // client asking to upgrade to an advisor tier, US-S3).
  let property = null;
  try { ({ property } = clientProperty(client, body.property_id)); } catch { /* no property yet */ }
  const db = open();
  const id = db.prepare(
    `INSERT INTO client_requests (client_id, property_id, created_at, subject, body, status) VALUES (?,?,?,?,?,'open')`
  ).run(client.id, property?.id ?? null, new Date().toISOString(), body.subject, body.body ?? null).lastInsertRowid;
  audit('client', client.id, 'create', 'client_requests', id, body.subject.slice(0, 80));
  sendJson(res, 201, db.prepare('SELECT * FROM client_requests WHERE id = ?').get(id));
});

// ── Self-Serve record building (US-S1/S2) ──────────────────────────────────
// Only self_serve clients may write to their own record; on advisor tiers the
// advisor is the author of the Home Record and the portal stays read-only.

// Self-managed tiers (Basic, Enhanced, legacy Self-Serve) build their own
// record; on the human tiers the advisor is the author and the portal is
// read-only.
function assertSelfServe(client) {
  if (!isSelfManaged(client.tier)) {
    throw Object.assign(new Error(
      'Record editing is a self-managed feature — on your membership, your advisor maintains the Home Record for you.'), { status: 403 });
  }
}

const PROPERTY_WRITE = ['address_line1','address_line2','city','state','zip','year_built','square_footage',
  'stories','bedrooms','bathrooms','property_type','construction_type','foundation_type','ownership_date'];
const SYSTEM_WRITE = ['system_name','category','description','install_date','age_at_intake','expected_lifespan',
  'condition_rating','model_number','serial_number','warranty_expiry','last_service_date'];

route('POST', /^\/api\/portal\/property$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const db = open();
  const existing = db.prepare('SELECT id FROM properties WHERE client_id = ? AND active = 1').get(client.id);
  if (existing) return sendError(res, 409, 'You already have a home on record');
  const body = await readJson(req);
  if (!body.address_line1) return sendError(res, 400, 'Address is required');

  const cols = PROPERTY_WRITE.filter((c) => body[c] !== undefined && body[c] !== null);
  const id = db.prepare(
    `INSERT INTO properties (${cols.join(',')}${cols.length ? ',' : ''}client_id, market_id, intake_date, record_completeness, active)
     VALUES (${cols.map(() => '?').join(',')}${cols.length ? ',' : ''}?,?,?,?,1)`
  ).run(...cols.map((c) => body[c]), client.id, client.market_id, today(), 25).lastInsertRowid;
  audit('client', client.id, 'create', 'properties', id, `self-serve onboarding: ${body.address_line1}`);
  sendJson(res, 201, pick(db.prepare('SELECT * FROM properties WHERE id = ?').get(id), VISIBLE.property));
});

route('POST', /^\/api\/portal\/systems$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  if (!body.system_name || !body.category) return sendError(res, 400, 'System name and category are required');
  if (!SYSTEM_CATEGORIES.includes(body.category)) return sendError(res, 400, 'Pick a category from the list');

  const db = open();
  const cols = SYSTEM_WRITE.filter((c) => body[c] !== undefined && body[c] !== null);
  const id = db.prepare(
    `INSERT INTO systems (${cols.join(',')}, property_id) VALUES (${cols.map(() => '?').join(',')}, ?)`
  ).run(...cols.map((c) => body[c]), property.id).lastInsertRowid;
  audit('client', client.id, 'create', 'systems', id, body.system_name);
  // The platform's intelligence without the service layer (US-S2): the rules
  // engine runs on every self-entered system, same as an advisor entry.
  const gen = rulesEngine.generateForProperty(property.id, { kind: 'client', id: client.id });
  const system = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  sendJson(res, 201, {
    ...pick({
      ...system,
      age_years: rulesEngine.systemAgeYears(system, property) != null
        ? Math.round(rulesEngine.systemAgeYears(system, property) * 10) / 10 : null,
      remaining_life: rulesEngine.remainingLife(system, property),
    }, VISIBLE.system),
    generated_items: gen.created,
  });
});

route('PATCH', /^\/api\/portal\/systems\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your system');
  const body = await readJson(req);
  if (body.category !== undefined && !SYSTEM_CATEGORIES.includes(body.category)) {
    return sendError(res, 400, 'Pick a category from the list');
  }
  const cols = SYSTEM_WRITE.filter((c) => body[c] !== undefined);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE systems SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => body[c]), id);
  audit('client', client.id, 'update', 'systems', id, cols.join(','));
  const gen = rulesEngine.generateForProperty(property.id, { kind: 'client', id: client.id });
  sendJson(res, 200, { updated: id, generated_items: gen.created });
});

// Retire a whole system: keep its history, stop scheduling it, and pull its
// components down with it. Logs the retirement as a dated event.
route('POST', /^\/api\/portal\/systems\/(\d+)\/retire$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  if (!sys || sys.property_id !== property.id) return sendError(res, 404, 'Not your system');
  const body = await readJson(req).catch(() => ({}));
  db.prepare('UPDATE systems SET active = 0 WHERE id = ?').run(id);
  db.prepare('UPDATE equipment SET active = 0 WHERE system_id = ? AND active = 1').run(id);
  db.prepare("UPDATE forward_schedule SET status = 'cancelled' WHERE system_id = ? AND status IN ('upcoming','scheduled')").run(id);
  db.prepare(`INSERT INTO maintenance_log (property_id, system_id, date, description, performed_by)
    VALUES (?,?,?,?,?)`).run(property.id, id, today(), `Retired: ${sys.system_name}${body.reason ? ` — ${body.reason}` : ''}`, 'homeowner');
  audit('client', client.id, 'update', 'systems', id, 'retired');
  sendJson(res, 200, { retired: id });
});

// Replace a whole system: retire the old shell, stand up a fresh one with the
// same identity and a reset clock, carry the components over (replace those
// individually if they changed too), and regenerate the schedule.
route('POST', /^\/api\/portal\/systems\/(\d+)\/replace$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const old = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  if (!old || old.property_id !== property.id) return sendError(res, 404, 'Not your system');
  const body = await readJson(req);
  db.prepare('UPDATE systems SET active = 0 WHERE id = ?').run(id);
  db.prepare("UPDATE forward_schedule SET status = 'cancelled' WHERE system_id = ? AND status IN ('upcoming','scheduled')").run(id);
  const newId = db.prepare(
    `INSERT INTO systems (system_name, property_id, category, description, install_date, expected_lifespan,
       condition_rating, model_number, serial_number, warranty_expiry, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,1)`
  ).run(body.system_name || old.system_name, property.id, old.category, body.description ?? old.description,
    body.install_date || today(), body.expected_lifespan ?? old.expected_lifespan,
    body.condition_rating ?? 5, body.model_number ?? null, body.serial_number ?? null,
    body.warranty_expiry ?? null).lastInsertRowid;
  db.prepare('UPDATE equipment SET system_id = ? WHERE system_id = ? AND active = 1').run(newId, id);
  db.prepare(`INSERT INTO maintenance_log (property_id, system_id, date, description, performed_by)
    VALUES (?,?,?,?,?)`).run(property.id, newId, body.install_date || today(),
    `Replaced ${old.system_name}${body.note ? ` — ${body.note}` : ''}`, 'homeowner');
  const gen = rulesEngine.generateForProperty(property.id, { kind: 'client', id: client.id });
  audit('client', client.id, 'create', 'systems', newId, `replaced system ${id}`);
  sendJson(res, 201, { id: newId, generated_items: gen.created });
});

route('POST', /^\/api\/portal\/recompute$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  sendJson(res, 200, rulesEngine.generateForProperty(property.id, { kind: 'client', id: client.id }));
});

// ── Self-Serve equipment (warranty/lifespan record-keeping) ────────────────
const EQUIPMENT_WRITE = ['system_id','name','description','make','model_number','serial_number',
  'install_date','expected_lifespan','warranty_expiry','condition_rating','active'];

function assertOwnSystem(db, property, systemId) {
  if (systemId == null) return;
  const s = db.prepare('SELECT property_id FROM systems WHERE id = ?').get(systemId);
  if (!s || s.property_id !== property.id) {
    throw Object.assign(new Error('That system is not on your home'), { status: 400 });
  }
}
function assertOwnEquipment(db, property, equipmentId) {
  if (equipmentId == null) return;
  const e = db.prepare('SELECT property_id FROM equipment WHERE id = ?').get(equipmentId);
  if (!e || e.property_id !== property.id) {
    throw Object.assign(new Error('That equipment is not on your home'), { status: 400 });
  }
}

route('POST', /^\/api\/portal\/equipment$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  if (!body.name) return sendError(res, 400, 'Give the equipment a name');
  const db = open();
  assertOwnSystem(db, property, body.system_id);
  const cols = EQUIPMENT_WRITE.filter((c) => body[c] !== undefined && body[c] !== null);
  const id = db.prepare(
    `INSERT INTO equipment (${cols.join(',')}${cols.length ? ',' : ''}property_id) VALUES (${cols.map(() => '?').join(',')}${cols.length ? ',' : ''}?)`
  ).run(...cols.map((c) => body[c]), property.id).lastInsertRowid;
  audit('client', client.id, 'create', 'equipment', id, body.name);
  sendJson(res, 201, { id });
});

route('PATCH', /^\/api\/portal\/equipment\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your equipment');
  const body = await readJson(req);
  if (body.system_id !== undefined) assertOwnSystem(db, property, body.system_id);
  const cols = EQUIPMENT_WRITE.filter((c) => body[c] !== undefined);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE equipment SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => body[c]), id);
  audit('client', client.id, 'update', 'equipment', id, cols.join(','));
  sendJson(res, 200, { updated: id });
});

// Retire one component (keeps its history in the system's record).
route('POST', /^\/api\/portal\/equipment\/(\d+)\/retire$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  if (!eq || eq.property_id !== property.id) return sendError(res, 404, 'Not your equipment');
  const body = await readJson(req).catch(() => ({}));
  db.prepare('UPDATE equipment SET active = 0 WHERE id = ?').run(id);
  db.prepare(`INSERT INTO maintenance_log (property_id, system_id, equipment_id, date, description, performed_by)
    VALUES (?,?,?,?,?,?)`).run(property.id, eq.system_id ?? null, id, today(),
    `Retired: ${eq.name}${body.reason ? ` — ${body.reason}` : ''}`, 'homeowner');
  audit('client', client.id, 'update', 'equipment', id, 'retired');
  sendJson(res, 200, { retired: id });
});

// Replace one component: retire the old, add its successor under the same
// system with a fresh clock, and log the swap.
route('POST', /^\/api\/portal\/equipment\/(\d+)\/replace$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const old = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  if (!old || old.property_id !== property.id) return sendError(res, 404, 'Not your equipment');
  const body = await readJson(req);
  db.prepare('UPDATE equipment SET active = 0 WHERE id = ?').run(id);
  const newId = db.prepare(
    `INSERT INTO equipment (property_id, system_id, name, description, make, model_number, serial_number,
       install_date, expected_lifespan, warranty_expiry, condition_rating, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
  ).run(property.id, old.system_id ?? null, body.name || old.name, body.description ?? old.description,
    body.make ?? old.make, body.model_number ?? null, body.serial_number ?? null,
    body.install_date || today(), body.expected_lifespan ?? old.expected_lifespan,
    body.warranty_expiry ?? null, body.condition_rating ?? 5).lastInsertRowid;
  db.prepare(`INSERT INTO maintenance_log (property_id, system_id, equipment_id, date, description, performed_by)
    VALUES (?,?,?,?,?,?)`).run(property.id, old.system_id ?? null, newId, body.install_date || today(),
    `Replaced ${old.name}${body.note ? ` — ${body.note}` : ''}`, 'homeowner');
  audit('client', client.id, 'create', 'equipment', newId, `replaced equipment ${id}`);
  sendJson(res, 201, { id: newId });
});

// ── Self-Serve service logging (both flows: mark-done and ad-hoc) ─────────
// A slim version of the advisor job-completion: closes the schedule item if
// one is given, updates the system's last-service date, and regenerates the
// next recurrence. No contractor network, so "performed by" is free text.
route('POST', /^\/api\/portal\/service$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  if (!body.date || !body.description) return sendError(res, 400, 'Date and a description of the work are required');
  const db = open();
  assertOwnSystem(db, property, body.system_id);
  assertOwnEquipment(db, property, body.equipment_id);

  let forwardItem = null;
  if (body.forward_item_id) {
    forwardItem = db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(body.forward_item_id);
    if (!forwardItem || forwardItem.property_id !== property.id) return sendError(res, 404, 'Not your schedule item');
    if (!['upcoming', 'scheduled'].includes(forwardItem.status)) return sendError(res, 409, 'That item is already closed');
  }

  assertOwnMyContractor(db, client, body.client_contractor_id);

  const logId = db.prepare(
    `INSERT INTO maintenance_log (property_id, system_id, equipment_id, date, description, invoice_amount, performed_by, client_contractor_id, outcome_notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(property.id, body.system_id ?? forwardItem?.system_id ?? null, body.equipment_id ?? null,
    body.date, body.description, body.invoice_amount ?? null, body.performed_by ?? null,
    body.client_contractor_id ?? null, body.outcome_notes ?? null).lastInsertRowid;
  audit('client', client.id, 'create', 'maintenance_log', logId, body.description.slice(0, 80));

  let nextOccurrence = null;
  if (forwardItem) {
    db.prepare(`UPDATE forward_schedule SET status = 'completed', completed_date = ?, maintenance_log_id = ? WHERE id = ?`)
      .run(body.date, logId, forwardItem.id);
    audit('client', client.id, 'update', 'forward_schedule', forwardItem.id, 'completed via portal service log');

    // Custom repeating tasks schedule their next occurrence on completion.
    if (forwardItem.custom && forwardItem.repeat_value && forwardItem.repeat_unit) {
      const nextDue = addToDate(body.date, forwardItem.repeat_value, forwardItem.repeat_unit);
      nextOccurrence = db.prepare(
        `INSERT INTO forward_schedule (item_name, property_id, system_id, equipment_id, due_date, due_window,
           priority, status, est_cost_low, est_cost_high, deferral_risk, custom, repeat_value, repeat_unit)
         VALUES (?,?,?,?,?,?,?, 'upcoming', ?,?,?,1,?,?)`
      ).run(forwardItem.item_name, property.id, forwardItem.system_id, forwardItem.equipment_id,
        nextDue, rulesEngine.dueWindowFor(nextDue), forwardItem.priority,
        forwardItem.est_cost_low, forwardItem.est_cost_high, forwardItem.deferral_risk,
        forwardItem.repeat_value, forwardItem.repeat_unit).lastInsertRowid;
      audit('client', client.id, 'create', 'forward_schedule', nextOccurrence, 'next occurrence of repeating custom task');
    }
  }
  const systemId = body.system_id ?? forwardItem?.system_id;
  if (systemId) db.prepare('UPDATE systems SET last_service_date = ? WHERE id = ?').run(body.date, systemId);

  const gen = rulesEngine.generateForProperty(property.id, { kind: 'client', id: client.id });
  sendJson(res, 201, {
    log_id: logId,
    closed_forward_item: forwardItem?.id ?? null,
    next_occurrence: nextOccurrence,
    next_items_generated: gen.created,
  });
});

function addToDate(dateStr, value, unit) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const days = unit === 'years' ? Math.round(value * 365.25)
    : unit === 'months' ? Math.round(value * 30.44) : value;
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function assertOwnMyContractor(db, client, id) {
  if (id == null) return;
  const c = db.prepare('SELECT client_id FROM client_contractors WHERE id = ?').get(id);
  if (!c || c.client_id !== client.id) {
    throw Object.assign(new Error('That contractor is not in your book'), { status: 400 });
  }
}

// ── Self-Serve: edit & delete service records ──────────────────────────────
const SERVICE_WRITE = ['date','description','invoice_amount','performed_by','client_contractor_id','outcome_notes',
  'system_id','equipment_id'];

route('PATCH', /^\/api\/portal\/service\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM maintenance_log WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your service record');
  const body = await readJson(req);
  assertOwnSystem(db, property, body.system_id);
  assertOwnEquipment(db, property, body.equipment_id);
  assertOwnMyContractor(db, client, body.client_contractor_id);
  const cols = SERVICE_WRITE.filter((c) => body[c] !== undefined);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE maintenance_log SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => body[c]), id);
  audit('client', client.id, 'update', 'maintenance_log', id, cols.join(','));
  sendJson(res, 200, { updated: id });
});

route('DELETE', /^\/api\/portal\/service\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM maintenance_log WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your service record');
  // Documents stay (unlinked); a task this service closed stays closed.
  db.prepare('UPDATE documents SET maintenance_log_id = NULL WHERE maintenance_log_id = ?').run(id);
  db.prepare('UPDATE forward_schedule SET maintenance_log_id = NULL WHERE maintenance_log_id = ?').run(id);
  db.prepare('UPDATE contractor_ratings SET maintenance_log_id = NULL WHERE maintenance_log_id = ?').run(id);
  db.prepare('UPDATE referral_fees SET maintenance_log_id = NULL WHERE maintenance_log_id = ?').run(id);
  db.prepare('DELETE FROM maintenance_log WHERE id = ?').run(id);
  audit('client', client.id, 'delete', 'maintenance_log', id, existing.description.slice(0, 80));
  sendJson(res, 200, { deleted: id });
});

// ── Self-Serve: personal contractor book ───────────────────────────────────
const MY_CONTRACTOR_WRITE = ['name','company','specialty','phone','email','notes','active'];

route('POST', /^\/api\/portal\/contractors$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const body = await readJson(req);
  if (!body.name) return sendError(res, 400, 'Give the contractor a name');
  const db = open();
  const cols = MY_CONTRACTOR_WRITE.filter((c) => body[c] !== undefined && body[c] !== null);
  const id = db.prepare(
    `INSERT INTO client_contractors (${cols.join(',')}${cols.length ? ',' : ''}client_id) VALUES (${cols.map(() => '?').join(',')}${cols.length ? ',' : ''}?)`
  ).run(...cols.map((c) => body[c]), client.id).lastInsertRowid;
  audit('client', client.id, 'create', 'client_contractors', id, body.name);
  sendJson(res, 201, { id });
});

route('PATCH', /^\/api\/portal\/contractors\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM client_contractors WHERE id = ?').get(id);
  if (!existing || existing.client_id !== client.id) return sendError(res, 404, 'Not your contractor');
  const body = await readJson(req);
  const cols = MY_CONTRACTOR_WRITE.filter((c) => body[c] !== undefined);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE client_contractors SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => body[c]), id);
  audit('client', client.id, 'update', 'client_contractors', id, cols.join(','));
  sendJson(res, 200, { updated: id });
});

// ── Self-Serve: custom tasks (own maintenance schedule) ────────────────────
const TASK_WRITE = ['item_name','due_date','priority','system_id','equipment_id','deferral_risk',
  'est_cost_low','est_cost_high','repeat_value','repeat_unit'];

route('POST', /^\/api\/portal\/tasks$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  if (!body.item_name || !body.due_date) return sendError(res, 400, 'Task name and due date are required');
  const db = open();
  assertOwnSystem(db, property, body.system_id);
  assertOwnEquipment(db, property, body.equipment_id);
  const id = db.prepare(
    `INSERT INTO forward_schedule (item_name, property_id, system_id, equipment_id, due_date, due_window,
       priority, status, est_cost_low, est_cost_high, deferral_risk, custom, repeat_value, repeat_unit)
     VALUES (?,?,?,?,?,?,?, 'upcoming', ?,?,?,1,?,?)`
  ).run(body.item_name, property.id, body.system_id ?? null, body.equipment_id ?? null,
    body.due_date, rulesEngine.dueWindowFor(body.due_date), body.priority ?? 'standard',
    body.est_cost_low ?? null, body.est_cost_high ?? null, body.deferral_risk ?? null,
    body.repeat_value ?? null, body.repeat_unit ?? null).lastInsertRowid;
  audit('client', client.id, 'create', 'forward_schedule', id, `custom task: ${body.item_name}`);
  sendJson(res, 201, { id });
});

route('PATCH', /^\/api\/portal\/tasks\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your task');
  if (!existing.custom) return sendError(res, 403, 'Engine-generated tasks are managed by the maintenance engine — mark them done or leave them; only your own tasks are editable');
  const body = await readJson(req);
  assertOwnSystem(db, property, body.system_id);
  assertOwnEquipment(db, property, body.equipment_id);
  const cols = TASK_WRITE.filter((c) => body[c] !== undefined);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE forward_schedule SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => body[c]), id);
  if (body.due_date) {
    db.prepare('UPDATE forward_schedule SET due_window = ? WHERE id = ?')
      .run(rulesEngine.dueWindowFor(body.due_date), id);
  }
  audit('client', client.id, 'update', 'forward_schedule', id, cols.join(','));
  sendJson(res, 200, { updated: id });
});

// ── AI suggestions (Claude API when configured, rule library otherwise) ───
// Modest per-client rate limit since the AI path costs real money.
const suggestUses = new Map(); // client_id -> { count, resetAt }
function suggestAllowed(clientId) {
  const now = Date.now();
  const entry = suggestUses.get(clientId);
  if (!entry || entry.resetAt < now) {
    suggestUses.set(clientId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= 30;
}

// Assemble the item's own surrounding context so suggestions consider the
// whole picture (equipment inside it, documents on file, service history, and
// what's already scheduled) — not just a name/model lookup. Ownership-scoped.
function suggestRelated(db, property, kind, id) {
  const related = { equipment: [], documents: [], history: [], scheduled: [] };
  if (!id) return related;
  const active = "status NOT IN ('completed','cancelled')";
  if (kind === 'system') {
    const sys = db.prepare('SELECT id FROM systems WHERE id = ? AND property_id = ?').get(id, property.id);
    if (!sys) return related;
    related.equipment = db.prepare('SELECT name, make, model_number, install_date FROM equipment WHERE system_id = ? AND active = 1').all(id);
    related.documents = db.prepare('SELECT document_name, document_type FROM documents WHERE system_id = ?').all(id);
    related.history = db.prepare('SELECT date, description FROM maintenance_log WHERE system_id = ? ORDER BY date DESC LIMIT 10').all(id);
    related.scheduled = db.prepare(`SELECT item_name, due_date FROM forward_schedule WHERE system_id = ? AND ${active}`).all(id);
  } else {
    const eq = db.prepare('SELECT id FROM equipment WHERE id = ? AND property_id = ?').get(id, property.id);
    if (!eq) return related;
    related.documents = db.prepare('SELECT document_name, document_type FROM documents WHERE equipment_id = ?').all(id);
    related.history = db.prepare('SELECT date, description FROM maintenance_log WHERE equipment_id = ? ORDER BY date DESC LIMIT 10').all(id);
    related.scheduled = db.prepare(`SELECT item_name, due_date FROM forward_schedule WHERE equipment_id = ? AND ${active}`).all(id);
  }
  return related;
}

route('POST', /^\/api\/portal\/suggest$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  if (!suggestAllowed(client.id)) {
    return sendError(res, 429, 'Suggestion limit reached for this hour — try again later.');
  }
  const body = await readJson(req);
  if (!body.name && !body.category) return sendError(res, 400, 'Give the item a name or category first');
  const db = open();
  const kind = body.kind === 'equipment' ? 'equipment' : 'system';
  const related = suggestRelated(db, property, kind, body.id ? Number(body.id) : null);
  const result = await suggest({
    kind, name: body.name, category: body.category, make: body.make, model_number: body.model_number,
    install_date: body.install_date, age_at_intake: body.age_at_intake, expected_lifespan: body.expected_lifespan,
    warranty_expiry: body.warranty_expiry, last_service_date: body.last_service_date,
    condition_rating: body.condition_rating, description: body.description,
  }, property, related, { allowAI: !isBasic(client.tier) });
  result.upgrade = isBasic(client.tier); // Basic gets rules-based; nudge to Enhanced
  audit('client', client.id, 'create', null, null, `suggestion (${result.source}) for ${body.name || body.category}`);
  sendJson(res, 200, result);
});

// The learning loop: record which suggested tasks the homeowner accepted so
// the fleet signal strengthens for the next comparable item.
route('POST', /^\/api\/portal\/suggest\/accept$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (!tasks.length) return sendJson(res, 200, { recorded: 0 });
  const recorded = recordFeedback(open(), {
    kind: body.kind === 'equipment' ? 'equipment' : 'system',
    category: body.category, make: body.make,
  }, tasks, body.source, client.id, property.id);
  sendJson(res, 200, { recorded });
});

// Self-upgrade Basic → Enhanced. Payments are bypassed in this build (same
// posture as open signup), so it flips the tier and refreshes the subscription.
route('POST', /^\/api\/portal\/upgrade$/, async (req, res, { session }) => {
  const client = getClient(session);
  if (client.tier !== 'basic') return sendError(res, 400, 'Only Basic accounts can self-upgrade to Enhanced.');
  const db = open();
  const now = today();
  const renewal = new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10);
  db.prepare('UPDATE clients SET tier = ?, annual_rate = ?, subscription_start = COALESCE(subscription_start, ?), subscription_renewal = ? WHERE id = ?')
    .run('enhanced', TIERS.enhanced.price, now, renewal, client.id);
  db.prepare(`INSERT INTO subscriptions (client_id, period_start, period_end, tier, annual_amount, discount_applied, payment_date, payment_method, status)
    VALUES (?,?,?, 'enhanced', ?, 'payments bypassed (demo)', ?, 'Card', 'paid')`)
    .run(client.id, now, renewal, TIERS.enhanced.price, now);
  audit('client', client.id, 'update', 'clients', client.id, 'upgraded basic → enhanced');
  sendJson(res, 200, { tier: 'enhanced' });
});

route('DELETE', /^\/api\/portal\/tasks\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM forward_schedule WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your task');
  if (!existing.custom) return sendError(res, 403, 'Only your own tasks can be deleted');
  db.prepare('DELETE FROM forward_schedule WHERE id = ?').run(id);
  audit('client', client.id, 'delete', 'forward_schedule', id, existing.item_name);
  sendJson(res, 200, { deleted: id });
});

// ── Self-Serve: permit history (record permits from work you've had done) ──
// Client-editable fields only. gap_flag / gap_notes / researched_* stay
// advisor-owned and never accept client input.
const PERMIT_WRITE = ['permit_number','date_filed','date_finaled','status','permit_type',
  'scope_description','contractor_of_record','final_inspection_passed'];
const PERMIT_STATUS = ['finaled','open','expired','pending','unknown'];
const PERMIT_TYPES = ['electrical','plumbing','structural','mechanical','general_building','demolition','other'];

function cleanPermitBody(body) {
  const out = {};
  for (const c of PERMIT_WRITE) {
    if (body[c] === undefined) continue;
    let v = body[c];
    if (c === 'status' && v != null && !PERMIT_STATUS.includes(v)) v = 'unknown';
    if (c === 'permit_type' && v != null && !PERMIT_TYPES.includes(v)) v = 'other';
    if (c === 'final_inspection_passed' && v != null) v = v ? 1 : 0;
    out[c] = v === '' ? null : v;
  }
  return out;
}

route('POST', /^\/api\/portal\/permits$/, async (req, res, { session }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const body = await readJson(req);
  const fields = cleanPermitBody(body);
  if (!fields.permit_number && !fields.scope_description) {
    return sendError(res, 400, 'Give the permit a number or a scope description');
  }
  const cols = Object.keys(fields);
  const db = open();
  const id = db.prepare(
    `INSERT INTO permits (property_id${cols.length ? ',' + cols.join(',') : ''})
     VALUES (?${cols.map(() => ',?').join('')})`
  ).run(property.id, ...cols.map((c) => fields[c])).lastInsertRowid;
  audit('client', client.id, 'create', 'permits', id, fields.permit_number || fields.scope_description);
  sendJson(res, 201, { id });
});

route('PATCH', /^\/api\/portal\/permits\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM permits WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your permit');
  const fields = cleanPermitBody(await readJson(req));
  const cols = Object.keys(fields);
  if (!cols.length) return sendError(res, 400, 'Nothing to update');
  db.prepare(`UPDATE permits SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), id);
  audit('client', client.id, 'update', 'permits', id, cols.join(','));
  sendJson(res, 200, { updated: id });
});

route('DELETE', /^\/api\/portal\/permits\/(\d+)$/, async (req, res, { session, params }) => {
  const client = getClient(session);
  assertSelfServe(client);
  const { property } = clientProperty(client, null);
  const db = open();
  const id = Number(params[0]);
  const existing = db.prepare('SELECT * FROM permits WHERE id = ?').get(id);
  if (!existing || existing.property_id !== property.id) return sendError(res, 404, 'Not your permit');
  // A client can only remove a permit they entered — never advisor-researched
  // records (those carry a researched_by stamp).
  if (existing.researched_by != null) return sendError(res, 403, 'This permit was researched by your advisor and can’t be deleted here');
  db.prepare('UPDATE documents SET permit_id = NULL WHERE permit_id = ?').run(id);
  db.prepare('DELETE FROM permits WHERE id = ?').run(id);
  audit('client', client.id, 'delete', 'permits', id, existing.permit_number || existing.scope_description);
  sendJson(res, 200, { deleted: id });
});

route('GET', /^\/api\/portal\/requests$/, async (req, res, { session }) => {
  const client = getClient(session);
  sendJson(res, 200, open().prepare(
    'SELECT id, property_id, created_at, subject, body, status, resolved_at FROM client_requests WHERE client_id = ? ORDER BY created_at DESC'
  ).all(client.id));
});

// Client document upload (US-C5). Raw body upload; metadata in query string.
route('POST', /^\/api\/portal\/documents$/, async (req, res, { session, query }) => {
  const client = getClient(session);
  const name = (query.get('name') || 'upload').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const type = query.get('type') || 'other';
  const { property } = clientProperty(client, query.get('property_id'));
  const buf = await readBody(req, MAX_FILE_BODY);
  if (!buf.length) return sendError(res, 400, 'Empty upload');

  const db = open();
  // Basic (free) tier has a document storage cap; Enhanced and up are unlimited.
  if (isBasic(client.tier)) {
    const used = db.prepare('SELECT COUNT(*) n FROM documents WHERE property_id = ?').get(property.id).n;
    if (used >= BASIC_DOC_CAP) {
      return sendError(res, 403, `Basic includes ${BASIC_DOC_CAP} documents. Upgrade to Enhanced for unlimited storage.`);
    }
  }
  // Optional relates-to links, each verified against the client's own home.
  const systemId = Number(query.get('system_id')) || null;
  const equipmentId = Number(query.get('equipment_id')) || null;
  const logId = Number(query.get('log_id')) || null;
  const permitId = Number(query.get('permit_id')) || null;
  assertOwnSystem(db, property, systemId);
  assertOwnEquipment(db, property, equipmentId);
  if (logId) {
    const l = db.prepare('SELECT property_id FROM maintenance_log WHERE id = ?').get(logId);
    if (!l || l.property_id !== property.id) return sendError(res, 400, 'That service entry is not on your home');
  }
  if (permitId) {
    const pm = db.prepare('SELECT property_id FROM permits WHERE id = ?').get(permitId);
    if (!pm || pm.property_id !== property.id) return sendError(res, 400, 'That permit is not on your home');
  }

  const fileName = `${Date.now()}-c${client.id}-${name}`;
  fs.writeFileSync(path.join(FILES_DIR, fileName), buf);
  const id = db.prepare(
    `INSERT INTO documents (document_name, document_type, file_path, mime_type, size_bytes, property_id, system_id, equipment_id, maintenance_log_id, permit_id, description, upload_date, uploaded_by_client)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(name, type, fileName, req.headers['content-type'] || 'application/octet-stream',
    buf.length, property.id, systemId, equipmentId, logId, permitId,
    query.get('description') || null, today(), client.id).lastInsertRowid;
  audit('client', client.id, 'create', 'documents', id, name);
  sendJson(res, 201, pick(db.prepare('SELECT * FROM documents WHERE id = ?').get(id), VISIBLE.document));
});

module.exports = { routes, buildPortalRecord, clientProperty, getClient };
