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
    <h2 class="serif" style="margin-bottom:6px">Start with your address</h2>
    <p class="sub" style="margin-bottom:12px">Steward can draft your home from public permit records — systems, install
    dates, and permit history — so you just confirm instead of typing it all in.</p>
    <div class="form-grid">
      <div class="span2">${field('enrich_address', 'Full street address', input(`placeholder="35 Sample St, Boston, MA 02130"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="ob-enrich">✨ Build from my address</button></div>
    <p class="small muted" style="margin-top:8px">Best coverage in cities with open permit data. Try
    <code>35 Sample St, Boston, MA 02130</code> or <code>88 Example Ave, Boston, MA 02127</code>.</p>
  </div>
  <details class="section" style="max-width:720px"><summary class="small" style="cursor:pointer">…or enter your home manually</summary>
  <div class="card card-pad" style="margin-top:10px">
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
  </div></details>`
  : `<div class="card">${empty('No home on record yet — your advisor is on it.')}</div>`}`;

  $('#ob-enrich', view)?.addEventListener('click', async () => {
    const address = $('[name=enrich_address]', view)?.value.trim();
    if (!address || address.length < 5) return toast('Enter a full street address', 'err');
    const btn = $('#ob-enrich', view);
    btn.disabled = true; btn.textContent = 'Looking up public records…';
    try {
      const draft = await api('/api/portal/enrich', { method: 'POST', body: { address } });
      renderEnrichDraft(view, r, draft);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = '✨ Build from my address'; }
  });

  $('#ob-save', view)?.addEventListener('click', async () => {
    const body = formValues(view);
    if (!body.address_line1) return toast('Enter your street address', 'err');
    delete body.enrich_address;
    try {
      await api('/api/portal/property', { method: 'POST', body });
      invalidate();
      toast('Home created — now add your systems');
      location.hash = '#/systems';
      renderSystems($('#view'));
    } catch (err) { toast(err.message, 'err'); }
  });
}

// Review step for the address auto-build: confirm the drafted property,
// systems, and permits (uncheck anything wrong) before creating the record.
function renderEnrichDraft(view, r, draft) {
  const p = draft.property || {};
  view.innerHTML = `
  <div class="page-head"><div>
    <h1>Here’s your home, ${esc(r.client.first_name)}</h1>
    <div class="sub">Drafted from ${draft.source === 'fixture' ? 'sample' : 'public'} permit records for
    ${esc(p.address_line1 || draft.address)}. Uncheck anything that’s wrong, then create your record.</div>
  </div></div>
  ${draft.source === 'none' ? `<div class="notice section" style="max-width:760px">${esc(draft.note || 'No public records found — enter your home manually instead.')}</div>` : ''}
  <div class="card card-pad" style="max-width:760px">
    <h3>Your home</h3>
    <dl class="kv small" style="margin-top:6px">
      <dt>Address</dt><dd>${esc([p.address_line1, p.city, p.state, p.zip].filter(Boolean).join(', ')) || '—'}</dd>
      <dt>Type</dt><dd>${p.property_type ? label(p.property_type) : '—'}</dd>
      <dt>Built</dt><dd>${p.year_built ?? '—'}</dd>
    </dl>
    <hr class="divider">
    <h3>Systems found (${draft.systems.length})</h3>
    ${draft.systems.map((s, i) => `<label class="checkbox-row" style="align-items:flex-start">
      <input type="checkbox" data-sys="${i}" checked style="margin-top:3px">
      <span><b>${esc(s.system_name)}</b> <span class="chip">${esc(s.category)}</span>
        <span class="small muted">${s.install_date ? 'installed ' + fmtDate(s.install_date) : ''}${s.expected_lifespan ? ` · ~${s.expected_lifespan} yr life` : ''}</span></span>
    </label>`).join('') || empty('No systems detected from permits.')}
    <hr class="divider">
    <h3>Permit history (${draft.permits.length})</h3>
    ${draft.permits.map((pm, i) => `<label class="checkbox-row" style="align-items:flex-start">
      <input type="checkbox" data-permit="${i}" checked style="margin-top:3px">
      <span>${esc(pm.permit_number || '—')} <span class="small muted">${esc((pm.scope_description || '').slice(0, 80))}</span></span>
    </label>`).join('') || empty('No permits found.')}
    <div class="form-actions">
      <button class="btn" id="ed-back">Back</button>
      <button class="btn btn-primary" id="ed-create">Create my Home Record</button>
    </div>
  </div>`;

  $('#ed-back', view).addEventListener('click', () => renderOnboarding(view, r));
  $('#ed-create', view).addEventListener('click', async () => {
    const systems = draft.systems.filter((_, i) => $(`[data-sys="${i}"]`, view)?.checked);
    const permits = draft.permits.filter((_, i) => $(`[data-permit="${i}"]`, view)?.checked);
    try {
      const res = await api('/api/portal/enrich/apply', { method: 'POST', body: { property: draft.property, systems, permits } });
      invalidate();
      toast(`Home created — ${res.systems} systems, ${res.permits} permits, ${res.generated_items} scheduled`);
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
      <div class="span2">${field('description', 'Description', textarea(`rows="2"`))}</div>
    </div>
    <div class="suggest-panel" id="sg-panel" style="display:none"></div>
    <div class="form-actions">
      ${existing ? lifecycleButtonsHtml() : ''}
      <button type="button" class="btn" id="sg-btn">✨ Suggest schedule & description</button>
      <button class="btn btn-primary" id="ss-save">${existing ? 'Save changes' : 'Add system'}</button>
    </div>`,
    { wide: true });
  bindStarInputs(m.body);
  if (existing) $('[name=description]', m.body).value = existing.description || '';

  let savedId = existing?.id ?? null;
  async function saveItem() {
    const body = formValues(m.body);
    body.condition_rating = readStars(m.body, 'condition_rating');
    if (!body.system_name) throw new Error('Give the system a name first');
    if (savedId) {
      await api(`/api/portal/systems/${savedId}`, { method: 'PATCH', body });
    } else {
      const res = await api('/api/portal/systems', { method: 'POST', body });
      savedId = res.id;
    }
    return savedId;
  }

  $('#ss-save', m.body).addEventListener('click', async () => {
    try {
      const id = await saveItem();
      invalidate();
      toast('Saved');
      m.close(); done(id);
    } catch (err) { toast(err.message, 'err'); }
  });
  bindLifecycle(m, r, 'system', existing, done);
  bindSuggest(m, r, 'system', existing, saveItem, done);
}

// Replace / retire actions shared by the system and equipment edit modals.
const lifecycleButtonsHtml = () => `
  <button type="button" class="btn" id="lc-replace">Replace</button>
  <button type="button" class="btn btn-danger" id="lc-retire">Retire</button>`;

function bindLifecycle(m, r, kind, existing, done) {
  if (!existing) return;
  const base = kind === 'system' ? 'systems' : 'equipment';
  $('#lc-retire', m.body)?.addEventListener('click', async () => {
    const what = kind === 'system' ? 'this system and its components' : 'this component';
    if (!confirm(`Retire ${what}? Its history stays in your record; it just leaves your active inventory and stops being scheduled.`)) return;
    try {
      await api(`/api/portal/${base}/${existing.id}/retire`, { method: 'POST', body: {} });
      invalidate();
      toast('Retired — history kept');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#lc-replace', m.body)?.addEventListener('click', () => { m.close(); replaceModal(r, kind, existing, done); });
}

// Replace flow: retire the old record, stand up a fresh one with a reset clock.
function replaceModal(r, kind, old, done) {
  const isSys = kind === 'system';
  const today = new Date().toISOString().slice(0, 10);
  const m = modal(`Replace — ${esc(isSys ? old.system_name : old.name)}`, `
    <p class="sub" style="margin-bottom:12px">Keeps the old one's history, retires it, and starts a fresh record with a new
    install date and clock.${isSys ? ' Its components carry over to the new system — replace any that changed too.' : ''}</p>
    <div class="form-grid">
      ${field('name', 'Name', input(`value="${esc(isSys ? old.system_name : old.name)}"`))}
      ${isSys ? '' : field('make', 'Make', input(`value="${esc(old.make || '')}"`))}
      ${field('model_number', 'New model #', input(`placeholder="from the new unit's data plate"`))}
      ${field('serial_number', 'New serial #', input())}
      ${field('install_date', 'Installed', input(`type="date" value="${today}"`))}
      ${field('expected_lifespan', 'Expected lifespan (yrs)', input(`type="number" step="0.5" value="${old.expected_lifespan ?? ''}" data-number`))}
      ${field('warranty_expiry', 'Warranty until', input(`type="date"`))}
      <div class="span2">${field('note', 'Note (optional)', input(`placeholder="e.g. old one failed — upgraded to a heat-pump model"`))}</div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="rp-save">Retire old &amp; add replacement</button>
    </div>`, { wide: true });
  $('#rp-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (isSys) { body.system_name = body.name; delete body.name; }
    try {
      await api(`/api/portal/${isSys ? 'systems' : 'equipment'}/${old.id}/replace`, { method: 'POST', body });
      invalidate();
      toast('Replaced — old record retired, history kept');
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
      <div class="span2">${field('description', 'Description', textarea(`rows="2"`))}</div>
    </div>
    <div class="suggest-panel" id="sg-panel" style="display:none"></div>
    <div class="form-actions">
      ${existing ? lifecycleButtonsHtml() : ''}
      <button type="button" class="btn" id="sg-btn">✨ Suggest schedule & description</button>
      <button class="btn btn-primary" id="pe-save">${existing ? 'Save changes' : 'Add equipment'}</button>
    </div>`,
    { wide: true });
  bindStarInputs(m.body);
  if (existing) $('[name=description]', m.body).value = existing.description || '';

  let savedId = existing?.id ?? null;
  async function saveItem() {
    const body = formValues(m.body);
    body.condition_rating = readStars(m.body, 'condition_rating');
    if (!body.name) throw new Error('Name the equipment first');
    if (savedId) {
      await api(`/api/portal/equipment/${savedId}`, { method: 'PATCH', body });
    } else {
      const res = await api('/api/portal/equipment', { method: 'POST', body });
      savedId = res.id;
    }
    return savedId;
  }

  $('#pe-save', m.body).addEventListener('click', async () => {
    try {
      const id = await saveItem();
      invalidate();
      toast('Equipment saved');
      m.close(); done(id);
    } catch (err) { toast(err.message, 'err'); }
  });
  bindLifecycle(m, r, 'equipment', existing, done);
  bindSuggest(m, r, 'equipment', existing, saveItem, done);
}

const DOC_CATEGORIES = ['receipt', 'invoice', 'quote', 'contract', 'photo', 'warranty', 'other'];

function fileRowsHtml() {
  return `
    <div class="span2"><span class="field-label">Attach documents (each with a category)</span>
      <div id="svc-files" style="margin-top:6px"></div>
      <button type="button" class="btn btn-sm" id="svc-file-add">+ Add a file</button>
    </div>`;
}
function addFileRow(container) {
  const row = document.createElement('div');
  row.className = 'doc-file-row';
  row.innerHTML = `
    <input type="file" class="control svc-file" style="max-width:260px">
    <select class="control svc-file-type" style="max-width:130px">
      ${DOC_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-sm svc-file-rm">×</button>`;
  row.querySelector('.svc-file-rm').addEventListener('click', () => row.remove());
  container.appendChild(row);
}
async function uploadFileRows(mBody, logId, systemId, equipmentId) {
  let uploaded = 0;
  for (const row of $$('.doc-file-row', mBody)) {
    const file = row.querySelector('.svc-file').files[0];
    if (!file) continue;
    const q = new URLSearchParams({
      name: file.name, type: row.querySelector('.svc-file-type').value,
      ...(logId ? { log_id: logId } : {}),
      ...(systemId ? { system_id: systemId } : {}),
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
    });
    const res = await fetch(`/api/portal/documents?${q}`, { method: 'POST', body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    if (res.ok) uploaded++;
  }
  return uploaded;
}

// Inline "+ Add new…" on a picker. Picking the sentinel opens a small
// creator modal on top of the current form; on save the picker refills from
// the fresh record with the new item already selected — so a missing
// contractor / system / equipment never forces you to abandon what you're
// filling in. itemsFn(freshRecord) returns the {value,label} option list.
function inlineCreate(selectEl, { placeholder, addLabel, itemsFn, openCreate }) {
  if (!selectEl) return;
  const rebuild = (items, sel) => {
    selectEl.innerHTML =
      `<option value="">${esc(placeholder)}</option>` +
      items.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(sel) ? ' selected' : ''}>${esc(o.label)}</option>`).join('') +
      `<option value="__new__">${esc(addLabel)}</option>`;
  };
  const sentinel = document.createElement('option');
  sentinel.value = '__new__';
  sentinel.textContent = addLabel;
  selectEl.appendChild(sentinel);
  let prev = selectEl.value;
  selectEl.addEventListener('change', () => {
    if (selectEl.value !== '__new__') { prev = selectEl.value; return; }
    selectEl.value = prev; // never leave the sentinel as the live value
    openCreate(async (newId) => {
      if (newId == null) return;
      const fresh = await record();
      rebuild(itemsFn(fresh), newId);
      prev = selectEl.value;
    });
  });
}

// Service log modal — "Log service", per-item "Mark done", and edit mode.
function serviceModal(r, opts, done) {
  const { forwardItem = null, existing = null } = opts || {};
  const title = existing ? 'Edit service record' : forwardItem ? `Mark done — ${forwardItem.item_name}` : 'Log service';
  const attachedDocs = existing ? r.documents.filter((d) => d.maintenance_log_id === existing.id) : [];
  const m = modal(title, `
    ${forwardItem ? '<div class="notice">This closes the task and schedules the next occurrence automatically.</div>' : ''}
    <div class="form-grid">
      ${field('date', 'Work date', input(`type="date" value="${existing?.date || new Date().toISOString().slice(0, 10)}"`))}
      ${field('client_contractor_id', 'Contractor (from your book)', select([{ value: '', label: '— none / myself —' },
        ...r.my_contractors.map((c) => ({ value: c.id, label: c.company ? `${c.name} — ${c.company}` : c.name,
          selected: existing?.client_contractor_id === c.id }))], 'data-number'))}
      ${field('performed_by', 'Or who did the work (free text)', input(`value="${esc(existing?.performed_by || '')}" placeholder="Me, a neighbor…"`))}
      ${field('invoice_amount', 'Cost ($, optional)', input(`type="number" step="0.01" value="${existing?.invoice_amount ?? ''}" data-number`))}
      ${field('system_id', 'System', select([{ value: '', label: '— none —' },
        ...r.systems.map((s) => ({ value: s.id, label: s.system_name,
          selected: (existing?.system_id ?? forwardItem?.system_id) === s.id }))], 'data-number'))}
      ${field('equipment_id', 'Equipment', select([{ value: '', label: '— none —' },
        ...r.equipment.map((e) => ({ value: e.id, label: e.name,
          selected: (existing?.equipment_id ?? forwardItem?.equipment_id) === e.id }))], 'data-number'))}
      <div class="span2">${field('description', 'What was done', textarea(`rows="3"`))}</div>
      <div class="span2">${field('outcome_notes', 'Notes / outcome (optional)', textarea(`rows="2"`))}</div>
      ${attachedDocs.length ? `<div class="span2"><span class="field-label">Attached documents</span>
        ${attachedDocs.map((doc) => `<div class="item-line small"><span class="chip">${label(doc.document_type)}</span>
          <a href="/api/documents/${doc.id}/file" target="_blank">${esc(doc.document_name)}</a></div>`).join('')}</div>` : ''}
      ${fileRowsHtml()}
    </div>
    <div class="form-actions">
      ${existing ? '<button class="btn btn-danger" id="svc-delete">Delete record</button>' : ''}
      <button class="btn btn-primary" id="svc-save">${existing ? 'Save changes' : forwardItem ? 'Mark done' : 'Log service'}</button>
    </div>`,
    { wide: true });
  $('[name=description]', m.body).value = existing?.description || '';
  $('[name=outcome_notes]', m.body).value = existing?.outcome_notes || '';
  const filesBox = $('#svc-files', m.body);
  addFileRow(filesBox);
  $('#svc-file-add', m.body).addEventListener('click', () => addFileRow(filesBox));

  // Create a missing contractor / system / equipment without leaving the form.
  inlineCreate($('[name=client_contractor_id]', m.body), {
    placeholder: '— none / myself —', addLabel: '+ Add a contractor…',
    itemsFn: (fresh) => fresh.my_contractors.map((c) =>
      ({ value: c.id, label: c.company ? `${c.name} — ${c.company}` : c.name })),
    openCreate: (cb) => myContractorModal(null, cb),
  });
  inlineCreate($('[name=system_id]', m.body), {
    placeholder: '— none —', addLabel: '+ Add a system…',
    itemsFn: (fresh) => fresh.systems.map((s) => ({ value: s.id, label: s.system_name })),
    openCreate: (cb) => selfSystemModal(r, null, cb),
  });
  inlineCreate($('[name=equipment_id]', m.body), {
    placeholder: '— none —', addLabel: '+ Add equipment…',
    itemsFn: (fresh) => fresh.equipment.map((e) => ({ value: e.id, label: e.name })),
    openCreate: (cb) => selfEquipmentModal(r, null, cb),
  });

  $('#svc-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.description) return toast('Describe the work', 'err');
    try {
      let logId;
      if (existing) {
        await api(`/api/portal/service/${existing.id}`, { method: 'PATCH', body });
        logId = existing.id;
      } else {
        if (forwardItem) body.forward_item_id = forwardItem.id;
        const res = await api('/api/portal/service', { method: 'POST', body });
        logId = res.log_id;
        var closed = res.closed_forward_item, nextOcc = res.next_occurrence, nextGen = res.next_items_generated;
      }
      const uploaded = await uploadFileRows(m.body, logId, body.system_id, body.equipment_id);
      invalidate();
      let msg = existing ? 'Service record updated' : 'Service logged';
      if (uploaded) msg += ` · ${uploaded} document(s) attached`;
      if (typeof closed !== 'undefined' && closed) msg += ' · task closed';
      if (typeof nextOcc !== 'undefined' && nextOcc) msg += ' · next occurrence scheduled';
      else if (typeof nextGen !== 'undefined' && nextGen) msg += ' · next occurrence scheduled';
      toast(msg);
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#svc-delete', m.body)?.addEventListener('click', async () => {
    if (!confirm('Delete this service record? Attached documents stay in your Documents.')) return;
    await api(`/api/portal/service/${existing.id}`, { method: 'DELETE' });
    invalidate();
    toast('Service record deleted');
    m.close(); done();
  });
}

// Custom task modal (your own maintenance schedule).
function taskModal(r, existing, done) {
  const m = modal(existing ? `Edit task — ${existing.item_name}` : 'Add a task', `
    <div class="form-grid">
      <div class="span2">${field('item_name', 'Task', input(`value="${esc(existing?.item_name || '')}" placeholder="Clean gutters, service generator…"`))}</div>
      ${field('due_date', 'Due', input(`type="date" value="${existing?.due_date || ''}"`))}
      ${field('priority', 'Priority', select(['standard', 'urgent', 'planning'].map((p) =>
        ({ value: p, label: p, selected: existing?.priority === p }))))}
      ${field('repeat_value', 'Repeats every…', input(`type="number" step="1" min="1" value="${existing?.repeat_value ?? ''}" placeholder="leave blank for one-time" data-number`))}
      ${field('repeat_unit', '…unit', select([{ value: '', label: '—' }, ...['months', 'years', 'days'].map((u) =>
        ({ value: u, label: u, selected: existing?.repeat_unit === u }))]))}
      ${field('system_id', 'System', select([{ value: '', label: '— none —' },
        ...r.systems.map((s) => ({ value: s.id, label: s.system_name, selected: existing?.system_id === s.id }))], 'data-number'))}
      ${field('equipment_id', 'Equipment', select([{ value: '', label: '— none —' },
        ...r.equipment.map((e) => ({ value: e.id, label: e.name, selected: existing?.equipment_id === e.id }))], 'data-number'))}
      ${field('est_cost_low', 'Est. cost low ($)', input(`type="number" value="${existing?.est_cost_low ?? ''}" data-number`))}
      ${field('est_cost_high', 'Est. cost high ($)', input(`type="number" value="${existing?.est_cost_high ?? ''}" data-number`))}
      <div class="span2">${field('deferral_risk', 'Notes (why it matters)', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions">
      ${existing ? '<button class="btn btn-danger" id="task-delete">Delete task</button>' : ''}
      <button class="btn btn-primary" id="task-save">${existing ? 'Save changes' : 'Add task'}</button>
    </div>`, { wide: true });
  $('[name=deferral_risk]', m.body).value = existing?.deferral_risk || '';
  inlineCreate($('[name=system_id]', m.body), {
    placeholder: '— none —', addLabel: '+ Add a system…',
    itemsFn: (fresh) => fresh.systems.map((s) => ({ value: s.id, label: s.system_name })),
    openCreate: (cb) => selfSystemModal(r, null, cb),
  });
  inlineCreate($('[name=equipment_id]', m.body), {
    placeholder: '— none —', addLabel: '+ Add equipment…',
    itemsFn: (fresh) => fresh.equipment.map((e) => ({ value: e.id, label: e.name })),
    openCreate: (cb) => selfEquipmentModal(r, null, cb),
  });
  $('#task-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.item_name || !body.due_date) return toast('Task name and due date are required', 'err');
    if (body.repeat_value && !body.repeat_unit) body.repeat_unit = 'months';
    try {
      if (existing) await api(`/api/portal/tasks/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/portal/tasks', { method: 'POST', body });
      invalidate();
      toast(existing ? 'Task updated' : 'Task added to your schedule');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#task-delete', m.body)?.addEventListener('click', async () => {
    if (!confirm(`Delete "${existing.item_name}"?`)) return;
    await api(`/api/portal/tasks/${existing.id}`, { method: 'DELETE' });
    invalidate();
    toast('Task deleted');
    m.close(); done();
  });
}

// Permit record modal (self-serve): record a permit from work done on the
// home, optionally attaching the permit PDF.
function permitModal(r, existing, done) {
  const attached = existing ? r.documents.filter((d) => d.permit_id === existing.id) : [];
  const types = ['electrical', 'plumbing', 'structural', 'mechanical', 'general_building', 'demolition', 'other'];
  const m = modal(existing ? `Edit permit — ${existing.permit_number || 'record'}` : 'Add a permit', `
    <p class="sub" style="margin-bottom:12px">Record a building permit from work done on your home — a panel upgrade,
    a re-roof, a water-heater swap. Attach the permit PDF if you have it.</p>
    <div class="form-grid">
      ${field('permit_number', 'Permit #', input(`value="${esc(existing?.permit_number || '')}" placeholder="e.g. BLD-2023-04812"`))}
      ${field('permit_type', 'Type', select([{ value: '', label: '—' },
        ...types.map((t) => ({ value: t, label: t.replace(/_/g, ' '), selected: existing?.permit_type === t }))]))}
      ${field('date_filed', 'Filed', input(`type="date" value="${existing?.date_filed || ''}"`))}
      ${field('date_finaled', 'Finaled / closed', input(`type="date" value="${existing?.date_finaled || ''}"`))}
      ${field('status', 'Status', select(['unknown', 'pending', 'open', 'finaled', 'expired']
        .map((s) => ({ value: s, label: s, selected: (existing?.status || 'unknown') === s }))))}
      ${field('contractor_of_record', 'Contractor of record', input(`value="${esc(existing?.contractor_of_record || '')}"`))}
      <div class="field span2"><span class="field-label">Final inspection</span>
        <label class="checkbox-row"><input type="checkbox" name="final_inspection_passed" ${existing?.final_inspection_passed ? 'checked' : ''}> passed</label></div>
      <div class="span2">${field('scope_description', 'Scope of work', textarea(`rows="2"`))}</div>
      <div class="span2"><span class="field-label">Attach the permit document (optional)</span>
        <div><input type="file" class="control" id="permit-file" style="max-width:280px"></div>
        ${attached.length ? `<div style="margin-top:6px">${attached.map((d) => `<div class="small item-line">
          <span class="chip">${label(d.document_type)}</span>
          <a href="/api/documents/${d.id}/file" target="_blank">${esc(d.document_name)}</a></div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="form-actions">
      ${existing ? '<button class="btn btn-danger" id="permit-delete">Delete</button>' : ''}
      <button class="btn btn-primary" id="permit-save">${existing ? 'Save changes' : 'Add permit'}</button>
    </div>`, { wide: true });
  $('[name=scope_description]', m.body).value = existing?.scope_description || '';

  $('#permit-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.permit_number && !body.scope_description) return toast('Enter a permit number or a scope of work', 'err');
    try {
      let permitId = existing?.id;
      if (existing) await api(`/api/portal/permits/${existing.id}`, { method: 'PATCH', body });
      else { const res = await api('/api/portal/permits', { method: 'POST', body }); permitId = res.id; }
      const file = $('#permit-file', m.body).files[0];
      if (file) {
        const q = new URLSearchParams({ name: file.name, type: 'permit_doc', permit_id: permitId });
        await fetch(`/api/portal/documents?${q}`, { method: 'POST', body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      }
      invalidate();
      toast(existing ? 'Permit updated' : 'Permit added');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#permit-delete', m.body)?.addEventListener('click', async () => {
    if (!confirm('Delete this permit record? An attached document stays in your Documents.')) return;
    try {
      await api(`/api/portal/permits/${existing.id}`, { method: 'DELETE' });
      invalidate();
      toast('Permit deleted');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// Personal contractor modal.
function myContractorModal(existing, done) {
  const m = modal(existing ? `Edit — ${existing.name}` : 'Add a contractor', `
    <div class="form-grid">
      ${field('name', 'Name', input(`value="${esc(existing?.name || '')}"`))}
      ${field('company', 'Company', input(`value="${esc(existing?.company || '')}"`))}
      ${field('specialty', 'Specialty', input(`value="${esc(existing?.specialty || '')}" placeholder="Plumbing, HVAC, handyman…"`))}
      ${field('phone', 'Phone', input(`value="${esc(existing?.phone || '')}"`))}
      ${field('email', 'Email', input(`type="email" value="${esc(existing?.email || '')}"`))}
      <div class="span2">${field('notes', 'Notes', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions">
      ${existing ? '<button class="btn btn-danger" id="mc-remove">Remove from book</button>' : ''}
      <button class="btn btn-primary" id="mc-save">${existing ? 'Save changes' : 'Add contractor'}</button>
    </div>`);
  $('[name=notes]', m.body).value = existing?.notes || '';
  $('#mc-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.name) return toast('Name is required', 'err');
    try {
      let id = existing?.id;
      if (existing) await api(`/api/portal/contractors/${existing.id}`, { method: 'PATCH', body });
      else { const res = await api('/api/portal/contractors', { method: 'POST', body }); id = res?.id; }
      invalidate();
      toast('Contractor saved');
      m.close(); done(id);
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#mc-remove', m.body)?.addEventListener('click', async () => {
    if (!confirm(`Remove ${existing.name} from your book? Their past services stay in your history.`)) return;
    await api(`/api/portal/contractors/${existing.id}`, { method: 'PATCH', body: { active: 0 } });
    invalidate();
    toast('Contractor removed');
    m.close(); done();
  });
}

// ── Connective tissue: detail panels + link chips ──────────────────────────
// Everything related to a system / piece of equipment / contractor in one
// place: open tasks, service history, documents.
const allSystems = (r) => [...(r.systems || []), ...(r.retired_systems || [])];
const allEquipment = (r) => [...(r.equipment || []), ...(r.retired_equipment || [])];
const retiredTag = (item) => item.active === 0 ? ' <span class="badge b-muted">retired</span>' : '';

// Roll a system's component health up to the card: a component counts as
// needing attention if it's rated failing (≤2) or its warranty has expired.
function componentHealth(components) {
  const flagged = components.filter((e) =>
    (e.condition_rating != null && e.condition_rating <= 2) || e.warranty_status === 'expired');
  return { count: components.length, flagged };
}

function detailModal(r, kind, id, done) {
  const refresh = done || (() => {});
  let title = '', header = '', tasks = [], history = [], docs = [];
  if (kind === 'system') {
    const s = allSystems(r).find((x) => x.id === id);
    if (!s) return;
    title = s.system_name;
    const equip = allEquipment(r).filter((e) => e.system_id === id);
    header = `<span class="chip">${esc(s.category)}</span> ${stars(s.condition_rating)}${retiredTag(s)}
      ${s.remaining_life != null ? `<span class="small muted"> · ~${s.remaining_life} yrs left</span>` : ''}
      ${s.description ? `<div class="small sub" style="margin-top:6px">${esc(s.description)}</div>` : ''}
      ${equip.length ? `<div style="margin-top:8px">${equip.map((e) => `<span class="chip link-chip" data-detail="equipment:${e.id}">⚙ ${esc(e.name)}${e.active === 0 ? ' ·retired' : ''}</span>`).join('')}</div>` : ''}`;
    tasks = r.schedule.filter((i) => i.system_id === id);
    history = r.log.filter((l) => l.system_id === id);
    docs = r.documents.filter((d) => d.system_id === id);
  } else if (kind === 'equipment') {
    const e = allEquipment(r).find((x) => x.id === id);
    if (!e) return;
    title = e.name;
    header = `${e.system_name ? `<span class="chip link-chip" data-detail="system:${e.system_id}">${esc(e.system_name)}</span>` : '<span class="chip">freestanding</span>'}${retiredTag(e)}
      ${warrantyBadge(e.warranty_status, e.warranty_expiry)}
      <div class="small sub" style="margin-top:6px">${[e.make, e.model_number].filter(Boolean).map(esc).join(' · ')}
      ${e.warranty_expiry && e.warranty_status === 'active' ? ` · warranty to ${fmtDate(e.warranty_expiry)}` : ''}</div>`;
    tasks = r.schedule.filter((i) => i.equipment_id === id);
    history = r.log.filter((l) => l.equipment_id === id);
    docs = r.documents.filter((d) => d.equipment_id === id);
  } else if (kind === 'contractor') {
    const c = r.my_contractors.find((x) => x.id === id);
    if (!c) return;
    title = c.name;
    header = `${c.company ? esc(c.company) + ' · ' : ''}${c.specialty ? `<span class="chip">${esc(c.specialty)}</span>` : ''}
      <div class="small muted" style="margin-top:4px">${[c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</div>
      ${c.notes ? `<div class="small sub" style="margin-top:4px">${esc(c.notes)}</div>` : ''}`;
    history = r.log.filter((l) => l.client_contractor_id === id);
    docs = r.documents.filter((d) => history.some((l) => l.id === d.maintenance_log_id));
  }

  const m = modal(title, `
    <div>${header}</div>
    ${tasks.length ? `<hr class="divider"><h3>Open tasks</h3>
      ${tasks.map((i) => `<div class="item-line small">${priorityBadge(i.priority, i.overdue)}
        <b>${esc(i.item_name)}</b><span class="right muted">${dueText(i.due_date)}</span></div>`).join('')}` : ''}
    <hr class="divider"><h3>Service history (${history.length})</h3>
    ${history.map((l) => {
      const attached = r.documents.filter((d) => d.maintenance_log_id === l.id);
      return `<div class="item-line small" style="align-items:flex-start">
        <span style="white-space:nowrap" class="muted">${fmtDate(l.date)}</span>
        <div>${esc(l.description)}
          ${attached.map((d) => ` <a href="/api/documents/${d.id}/file" target="_blank">📎${esc(d.document_name)}</a>`).join('')}
          <br><span class="muted">${esc(l.my_contractor_name || l.contractor_name || l.performed_by || '')}</span></div>
        <span class="right muted">${money(l.invoice_amount)}</span>
      </div>`;
    }).join('') || empty('No services recorded yet.')}
    ${kind !== 'contractor' ? `<hr class="divider"><h3>Documents (${docs.length})</h3>
      ${docs.map((d) => `<div class="item-line small"><span class="chip">${label(d.document_type)}</span>
        <a href="/api/documents/${d.id}/file" target="_blank">${esc(d.document_name)}</a>
        <span class="right muted">${fmtDate(d.upload_date)}</span></div>`).join('') || empty('No documents linked.')}` : ''}
  `, { wide: true });
  bindDetailLinks(m.body, r, refresh);
}

function bindDetailLinks(root, r, done) {
  for (const chip of $$('[data-detail]', root)) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const [kind, id] = chip.dataset.detail.split(':');
      detailModal(r, kind, Number(id), done);
    });
  }
}

// ── AI suggestions (system/equipment modals) ──────────────────────────────
// Fetches a drafted description + proposed maintenance tasks. Description
// fills the form; tasks are accepted per-checkbox (saving the item first if
// it's new, so tasks have something to link to).
function bindSuggest(m, r, kind, existing, saveItem, done) {
  $('#sg-btn', m.body)?.addEventListener('click', async () => {
    const btn = $('#sg-btn', m.body);
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      const v = formValues(m.body);
      const sg = await api('/api/portal/suggest', { method: 'POST', body: {
        kind, id: existing?.id, name: v.system_name || v.name, category: v.category,
        make: v.make, model_number: v.model_number, install_date: v.install_date,
        age_at_intake: v.age_at_intake, expected_lifespan: v.expected_lifespan,
        warranty_expiry: v.warranty_expiry, last_service_date: v.last_service_date,
        condition_rating: readStars(m.body, 'condition_rating'),
        description: $('[name=description]', m.body)?.value || null,
      } });
      const fleet = sg.fleet || {};
      const panel = $('#sg-panel', m.body);
      panel.style.display = 'block';
      panel.innerHTML = `
        <h4>${sg.source === 'ai' ? '✨ Steward’s recommendations' : 'Suggestions from the maintenance library'}</h4>
        ${sg.upgrade ? `<div class="notice" style="margin-bottom:8px">These are library suggestions.
          <a href="#" id="sg-enh">Upgrade to Enhanced</a> for recommendations tailored to this exact system by Steward’s AI.</div>` : ''}
        ${fleet.similar_homes ? `<div class="small muted" style="margin-bottom:6px">${fleet.from_feedback
          ? `Learned from ${fleet.similar_homes} similar home${fleet.similar_homes === 1 ? '' : 's'}`
          : `Consistent with ${fleet.similar_homes} similar home${fleet.similar_homes === 1 ? '' : 's'}`} in the Steward network.</div>` : ''}
        ${sg.description ? `<div class="small" style="margin-bottom:6px"><i>${esc(sg.description)}</i>
          <button type="button" class="btn btn-sm" id="sg-use-desc" style="margin-left:6px">Use as description</button></div>` : ''}
        ${sg.tasks.length ? `
          ${sg.tasks.map((t, i) => `<label class="checkbox-row" style="align-items:flex-start">
            <input type="checkbox" data-sg-task="${i}" checked style="margin-top:3px">
            <span><b>${esc(t.task_name)}</b>
              <span class="small muted">— ${t.interval_months ? `every ${t.interval_months} mo` : 'one-time'}
              · ${label(t.priority)}${t.est_cost_high ? ` · ~${money(t.est_cost_low)}–${money(t.est_cost_high)}` : ''}</span>
              ${t.note ? `<br><span class="small muted">${esc(t.note)}</span>` : ''}</span>
          </label>`).join('')}
          <button type="button" class="btn btn-primary btn-sm" id="sg-add-tasks">Save & add selected tasks</button>`
          : '<div class="small muted">No task suggestions for this category.</div>'}`;
      $('#sg-enh', panel)?.addEventListener('click', (e) => {
        e.preventDefault();
        m.close();
        upgradeToEnhanced(() => { location.hash = '#/home'; renderOverview($('#view')); });
      });
      $('#sg-use-desc', panel)?.addEventListener('click', () => {
        const descField = $('[name=description]', m.body);
        if (descField) descField.value = sg.description;
        toast('Description filled in — save to keep it');
      });
      $('#sg-add-tasks', panel)?.addEventListener('click', async () => {
        const picked = $$('[data-sg-task]:checked', panel).map((cb) => sg.tasks[Number(cb.dataset.sgTask)]);
        if (!picked.length) return toast('Nothing selected', 'err');
        try {
          const itemId = await saveItem(); // creates or updates; returns id
          const t0 = new Date();
          for (const t of picked) {
            const due = new Date(t0.getTime() + Math.max(t.interval_months || 0.5, 0.5) * 30.44 * 86400000);
            await api('/api/portal/tasks', { method: 'POST', body: {
              item_name: t.task_name,
              due_date: due.toISOString().slice(0, 10),
              priority: t.priority,
              deferral_risk: t.note || null,
              est_cost_low: t.est_cost_low, est_cost_high: t.est_cost_high,
              repeat_value: t.interval_months || null,
              repeat_unit: t.interval_months ? 'months' : null,
              ...(kind === 'system' ? { system_id: itemId } : { equipment_id: itemId }),
            } });
          }
          // Feed the fleet learning loop with what was actually kept.
          const vv = formValues(m.body);
          api('/api/portal/suggest/accept', { method: 'POST', body: {
            kind, category: vv.category, make: vv.make, source: sg.source,
            tasks: picked.map((t) => ({ task_name: t.task_name, interval_months: t.interval_months, priority: t.priority })),
          } }).catch(() => {});
          invalidate();
          toast(`Saved — ${picked.length} task(s) added to your schedule`);
          m.close(); done();
        } catch (err) { toast(err.message, 'err'); }
      });
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Suggest schedule & description';
    }
  });
}

async function sendUpgradeRequest() {
  await api('/api/portal/requests', { method: 'POST', body: {
    subject: 'Upgrade request: → Guided',
    body: 'I’d like to upgrade to an advisor membership. Please contact me to book an intake visit that validates and completes my Home Record.',
  } });
  toast('Request sent — a Steward advisor will reach out to book your intake');
}

// Basic → Enhanced self-upgrade (payments bypassed in this build). Unlocks the
// AI-tailored recommendations and the full itemized capital forecast.
async function upgradeToEnhanced(rerender) {
  try {
    await api('/api/portal/upgrade', { method: 'POST', body: {} });
    invalidate();
    toast('Welcome to Enhanced — AI recommendations and the full forecast are unlocked');
    rerender ? rerender() : (location.hash = '#/home');
  } catch (err) { toast(err.message, 'err'); }
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
      <p style="font:400 20px var(--serif);margin:8px 0 2px">${esc(r.tier_label)}</p>
      ${r.is_basic ? `
      <div class="sub">You’re on the free plan — you keep your own record and get a rules-based schedule.</div>
      <div class="small muted" style="margin-top:10px"><b>Enhanced</b> hands the work to Steward: AI-tailored
      recommendations, the full 5-year capital forecast, and unlimited storage.</div>
      <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="enh-upgrade">Upgrade to Enhanced — $${r.enhanced_price}/yr</button></div>
      <div class="small muted" style="margin-top:10px">Want a named human advisor too? <a href="#" id="advisor-upgrade">See Guided &amp; Managed</a>.</div>`
      : `
      <div class="sub">You maintain your Home Record; Steward’s AI keeps your schedule and recommendations sharp.</div>
      <div class="small muted" style="margin-top:10px">Want a named advisor who validates your home and brings a vetted
      contractor network? Your record comes with you.</div>
      <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="upgrade-btn">Upgrade — book an advisor intake</button></div>`}`
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
  $('#enh-upgrade', view)?.addEventListener('click', () => upgradeToEnhanced(() => renderOverview(view)));
  $('#advisor-upgrade', view)?.addEventListener('click', (e) => { e.preventDefault(); sendUpgradeRequest(); });
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
    <div><b>${esc(i.item_name)}</b>
      ${i.system_name ? ` <span class="chip link-chip small" data-detail="system:${i.system_id}">${esc(i.system_name)}</span>` : ''}
      ${i.equipment_name ? ` <span class="chip link-chip small" data-detail="equipment:${i.equipment_id}">⚙ ${esc(i.equipment_name)}</span>` : ''}
      ${i.custom ? `<span class="chip">yours${i.repeat_value ? ` · every ${i.repeat_value} ${i.repeat_unit}` : ''}</span>` : ''}
      ${i.deferral_risk ? `<br><span class="small muted">${esc(i.deferral_risk)}</span>` : ''}
      ${i.contractor_name ? `<br><span class="small muted">Assigned: ${esc(i.contractor_name)}</span>` : ''}</div>
    <span class="right" style="white-space:nowrap"><b>${dueText(i.due_date)}</b><br>
      <span class="small muted">${moneyRange(i.est_cost_low, i.est_cost_high)}</span>
      ${selfServe ? `<br><button class="btn btn-sm" data-done="${i.id}" style="margin-top:4px">Mark done</button>
        ${i.custom ? `<button class="btn btn-sm" data-task-edit="${i.id}" style="margin-top:4px">Edit</button>` : ''}` : ''}</span>
  </div>`;
}

function bindMarkDone(view, r, refresh) {
  for (const b of $$('[data-done]', view)) {
    b.addEventListener('click', () =>
      serviceModal(r, { forwardItem: r.schedule.find((i) => i.id === Number(b.dataset.done)) }, refresh));
  }
  for (const b of $$('[data-task-edit]', view)) {
    b.addEventListener('click', () =>
      taskModal(r, r.schedule.find((i) => i.id === Number(b.dataset.taskEdit)), refresh));
  }
  bindDetailLinks(view, r, refresh);
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
  ${r.self_serve ? `<div style="margin-bottom:16px"><button class="btn btn-primary" id="task-add">+ Add a task</button>
    <span class="small muted" style="margin-left:8px">your own to-dos, one-time or repeating — alongside what the engine schedules</span></div>` : ''}
  ${overdue.length ? `<div class="section"><div class="section-head"><h2>Past due</h2></div>
    <div class="card card-pad">${overdue.map(line).join('')}</div></div>` : ''}
  ${months.map((ym) => {
    const items = within.filter((i) => !i.overdue && i.due_date.slice(0, 7) === ym);
    if (!items.length) return '';
    return `<div class="section cal-month"><h3 class="serif">${fmtMonth(ym)}</h3>
      <div class="card card-pad">${items.map(line).join('')}</div></div>`;
  }).join('') || `<div class="card section">${empty('Nothing scheduled in the next 12 months.')}</div>`}
  <div class="disclaimer">${esc(r.disclaimer)}</div>`;
  $('#task-add', view)?.addEventListener('click', () => taskModal(r, null, () => renderCalendar(view)));
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
      const health = componentHealth(equip);
      return `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><h3>${esc(s.system_name)}</h3><span class="chip">${esc(s.category)}</span></div>
        <div style="text-align:right;white-space:nowrap">${stars(s.condition_rating)}<br>
          <span class="small muted">${s.remaining_life == null ? '' : s.remaining_life <= 0
            ? '<b style="color:var(--critical-text)">at end of expected life</b>' : `~${s.remaining_life} yrs of life left`}</span></div>
      </div>
      ${health.flagged.length ? `<div style="margin-top:6px"><span class="badge b-serious">▲ ${health.flagged.length} of ${health.count} component${health.count > 1 ? 's' : ''} need${health.flagged.length > 1 ? '' : 's'} attention</span></div>` : ''}
      ${s.description ? `<div class="small sub" style="margin-top:6px">${esc(s.description)}</div>` : ''}
      ${ageBar(s)}
      <dl class="kv small" style="margin-top:10px">
        ${s.install_date ? `<dt>Installed</dt><dd>${fmtDate(s.install_date)}</dd>` : ''}
        ${s.last_service_date ? `<dt>Last serviced</dt><dd>${fmtDate(s.last_service_date)}</dd>` : ''}
        ${s.warranty_expiry ? `<dt>Warranty until</dt><dd>${fmtDate(s.warranty_expiry)}</dd>` : ''}
        ${s.model_number ? `<dt>Model</dt><dd>${esc(s.model_number)}</dd>` : ''}
      </dl>
      ${equip.length ? `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--hairline-2)">
        <div class="field-label" style="margin-bottom:4px">Components (${health.count})${health.flagged.length ? '' : ' · all healthy'}</div>
        ${equip.map((e) => `<div class="item-line small">
          <div><b>${esc(e.name)}</b> ${warrantyBadge(e.warranty_status, e.warranty_expiry)}
            ${e.condition_rating != null && e.condition_rating <= 2 ? '<span class="badge b-serious">▲ failing</span>' : ''}<br>
            <span class="muted">${[e.make, e.model_number].filter(Boolean).map(esc).join(' · ')}
            ${e.warranty_expiry && e.warranty_status === 'active' ? ` · warranty to ${fmtDate(e.warranty_expiry)}` : ''}</span></div>
          ${r.self_serve ? `<span class="right"><button class="btn btn-sm" data-pe-edit="${e.id}">Edit</button></span>` : ''}
        </div>`).join('')}
      </div>` : ''}
      <div style="margin-top:10px"><button class="btn btn-sm" data-detail="system:${s.id}">History & documents</button>
      ${r.self_serve ? `<button class="btn btn-sm" data-ss-edit="${s.id}">Edit</button>` : ''}</div>
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
  })()}
  ${(() => {
    const retired = [...(r.retired_systems || []), ...(r.retired_equipment || [])];
    return retired.length ? `
    <div class="card card-pad section" style="opacity:.85">
      <h3 class="muted">Replaced &amp; retired</h3>
      <p class="small muted" style="margin-bottom:8px">Kept so their history stays in your record. Open one to see its past service and documents.</p>
      ${(r.retired_systems || []).map((s) => `<div class="item-line small">
        <div><b>${esc(s.system_name)}</b> <span class="chip">${esc(s.category)}</span></div>
        <span class="right"><button class="btn btn-sm" data-detail="system:${s.id}">History</button></span></div>`).join('')}
      ${(r.retired_equipment || []).map((e) => `<div class="item-line small">
        <div><b>${esc(e.name)}</b> ${e.system_name ? `<span class="muted">in ${esc(e.system_name)}</span>` : ''}</div>
        <span class="right"><button class="btn btn-sm" data-detail="equipment:${e.id}">History</button></span></div>`).join('')}
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
  bindDetailLinks(view, r, () => renderSystems(view));
}

// ── History (US-C2: the home's medical record) ─────────────────────────────
export async function renderHistory(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  const total = r.log.reduce((sum, l) => sum + (l.invoice_amount || 0), 0);
  const docsByLog = {};
  for (const doc of r.documents) if (doc.maintenance_log_id) (docsByLog[doc.maintenance_log_id] ??= []).push(doc);
  const permitDocs = {};
  for (const doc of r.documents) if (doc.permit_id) (permitDocs[doc.permit_id] ??= []).push(doc);
  const performerCell = (l) => l.my_contractor_name
    ? `<span class="chip link-chip" data-detail="contractor:${l.client_contractor_id}">${esc(l.my_contractor_name)}</span>`
    : esc(l.contractor_name || l.performed_by || '—');
  const sysChips = (l) => `${l.system_name ? `<span class="chip link-chip" data-detail="system:${l.system_id}">${esc(l.system_name)}</span>` : '—'}
    ${l.equipment_name ? `<span class="chip link-chip" data-detail="equipment:${l.equipment_id}">⚙ ${esc(l.equipment_name)}</span>` : ''}`;

  const tableHtml = `
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Work performed</th><th>System / Equipment</th><th>Performed by</th><th class="num">Cost</th>${r.self_serve ? '<th></th>' : ''}</tr></thead>
      <tbody>${r.log.map((l) => `<tr>
        <td style="white-space:nowrap">${fmtDate(l.date)}</td>
        <td>${esc(l.description)}${l.outcome_notes ? `<br><span class="small muted">${esc(l.outcome_notes)}</span>` : ''}
          ${(docsByLog[l.id] || []).map((doc) => `<br><a class="small" href="/api/documents/${doc.id}/file" target="_blank">📎 ${esc(doc.document_name)}</a>`).join('')}</td>
        <td>${sysChips(l)}</td>
        <td>${performerCell(l)}</td>
        <td class="num">${money(l.invoice_amount)}</td>
        ${r.self_serve ? `<td><button class="btn btn-sm" data-svc-edit="${l.id}">Edit</button></td>` : ''}
      </tr>`).join('') || `<tr><td colspan="6">${empty('No work logged yet.')}</td></tr>`}</tbody>
    </table>
  </div>`;

  const timelineHtml = buildTimeline(r, docsByLog);

  view.innerHTML = `
  ${head(r, 'Maintenance History', `${r.log.length} jobs on record · ${money(total)} total invested`)}
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
    ${r.self_serve ? `<button class="btn btn-primary" id="svc-add">+ Log service</button>` : ''}
    <span class="right" style="margin-left:auto">
      <button class="btn btn-sm ${historyMode === 'timeline' ? 'btn-primary' : ''}" data-hmode="timeline">Timeline</button>
      <button class="btn btn-sm ${historyMode === 'table' ? 'btn-primary' : ''}" data-hmode="table">Table</button>
    </span>
  </div>
  ${historyMode === 'timeline' ? timelineHtml : tableHtml}
  ${r.self_serve || r.permits.length ? `
  <div class="section"><div class="section-head"><h2>Permit history</h2>
    ${r.self_serve ? '<button class="btn btn-sm" id="permit-add">+ Add permit</button>' : ''}</div>
  ${r.permits.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Permit</th><th>Type</th><th>Filed</th><th>Status</th><th>Scope</th>${r.self_serve ? '<th></th>' : ''}</tr></thead>
    <tbody>${r.permits.map((pm) => `<tr>
      <td>${esc(pm.permit_number || '—')}${pm.gap_flag ? '<br><span class="badge b-critical">▲ gap flag</span>' : ''}
        ${(permitDocs[pm.id] || []).map((d) => `<br><a class="small" href="/api/documents/${d.id}/file" target="_blank">📎 ${esc(d.document_name)}</a>`).join('')}</td>
      <td>${label(pm.permit_type)}</td><td>${fmtDate(pm.date_filed)}</td><td>${statusBadge(pm.status)}</td>
      <td>${esc(pm.scope_description || '')}${pm.gap_notes ? `<br><span class="small muted">${esc(pm.gap_notes)}</span>` : ''}</td>
      ${r.self_serve ? `<td><button class="btn btn-sm" data-permit-edit="${pm.id}">Edit</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`
    : `<div class="card">${empty('No permits on record yet. Add permits from work done on your home — a panel upgrade, a re-roof, a water-heater swap — so your Home Record shows what has been done to code. Attach the permit PDF if you have it.')}</div>`}
  </div>` : ''}`;

  const refresh = () => renderHistory(view);
  $('#svc-add', view)?.addEventListener('click', () => serviceModal(r, {}, refresh));
  $('#permit-add', view)?.addEventListener('click', () => permitModal(r, null, refresh));
  for (const b of $$('[data-permit-edit]', view)) {
    b.addEventListener('click', () =>
      permitModal(r, r.permits.find((p) => p.id === Number(b.dataset.permitEdit)), refresh));
  }
  for (const b of $$('[data-hmode]', view)) {
    b.addEventListener('click', () => { historyMode = b.dataset.hmode; renderHistory(view); });
  }
  for (const b of $$('[data-svc-edit]', view)) {
    b.addEventListener('click', () =>
      serviceModal(r, { existing: r.log.find((l) => l.id === Number(b.dataset.svcEdit)) }, refresh));
  }
  bindDetailLinks(view, r, refresh);
}

let historyMode = 'timeline';

// The home's life as one stream: services, documents added, tasks completed,
// and milestones — grouped by year, newest first.
function buildTimeline(r, docsByLog) {
  const events = [];
  const completedByLog = new Set(r.completed_tasks.filter((ct) => ct.maintenance_log_id).map((ct) => ct.maintenance_log_id));
  for (const l of r.log) {
    events.push({ date: l.date, cls: '', html: `
      <b>${esc(l.description)}</b>
      ${completedByLog.has(l.id) ? '<span class="badge b-good">task completed</span>' : ''}
      ${r.self_serve ? `<button class="btn btn-sm" data-svc-edit="${l.id}" style="float:right">Edit</button>` : ''}
      <div class="small muted" style="margin-top:3px">
        ${l.my_contractor_name ? `<span class="chip link-chip" data-detail="contractor:${l.client_contractor_id}">${esc(l.my_contractor_name)}</span>` : esc(l.contractor_name || l.performed_by || '')}
        ${l.system_name ? `<span class="chip link-chip" data-detail="system:${l.system_id}">${esc(l.system_name)}</span>` : ''}
        ${l.equipment_name ? `<span class="chip link-chip" data-detail="equipment:${l.equipment_id}">⚙ ${esc(l.equipment_name)}</span>` : ''}
        ${l.invoice_amount != null ? ` · ${money(l.invoice_amount)}` : ''}
      </div>
      ${(docsByLog[l.id] || []).map((doc) => `<a class="small" href="/api/documents/${doc.id}/file" target="_blank">📎 ${esc(doc.document_name)}</a> `).join('')}` });
  }
  for (const doc of r.documents) {
    if (doc.maintenance_log_id) continue; // shown with its service
    if (!doc.upload_date) continue;
    events.push({ date: doc.upload_date, cls: 'tl-doc', html: `
      <span class="chip">${label(doc.document_type)}</span>
      <a href="/api/documents/${doc.id}/file" target="_blank"><b>${esc(doc.document_name)}</b></a> added
      ${doc.system_name ? `<span class="chip link-chip" data-detail="system:${doc.system_id}">${esc(doc.system_name)}</span>` : ''}
      ${doc.equipment_name ? `<span class="chip link-chip" data-detail="equipment:${doc.equipment_id}">⚙ ${esc(doc.equipment_name)}</span>` : ''}` });
  }
  for (const ct of r.completed_tasks) {
    if (ct.maintenance_log_id) continue; // its service entry carries the story
    events.push({ date: ct.completed_date, cls: 'tl-task', html: `
      <span class="badge b-good">✓ done</span> <b>${esc(ct.item_name)}</b>
      ${ct.system_name ? `<span class="chip link-chip" data-detail="system:${ct.system_id}">${esc(ct.system_name)}</span>` : ''}` });
  }
  if (r.property.ownership_date) {
    events.push({ date: r.property.ownership_date, cls: 'tl-milestone', html: `<b>🏠 Purchased the home</b>` });
  }
  if (r.property.intake_date) {
    events.push({ date: r.property.intake_date, cls: 'tl-milestone', html: `<b>📖 Home Record started</b>` });
  }
  events.sort((a, b) => b.date.localeCompare(a.date));
  if (!events.length) return `<div class="card">${empty('Nothing on the timeline yet.')}</div>`;

  let html = '<div class="tl">';
  let year = null;
  for (const ev of events) {
    const y = ev.date.slice(0, 4);
    if (y !== year) { year = y; html += `<div class="tl-year">${y}</div>`; }
    html += `<div class="tl-item ${ev.cls}"><div class="tl-date">${fmtDate(ev.date)}</div><div class="tl-body">${ev.html}</div></div>`;
  }
  return html + '</div>';
}

// ── Capital forecast (US-C3, tier-gated) ───────────────────────────────────
export async function renderForecast(view) {
  const r = await record();
  if (needsOnboarding(r)) return renderOnboarding(view, r);
  if (!r.forecast_eligible) {
    // Basic (free): show the headline number, gate the itemized plan behind Enhanced.
    const h = r.forecast_headline || { count: 0, low: 0, high: 0 };
    view.innerHTML = `${head(r, 'Capital Forecast')}
    <div class="card card-pad" style="max-width:640px">
      <div class="tiles">
        ${statTile(h.count, 'major expenses on the horizon', 'brand')}
        ${statTile(moneyRange(h.low, h.high), 'estimated 5-year range')}
      </div>
      <h2 class="serif" style="margin-top:18px">See the full plan with Enhanced</h2>
      <p class="sub" style="margin-top:8px">Basic gives you the headline number. Enhanced breaks it down system by
      system — every major expense, its expected year, and cost range — so a new roof or boiler never arrives as a surprise.</p>
      <div style="margin-top:14px"><button class="btn btn-primary" id="enh-btn">Upgrade to Enhanced — $${r.enhanced_price}/yr</button></div>
    </div>`;
    $('#enh-btn', view)?.addEventListener('click', () => upgradeToEnhanced(() => renderForecast(view)));
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

  // Self-serve: a personal contractor book they maintain themselves.
  if (r.self_serve) {
    const refresh = () => renderContractors(view);
    view.innerHTML = `
    ${head(r, 'My Contractors', 'Your own book — the people you hire, and everything they’ve done for you')}
    <div style="margin-bottom:16px"><button class="btn btn-primary" id="mc-add">+ Add a contractor</button></div>
    <div class="grid g2">
      ${r.my_contractors.map((c) => `
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <div><h3>${esc(c.name)}</h3>
            <div class="sub">${esc(c.company || '')}</div></div>
          ${c.specialty ? `<span class="chip">${esc(c.specialty)}</span>` : ''}
        </div>
        <dl class="kv small" style="margin-top:8px">
          ${c.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>` : ''}
          ${c.email ? `<dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
          <dt>Services</dt><dd>${c.service_count} on record</dd>
        </dl>
        ${c.notes ? `<div class="small muted" style="margin-top:6px">${esc(c.notes)}</div>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-sm" data-detail="contractor:${c.id}">Service history</button>
          <button class="btn btn-sm" data-mc-edit="${c.id}">Edit</button>
        </div>
      </div>`).join('') || `<div class="card">${empty('No contractors in your book yet — add the first one.')}</div>`}
    </div>`;
    $('#mc-add', view).addEventListener('click', () => myContractorModal(null, refresh));
    for (const b of $$('[data-mc-edit]', view)) {
      b.addEventListener('click', () =>
        myContractorModal(r.my_contractors.find((c) => c.id === Number(b.dataset.mcEdit)), refresh));
    }
    bindDetailLinks(view, r, refresh);
    return;
  }

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
          ${['photo', 'receipt', 'invoice', 'quote', 'contract', 'warranty', 'permit_doc', 'inspection_report', 'other'].map((t) => `<option>${t}</option>`).join('')}
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
  <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
    <span class="small muted">Filter:</span>
    <select id="df-type" class="control" style="max-width:150px"><option value="">all types</option>
      ${[...new Set(r.documents.map((d) => d.document_type))].map((t) => `<option value="${t}" ${docFilter.type === t ? 'selected' : ''}>${label(t)}</option>`).join('')}
    </select>
    <select id="df-system" class="control" style="max-width:180px"><option value="">all systems</option>
      ${r.systems.map((s) => `<option value="${s.id}" ${docFilter.system === String(s.id) ? 'selected' : ''}>${esc(s.system_name)}</option>`).join('')}
    </select>
    <select id="df-equipment" class="control" style="max-width:180px"><option value="">all equipment</option>
      ${r.equipment.map((e) => `<option value="${e.id}" ${docFilter.equipment === String(e.id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
    </select>
  </div>
  <div class="card card-pad">
    ${(() => {
      const filtered = r.documents.filter((d) =>
        (!docFilter.type || d.document_type === docFilter.type)
        && (!docFilter.system || String(d.system_id) === docFilter.system)
        && (!docFilter.equipment || String(d.equipment_id) === docFilter.equipment));
      return filtered.length ? filtered.map((doc) => `
      <div class="item-line">
        <span class="chip">${label(doc.document_type)}</span>
        <div><a href="/api/documents/${doc.id}/file" target="_blank"><b>${esc(doc.document_name)}</b></a>
          ${doc.system_name ? `<span class="chip link-chip" data-detail="system:${doc.system_id}">${esc(doc.system_name)}</span>` : ''}
          ${doc.equipment_name ? `<span class="chip link-chip" data-detail="equipment:${doc.equipment_id}">⚙ ${esc(doc.equipment_name)}</span>` : ''}
          ${doc.maintenance_log_id ? `<span class="chip">🔧 service</span>` : ''}
          <br><span class="small muted">${doc.description ? esc(doc.description) + ' · ' : ''}${fmtDate(doc.upload_date)}</span></div>
        <span class="right small muted">${doc.size_bytes ? Math.ceil(doc.size_bytes / 1024) + ' KB' : ''}</span>
      </div>`).join('') : empty(r.documents.length ? 'Nothing matches these filters.' : 'No documents yet — upload the first one.');
    })()}
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
  for (const [key, sel] of [['type', '#df-type'], ['system', '#df-system'], ['equipment', '#df-equipment']]) {
    $(sel, view)?.addEventListener('change', (e) => { docFilter[key] = e.target.value; renderDocuments(view); });
  }
  bindDetailLinks(view, r, () => renderDocuments(view));
}

let docFilter = { type: '', system: '', equipment: '' };
