// Client portal (§5.2): overview, 12-month calendar, systems, history,
// capital forecast (tier-gated), contractors, documents. Read-only on the
// record; clients can submit requests and upload documents.

import {
  api, esc, fmtDate, fmtMonth, money, moneyRange, label, stars, dueText,
  priorityBadge, statusBadge, ageBar, progress, statTile, empty,
  $, $$, toast, modal, field, input, textarea, select, formValues,
  starInput, bindStarInputs, readStars,
} from './core.js';

let cached = null;
async function record() {
  if (!cached) cached = await api('/api/portal/record');
  return cached;
}
export const invalidate = () => { cached = null; };

function head(r, title, sub = '') {
  return `<div class="page-head"><div>
    <div class="small muted">${esc(r.property.address_line1)}, ${esc(r.property.city)}</div>
    <h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}
  </div><div class="actions"><a class="btn" href="/api/export/${r.property.id}" target="_blank">Export Home Record</a></div></div>`;
}

// Views other than Overview send new accounts back to onboarding.
function needsOnboarding(r) {
  if (r.needs_onboarding) { location.hash = '#/home'; return true; }
  return false;
}

// ── Self-Serve onboarding (US-S1: build your own Home Record) ─────────────
function renderOnboarding(view, r) {
  view.innerHTML = `
  <div class="page-head"><div>
    <h1>Welcome, ${esc(r.client.first_name)} — let’s document your home</h1>
    <div class="sub">${r.self_serve
      ? 'Start with the basics. Then add your home’s systems, and the maintenance engine builds your schedule.'
      : 'Your Home Record will appear here once your advisor completes your intake.'}</div>
  </div></div>
  ${r.self_serve ? `
  <div class="card card-pad" style="max-width:720px">
    <h2 class="serif" style="margin-bottom:14px">Step 1 of 2 — Your home</h2>
    <div class="form-grid">
      <div class="span2">${field('address_line1', 'Street address', input(`placeholder="86 Winter Hill Ave"`))}</div>
      ${field('city', 'City', input())}
      ${field('state', 'State', input(`maxlength="2" placeholder="MA"`))}
      ${field('zip', 'ZIP', input())}
      ${field('year_built', 'Year built (approx. is fine)', input(`type="number" data-number`))}
      ${field('property_type', 'Property type', select(['single_family', 'two_family', 'triple_decker', 'condo', 'townhouse']
        .map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))))}
      ${field('square_footage', 'Square footage', input(`type="number" data-number`))}
      ${field('bedrooms', 'Bedrooms', input(`type="number" data-number`))}
      ${field('bathrooms', 'Bathrooms', input(`type="number" step="0.5" data-number`))}
      ${field('foundation_type', 'Foundation', select([{ value: '', label: 'not sure' },
        ...['fieldstone', 'poured_concrete', 'slab', 'crawlspace', 'basement'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))]))}
      ${field('ownership_date', 'You’ve owned it since', input(`type="date"`))}
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="ob-save">Create my Home Record</button></div>
  </div>
  <p class="small muted section" style="max-width:720px">Step 2 adds your home’s systems — furnace, water heater, roof —
  and generates your maintenance schedule. Guessing an age is fine; you can refine everything later.</p>`
  : `<div class="card">${empty('No home on record yet — your advisor is on it.')}</div>`}`;

  $('#ob-save', view)?.addEventListener('click', async () => {
    const body = formValues(view);
    if (!body.address_line1) return toast('Enter your street address', 'err');
    try {
      await api('/api/portal/property', { method: 'POST', body });
      invalidate();
      toast('Home created — now add your systems');
      location.hash = '#/systems';
      renderSystems($('#view'));
    } catch (err) { toast(err.message, 'err'); }
  });
}

// The 60-second capture, homeowner edition (no internal fields).
function selfSystemModal(r, existing, done) {
  const m = modal(existing ? `Edit — ${existing.system_name}` : 'Add a system', `
    <div class="form-grid">
      ${field('category', 'What kind of system?', select(r.categories.map((c) =>
        ({ value: c, label: c, selected: existing?.category === c }))))}
      ${field('system_name', 'Name it', input(`value="${esc(existing?.system_name || '')}" placeholder="Gas furnace, kitchen fridge…"`))}
      <div class="field span2"><span class="field-label">Condition (1 = failing, 5 = like new)</span>
        ${starInput('condition_rating', existing?.condition_rating || 0)}</div>
      ${field('install_date', 'Installed (if you know)', input(`type="date" value="${existing?.install_date || ''}"`))}
      ${field('age_at_intake', 'Or roughly how old (years)', input(`type="number" step="0.5" value="${existing?.age_at_intake ?? ''}" data-number`))}
      ${field('expected_lifespan', 'Expected lifespan (years)', input(`type="number" step="0.5" value="${existing?.expected_lifespan ?? ''}" data-number`))}
      ${field('last_service_date', 'Last serviced (if you know)', input(`type="date" value="${existing?.last_service_date || ''}"`))}
      ${field('model_number', 'Model # (from the data plate)', input(`value="${esc(existing?.model_number || '')}"`))}
      ${field('warranty_expiry', 'Warranty until', input(`type="date" value="${existing?.warranty_expiry || ''}"`))}
      <div class="span2">${field('description', 'Notes', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="ss-save">${existing ? 'Save changes' : 'Add system'}</button></div>`,
    { wide: true });
  bindStarInputs(m.body);
  if (existing) $('[name=description]', m.body).value = existing.description || '';
  $('#ss-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    body.condition_rating = readStars(m.body, 'condition_rating');
    if (!body.system_name) return toast('Give the system a name', 'err');
    try {
      const res = existing
        ? await api(`/api/portal/systems/${existing.id}`, { method: 'PATCH', body })
        : await api('/api/portal/systems', { method: 'POST', body });
      invalidate();
      toast(res.generated_items
        ? `Saved — ${res.generated_items} maintenance item(s) added to your schedule`
        : 'Saved');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

function warrantyBadge(status, expiry) {
  if (status === 'expired') return `<span class="badge b-critical">■ warranty expired</span>`;
  if (status === 'expiring') return `<span class="badge b-serious">▲ warranty ends ${fmtDate(expiry)}</span>`;
  return '';
}

// Equipment modal — homeowner edition (no internal notes).
function selfEquipmentModal(r, existing, done) {
  const m = modal(existing ? `Edit — ${existing.name}` : 'Add equipment', `
    <p class="sub" style="margin-bottom:12px">Track anything with its own model and warranty — parts of a system
    (a condenser inside your AC) or freestanding (a generator, a mower).</p>
    <div class="form-grid">
      ${field('name', 'Name', input(`value="${esc(existing?.name || '')}" placeholder="AC condenser, generator…"`))}
      ${field('system_id', 'Part of system', select([{ value: '', label: '— freestanding —' },
        ...r.systems.map((s) => ({ value: s.id, label: s.system_name, selected: existing?.system_id === s.id }))], 'data-number'))}
      ${field('make', 'Make', input(`value="${esc(existing?.make || '')}"`))}
      ${field('model_number', 'Model #', input(`value="${esc(existing?.model_number || '')}"`))}
      ${field('serial_number', 'Serial #', input(`value="${esc(existing?.serial_number || '')}"`))}
      ${field('install_date', 'Installed / purchased', input(`type="date" value="${existing?.install_date || ''}"`))}
      ${field('expected_lifespan', 'Expected lifespan (yrs)', input(`type="number" step="0.5" value="${existing?.expected_lifespan ?? ''}" data-number`))}
      ${field('warranty_expiry', 'Warranty expires', input(`type="date" value="${existing?.warranty_expiry || ''}"`))}
      <div class="field"><span class="field-label">Condition</span>${starInput('condition_rating', existing?.condition_rating || 0)}</div>
      <div class="span2">${field('description', 'Notes', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="pe-save">${existing ? 'Save changes' : 'Add equipment'}</button></div>`,
    { wide: true });
  bindStarInputs(m.body);
  if (existing) $('[name=description]', m.body).value = existing.description || '';
  $('#pe-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    body.condition_rating = readStars(m.body, 'condition_rating');
    if (!body.name) return toast('Name the equipment', 'err');
    try {
      if (existing) await api(`/api/portal/equipment/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/portal/equipment', { method: 'POST', body });
      invalidate();
      toast('Equipment saved');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// Service log modal — used for ad-hoc "Log service" and per-item "Mark done".
function serviceModal(r, forwardItem, done) {
  const m = modal(forwardItem ? `Mark done — ${forwardItem.item_name}` : 'Log service', `
    ${forwardItem ? '<div class="notice">This closes the task and schedules the next occurrence automatically.</div>' : ''}
    <div class="form-grid">
      ${field('date', 'Work date', input(`type="date" value="${new Date().toISOString().slice(0, 10)}"`))}
      ${field('performed_by', 'Who did the work', input(`placeholder="Me, ACME Plumbing…"`))}
      ${field('system_id', 'System', select([{ value: '', label: '— none —' },
        ...r.systems.map((s) => ({ value: s.id, label: s.system_name, selected: forwardItem?.system_id === s.id }))], 'data-number'))}
      ${field('equipment_id', 'Equipment', select([{ value: '', label: '— none —' },
        ...r.equipment.map((e) => ({ value: e.id, label: e.name }))], 'data-number'))}
      ${field('invoice_amount', 'Cost ($, optional)', input(`type="number" step="0.01" data-number`))}
      <div class="span2">${field('description', 'What was done', textarea(`rows="3"`))}</div>
      <div class="span2"><label class="field"><span class="field-label">Attach receipt / photo (optional)</span>
        <input type="file" id="svc-doc" class="control"></label></div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="svc-save">${forwardItem ? 'Mark done' : 'Log service'}</button></div>`,
    { wide: true });
  $('#svc-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.description) return toast('Describe the work', 'err');
    if (forwardItem) body.forward_item_id = forwardItem.id;
    try {
      const file = $('#svc-doc', m.body)?.files[0];
      const res = await api('/api/portal/service', { method: 'POST', body });
      if (file) {
        const q = new URLSearchParams({ name: file.name, type: 'invoice', log_id: res.log_id,
          ...(body.system_id ? { system_id: body.system_id } : {}),
          ...(body.equipment_id ? { equipment_id: body.equipment_id } : {}) });
        await fetch(`/api/portal/documents?${q}`, { method: 'POST', body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      }
      invalidate();
      let msg = 'Service logged';
      if (res.closed_forward_item) msg += ' · task closed';
      if (res.next_items_generated) msg += ` · next occurrence scheduled`;
      toast(msg);
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function sendUpgradeRequest() {
  await api('/api/portal/requests', { method: 'POST', body: {
    subject: 'Upgrade request: Self-Serve → Guided',
    body: 'I’d like to upgrade to an advisor membership. Please contact me to book an intake visit that validates and completes my Home Record.',
  } });
  toast('Request sent — a Steward advisor will reach out to book your intake');
}

// ── Overview (US-C1) ───────────────────────────────────────────────────────
export async function renderOverview(view) {
  invalidate();
  const r = await record();
  if (r.needs_onboarding) return renderOnboarding(view, r);
  const h = r.hero;
  view.innerHTML = `
  ${head(r, `Welcome back, ${esc(r.client.first_name)}`,
    `${esc(r.tier_label)} member${r.client.charter_member ? ' · Charter member' : ''} · renewal ${fmtDate(r.client.subscription_renewal)}`)}

  <div class="tiles">
    ${statTile(h.record_completeness + '%', 'home record complete', 'brand')}
    ${statTile(h.next_item ? dueText(h.next_item.due_date) : '—', 'next item due', h.next_item?.overdue ? 'critical' : '')}
    ${statTile(`${h.systems_healthy} / ${h.systems_total}`, 'systems in good shape', 'good')}
    ${statTile(h.systems_aging, 'systems aging or near end of life', h.systems_aging ? 'serious' : '')}
  </div>

  <div class="grid g2 section">
    <div class="card card-pad">
      <h2 class="serif">Your home</h2>
      ${r.property.narrative_summary ? `<div class="narrative">${esc(r.property.narrative_summary)}</div>` : ''}
      <dl class="kv small" style="margin-top:8px">
        <dt>Built</dt><dd>${r.property.year_built ?? '—'}</dd>
        <dt>Size</dt><dd>${r.property.square_footage ? r.property.square_footage.toLocaleString() + ' sq ft' : '—'}</dd>
        <dt>Type</dt><dd>${label(r.property.property_type)}</dd>
        <dt>With Steward since</dt><dd>${fmtDate(r.property.intake_date)}</dd>
      </dl>
      <div style="margin-top:12px">${progress(h.record_completeness, h.record_completeness + '% documented')}</div>
    </div>
    <div class="card card-pad">
      ${r.self_serve ? `
      <h2 class="serif">Your membership</h2>
      <p style="font:400 20px var(--serif);margin:8px 0 2px">Self-Serve</p>
      <div class="sub">You maintain your own Home Record; the maintenance engine keeps your schedule.</div>
      <div class="small muted" style="margin-top:10px">Want a named advisor who documents your home, stays ahead of
      its needs, and brings a vetted contractor network? Your record comes with you.</div>
      <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="upgrade-btn">Upgrade — book an advisor intake</button></div>`
      : `
      <h2 class="serif">Your advisor</h2>
      ${r.advisor ? `
        <p style="font:400 20px var(--serif);margin:8px 0 2px">${esc(r.advisor.full_name)}</p>
        <div class="sub">${esc(r.advisor.email || '')}${r.advisor.phone ? ' · ' + esc(r.advisor.phone) : ''}</div>
        <div class="small muted" style="margin-top:6px">Reaches you by <b>${esc(r.client.preferred_contact || 'email')}</b></div>`
        : '<div class="empty">No advisor assigned.</div>'}`}
      <hr class="divider">
      <h3>Need something?</h3>
      <form id="request-form" style="margin-top:8px">
        ${field('subject', 'Subject', input(`placeholder="Dripping sound in the wall…"`))}
        ${field('body', 'Details', textarea(`rows="2"`))}
        <button class="btn btn-primary btn-sm" type="submit">${r.self_serve ? 'Send to Steward' : 'Send to my advisor'}</button>
      </form>
      <div id="my-requests" style="margin-top:10px"></div>
    </div>
  </div>

  ${r.self_serve && !r.systems.length ? `
  <div class="notice section">Your Home Record has no systems yet — <a href="#/systems">add your furnace, water
  heater, and roof</a> and the maintenance engine will build your schedule.</div>` : ''}

  ${r.warranty_flags?.length ? `
  <div class="notice section">▲ <b>Warranty attention:</b> ${r.warranty_flags.map((w) =>
    `${esc(w.name)} (${w.status === 'expired' ? 'expired' : 'ends ' + fmtDate(w.warranty_expiry)})`).join(' · ')}
    — <a href="#/systems">see equipment</a></div>` : ''}

  <div class="section"><div class="section-head"><h2>Coming up in the next 12 months</h2>
    <a class="small" href="#/calendar">full calendar →</a></div>
    <div class="card card-pad">
      ${r.schedule.slice(0, 6).map(itemLine).join('') || empty('Nothing scheduled.')}
    </div>
  </div>
  <div class="disclaimer">${esc(r.disclaimer)}</div>`;

  $('#upgrade-btn', view)?.addEventListener('click', sendUpgradeRequest);
  loadRequests(view);
  $('#request-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formValues(e.target);
    if (!body.subject) return toast('Add a subject', 'err');
    await api('/api/portal/requests', { method: 'POST', body });
    toast('Sent — your advisor will follow up');
    e.target.reset();
    loadRequests(view);
  });
}

async function loadRequests(view) {
  const reqs = await api('/api/portal/requests');
  const holder = $('#my-requests', view);
  if (!holder) return;
  holder.innerHTML = reqs.length ? `<div class="small muted" style="margin-bottom:4px">Your requests</div>` +
    reqs.slice(0, 4).map((r) => `<div class="item-line small">
      ${statusBadge(r.status)} ${esc(r.subject)}
      <span class="right muted">${fmtDate(r.created_at.slice(0, 10))}</span></div>`).join('') : '';
}

function itemLine(i, selfServe = false) {
  return `<div class="item-line" style="align-items:flex-start">
    ${priorityBadge(i.priority, i.overdue)}
    <div><b>${esc(i.item_name)}</b>${i.system_name ? ` <span class="small muted">· ${esc(i.system_name)}</span>` : ''}
      ${i.deferral_risk ? `<br><span class="small muted">${esc(i.deferral_risk)}</span>` : ''}
      ${i.contractor_name ? `<br><span class="small muted">Assigned: ${esc(i.contractor_name)}</span>` : ''}</div>
    <span class="right" style="white-space:nowrap"><b>${dueText(i.due_date)}</b><br>
      <span class="small muted">${moneyRange(i.est_cost_low, i.est_cost_high)}</span>
      ${selfServe ? `<br><button class="btn btn-sm" data-done="${i.id}" style="margin-top:4px">Mark done</button>` : ''}</span>
  </div>`;
}

function bindMarkDone(view, r, refresh) {
  for (const b of $$('[data-done]', view)) {
    b.addEventListener('click', () =>
      serviceModal(r, r.schedule.find((i) => i.id === Number(b.dataset.done)), refresh));
  }
}

// ── Calendar (US-C1: 12-month forward view) ────────────────────────────────
export async function renderCalendar(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  const months = [];
  const now = new Date();
  for (let k = 0; k < 12; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const horizon = months[11] + '-99';
  const within = r.schedule.filter((i) => i.due_date && i.due_date <= horizon);
  const overdue = within.filter((i) => i.overdue);

  const line = (i) => itemLine(i, r.self_serve);
  view.innerHTML = `
  ${head(r, 'Maintenance Calendar', `${within.length} items over the next 12 months`)}
  ${overdue.length ? `<div class="section"><div class="section-head"><h2>Past due</h2></div>
    <div class="card card-pad">${overdue.map(line).join('')}</div></div>` : ''}
  ${months.map((ym) => {
    const items = within.filter((i) => !i.overdue && i.due_date.slice(0, 7) === ym);
    if (!items.length) return '';
    return `<div class="section cal-month"><h3 class="serif">${fmtMonth(ym)}</h3>
      <div class="card card-pad">${items.map(line).join('')}</div></div>`;
  }).join('') || `<div class="card section">${empty('Nothing scheduled in the next 12 months.')}</div>`}
  <div class="disclaimer">${esc(r.disclaimer)}</div>`;
  bindMarkDone(view, r, () => renderCalendar(view));
}

// ── Systems (US-C1: inventory cards with age bars) ─────────────────────────
export async function renderSystems(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  view.innerHTML = `
  ${head(r, 'Systems Inventory', r.self_serve
    ? `${r.systems.length} systems — you maintain this inventory; the engine schedules from it`
    : `${r.systems.length} systems on record, sorted by remaining life`)}
  ${r.self_serve ? `<div style="margin-bottom:16px">
    <button class="btn btn-primary" id="ss-add">+ Add a system</button>
    <button class="btn" id="pe-add">+ Add equipment</button>
  </div>` : ''}
  <div class="grid g2">
    ${r.systems.map((s) => {
      const equip = r.equipment.filter((e) => e.system_id === s.id);
      return `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><h3>${esc(s.system_name)}</h3><span class="chip">${esc(s.category)}</span></div>
        <div style="text-align:right">${stars(s.condition_rating)}<br>
          <span class="small muted">${s.remaining_life == null ? '' : s.remaining_life <= 0
            ? '<b style="color:var(--critical-text)">at end of expected life</b>' : `~${s.remaining_life} yrs of life left`}</span></div>
      </div>
      ${s.description ? `<div class="small sub" style="margin-top:6px">${esc(s.description)}</div>` : ''}
      ${ageBar(s)}
      <dl class="kv small" style="margin-top:10px">
        ${s.install_date ? `<dt>Installed</dt><dd>${fmtDate(s.install_date)}</dd>` : ''}
        ${s.last_service_date ? `<dt>Last serviced</dt><dd>${fmtDate(s.last_service_date)}</dd>` : ''}
        ${s.warranty_expiry ? `<dt>Warranty until</dt><dd>${fmtDate(s.warranty_expiry)}</dd>` : ''}
        ${s.model_number ? `<dt>Model</dt><dd>${esc(s.model_number)}</dd>` : ''}
      </dl>
      ${equip.length ? `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--hairline-2)">
        <div class="field-label" style="margin-bottom:4px">Equipment</div>
        ${equip.map((e) => `<div class="item-line small">
          <div><b>${esc(e.name)}</b> ${warrantyBadge(e.warranty_status, e.warranty_expiry)}<br>
            <span class="muted">${[e.make, e.model_number].filter(Boolean).map(esc).join(' · ')}
            ${e.warranty_expiry && e.warranty_status === 'active' ? ` · warranty to ${fmtDate(e.warranty_expiry)}` : ''}</span></div>
          ${r.self_serve ? `<span class="right"><button class="btn btn-sm" data-pe-edit="${e.id}">Edit</button></span>` : ''}
        </div>`).join('')}
      </div>` : ''}
      ${r.self_serve ? `<div style="margin-top:10px"><button class="btn btn-sm" data-ss-edit="${s.id}">Edit</button></div>` : ''}
    </div>`; }).join('') || `<div class="card">${empty('No systems yet — add the first one.')}</div>`}
  </div>
  ${(() => {
    const freestanding = r.equipment.filter((e) => !e.system_id);
    return freestanding.length ? `
    <div class="card card-pad section">
      <h3>Freestanding equipment</h3>
      ${freestanding.map((e) => `<div class="item-line small">
        <div><b>${esc(e.name)}</b> ${warrantyBadge(e.warranty_status, e.warranty_expiry)}<br>
          <span class="muted">${[e.make, e.model_number].filter(Boolean).map(esc).join(' · ')}
          ${e.warranty_expiry && e.warranty_status === 'active' ? ` · warranty to ${fmtDate(e.warranty_expiry)}` : ''}</span></div>
        ${r.self_serve ? `<span class="right"><button class="btn btn-sm" data-pe-edit="${e.id}">Edit</button></span>` : ''}
      </div>`).join('')}
    </div>` : '';
  })()}`;

  if (r.self_serve) {
    const refresh = () => renderSystems(view);
    $('#ss-add', view).addEventListener('click', () => selfSystemModal(r, null, refresh));
    $('#pe-add', view).addEventListener('click', () => selfEquipmentModal(r, null, refresh));
    for (const b of $$('[data-ss-edit]', view)) {
      b.addEventListener('click', () =>
        selfSystemModal(r, r.systems.find((s) => s.id === Number(b.dataset.ssEdit)), refresh));
    }
    for (const b of $$('[data-pe-edit]', view)) {
      b.addEventListener('click', () =>
        selfEquipmentModal(r, r.equipment.find((e) => e.id === Number(b.dataset.peEdit)), refresh));
    }
  }
}

// ── History (US-C2: the home's medical record) ─────────────────────────────
export async function renderHistory(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  const total = r.log.reduce((sum, l) => sum + (l.invoice_amount || 0), 0);
  const docsByLog = {};
  for (const doc of r.documents) if (doc.maintenance_log_id) (docsByLog[doc.maintenance_log_id] ??= []).push(doc);
  view.innerHTML = `
  ${head(r, 'Maintenance History', `${r.log.length} jobs on record · ${money(total)} total invested`)}
  ${r.self_serve ? `<div style="margin-bottom:16px"><button class="btn btn-primary" id="svc-add">+ Log service</button></div>` : ''}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Work performed</th><th>System / Equipment</th><th>Performed by</th><th class="num">Cost</th></tr></thead>
      <tbody>${r.log.map((l) => `<tr>
        <td style="white-space:nowrap">${fmtDate(l.date)}</td>
        <td>${esc(l.description)}${l.outcome_notes ? `<br><span class="small muted">${esc(l.outcome_notes)}</span>` : ''}
          ${(docsByLog[l.id] || []).map((doc) => `<br><a class="small" href="/api/documents/${doc.id}/file" target="_blank">📎 ${esc(doc.document_name)}</a>`).join('')}</td>
        <td>${esc(l.system_name || '—')}${l.equipment_name ? `<br><span class="chip">${esc(l.equipment_name)}</span>` : ''}</td>
        <td>${esc(l.contractor_name || l.performed_by || '—')}</td>
        <td class="num">${money(l.invoice_amount)}</td>
      </tr>`).join('') || `<tr><td colspan="5">${empty('No work logged yet.')}</td></tr>`}</tbody>
    </table>
  </div>
  ${r.permits.length ? `
  <div class="section"><div class="section-head"><h2>Permit history</h2></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Permit</th><th>Type</th><th>Filed</th><th>Status</th><th>Scope</th></tr></thead>
    <tbody>${r.permits.map((pm) => `<tr>
      <td>${esc(pm.permit_number || '—')}${pm.gap_flag ? '<br><span class="badge b-critical">▲ gap flag</span>' : ''}</td>
      <td>${label(pm.permit_type)}</td><td>${fmtDate(pm.date_filed)}</td><td>${statusBadge(pm.status)}</td>
      <td>${esc(pm.scope_description || '')}${pm.gap_notes ? `<br><span class="small muted">${esc(pm.gap_notes)}</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div></div>` : ''}`;

  $('#svc-add', view)?.addEventListener('click', () => serviceModal(r, null, () => renderHistory(view)));
}

// ── Capital forecast (US-C3, tier-gated) ───────────────────────────────────
export async function renderForecast(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  if (!r.forecast_eligible) {
    view.innerHTML = `${head(r, 'Capital Forecast')}
    <div class="card card-pad" style="max-width:640px">
      <h2 class="serif">Included with Managed and Concierge membership</h2>
      <p class="sub" style="margin-top:8px">The five-year capital forecast maps every major system to its expected
      replacement year and cost range — so a new roof or boiler never arrives as a surprise.
      ${r.self_serve ? '' : 'Ask your advisor about upgrading your membership.'}</p>
      ${r.self_serve ? '<div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="upgrade-btn">Upgrade — book an advisor intake</button></div>' : ''}
    </div>`;
    $('#upgrade-btn', view)?.addEventListener('click', sendUpgradeRequest);
    return;
  }
  const lo = r.forecast.reduce((s, f) => s + (f.est_cost_low || 0), 0);
  const hi = r.forecast.reduce((s, f) => s + (f.est_cost_high || 0), 0);
  view.innerHTML = `
  ${head(r, 'Five-Year Capital Forecast', 'Major expenses, planned — never surprises')}
  <div class="tiles">
    ${statTile(r.forecast.length, 'capital items on the horizon', 'brand')}
    ${statTile(moneyRange(lo, hi), 'combined planning range')}
  </div>
  <div class="table-wrap section"><table>
    <thead><tr><th>System</th><th>What</th><th>Est. year</th><th class="num">Cost range</th></tr></thead>
    <tbody>${r.forecast.map((f) => `<tr>
      <td><b>${esc(f.system_name || '—')}</b></td>
      <td>${esc(f.item_name)}</td>
      <td>${f.est_year ?? '—'}</td>
      <td class="num">${moneyRange(f.est_cost_low, f.est_cost_high)}</td>
    </tr>`).join('') || `<tr><td colspan="4">${empty('No capital items — enjoy it.')}</td></tr>`}</tbody>
  </table></div>
  <p class="small muted section">Estimates refine over time as your advisor gathers real quotes. Your advisor reviews this forecast with you at every annual visit.</p>`;
}

// ── Contractors (US-C4: "so I know who Mike is") ───────────────────────────
export async function renderContractors(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  view.innerHTML = `
  ${head(r, 'Your Home’s Contractors', 'The vetted professionals who work on your home')}
  <div class="grid g2">
    ${r.contractors.map((c) => `
    <div class="card card-pad">
      <h3>${esc(c.company_name)}</h3>
      <div class="sub">${esc(c.primary_contact || '')}</div>
      <div style="margin:8px 0">${c.trades.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        ${c.preferred_pricing ? '<span class="chip" style="color:var(--brand)">Steward preferred pricing</span>' : ''}</div>
      <dl class="kv small">
        ${c.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>` : ''}
        ${c.email ? `<dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
      </dl>
    </div>`).join('') || `<div class="card">${empty('No contractors assigned to your home yet.')}</div>`}
  </div>
  <p class="small muted section">${esc(r.fee_disclosure)}</p>`;
}

// ── Documents (US-C5/C6: browse + upload + export) ─────────────────────────
export async function renderDocuments(view) {
  invalidate();
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  view.innerHTML = `
  ${head(r, 'Documents', 'Everything about your house, in one place — and it’s yours to take')}
  <div class="card card-pad" style="margin-bottom:16px">
    <h3>Add to your Home Record</h3>
    <form id="up-form" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:10px">
      <label class="field" style="margin:0"><span class="field-label">File</span>
        <input type="file" id="up-file" class="control" style="max-width:250px"></label>
      <label class="field" style="margin:0"><span class="field-label">Type</span>
        <select id="up-type" class="control" style="max-width:150px">
          ${['photo', 'invoice', 'warranty', 'permit_doc', 'inspection_report', 'other'].map((t) => `<option>${t}</option>`).join('')}
        </select></label>
      <label class="field" style="margin:0"><span class="field-label">System</span>
        <select id="up-system" class="control" style="max-width:170px"><option value="">—</option>
          ${r.systems.map((s) => `<option value="${s.id}">${esc(s.system_name)}</option>`).join('')}
        </select></label>
      <label class="field" style="margin:0"><span class="field-label">Equipment</span>
        <select id="up-equipment" class="control" style="max-width:170px"><option value="">—</option>
          ${r.equipment.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
        </select></label>
      <label class="field" style="margin:0"><span class="field-label">Description</span>
        <input id="up-desc" class="control" placeholder="optional" style="max-width:200px"></label>
      <button class="btn btn-primary btn-sm" type="submit">Upload</button>
    </form>
  </div>
  <div class="card card-pad">
    ${r.documents.length ? r.documents.map((doc) => `
      <div class="item-line">
        <span class="chip">${label(doc.document_type)}</span>
        <div><a href="/api/documents/${doc.id}/file" target="_blank"><b>${esc(doc.document_name)}</b></a>
          ${doc.system_name ? `<span class="chip">${esc(doc.system_name)}</span>` : ''}
          ${doc.equipment_name ? `<span class="chip">⚙ ${esc(doc.equipment_name)}</span>` : ''}
          <br><span class="small muted">${doc.description ? esc(doc.description) + ' · ' : ''}${fmtDate(doc.upload_date)}</span></div>
        <span class="right small muted">${doc.size_bytes ? Math.ceil(doc.size_bytes / 1024) + ' KB' : ''}</span>
      </div>`).join('') : empty('No documents yet — upload the first one.')}
  </div>
  <div class="card card-pad section" style="max-width:640px">
    <h3>Your record belongs to you</h3>
    <p class="small sub" style="margin:8px 0 12px">Export your complete Home Record at any time — systems, history,
    permits, forecast. It's the document that makes your house worth more when you sell, and it leaves with you if you ever go.</p>
    <a class="btn btn-primary" href="/api/export/${r.property.id}" target="_blank">Export Home Record (print / save as PDF)</a>
  </div>`;

  $('#up-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#up-file', view).files[0];
    if (!file) return toast('Choose a file first', 'err');
    const q = new URLSearchParams({
      name: file.name, type: $('#up-type', view).value,
      description: $('#up-desc', view).value, property_id: r.property.id,
    });
    for (const [param, sel] of [['system_id', '#up-system'], ['equipment_id', '#up-equipment']]) {
      const v = $(sel, view)?.value;
      if (v) q.set(param, v);
    }
    const res = await fetch(`/api/portal/documents?${q}`, {
      method: 'POST', body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!res.ok) return toast((await res.json()).error, 'err');
    toast('Added to your Home Record');
    renderDocuments(view);
  });
}
