// Password hashing (scrypt, built-in crypto) and session management.

const crypto = require('node:crypto');
const { open, nowIso } = require('./db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createSession(kind, userId) {
  const db = open();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, kind, user_id, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, kind, userId, nowIso(), new Date(now + SESSION_TTL_MS).toISOString());
  return token;
}

function getSession(token) {
  if (!token) return null;
  const db = open();
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < nowIso()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) open().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

module.exports = { hashPassword, verifyPassword, createSession, getSession, destroySession };
