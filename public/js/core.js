// Shared client-side core: API access, DOM helpers, shared components.

// ── API ────────────────────────────────────────────────────────────────────
export async function api(path, opts = {}) {
  const init = { headers: {}, credentials: 'same-origin', ...opts };
  if (init.body && typeof init.body !== 'string' && !(init.body instanceof Blob) && !(init.body instanceof File)) {
    init.body = JSON.stringify(init.body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── formatting ─────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`;
};
export const fmtMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const moneyRange = (lo, hi) => lo == null && hi == null ? '—'
  : (!lo && !hi) ? 'no cost' : `${money(lo)}–${money(hi)}`;
export const label = (s) => s == null ? '—' : String(s).replace(/_/g, ' ');
export const stars = (n) => n == null ? '<span class="muted">—</span>'
  : `<span class="stars" title="${n}/5">${'★'.repeat(n)}<span class="stars-off">${'☆'.repeat(5 - n)}</span></span>`;
export const daysFromToday = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / 86400000);

export function dueText(d) {
  if (!d) return '—';
  const n = daysFromToday(d);
  if (n < -1) return `${-n} days overdue`;
  if (n === -1) return 'overdue since yesterday';
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  if (n <= 60) return `in ${n} days`;
  return fmtDate(d);
}

// ── status/urgency vocabulary (icon + label always accompany color) ───────
export function priorityBadge(priority, overdue) {
  if (overdue) return `<span class="badge b-critical">▲ overdue</span>`;
  if (priority === 'urgent') return `<span class="badge b-serious">▲ urgent</span>`;
  if (priority === 'planning') return `<span class="badge b-muted">◇ planning</span>`;
  return `<span class="badge b-neutral">● standard</span>`;
}
export function statusBadge(status) {
  const map = {
    upcoming: 'b-neutral', scheduled: 'b-info', completed: 'b-good', deferred: 'b-muted', cancelled: 'b-muted',
    active: 'b-good', probation: 'b-serious', inactive: 'b-muted', removed: 'b-critical',
    paused: 'b-serious', prospect: 'b-info',
    paid: 'b-good', pending: 'b-neutral', invoiced: 'b-info', overdue: 'b-critical', disputed: 'b-serious', waived: 'b-muted',
    finaled: 'b-good', open: 'b-info', expired: 'b-serious', unknown: 'b-muted',
    resolved: 'b-good', in_progress: 'b-info',
  };
  return `<span class="badge ${map[status] || 'b-neutral'}">${label(status)}</span>`;
}
export const tierBadge = (tier) => `<span class="badge b-tier t-${tier}">${label(tier)}</span>`;

// Age bar: age vs expected lifespan (client systems view + advisor).
export function ageBar(system) {
  if (system.age_years == null || !system.expected_lifespan) return '';
  const pct = Math.min(100, Math.round((system.age_years / system.expected_lifespan) * 100));
  const tone = pct >= 90 ? 'critical' : pct >= 70 ? 'serious' : 'ok';
  return `<div class="agebar" title="${system.age_years} yrs of ~${system.expected_lifespan} expected">
    <div class="agebar-track"><div class="agebar-fill agebar-${tone}" style="width:${pct}%"></div></div>
    <span class="agebar-label">${Math.round(system.age_years)} of ~${system.expected_lifespan} yrs</span>
  </div>`;
}

export function progress(pct, labelText) {
  return `<div class="progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span class="progress-label">${labelText ?? pct + '%'}</span></div>`;
}

export const statTile = (value, labelText, tone = '') =>
  `<div class="tile ${tone ? 'tile-' + tone : ''}"><div class="tile-value">${value}</div><div class="tile-label">${labelText}</div></div>`;

export const empty = (msg) => `<div class="empty">${msg}</div>`;

// ── DOM / modal / toast ────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, tone = 'ok') {
  let holder = $('#toasts');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'toasts';
    document.body.appendChild(holder);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${tone}`;
  t.textContent = msg;
  holder.appendChild(t);
  setTimeout(() => { t.classList.add('gone'); setTimeout(() => t.remove(), 400); }, 3600);
}

export function modal(title, bodyHtml, { wide = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" aria-label="Close">×</button></div>
    <div class="modal-body">${bodyHtml}</div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('.modal-x', overlay).addEventListener('click', close);
  return { overlay, close, body: $('.modal-body', overlay) };
}

// Form helpers: build a labeled field row and read values back.
export function field(name, labelText, control) {
  return `<label class="field"><span class="field-label">${labelText}</span>${control.replace('{name}', `name="${name}"`)}</label>`;
}
export const input = (attrs = '') => `<input {name} class="control" ${attrs}>`;
export const textarea = (attrs = '') => `<textarea {name} class="control" rows="3" ${attrs}></textarea>`;
export const select = (options, attrs = '') =>
  `<select {name} class="control" ${attrs}>${options.map((o) =>
    typeof o === 'string' ? `<option value="${esc(o)}">${esc(o)}</option>`
      : `<option value="${esc(o.value)}" ${o.selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;

export function formValues(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    let v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
    if (v === '' || v === undefined) v = null;
    else if (el.dataset.number != null && v != null) v = Number(v);
    out[el.name] = v;
  }
  return out;
}

// Star-rating input control (write) — used by the 60-second system capture.
export function starInput(name, value = 0) {
  return `<div class="star-input" data-star-input data-name="${name}" data-value="${value}">
    ${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="star ${i <= value ? 'on' : ''}" data-v="${i}" aria-label="${i} of 5">★</button>`).join('')}
  </div>`;
}
export function bindStarInputs(root) {
  for (const holder of $$('[data-star-input]', root)) {
    holder.addEventListener('click', (e) => {
      const b = e.target.closest('.star');
      if (!b) return;
      holder.dataset.value = b.dataset.v;
      $$('.star', holder).forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= Number(b.dataset.v)));
    });
  }
}
export const readStars = (root, name) => {
  const holder = $(`[data-star-input][data-name="${name}"]`, root);
  const v = holder ? Number(holder.dataset.value) : 0;
  return v > 0 ? v : null;
};
