// CLI to set (or reset) a staff or client password by email. Use this before
// exposing the app publicly — the seeded demo accounts share two fixed
// passwords (steward123 / welcome123), which is fine on localhost but must
// not survive onto the open internet.
//
//   node server/set-password.js <email> <new-password>
//
// Works for both the users (staff) and clients tables — whichever the email
// matches. Logs the change to the audit trail as a system action.

const { open, audit } = require('./db');
const { hashPassword } = require('./auth');

function main() {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error('Usage: node server/set-password.js <email> <new-password>');
    process.exit(1);
  }
  if (passwordArg.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const db = open();
  const hash = hashPassword(passwordArg);

  const staff = db.prepare('SELECT id, full_name, role FROM users WHERE lower(email) = ?').get(email);
  if (staff) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, staff.id);
    audit('system', null, 'update', 'users', staff.id, 'password reset via CLI');
    console.log(`Password updated for staff: ${staff.full_name} (${staff.role}, ${email})`);
    return;
  }
  const client = db.prepare('SELECT id, first_name, last_name FROM clients WHERE lower(email) = ?').get(email);
  if (client) {
    db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(hash, client.id);
    audit('system', null, 'update', 'clients', client.id, 'password reset via CLI');
    console.log(`Password updated for client: ${client.first_name} ${client.last_name} (${email})`);
    return;
  }
  console.error(`No staff or client found with email ${email}`);
  process.exit(1);
}

main();
