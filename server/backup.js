// One-command database backup. Produces a clean, consistent snapshot of the
// SQLite database (safe to run while the app is live — VACUUM INTO handles WAL)
// into data/backups/. Run it before any code update:
//
//   npm run backup                       # local
//   docker-compose exec steward npm run backup   # on the NAS
//
// Restore is just copying a snapshot back over data/steward.db while the app is
// stopped (see DEPLOY.md).

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.STEWARD_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'steward.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function backup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH} — nothing to back up.`);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(BACKUP_DIR, `steward-${stamp}.db`);
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`Backup written: ${out} (${kb} KB)`);

  // Keep the most recent 20 snapshots; prune older ones.
  const snaps = fs.readdirSync(BACKUP_DIR).filter((f) => /^steward-.*\.db$/.test(f)).sort();
  for (const f of snaps.slice(0, -20)) fs.rmSync(path.join(BACKUP_DIR, f));
}

if (require.main === module) backup();
module.exports = { backup };
