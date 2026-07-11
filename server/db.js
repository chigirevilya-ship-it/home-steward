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

function migrate(handle) {
  ensureColumn(handle, 'documents', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'equipment_id', 'equipment_id INTEGER REFERENCES equipment(id)');
  ensureColumn(handle, 'maintenance_log', 'performed_by', 'performed_by TEXT');
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
