// Client portal API. Everything here is scoped to the logged-in client's own
// records, and internal-only data is stripped SERVER-SIDE (business rule #9):
// advisor internal notes, client household notes, contractor vetting notes,
// and all referral-fee accounting never leave the API for a client session.

const path = require('node:path');
const fs = require('node:fs');
const { open, audit, today, FILES_DIR } = require('./db');
const rulesEngine = require('./rules-engine');
const { TIERS, SCOPE_DISCLAIMER } = require('./vocab');
const { sendJson, sendError, readJson, readBody, pick, MAX_FILE_BODY } = require('./http-util');

const DAY = 24 * 60 * 60 * 1000;
const rel = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// Client-visible column whitelists — the enforcement mechanism for
// internal-vs-client-visible data. Add a column here to expose it.
const VISIBLE = {
  system: ['id','system_name','category','description','install_date','expected_lifespan','condition_rating',
    'model_number','warranty_expiry','last_service_date','age_years','remaining_life'],
  schedule: ['id','item_name','system_id','system_name','due_date','due_window','priority','status',
    'est_cost_low','est_cost_high','capital_forecast_item','completed_date','deferral_risk','contractor_name','overdue'],
  log: ['id','system_id','system_name','date','description','contractor_name','invoice_amount','outcome_notes'],
  permit: ['id','permit_number','date_filed','date_finaled','status','permit_type','scope_description',
    'contractor_of_record','final_inspection_passed','gap_flag','gap_notes'],
  visit: ['id','visit_date','visit_type','advisor_name','systems_reviewed','findings_summary'],
  contractor: ['id','company_name','primary_contact','email','phone','trades','preferred_pricing'],
  document: ['id','document_name','document_type','mime_type','size_bytes','system_id','description','upload_date'],
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

  const systems = db.prepare('SELECT * FROM systems WHERE property_id = ?').all(pid)
    .map((s) => pick({
      ...s,
      age_years: rulesEngine.systemAgeYears(s, property) != null
        ? Math.round(rulesEngine.systemAgeYears(s, property) * 10) / 10 : null,
      remaining_life: rulesEngine.remainingLife(s, property),
    }, VISIBLE.system))
    .sort((a, b) => (a.remaining_life ?? 999) - (b.remaining_life ?? 999));

  const schedule = db.prepare(
    `SELECT f.*, s.system_name, ct.company_name AS contractor_name
     FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
     LEFT JOIN contractors ct ON ct.id = f.assigned_contractor_id
     WHERE f.property_id = ? AND f.status IN ('upcoming','scheduled')
     ORDER BY f.due_date`).all(pid)
    .map((it) => pick({ ...it, overdue: it.due_date && it.due_date < t ? 1 : 0 }, VISIBLE.schedule));

  const log = db.prepare(
    `SELECT l.*, s.system_name, ct.company_name AS contractor_name
     FROM maintenance_log l LEFT JOIN systems s ON s.id = l.system_id
     LEFT JOIN contractors ct ON ct.id = l.contractor_id
     WHERE l.property_id = ? ORDER BY l.date DESC`).all(pid)
    .map((r) => pick(r, VISIBLE.log));

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

  const documents = db.prepare('SELECT * FROM documents WHERE property_id = ? ORDER BY upload_date DESC').all(pid)
    .map((r) => pick(r, VISIBLE.document));

  // Capital forecast is tier-scoped: Managed + Concierge only (business rule #8).
  const forecastEligible = ['managed', 'concierge'].includes(client.tier);
  const forecast = forecastEligible
    ? db.prepare(
        `SELECT f.item_name, f.due_date, f.est_cost_low, f.est_cost_high, s.system_name
         FROM forward_schedule f LEFT JOIN systems s ON s.id = f.system_id
         WHERE f.property_id = ? AND f.capital_forecast_item = 1 AND f.status IN ('upcoming','scheduled')
         ORDER BY f.due_date`).all(pid)
        .map((r) => ({ ...r, est_year: r.due_date ? Number(r.due_date.slice(0, 4)) : null }))
    : null;

  const advisor = client.advisor_id
    ? open().prepare('SELECT full_name, email, phone FROM users WHERE id = ?').get(client.advisor_id)
    : null;

  return {
    client: pick(client, ['id','first_name','last_name','email','phone','preferred_contact','tier',
      'subscription_start','subscription_renewal','charter_member','status']),
    tier_label: TIERS[client.tier]?.label || client.tier,
    advisor,
    property: pick(property, VISIBLE.property),
    properties_count: undefined,
    systems, schedule, log, permits, visits, contractors, documents,
    forecast, forecast_eligible: forecastEligible,
    fee_disclosure: 'Steward receives a referral fee from network contractors, paid by the contractor and disclosed in your service agreement. You are never charged more because of it.',
    disclaimer: SCOPE_DISCLAIMER,
    today: t,
  };
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/portal\/record$/, async (req, res, { session, query }) => {
  const client = getClient(session);
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
  const { property } = clientProperty(client, body.property_id);
  const db = open();
  const id = db.prepare(
    `INSERT INTO client_requests (client_id, property_id, created_at, subject, body, status) VALUES (?,?,?,?,?,'open')`
  ).run(client.id, property.id, new Date().toISOString(), body.subject, body.body ?? null).lastInsertRowid;
  audit('client', client.id, 'create', 'client_requests', id, body.subject.slice(0, 80));
  sendJson(res, 201, db.prepare('SELECT * FROM client_requests WHERE id = ?').get(id));
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

  const fileName = `${Date.now()}-c${client.id}-${name}`;
  fs.writeFileSync(path.join(FILES_DIR, fileName), buf);
  const db = open();
  const id = db.prepare(
    `INSERT INTO documents (document_name, document_type, file_path, mime_type, size_bytes, property_id, description, upload_date, uploaded_by_client)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(name, type, fileName, req.headers['content-type'] || 'application/octet-stream',
    buf.length, property.id, query.get('description') || null, today(), client.id).lastInsertRowid;
  audit('client', client.id, 'create', 'documents', id, name);
  sendJson(res, 201, pick(db.prepare('SELECT * FROM documents WHERE id = ?').get(id), VISIBLE.document));
});

module.exports = { routes, buildPortalRecord, clientProperty, getClient };
