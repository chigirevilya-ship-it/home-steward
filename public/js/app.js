// App shell: login, role-based navigation, hash router.

import { api, $, esc, toast } from './core.js';
import * as advisor from './advisor.js';
import * as portal from './portal.js';
import * as founder from './founder.js';

export const state = { me: null, meta: null };

const app = $('#app');

// ── login & self-serve signup ──────────────────────────────────────────────
function renderLogin() {
  document.title = 'Steward — Sign in';
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="login-form">
      <div class="login-brand">
        <div class="mark">Steward</div>
        <div class="tag">Your home, professionally kept.</div>
      </div>
      <label class="field"><span class="field-label">Email</span>
        <input class="control" name="email" type="email" autocomplete="username" required autofocus></label>
      <label class="field"><span class="field-label">Password</span>
        <input class="control" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" style="width:100%;padding:10px" type="submit">Sign in</button>
      <div style="text-align:center;margin-top:14px" class="small">
        New here? <a href="#" id="show-signup">Create a Self-Serve account</a>
      </div>
      <div class="login-demo">
        <b>Demo logins</b> (password <code>steward123</code> / clients <code>welcome123</code>)<br>
        Founder: <code>founder@steward.demo</code><br>
        Advisor: <code>marcus@steward.demo</code>, <code>elena@steward.demo</code><br>
        Client: <code>sarah@client.demo</code>, <code>james@client.demo</code><br>
        Self-serve: <code>taylor@client.demo</code>
      </div>
    </form>
  </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      const data = await api('/api/login', { method: 'POST', body: {
        email: e.target.email.value, password: e.target.password.value } });
      state.me = data;
      await boot();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  });
  $('#show-signup').addEventListener('click', (e) => { e.preventDefault(); renderSignup(); });
}

async function renderSignup() {
  document.title = 'Steward — Create account';
  let markets = [];
  try { markets = await api('/api/signup/markets'); } catch { /* form still renders */ }
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="signup-form">
      <div class="login-brand">
        <div class="mark">Steward</div>
        <div class="tag">Build your own Home Record — Self-Serve.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
        <label class="field"><span class="field-label">First name</span>
          <input class="control" name="first_name" required autofocus></label>
        <label class="field"><span class="field-label">Last name</span>
          <input class="control" name="last_name" required></label>
      </div>
      <label class="field"><span class="field-label">Email</span>
        <input class="control" name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span class="field-label">Password (8+ characters)</span>
        <input class="control" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span class="field-label">Your metro area</span>
        <select class="control" name="market_id" required>
          ${markets.map((m) => `<option value="${m.id}">${m.name} (${m.city}, ${m.state})</option>`).join('')}
        </select></label>
      <button class="btn btn-primary" style="width:100%;padding:10px" type="submit">Create my account</button>
      <div style="text-align:center;margin-top:14px" class="small">
        Already a member? <a href="#" id="show-login">Sign in</a>
      </div>
      <div class="login-demo">
        Self-Serve is the software-only membership: you build and maintain your own
        Home Record, and the maintenance engine generates your schedule. No advisor,
        no contractor network — with a one-tap upgrade path when you want one.
        <b>Payments are disabled in this deployment.</b>
      </div>
    </form>
  </div>`;
  $('#show-login').addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      const data = await api('/api/signup', { method: 'POST', body: {
        first_name: e.target.first_name.value, last_name: e.target.last_name.value,
        email: e.target.email.value, password: e.target.password.value,
        market_id: Number(e.target.market_id.value) } });
      state.me = data;
      toast('Welcome to Steward — let’s document your home');
      await boot();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  });
}

// ── shell ──────────────────────────────────────────────────────────────────
function navFor(me) {
  if (me.kind === 'client') {
    return [
      ['#/home', 'Overview'], ['#/calendar', 'Calendar'], ['#/systems', 'Systems'],
      ['#/history', 'History'], ['#/forecast', 'Forecast'], ['#/contractors', 'Contractors'], ['#/documents', 'Documents'],
    ];
  }
  const staffNav = [
    ['#/dashboard', 'Dashboard'], ['#/properties', 'Home Records'],
    ['#/intake', 'New Intake'], ['#/contractors', 'Contractors'],
  ];
  if (me.user.role === 'founder') {
    staffNav.push(['#/founder', 'Market'], ['#/fees', 'Referral Ledger'], ['#/rules', 'Rules'], ['#/network', 'Network Health']);
  }
  return staffNav;
}

function renderShell() {
  const me = state.me;
  const who = me.kind === 'staff'
    ? `<b>${esc(me.user.full_name)}</b>${esc(me.user.role)}`
    : `<b>${esc(me.user.first_name)} ${esc(me.user.last_name)}</b>${esc(String(me.user.tier || '').replace(/_/g, '-'))} member`;
  app.innerHTML = `
  <div class="topbar">
    <div class="wordmark">Steward<small>${me.kind === 'client' ? 'Client Portal' : 'Advisory Platform'}</small></div>
    <nav class="nav" id="nav">
      ${navFor(me).map(([href, labelText]) => `<a href="${href}" data-nav="${href}">${labelText}</a>`).join('')}
    </nav>
    <div class="who">${who}</div>
    <button class="btn-ghost-light" id="logout">Sign out</button>
  </div>
  <main id="view"></main>`;
  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.me = null;
    location.hash = '';
    renderLogin();
  });
}

// ── router ─────────────────────────────────────────────────────────────────
const staffRoutes = [
  [/^#\/dashboard$/, advisor.renderDashboard],
  [/^#\/properties$/, advisor.renderProperties],
  [/^#\/property\/(\d+)$/, (view, m) => advisor.renderPropertyRecord(view, Number(m[1]))],
  [/^#\/intake$/, advisor.renderIntake],
  [/^#\/contractors$/, advisor.renderContractors],
  [/^#\/founder$/, founder.renderMarketDashboard],
  [/^#\/fees$/, founder.renderFees],
  [/^#\/rules$/, founder.renderRules],
  [/^#\/network$/, founder.renderNetwork],
];
const clientRoutes = [
  [/^#\/home$/, portal.renderOverview],
  [/^#\/calendar$/, portal.renderCalendar],
  [/^#\/systems$/, portal.renderSystems],
  [/^#\/history$/, portal.renderHistory],
  [/^#\/forecast$/, portal.renderForecast],
  [/^#\/contractors$/, portal.renderContractors],
  [/^#\/documents$/, portal.renderDocuments],
];

async function route() {
  if (!state.me) return;
  const view = $('#view');
  if (!view) return;
  const hash = location.hash || (state.me.kind === 'client' ? '#/home' : '#/dashboard');
  const routes = state.me.kind === 'client' ? clientRoutes : staffRoutes;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', hash === a.dataset.nav
      || (a.dataset.nav === '#/properties' && hash.startsWith('#/property/')));
  }
  for (const [re, handler] of routes) {
    const m = hash.match(re);
    if (m) {
      view.innerHTML = '<div class="empty">Loading…</div>';
      try {
        await handler(view, m, state);
      } catch (err) {
        view.innerHTML = `<div class="notice notice-critical">${esc(err.message)}</div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = state.me.kind === 'client' ? '#/home' : '#/dashboard';
}

async function boot() {
  if (state.me.kind === 'staff') state.meta = await api('/api/meta');
  renderShell();
  if (!location.hash) location.hash = state.me.kind === 'client' ? '#/home' : '#/dashboard';
  await route();
}

window.addEventListener('hashchange', route);

(async function init() {
  try {
    state.me = await api('/api/me');
    await boot();
  } catch {
    renderLogin();
  }
})();
