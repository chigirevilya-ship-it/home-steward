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

function migrate(handle) {
  ensureColumn(handle, 'systems', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  ensureColumn(handle, 'documents', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'performed_by', 'performed_by TEXT');
  ensureColumn(handle, 'maintenance_log', 'client_contractor_id', 'client_contractor_id INTEGER REFERENCES client_contractors(id)');
  ensureColumn(handle, 'forward_schedule', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'forward_schedule', 'custom', 'custom INTEGER NOT NULL DEFAULT 0');
  ensureColumn(handle, 'forward_schedule', 'repeat_value', 'repeat_value REAL');
  ensureColumn(handle, 'forward_schedule', 'repeat_unit', 'repeat_unit TEXT');
  migrateDocumentTypes(handle);
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
