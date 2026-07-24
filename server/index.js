// Steward server. Zero external dependencies: node:http for the server,
// node:sqlite for the database, node:crypto for auth. Serves the SPA from
// public/ and the JSON API under /api.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { open, audit, today, FILES_DIR } = require('./db');
const { seed } = require('./seed');
const auth = require('./auth');
const staffRoutes = require('./routes').routes;
const portalRoutes = require('./portal').routes;
const { clientProperty, getClient } = require('./portal');
const { renderHomeRecord } = require('./export');
const { sendJson, sendError, readJson, readBody, parseCookies, clientIp, MAX_FILE_BODY } = require('./http-util');

const PORT = Number(process.env.PORT || 8710);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Set COOKIE_SECURE=1 when the app is reachable only over HTTPS (e.g. behind
// a Cloudflare Tunnel or any TLS-terminating reverse proxy). Leave unset for
// plain-HTTP local/LAN testing — browsers silently drop Secure cookies over http.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
const sessionCookie = (token) => `steward_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${COOKIE_SECURE}`;

// Login rate limiting — this app will be reachable from the open internet,
// so brute-forcing the fixed set of accounts needs a real cost. In-memory is
// fine for a single-process NAS deployment; resets on restart.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // key: ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  return entry.count < LOGIN_MAX_ATTEMPTS;
}
function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip);
  if (entry) entry.count++;
}
function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}
// Prevent unbounded growth from scanning bots hitting many source IPs.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) if (entry.resetAt < now) loginAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

// ── auth endpoints ─────────────────────────────────────────────────────────

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return sendError(res, 429, 'Too many login attempts. Try again in a few minutes.');
  }

  const db = open();
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return sendError(res, 400, 'email and password are required');

  const staff = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1').get(email);
  if (staff && auth.verifyPassword(password, staff.password_hash)) {
    clearLoginAttempts(ip);
    const token = auth.createSession('staff', staff.id);
    audit('staff', staff.id, 'login', 'users', staff.id, null);
    res.setHeader('Set-Cookie', sessionCookie(token));
    const { password_hash, ...user } = staff;
    return sendJson(res, 200, { kind: 'staff', user });
  }
  const client = db.prepare('SELECT * FROM clients WHERE lower(email) = ?').get(email);
  if (client && auth.verifyPassword(password, client.password_hash)) {
    clearLoginAttempts(ip);
    const token = auth.createSession('client', client.id);
    audit('client', client.id, 'login', 'clients', client.id, null);
    res.setHeader('Set-Cookie', sessionCookie(token));
    const { password_hash, notes, ...user } = client; // household notes are internal-only
    return sendJson(res, 200, { kind: 'client', user });
  }
  recordLoginFailure(ip);
  sendError(res, 401, 'Invalid email or password');
}

// Self-Serve signup (US-S1). Public endpoint — creates a client on the
// self_serve tier with no advisor and no intake. Payments are intentionally
// bypassed for now; the subscription fields are recorded as if paid so the
// portal renders sensibly.
async function handleSignup(req, res) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return sendError(res, 429, 'Too many attempts. Try again in a few minutes.');
  }
  const db = open();
  const body = await readJson(req);
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const marketId = Number(body.market_id);

  const fail = (status, msg) => { recordLoginFailure(ip); return sendError(res, status, msg); };
  if (!firstName || !lastName || !email || !password || !marketId) {
    return fail(400, 'First name, last name, email, password, and market are required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'That does not look like an email address');
  if (password.length < 8) return fail(400, 'Password must be at least 8 characters');
  const market = db.prepare(`SELECT id FROM markets WHERE id = ? AND status = 'active'`).get(marketId);
  if (!market) return fail(400, 'Pick one of the available metro areas');
  const taken = db.prepare('SELECT id FROM clients WHERE lower(email) = ?').get(email)
    || db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (taken) return fail(409, 'An account with that email already exists');

  const { TIERS } = require('./vocab');
  const start = today();
  const renewal = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const id = db.prepare(
    `INSERT INTO clients (first_name, last_name, email, preferred_contact, market_id, tier,
       subscription_start, subscription_renewal, annual_rate, referral_source, status, password_hash)
     VALUES (?,?,?,'email',?,'basic',?,?,?,'basic_signup','active',?)`
  ).run(firstName, lastName, email, marketId, start, renewal,
    TIERS.basic.price, auth.hashPassword(password)).lastInsertRowid;
  audit('client', id, 'signup', 'clients', id, 'basic (free) signup');

  clearLoginAttempts(ip);
  const token = auth.createSession('client', id);
  res.setHeader('Set-Cookie', sessionCookie(token));
  const { password_hash, notes, ...user } = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  sendJson(res, 201, { kind: 'client', user });
}

// Public list of active markets for the signup form (names only).
function handleSignupMarkets(res) {
  const db = open();
  sendJson(res, 200, db.prepare(
    `SELECT id, name, city, state FROM markets WHERE status = 'active' ORDER BY name`).all());
}

function handleMe(res, session) {
  const db = open();
  if (session.kind === 'staff') {
    const u = db.prepare('SELECT id, full_name, email, role, market_id FROM users WHERE id = ?').get(session.user_id);
    return sendJson(res, 200, { kind: 'staff', user: u });
  }
  const c = db.prepare('SELECT id, first_name, last_name, email, tier, market_id FROM clients WHERE id = ?').get(session.user_id);
  sendJson(res, 200, { kind: 'client', user: c });
}

// ── shared document/file endpoints (access-checked per session kind) ──────

function canAccessDocument(session, doc) {
  const db = open();
  if (session.kind === 'staff') {
    const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    if (staff.role === 'founder') return true;
    if (!doc.property_id) return true;
    const p = db.prepare('SELECT market_id FROM properties WHERE id = ?').get(doc.property_id);
    return p && p.market_id === staff.market_id;
  }
  if (!doc.property_id) return false;
  const p = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(doc.property_id);
  return p && p.client_id === session.user_id;
}

function handleDocumentFile(res, session, docId) {
  const db = open();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc || !doc.file_path) return sendError(res, 404, 'Document not found');
  if (!canAccessDocument(session, doc)) return sendError(res, 403, 'Not your document');
  const filePath = path.join(FILES_DIR, path.basename(doc.file_path));
  if (!fs.existsSync(filePath)) return sendError(res, 404, 'File missing from storage');
  res.writeHead(200, {
    'Content-Type': doc.mime_type || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${doc.document_name.replace(/"/g, '')}"`,
  });
  fs.createReadStream(filePath).pipe(res);
}

// Staff document upload (raw body, metadata in query — same shape as portal).
async function handleStaffUpload(req, res, session, query) {
  const db = open();
  const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const propertyId = Number(query.get('property_id'));
  if (!propertyId) return sendError(res, 400, 'property_id is required');
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!p) return sendError(res, 404, 'Property not found');
  if (staff.role !== 'founder' && p.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');

  const name = (query.get('name') || 'upload').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const buf = await readBody(req, MAX_FILE_BODY);
  if (!buf.length) return sendError(res, 400, 'Empty upload');
  const fileName = `${Date.now()}-u${staff.id}-${name}`;
  fs.writeFileSync(path.join(FILES_DIR, fileName), buf);
  const id = db.prepare(
    `INSERT INTO documents (document_name, document_type, file_path, mime_type, size_bytes, property_id, system_id, equipment_id, maintenance_log_id, permit_id, description, upload_date, uploaded_by_user)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(name, query.get('type') || 'other', fileName, req.headers['content-type'] || 'application/octet-stream',
    buf.length, propertyId, Number(query.get('system_id')) || null, Number(query.get('equipment_id')) || null,
    Number(query.get('log_id')) || null,
    Number(query.get('permit_id')) || null, query.get('description') || null, today(), staff.id).lastInsertRowid;
  audit('staff', staff.id, 'create', 'documents', id, name);
  sendJson(res, 201, db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
}

// Home Record export — staff (any property in scope) or client (own home).
function handleExport(res, session, propertyIdRaw) {
  const db = open();
  let client, property;
  if (session.kind === 'client') {
    client = getClient(session);
    ({ property } = clientProperty(client, propertyIdRaw));
  } else {
    const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    property = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(propertyIdRaw));
    if (!property) return sendError(res, 404, 'Property not found');
    if (staff.role !== 'founder' && property.market_id !== staff.market_id) return sendError(res, 403, 'Outside your market');
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(property.client_id);
  }
  audit(session.kind, session.user_id, 'export', 'properties', property.id, 'home record export');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderHomeRecord(client, property));
}

// ── request dispatch ───────────────────────────────────────────────────────

async function handleApi(req, res, pathname, query) {
  if (req.method === 'POST' && pathname === '/api/login') return handleLogin(req, res);
  if (req.method === 'POST' && pathname === '/api/signup') return handleSignup(req, res);
  if (req.method === 'GET' && pathname === '/api/signup/markets') return handleSignupMarkets(res);

  const cookies = parseCookies(req);
  const session = auth.getSession(cookies.steward_session);

  if (req.method === 'POST' && pathname === '/api/logout') {
    auth.destroySession(cookies.steward_session);
    res.setHeader('Set-Cookie', 'steward_session=; HttpOnly; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }
  if (!session) return sendError(res, 401, 'Not signed in');
  if (req.method === 'GET' && pathname === '/api/me') return handleMe(res, session);

  // Shared endpoints
  let m;
  if ((m = pathname.match(/^\/api\/documents\/(\d+)\/file$/)) && req.method === 'GET') {
    return handleDocumentFile(res, session, Number(m[1]));
  }
  if ((m = pathname.match(/^\/api\/export\/(\d*)$/)) && req.method === 'GET') {
    return handleExport(res, session, m[1] || query.get('property_id'));
  }

  if (session.kind === 'client') {
    for (const r of portalRoutes) {
      if (r.method === req.method && (m = pathname.match(r.pattern))) {
        return r.handler(req, res, { session, params: m.slice(1), query });
      }
    }
    return sendError(res, session.kind === 'client' && pathname.startsWith('/api/portal') ? 404 : 403,
      'Client sessions can only use portal endpoints');
  }

  // Staff
  const db = open();
  const staff = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.user_id);
  if (!staff) return sendError(res, 401, 'Account deactivated');
  if (req.method === 'POST' && pathname === '/api/documents') return handleStaffUpload(req, res, session, query);
  for (const r of staffRoutes) {
    if (r.method === req.method && (m = pathname.match(r.pattern))) {
      return r.handler(req, res, { staff, session, params: m.slice(1), query });
    }
  }
  sendError(res, 404, `No route: ${req.method} ${pathname}`);
}

// Static files are served with `no-cache` + Last-Modified so browsers (and
// Cloudflare's edge, which caches js/css by default) revalidate on every
// load instead of serving a stale app after a deploy. Unchanged files still
// answer 304 with no body, so the app stays fast.
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden');
  let finalPath = filePath;
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  const stat = fs.statSync(finalPath);
  const lastModified = stat.mtime.toUTCString();
  const headers = {
    'Content-Type': MIME[path.extname(finalPath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Last-Modified': lastModified,
  };
  const since = req.headers['if-modified-since'];
  if (since && new Date(since).getTime() >= Math.floor(stat.mtime.getTime() / 1000) * 1000) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  fs.createReadStream(finalPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname, url.searchParams);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendError(res, status, err.message || 'Server error');
    else res.end();
  }
});

// First run: create schema and seed demo data automatically.
open();
seed();

// Nightly rules-engine recompute (§3.4 v2) while the server runs.
const rulesEngine = require('./rules-engine');
setInterval(() => {
  try {
    const r = rulesEngine.recomputeAll({ kind: 'system', id: null });
    if (r.created) console.log(`[rules-engine] nightly recompute created ${r.created} item(s)`);
  } catch (e) { console.error('[rules-engine]', e); }
}, 24 * 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Steward running at http://localhost:${PORT}`);
});
