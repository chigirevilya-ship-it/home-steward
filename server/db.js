// Database bootstrap. Opens (or creates) the SQLite file and applies the
// schema. Uses Node's built-in sqlite module — no external dependencies.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.STEWARD_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'steward.db');
const FILES_DIR = path.join(DATA_DIR, 'files');

let db = null;

// In-place migrations for databases created before a column existed.
// CREATE TABLE IF NOT EXISTS covers new tables; this covers new columns.
function ensureColumn(handle, table, column, ddl) {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate] added ${table}.${column}`);
  }
}

// The document-type list is enforced by a CHECK constraint, which SQLite
// can't ALTER — expanding it needs a table rebuild (create new, copy, swap).
function migrateDocumentTypes(handle) {
  const ddl = handle.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents'`).get();
  if (!ddl || ddl.sql.includes("'receipt'")) return; // already current
  handle.exec('PRAGMA foreign_keys = OFF');
  handle.exec('BEGIN');
  try {
    handle.exec(`CREATE TABLE documents_new (
      id                 INTEGER PRIMARY KEY,
      document_name      TEXT NOT NULL,
      document_type      TEXT NOT NULL DEFAULT 'other' CHECK (document_type IN ('photo','permit_doc','quote','invoice','receipt','contract','warranty','home_record_pdf','inspection_report','other')),
      file_path          TEXT,
      mime_type          TEXT,
      size_bytes         INTEGER,
      property_id        INTEGER REFERENCES properties(id),
      system_id          INTEGER REFERENCES systems(id),
      equipment_id       INTEGER REFERENCES equipment(id),
      maintenance_log_id INTEGER REFERENCES maintenance_log(id),
      permit_id          INTEGER REFERENCES permits(id),
      description        TEXT,
      upload_date        TEXT,
      uploaded_by_user   INTEGER REFERENCES users(id),
      uploaded_by_client INTEGER REFERENCES clients(id)
    )`);
    const cols = 'id, document_name, document_type, file_path, mime_type, size_bytes, property_id, system_id, equipment_id, maintenance_log_id, permit_id, description, upload_date, uploaded_by_user, uploaded_by_client';
    handle.exec(`INSERT INTO documents_new (${cols}) SELECT ${cols} FROM documents`);
    handle.exec('DROP TABLE documents');
    handle.exec('ALTER TABLE documents_new RENAME TO documents');
    handle.exec('CREATE INDEX IF NOT EXISTS idx_docs_property ON documents(property_id)');
    handle.exec('COMMIT');
    console.log('[migrate] rebuilt documents table with expanded type list');
  } catch (e) {
    handle.exec('ROLLBACK');
    throw e;
  } finally {
    handle.exec('PRAGMA foreign_keys = ON');
  }
}

// The tier list is a CHECK constraint on clients + subscriptions. Expanding it
// to add the Basic/Enhanced tiers needs the same rebuild dance as documents.
// clients has FK dependents, so foreign_keys stays OFF during the swap (they
// resolve by table name afterward) — identical to the documents rebuild.
function migrateTierCheck(handle) {
  const ddl = handle.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clients'`).get();
  if (!ddl || ddl.sql.includes("'basic'")) return; // already current
  const CHECK = "CHECK (tier IN ('basic','enhanced','guided','managed','concierge','self_serve'))";
  handle.exec('PRAGMA foreign_keys = OFF');
  handle.exec('BEGIN');
  try {
    const clientCols = 'id, first_name, last_name, email, phone, preferred_contact, market_id, advisor_id, tier, subscription_start, subscription_renewal, annual_rate, charter_member, intake_fee_paid, intake_fee_date, referral_source, status, notes, password_hash';
    handle.exec(`CREATE TABLE clients_new (
      id                   INTEGER PRIMARY KEY,
      first_name           TEXT NOT NULL,
      last_name            TEXT NOT NULL,
      email                TEXT UNIQUE,
      phone                TEXT,
      preferred_contact    TEXT CHECK (preferred_contact IN ('email','text','call') OR preferred_contact IS NULL),
      market_id            INTEGER NOT NULL REFERENCES markets(id),
      advisor_id           INTEGER REFERENCES users(id),
      tier                 TEXT NOT NULL ${CHECK},
      subscription_start   TEXT,
      subscription_renewal TEXT,
      annual_rate          REAL,
      charter_member       INTEGER NOT NULL DEFAULT 0,
      intake_fee_paid      INTEGER NOT NULL DEFAULT 0,
      intake_fee_date      TEXT,
      referral_source      TEXT,
      status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','prospect')),
      notes                TEXT,
      password_hash        TEXT
    )`);
    handle.exec(`INSERT INTO clients_new (${clientCols}) SELECT ${clientCols} FROM clients`);
    handle.exec('DROP TABLE clients');
    handle.exec('ALTER TABLE clients_new RENAME TO clients');

    const subCols = 'id, client_id, period_start, period_end, tier, annual_amount, discount_applied, payment_date, payment_method, status';
    handle.exec(`CREATE TABLE subscriptions_new (
      id               INTEGER PRIMARY KEY,
      client_id        INTEGER NOT NULL REFERENCES clients(id),
      period_start     TEXT NOT NULL,
      period_end       TEXT NOT NULL,
      tier             TEXT NOT NULL ${CHECK},
      annual_amount    REAL,
      discount_applied TEXT,
      payment_date     TEXT,
      payment_method   TEXT,
      status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','pending','overdue','refunded','cancelled'))
    )`);
    handle.exec(`INSERT INTO subscriptions_new (${subCols}) SELECT ${subCols} FROM subscriptions`);
    handle.exec('DROP TABLE subscriptions');
    handle.exec('ALTER TABLE subscriptions_new RENAME TO subscriptions');
    handle.exec('COMMIT');
    console.log('[migrate] rebuilt clients + subscriptions with Basic/Enhanced tiers');
  } catch (e) {
    handle.exec('ROLLBACK');
    throw e;
  } finally {
    handle.exec('PRAGMA foreign_keys = ON');
  }
}

function migrate(handle) {
  migrateTierCheck(handle);
  ensureColumn(handle, 'systems', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  ensureColumn(handle, 'documents', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'performed_by', 'performed_by TEXT');
  ensureColumn(handle, 'maintenance_log', 'client_contractor_id', 'client_contractor_id INTEGER REFERENCES client_contractors(id)');
  ensureColumn(handle, 'forward_schedule', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'forward_schedule', 'custom', 'custom INTEGER NOT NULL DEFAULT 0');
  ensureColumn(handle, 'forward_schedule', 'repeat_value', 'repeat_value REAL');
  ensureColumn(handle, 'forward_schedule', 'repeat_unit', 'repeat_unit TEXT');
  ensureColumn(handle, 'permits', 'system_id', 'system_id INTEGER REFERENCES systems(id)');
  ensureColumn(handle, 'permits', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  migrateDocumentTypes(handle);
  // Roll component records up to their parent system: any record on a piece of
  // equipment is also about that equipment's system (container model).
  for (const tbl of ['maintenance_log', 'forward_schedule', 'documents', 'permits']) {
    handle.exec(`UPDATE ${tbl} SET system_id = (SELECT e.system_id FROM equipment e WHERE e.id = ${tbl}.equipment_id)
      WHERE equipment_id IS NOT NULL AND system_id IS NULL
        AND (SELECT e.system_id FROM equipment e WHERE e.id = ${tbl}.equipment_id) IS NOT NULL`);
  }
  ensureReferenceData(handle);
}

// Idempotent reference data — regions and other shared config applied on every
// startup, so a code update adds them to a LIVE database without a reset (and
// without touching user data). Add new markets here to roll them out safely.
const REGIONS = [
  { name: 'Central New Jersey', city: 'Bridgewater', state: 'NJ', zips: '08807,08805,08876', notes: 'Self-serve region.' },
];
function ensureReferenceData(handle) {
  const findMarket = handle.prepare('SELECT id FROM markets WHERE name = ?');
  const addMarket = handle.prepare(
    `INSERT INTO markets (name, city, state, launch_date, active_zip_codes, status, notes)
     VALUES (?,?,?,?,?, 'active', ?)`);
  for (const r of REGIONS) {
    if (!findMarket.get(r.name)) {
      addMarket.run(r.name, r.city, r.state, null, r.zips, r.notes);
      console.log(`[migrate] added region: ${r.name}`);
    }
  }
}

function open() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function audit(actorKind, actorId, action, tableName, recordId, detail) {
  open().prepare(
    'INSERT INTO audit_log (ts, actor_kind, actor_id, action, table_name, record_id, detail) VALUES (?,?,?,?,?,?,?)'
  ).run(nowIso(), actorKind, actorId ?? null, action, tableName ?? null, recordId ?? null, detail ?? null);
}

module.exports = { open, audit, today, nowIso, DATA_DIR, DB_PATH, FILES_DIR };
