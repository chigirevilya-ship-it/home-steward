// Advisor app: dashboard (US-A8), Home Record view (US-A10), intake flow
// (US-A2/A3), job completion (US-A11/A12), contractor network view.

import {
  api, esc, fmtDate, money, moneyRange, label, stars, dueText, daysFromToday,
  priorityBadge, statusBadge, tierBadge, ageBar, progress, statTile, empty,
  $, $$, toast, modal, field, input, textarea, select, formValues,
  starInput, bindStarInputs, readStars,
} from './core.js';
import { state } from './app.js';

const meta = () => state.meta;

// ── Dashboard ──────────────────────────────────────────────────────────────
export async function renderDashboard(view) {
  const me = state.me.user;
  const isAdvisor = ['sme', 'advisor'].includes(me.role);
  const d = await api('/api/dashboard');
  const overdue = d.items.filter((i) => i.overdue);
  const upcoming = d.items.filter((i) => !i.overdue);
  const due30 = upcoming.filter((i) => daysFromToday(i.due_date) <= 30);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  view.innerHTML = `
  <div class="page-head">
    <div>
      <h1>${greeting}, ${esc(me.full_name.split(' ')[0])}</h1>
      <div class="sub">${isAdvisor ? 'Your book' : 'Market view'} · ${fmtDate(d.today)}</div>
    </div>
    <div class="actions"><button class="btn btn-primary" id="client-add">Add client</button></div>
  </div>

  <div class="tiles">
    ${statTile(d.clients.filter((c) => c.status === 'active').length, isAdvisor ? 'active clients' : 'active clients in market', 'brand')}
    ${statTile(overdue.length, 'overdue items', overdue.length ? 'critical' : 'good')}
    ${statTile(due30.length, 'due in 30 days', due30.length ? 'serious' : '')}
    ${statTile(d.items.length, 'open in next 90 days')}
    ${statTile(d.requests.length, 'client requests', d.requests.length ? 'serious' : '')}
  </div>

  ${d.visitsToday.length ? `
  <div class="section"><div class="section-head"><h2>Today's visits</h2></div>
    <div class="card card-pad">
      ${d.visitsToday.map((v) => `<div class="item-line">
        <span class="badge b-info">${label(v.visit_type)}</span>
        <b>${esc(v.address_line1)}, ${esc(v.city)}</b>
        <span class="muted">${esc(v.first_name)} ${esc(v.last_name)} · ${esc(v.advisor_name)}</span>
        <span class="right small muted">${v.duration_hrs ? v.duration_hrs + ' hrs' : ''}</span>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${overdue.length ? `
  <div class="section"><div class="section-head"><h2>Needs attention — overdue</h2></div>
    ${itemsTable(overdue, true)}
  </div>` : ''}

  <div class="section"><div class="section-head"><h2>Next 90 days</h2>
    <span class="small muted">sorted by due date</span></div>
    ${upcoming.length ? itemsTable(upcoming, false) : `<div class="card">${empty('Nothing due in the next 90 days.')}</div>`}
  </div>

  <div class="grid g2 section">
    <div><div class="section-head"><h2>Client requests</h2></div>
      <div class="card card-pad" id="requests">
        ${d.requests.length ? d.requests.map((r) => `
          <div class="item-line">
            <div>
              <b>${esc(r.subject)}</b> ${statusBadge(r.status)}<br>
              <span class="small muted">${esc(r.first_name)} ${esc(r.last_name)} · ${esc(r.address_line1 || '')} · ${fmtDate(r.created_at.slice(0, 10))}</span>
              ${r.body ? `<div class="small" style="margin-top:4px">${esc(r.body)}</div>` : ''}
            </div>
            <span class="right"><button class="btn btn-sm" data-resolve="${r.id}">Resolve</button></span>
          </div>`).join('') : empty('No open requests.')}
      </div>
    </div>
    <div><div class="section-head"><h2>Visit cadence — behind tier promise</h2></div>
      <div class="card card-pad">
        ${d.cadence.length ? d.cadence.map((c) => `<div class="item-line">
          <span class="badge b-serious">▲ visit due</span>
          <b>${esc(c.name)}</b> ${tierBadge(c.tier)}
          <span class="right small muted">last visit ${c.last_visit ? fmtDate(c.last_visit) : 'never'} · expected every ${c.expected_every_days} days</span>
        </div>`).join('') : empty('Every client is within their tier’s visit cadence.')}
      </div>
    </div>
  </div>

  <div class="section"><div class="section-head"><h2>${isAdvisor ? 'My clients' : 'Clients'}</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Tier</th><th>Status</th><th>Advisor</th><th>Renewal</th><th>Homes</th><th></th></tr></thead>
      <tbody>${d.clients.map((c) => `
        <tr class="clickable" data-client="${c.id}">
          <td><b>${esc(c.first_name)} ${esc(c.last_name)}</b><br><span class="small muted">${esc(c.preferred_contact || '')} ${c.charter_member ? '· charter' : ''}</span></td>
          <td>${tierBadge(c.tier)}</td>
          <td>${statusBadge(c.status)}</td>
          <td>${esc(c.advisor_name || '—')}</td>
          <td>${c.subscription_renewal ? fmtDate(c.subscription_renewal) : '—'}</td>
          <td>${c.property_count}</td>
          <td><button class="btn btn-sm" data-client-edit="${c.id}">Edit</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;

  for (const btn of $$('[data-resolve]', view)) {
    btn.addEventListener('click', async () => {
      await api(`/api/requests/${btn.dataset.resolve}`, { method: 'PATCH', body: { status: 'resolved' } });
      toast('Request resolved');
      renderDashboard(view);
    });
  }
  for (const row of $$('[data-client]', view)) {
    row.addEventListener('click', async () => {
      const c = await api(`/api/clients/${row.dataset.client}`);
      if (c.properties.length) location.hash = `#/property/${c.properties[0].id}`;
      else toast('No property on record for this client yet — start an intake.');
    });
  }
  const refresh = () => renderDashboard(view);
  $('#client-add', view).addEventListener('click', () => clientModal(null, refresh));
  for (const b of $$('[data-client-edit]', view)) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      clientModal(d.clients.find((c) => c.id === Number(b.dataset.clientEdit)), refresh);
    });
  }
}

// ── Client create/edit ─────────────────────────────────────────────────────
export function clientModal(existing, done) {
  const isFounder = state.me.user.role === 'founder';
  const tiers = meta().tiers;
  // New clients default to the creating advisor's own book so they don't
  // vanish from the "my book" dashboard the moment they're created.
  const defaultAdvisor = existing ? existing.advisor_id : state.me.user.id;
  const advisorOptions = (marketId) => [{ value: '', label: '— unassigned —' },
    ...meta().advisors.filter((a) => !marketId || a.market_id === Number(marketId))
      .map((a) => ({ value: a.id, label: `${a.full_name} (${a.role})`, selected: defaultAdvisor === a.id }))];

  const m = modal(existing ? `Edit — ${existing.first_name} ${existing.last_name}` : 'Add client', `
    <div class="form-grid">
      ${field('first_name', 'First name', input(`value="${esc(existing?.first_name || '')}"`))}
      ${field('last_name', 'Last name', input(`value="${esc(existing?.last_name || '')}"`))}
      ${field('email', 'Email (their portal login)', input(`type="email" value="${esc(existing?.email || '')}"`))}
      ${field('phone', 'Phone', input(`value="${esc(existing?.phone || '')}"`))}
      ${field('preferred_contact', 'Preferred contact — honor religiously', select(['email', 'text', 'call']
        .map((v) => ({ value: v, label: v, selected: existing?.preferred_contact === v }))))}
      ${isFounder ? field('market_id', 'Market', select(meta().markets
        .map((mk) => ({ value: mk.id, label: mk.name, selected: (existing?.market_id ?? meta().markets[0]?.id) === mk.id })), 'data-number')) : ''}
      ${field('advisor_id', 'Advisor', select(advisorOptions(existing?.market_id), 'data-number'))}
      ${field('tier', 'Tier', select(Object.entries(tiers)
        .map(([v, t]) => ({ value: v, label: `${t.label} ($${t.price}/yr)`, selected: (existing?.tier ?? 'guided') === v }))))}
      ${field('status', 'Status', select(['prospect', 'active', 'paused', 'cancelled']
        .map((v) => ({ value: v, label: v, selected: (existing?.status ?? 'prospect') === v }))))}
      ${field('annual_rate', 'Annual rate ($)', input(`type="number" step="1" value="${existing?.annual_rate ?? ''}" data-number`))}
      ${field('subscription_start', 'Subscription start', input(`type="date" value="${existing?.subscription_start || ''}"`))}
      ${field('subscription_renewal', 'Renewal date', input(`type="date" value="${existing?.subscription_renewal || ''}"`))}
      ${field('referral_source', 'Referral source', input(`value="${esc(existing?.referral_source || '')}"`))}
      <label class="checkbox-row"><input type="checkbox" name="charter_member" ${existing?.charter_member ? 'checked' : ''}> Charter member (15% off for life)</label>
      ${field('password', existing?.has_portal_password ? 'Reset portal password (blank = keep current)' : 'Portal password (blank = no portal access yet)',
        input(`type="text" minlength="8" placeholder="8+ characters" autocomplete="off"`))}
      <div class="span2">${field('notes', 'Household notes (internal — never client-visible)', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="client-save">${existing ? 'Save changes' : 'Create client'}</button></div>`,
    { wide: true });

  if (existing) $('[name=notes]', m.body).value = existing.notes || '';

  // Tier changes suggest the list price (unless a rate was already typed).
  const tierEl = $('[name=tier]', m.body);
  const rateEl = $('[name=annual_rate]', m.body);
  tierEl.addEventListener('change', () => {
    const t = tiers[tierEl.value];
    if (t && !rateEl.dataset.touched) rateEl.value = t.price;
  });
  rateEl.addEventListener('input', () => { rateEl.dataset.touched = '1'; });

  // Founder switching markets re-filters the advisor list.
  const marketEl = $('[name=market_id]', m.body);
  if (marketEl) {
    marketEl.addEventListener('change', () => {
      const advisorEl = $('[name=advisor_id]', m.body);
      advisorEl.innerHTML = advisorOptions(marketEl.value)
        .map((o) => `<option value="${o.value}" ${o.selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    });
  }

  $('#client-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.first_name || !body.last_name) return toast('First and last name are required', 'err');
    try {
      if (existing) await api(`/api/clients/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/clients', { method: 'POST', body });
      toast(existing ? 'Client updated' : `Client created${body.password ? ' with portal access' : ''} — start an intake to build their Home Record`);
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

function itemsTable(items, isOverdue) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Due</th><th>Item</th><th>Home</th><th>Priority</th><th>Status</th><th class="num">Est. cost</th></tr></thead>
    <tbody>${items.map((i) => `
      <tr class="clickable ${i.overdue ? 'row-overdue' : ''}" onclick="location.hash='#/property/${i.property_id}'">
        <td style="white-space:nowrap"><b>${dueText(i.due_date)}</b><br><span class="small muted">${fmtDate(i.due_date)}</span></td>
        <td><b>${esc(i.item_name)}</b>${i.system_name ? `<br><span class="small muted">${esc(i.system_name)}</span>` : ''}</td>
        <td>${esc(i.address_line1)}<br><span class="small muted">${esc(i.first_name)} ${esc(i.last_name)} ${tierBadge(i.tier)}</span></td>
        <td>${priorityBadge(i.priority, i.overdue)}</td>
        <td>${statusBadge(i.status)}${i.contractor_name ? `<br><span class="small muted">${esc(i.contractor_name)}</span>` : ''}</td>
        <td class="num">${moneyRange(i.est_cost_low, i.est_cost_high)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── Home Records list ──────────────────────────────────────────────────────
export async function renderProperties(view) {
  const props = await api('/api/properties');
  view.innerHTML = `
  <div class="page-head"><div><h1>Home Records</h1>
    <div class="sub">${props.length} properties under advisory</div></div>
    <div class="actions"><a class="btn btn-primary" href="#/intake">Start new intake</a></div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Address</th><th>Client</th><th>Built</th><th>Type</th><th>Record</th><th>Intake</th></tr></thead>
    <tbody>${props.map((p) => `
      <tr class="clickable" onclick="location.hash='#/property/${p.id}'">
        <td><b>${esc(p.address_line1)}</b><br><span class="small muted">${esc(p.city)}, ${esc(p.state)} ${esc(p.zip)}</span></td>
        <td>${esc(p.first_name)} ${esc(p.last_name)} ${tierBadge(p.tier)}</td>
        <td>${p.year_built ?? '—'}</td>
        <td>${label(p.property_type)}</td>
        <td>${progress(p.record_completeness)}</td>
        <td>${fmtDate(p.intake_date)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── Home Record (US-A10: the 2-minute pre-call review) ────────────────────
export async function renderPropertyRecord(view, id) {
  const r = await api(`/api/properties/${id}/record`);
  const p = r.property;
  const open = r.schedule.filter((i) => ['upcoming', 'scheduled'].includes(i.status));
  const overdueCount = open.filter((i) => i.overdue).length;
  const eol = r.systems.filter((s) => s.remaining_life != null && s.remaining_life <= 3).length;

  view.innerHTML = `
  <div class="page-head">
    <div>
      <div class="small muted"><a href="#/properties">Home Records</a> / ${esc(p.city)}</div>
      <h1>${esc(p.address_line1)}</h1>
      <div class="sub">${esc(p.city)}, ${esc(p.state)} ${esc(p.zip)} ·
        <b>${esc(r.client.first_name)} ${esc(r.client.last_name)}</b> ${tierBadge(r.client.tier)}
        · advisor ${esc(r.client.advisor_name || '—')}
        · prefers <b>${esc(r.client.preferred_contact || '—')}</b></div>
    </div>
    <div class="actions">
      <button class="btn" id="act-visit">Log visit</button>
      <button class="btn" id="act-permit">Log permit</button>
      <button class="btn" id="act-system">Add system</button>
      <button class="btn" id="act-job">Log completed job</button>
      <button class="btn" id="act-recompute">Run rules engine</button>
      <a class="btn" href="/api/export/${p.id}" target="_blank">Export Home Record</a>
    </div>
  </div>

  ${r.client.notes ? `<div class="notice"><b>Internal:</b> ${esc(r.client.notes)}</div>` : ''}
  ${p.narrative_summary ? `<div class="narrative">${esc(p.narrative_summary)}</div>` : ''}

  <div class="tiles">
    ${statTile(p.record_completeness + '%', 'record complete', 'brand')}
    ${statTile(r.systems.length, 'systems on record')}
    ${statTile(overdueCount, 'overdue', overdueCount ? 'critical' : 'good')}
    ${statTile(open.length, 'open items')}
    ${statTile(eol, 'systems near end of life', eol ? 'serious' : '')}
  </div>

  <div class="tabs" id="tabs">
    <button data-tab="systems" class="active">Systems (${r.systems.length})</button>
    <button data-tab="schedule">Forward Schedule (${open.length})</button>
    <button data-tab="log">History (${r.log.length})</button>
    <button data-tab="permits">Permits (${r.permits.length})</button>
    <button data-tab="visits">Visits (${r.visits.length})</button>
    <button data-tab="documents">Documents (${r.documents.length})</button>
    <button data-tab="details">Property Details</button>
  </div>
  <div id="tab-body"></div>
  <div class="disclaimer">${esc(r.disclaimer)}</div>`;

  const tabBody = $('#tab-body', view);
  const tabs = {
    systems: () => systemsTab(r),
    schedule: () => scheduleTab(r),
    log: () => logTab(r),
    permits: () => permitsTab(r),
    visits: () => visitsTab(r),
    documents: () => documentsTab(r),
    details: () => detailsTab(r),
  };
  const showTab = (name) => {
    $$('#tabs button', view).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    tabBody.innerHTML = tabs[name]();
    bindTabActions(name, r, view, id);
  };
  $('#tabs', view).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) showTab(b.dataset.tab);
  });
  showTab('systems');

  $('#act-recompute', view).addEventListener('click', async () => {
    const res = await api(`/api/properties/${id}/recompute`, { method: 'POST' });
    toast(res.created ? `Rules engine created ${res.created} new schedule item(s)` : 'Schedule already up to date');
    if (res.created) renderPropertyRecord(view, id);
  });
  $('#act-system', view).addEventListener('click', () => systemModal(id, null, () => renderPropertyRecord(view, id)));
  $('#act-job', view).addEventListener('click', () => jobModal(r, null, () => renderPropertyRecord(view, id)));
  $('#act-visit', view).addEventListener('click', () => visitModal(id, () => renderPropertyRecord(view, id)));
  $('#act-permit', view).addEventListener('click', () => permitModal(id, () => renderPropertyRecord(view, id)));
}

function systemsTab(r) {
  if (!r.systems.length) return `<div class="card">${empty('No systems logged yet — add the first one.')}</div>`;
  return `<div class="grid g2">${r.systems.map((s) => `
    <div class="card card-pad" style="position:relative">
      <div style="display:flex;justify-content:space-between;gap:10px">
        <div><h3>${esc(s.system_name)}</h3><span class="chip">${esc(s.category)}</span>
          ${s.needs_specialist ? '<span class="chip" style="color:var(--serious-text)">specialist required</span>' : ''}</div>
        <div style="text-align:right">${stars(s.condition_rating)}<br>
          <span class="small ${s.remaining_life != null && s.remaining_life <= 2 ? 'muted' : 'muted'}">
          ${s.remaining_life == null ? '' : s.remaining_life <= 0 ? '<b style="color:var(--critical-text)">at end of life</b>' : `~${s.remaining_life} yrs left`}</span></div>
      </div>
      ${s.description ? `<div class="small sub" style="margin-top:6px">${esc(s.description)}</div>` : ''}
      ${ageBar(s)}
      <dl class="kv small" style="margin-top:10px">
        ${s.install_date ? `<dt>Installed</dt><dd>${fmtDate(s.install_date)}</dd>` : ''}
        ${s.last_service_date ? `<dt>Last serviced</dt><dd>${fmtDate(s.last_service_date)}</dd>` : ''}
        ${s.model_number ? `<dt>Model</dt><dd>${esc(s.model_number)}</dd>` : ''}
        ${s.warranty_expiry ? `<dt>Warranty until</dt><dd>${fmtDate(s.warranty_expiry)}</dd>` : ''}
      </dl>
      ${s.advisor_notes ? `<div class="small muted" style="margin-top:8px"><b>Internal:</b> ${esc(s.advisor_notes)}</div>` : ''}
      <div style="margin-top:10px"><button class="btn btn-sm" data-edit-system="${s.id}">Edit</button></div>
    </div>`).join('')}</div>`;
}

function scheduleTab(r) {
  const rows = r.schedule;
  if (!rows.length) return `<div class="card">${empty('No schedule items — run the rules engine.')}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Due</th><th>Item</th><th>Priority</th><th>Status</th><th class="num">Est. cost</th><th></th></tr></thead>
    <tbody>${rows.map((i) => `
      <tr class="${i.overdue ? 'row-overdue' : ''}">
        <td style="white-space:nowrap"><b>${dueText(i.due_date)}</b><br><span class="small muted">${fmtDate(i.due_date)}</span></td>
        <td><b>${esc(i.item_name)}</b>
          ${i.system_name ? `<br><span class="small muted">${esc(i.system_name)}</span>` : ''}
          ${i.deferral_risk ? `<br><span class="small muted">${esc(i.deferral_risk)}</span>` : ''}
          ${i.capital_forecast_item ? '<br><span class="chip">capital forecast</span>' : ''}</td>
        <td>${priorityBadge(i.priority, i.overdue)}</td>
        <td>${statusBadge(i.status)}${i.contractor_name ? `<br><span class="small muted">${esc(i.contractor_name)}</span>` : ''}</td>
        <td class="num">${moneyRange(i.est_cost_low, i.est_cost_high)}</td>
        <td style="white-space:nowrap">${['upcoming', 'scheduled'].includes(i.status) ? `
          <button class="btn btn-sm" data-complete="${i.id}">Complete</button>
          <button class="btn btn-sm" data-item-edit="${i.id}">Edit</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function logTab(r) {
  if (!r.log.length) return `<div class="card">${empty('No work logged yet.')}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Work performed</th><th>System</th><th>Contractor</th><th class="num">Invoice</th></tr></thead>
    <tbody>${r.log.map((l) => `<tr>
      <td style="white-space:nowrap">${fmtDate(l.date)}</td>
      <td>${esc(l.description)}${l.outcome_notes ? `<br><span class="small muted">${esc(l.outcome_notes)}</span>` : ''}</td>
      <td>${esc(l.system_name || '—')}</td>
      <td>${esc(l.contractor_name || '—')}${l.advisor_present ? '<br><span class="small muted">advisor present</span>' : ''}</td>
      <td class="num">${money(l.invoice_amount)}${l.invoice_reference ? `<br><span class="small muted">${esc(l.invoice_reference)}</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function permitsTab(r) {
  if (!r.permits.length) return `<div class="card">${empty('No permits researched yet.')}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Permit</th><th>Type</th><th>Filed</th><th>Status</th><th>Scope</th></tr></thead>
    <tbody>${r.permits.map((pm) => `<tr class="${pm.gap_flag ? 'row-overdue' : ''}">
      <td style="white-space:nowrap">${esc(pm.permit_number || '—')}${pm.gap_flag ? '<br><span class="badge b-critical">▲ gap flag</span>' : ''}</td>
      <td>${label(pm.permit_type)}</td>
      <td>${fmtDate(pm.date_filed)}</td>
      <td>${statusBadge(pm.status)}</td>
      <td>${esc(pm.scope_description || '')}
        ${pm.gap_notes ? `<br><span class="small" style="color:var(--critical-text)">${esc(pm.gap_notes)}</span>` : ''}
        ${pm.contractor_of_record ? `<br><span class="small muted">Contractor: ${esc(pm.contractor_of_record)}</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function visitsTab(r) {
  if (!r.visits.length) return `<div class="card">${empty('No visits recorded.')}</div>`;
  return `<div class="card card-pad">${r.visits.map((v) => `
    <div class="item-line" style="align-items:flex-start">
      <span class="badge b-info" style="margin-top:2px">${label(v.visit_type)}</span>
      <div>
        <b>${fmtDate(v.visit_date)}</b> · ${esc(v.advisor_name)} ${v.duration_hrs ? `· ${v.duration_hrs} hrs` : ''}
        ${v.client_satisfaction ? `· ${stars(v.client_satisfaction)}` : ''}<br>
        ${v.systems_reviewed ? `<span class="small muted">Reviewed: ${esc(v.systems_reviewed)}</span><br>` : ''}
        ${v.findings_summary ? `<span class="small">${esc(v.findings_summary)}</span>` : ''}
        ${v.follow_up_required ? `<br><span class="small" style="color:var(--serious-text)">Follow-up: ${esc(v.follow_up_notes || 'required')}</span>` : ''}
      </div>
      <span class="right small muted">${v.forward_items_generated ? `+${v.forward_items_generated} items` : ''}</span>
    </div>`).join('')}</div>`;
}

function documentsTab(r) {
  return `<div class="card card-pad">
    <form id="doc-upload" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <input type="file" id="doc-file" class="control" style="max-width:280px">
      <select id="doc-type" class="control" style="max-width:180px">
        ${['photo','permit_doc','invoice','warranty','inspection_report','other'].map((t) => `<option>${t}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" type="submit">Upload</button>
    </form>
    ${r.documents.length ? r.documents.map((doc) => `
      <div class="item-line">
        <span class="chip">${label(doc.document_type)}</span>
        <a href="/api/documents/${doc.id}/file" target="_blank"><b>${esc(doc.document_name)}</b></a>
        <span class="small muted">${doc.description ? esc(doc.description) + ' · ' : ''}${fmtDate(doc.upload_date)} ${doc.uploaded_by_name ? '· ' + esc(doc.uploaded_by_name) : ''}</span>
        <span class="right small muted">${doc.size_bytes ? Math.ceil(doc.size_bytes / 1024) + ' KB' : ''}</span>
      </div>`).join('') : empty('No documents yet.')}
  </div>`;
}

function detailsTab(r) {
  const p = r.property;
  const rows = [
    ['Year built', p.year_built], ['Square footage', p.square_footage?.toLocaleString()],
    ['Stories', p.stories], ['Bedrooms', p.bedrooms], ['Bathrooms', p.bathrooms],
    ['Property type', label(p.property_type)], ['Construction', label(p.construction_type)],
    ['Foundation', label(p.foundation_type)], ['Owned since', fmtDate(p.ownership_date)],
    ['Permit jurisdiction', p.permit_jurisdiction], ['Intake date', fmtDate(p.intake_date)],
  ];
  return `<div class="card card-pad">
    ${p.year_built && p.year_built < 1960 ? '<div class="notice">Pre-1960 home — extended intake protocol applies.</div>' : ''}
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>
    <hr class="divider">
    ${field('record_completeness', 'Record completeness (%)', input(`type="number" min="0" max="100" value="${p.record_completeness}" data-number`))}
    ${field('narrative_summary', 'Narrative summary (future advisors read this first)', textarea(`rows="4"`))}
    <div class="form-actions"><button class="btn btn-primary" id="save-details">Save</button></div>
  </div>`;
}

function bindTabActions(name, r, view, id) {
  const rerender = () => renderPropertyRecord(view, id);
  if (name === 'systems') {
    for (const b of $$('[data-edit-system]', view)) {
      b.addEventListener('click', () => {
        const s = r.systems.find((x) => x.id === Number(b.dataset.editSystem));
        systemModal(id, s, rerender);
      });
    }
  }
  if (name === 'schedule') {
    for (const b of $$('[data-complete]', view)) {
      b.addEventListener('click', () => {
        const item = r.schedule.find((x) => x.id === Number(b.dataset.complete));
        jobModal(r, item, rerender);
      });
    }
    for (const b of $$('[data-item-edit]', view)) {
      b.addEventListener('click', () => {
        const item = r.schedule.find((x) => x.id === Number(b.dataset.itemEdit));
        itemModal(r, item, rerender);
      });
    }
  }
  if (name === 'documents') {
    $('#doc-upload', view)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileEl = $('#doc-file', view);
      const file = fileEl.files[0];
      if (!file) return toast('Choose a file first', 'err');
      const q = new URLSearchParams({ property_id: id, name: file.name, type: $('#doc-type', view).value });
      await fetch(`/api/documents?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
        .then(async (res) => { if (!res.ok) throw new Error((await res.json()).error); });
      toast('Document uploaded');
      rerender();
    });
  }
  if (name === 'details') {
    const ta = $('[name=narrative_summary]', view);
    if (ta) ta.value = r.property.narrative_summary || '';
    $('#save-details', view)?.addEventListener('click', async () => {
      const body = formValues($('#tab-body', view));
      await api(`/api/properties/${id}`, { method: 'PATCH', body });
      toast('Property updated');
      rerender();
    });
  }
}

// ── System modal (US-A3: the 60-second capture) ────────────────────────────
export function systemModal(propertyId, existing, done) {
  const m = modal(existing ? `Edit — ${existing.system_name}` : 'Add system', `
    <div class="form-grid">
      ${field('category', 'Category (rules-engine join key)', select(meta().categories.map((c) =>
        ({ value: c, label: c, selected: existing?.category === c }))))}
      ${field('system_name', 'System name', input(`value="${esc(existing?.system_name || '')}" placeholder="Gas boiler, 200A panel…"`))}
      <div class="field span2"><span class="field-label">Condition (1 = near failure, 5 = like new)</span>
        ${starInput('condition_rating', existing?.condition_rating || 0)}</div>
      ${field('install_date', 'Install date', input(`type="date" value="${existing?.install_date || ''}"`))}
      ${field('age_at_intake', 'Age at intake (yrs, if install unknown)', input(`type="number" step="0.5" value="${existing?.age_at_intake ?? ''}" data-number`))}
      ${field('expected_lifespan', 'Expected lifespan (yrs)', input(`type="number" step="0.5" value="${existing?.expected_lifespan ?? ''}" data-number`))}
      ${field('last_service_date', 'Last serviced', input(`type="date" value="${existing?.last_service_date || ''}"`))}
      ${field('model_number', 'Model #', input(`value="${esc(existing?.model_number || '')}"`))}
      ${field('serial_number', 'Serial #', input(`value="${esc(existing?.serial_number || '')}"`))}
      ${field('warranty_expiry', 'Warranty expiry', input(`type="date" value="${existing?.warranty_expiry || ''}"`))}
      <label class="checkbox-row span2"><input type="checkbox" name="needs_specialist" ${existing?.needs_specialist ? 'checked' : ''}> Needs specialist referral</label>
      <div class="span2">${field('description', 'Description (make, fuel, zones…)', textarea(`rows="2"`))}</div>
      <div class="span2">${field('advisor_notes', 'Advisor notes (internal — never client-visible)', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="sys-save">${existing ? 'Save changes' : 'Add system'}</button></div>`,
    { wide: true });
  bindStarInputs(m.body);
  if (existing) {
    $('[name=description]', m.body).value = existing.description || '';
    $('[name=advisor_notes]', m.body).value = existing.advisor_notes || '';
  }
  $('#sys-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    body.condition_rating = readStars(m.body, 'condition_rating');
    if (!body.system_name) return toast('System name is required', 'err');
    try {
      const res = existing
        ? await api(`/api/systems/${existing.id}`, { method: 'PATCH', body })
        : await api('/api/systems', { method: 'POST', body: { ...body, property_id: propertyId } });
      toast(res.generated_items ? `Saved — rules engine added ${res.generated_items} schedule item(s)` : 'Saved');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── Job completion modal (US-A11 + US-A12) ────────────────────────────────
export async function jobModal(r, forwardItem, done) {
  const contractors = await api('/api/contractors');
  const referable = contractors.filter((c) => c.referable);
  const m = modal(forwardItem ? `Complete — ${forwardItem.item_name}` : 'Log completed job', `
    ${forwardItem ? `<div class="notice">Completing this job closes the schedule item and resets the next recurrence automatically.</div>` : ''}
    <div class="form-grid">
      ${field('date', 'Work date', input(`type="date" value="${new Date().toISOString().slice(0, 10)}"`))}
      ${field('system_id', 'System', select([{ value: '', label: '— none —' },
        ...r.systems.map((s) => ({ value: s.id, label: s.system_name, selected: forwardItem?.system_id === s.id }))], 'data-number'))}
      ${field('contractor_id', 'Contractor (referable only)', select([{ value: '', label: '— none / client arranged —' },
        ...referable.map((c) => ({ value: c.id, label: `${c.company_name} (${c.trades.join(', ')})`, selected: forwardItem?.assigned_contractor_id === c.id }))], 'data-number'))}
      ${field('invoice_amount', 'Invoice amount ($)', input(`type="number" step="0.01" data-number`))}
      ${field('invoice_reference', 'Invoice #', input())}
      <label class="checkbox-row"><input type="checkbox" name="advisor_present"> Advisor present</label>
      <div class="span2">${field('description', 'What was done, specifically', textarea(`rows="3"`))}</div>
      <div class="span2">${field('outcome_notes', 'Outcome notes', textarea(`rows="2"`))}</div>
    </div>
    ${contractors.length !== referable.length ? `<div class="small muted">${contractors.length - referable.length} network contractor(s) hidden — missing current license or insurance (never refer without both).</div>` : ''}
    <div class="form-actions"><button class="btn btn-primary" id="job-save">Log job${forwardItem ? ' & close item' : ''}</button></div>`,
    { wide: true });
  $('#job-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.description) return toast('Describe the work performed', 'err');
    if (forwardItem) body.forward_item_id = forwardItem.id;
    body.property_id = r.property.id;
    try {
      const res = await api('/api/maintenance-log', { method: 'POST', body });
      m.close();
      let msg = 'Job logged';
      if (res.closed_forward_item) msg += ' · schedule item closed';
      if (res.referral_fee_created) msg += ' · referral fee recorded';
      if (res.next_items_generated) msg += ` · ${res.next_items_generated} next item(s) scheduled`;
      toast(msg);
      if (res.rate_contractor_within_48h && body.contractor_id) {
        ratingModal(body.contractor_id, r.property.id, res.log.id, done);
      } else done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── Rating modal (US-A12: rate within 48 hrs) ─────────────────────────────
export function ratingModal(contractorId, propertyId, logId, done) {
  const m = modal('Rate this job (within 48 hours)', `
    <p class="sub" style="margin-bottom:12px">Ratings feed network quality management — a score of 2 or below files a complaint flag; three flags trigger automatic probation and founder review.</p>
    <div class="field"><span class="field-label">Score</span>${starInput('score', 0)}</div>
    ${field('client_comments', 'Client comments', textarea(`rows="2"`))}
    ${field('advisor_notes', 'Advisor notes (internal)', textarea(`rows="2"`))}
    <div class="form-actions">
      <button class="btn" id="rate-skip">Later</button>
      <button class="btn btn-primary" id="rate-save">Submit rating</button>
    </div>`);
  bindStarInputs(m.body);
  $('#rate-skip', m.body).addEventListener('click', () => { m.close(); done(); });
  $('#rate-save', m.body).addEventListener('click', async () => {
    const score = readStars(m.body, 'score');
    if (!score) return toast('Pick a score', 'err');
    const body = { ...formValues(m.body), score, contractor_id: Number(contractorId), property_id: propertyId, maintenance_log_id: logId };
    const res = await api('/api/ratings', { method: 'POST', body });
    m.close();
    toast(res.probation_triggered
      ? 'Rating saved — third complaint flag: contractor moved to PROBATION for founder review'
      : res.complaint_flag ? 'Rating saved — complaint flag filed' : 'Rating saved', res.complaint_flag ? 'err' : 'ok');
    done();
  });
}

// ── Schedule item modal ────────────────────────────────────────────────────
async function itemModal(r, item, done) {
  const contractors = await api('/api/contractors');
  const referable = contractors.filter((c) => c.referable);
  const m = modal(`Edit — ${item.item_name}`, `
    <div class="form-grid">
      ${field('due_date', 'Due date', input(`type="date" value="${item.due_date || ''}"`))}
      ${field('priority', 'Priority', select(['urgent', 'standard', 'planning'].map((p) => ({ value: p, label: p, selected: item.priority === p }))))}
      ${field('status', 'Status', select(['upcoming', 'scheduled', 'deferred', 'cancelled'].map((s) => ({ value: s, label: s, selected: item.status === s }))))}
      ${field('assigned_contractor_id', 'Assign contractor', select([{ value: '', label: '— none —' },
        ...referable.map((c) => ({ value: c.id, label: c.company_name, selected: item.assigned_contractor_id === c.id }))], 'data-number'))}
      ${field('est_cost_low', 'Est. cost low', input(`type="number" value="${item.est_cost_low ?? ''}" data-number`))}
      ${field('est_cost_high', 'Est. cost high', input(`type="number" value="${item.est_cost_high ?? ''}" data-number`))}
      <div class="span2">${field('advisor_notes', 'Advisor notes (internal)', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="item-save">Save</button></div>`);
  $('[name=advisor_notes]', m.body).value = item.advisor_notes || '';
  $('#item-save', m.body).addEventListener('click', async () => {
    try {
      await api(`/api/schedule/${item.id}`, { method: 'PATCH', body: formValues(m.body) });
      toast('Item updated');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── Visit + permit modals ──────────────────────────────────────────────────
function visitModal(propertyId, done) {
  const m = modal('Log visit', `
    <div class="form-grid">
      ${field('visit_date', 'Date', input(`type="date" value="${new Date().toISOString().slice(0, 10)}"`))}
      ${field('visit_type', 'Type', select(['annual', 'spring', 'fall', 'quarterly', 'ad_hoc', 'intake']))}
      ${field('duration_hrs', 'Duration (hrs)', input(`type="number" step="0.5" data-number`))}
      ${field('client_satisfaction', 'Client satisfaction (1–5, optional)', input(`type="number" min="1" max="5" data-number`))}
      <div class="span2">${field('systems_reviewed', 'Systems reviewed', input())}</div>
      <div class="span2">${field('findings_summary', 'Findings', textarea(`rows="3"`))}</div>
      <label class="checkbox-row"><input type="checkbox" name="follow_up_required"> Follow-up required</label>
      <div class="span2">${field('follow_up_notes', 'Follow-up notes', input())}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="visit-save">Log visit</button></div>`);
  $('#visit-save', m.body).addEventListener('click', async () => {
    const body = { ...formValues(m.body), property_id: propertyId, home_record_updated: 1 };
    if (!body.visit_type || !body.visit_date) return toast('Date and type are required', 'err');
    await api('/api/visits', { method: 'POST', body });
    toast('Visit logged');
    m.close(); done();
  });
}

function permitModal(propertyId, done) {
  const m = modal('Log permit / gap flag', `
    <div class="form-grid">
      ${field('permit_number', 'Permit # (blank for gap flag)', input())}
      ${field('permit_type', 'Type', select(['electrical', 'plumbing', 'structural', 'mechanical', 'general_building', 'demolition', 'other']))}
      ${field('date_filed', 'Filed', input(`type="date"`))}
      ${field('status', 'Status', select(['finaled', 'open', 'expired', 'pending', 'unknown']))}
      ${field('contractor_of_record', 'Contractor of record', input())}
      <label class="checkbox-row"><input type="checkbox" name="gap_flag" id="gapflag"> <b>Gap flag</b> — visible improvement, no matching permit</label>
      <div class="span2">${field('scope_description', 'Scope', textarea(`rows="2"`))}</div>
      <div class="span2">${field('gap_notes', 'Gap notes', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="permit-save">Save permit</button></div>`);
  $('#permit-save', m.body).addEventListener('click', async () => {
    await api('/api/permits', { method: 'POST', body: { ...formValues(m.body), property_id: propertyId } });
    toast('Permit recorded');
    m.close(); done();
  });
}

// ── Intake flow (US-A2: guided multi-step) ────────────────────────────────
export async function renderIntake(view) {
  const clientsData = await api('/api/dashboard?mine=0');
  const clients = clientsData.clients;
  const draft = { systems: [], permits: [] };
  let step = 0;

  const steps = ['Client & address', 'Property details', 'Systems inventory', 'Narrative & safety', 'Permit review', 'Debrief'];

  function shell() {
    view.innerHTML = `
    <div class="page-head"><div><h1>New Intake</h1>
      <div class="sub">The structured intake flow — no home gets a different process depending on who runs it.</div></div></div>
    <div class="card card-pad" style="max-width:860px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
        ${steps.map((s, i) => `<span class="badge ${i === step ? 'b-tier' : i < step ? 'b-good' : 'b-muted'}">${i + 1}. ${s}</span>`).join('')}
      </div>
      <div id="step-body"></div>
    </div>`;
    renderStep();
  }

  function nav(backOk = true, nextLabel = 'Continue') {
    return `<div class="form-actions">
      ${backOk && step > 0 ? '<button class="btn" id="step-back">Back</button>' : ''}
      <button class="btn btn-primary" id="step-next">${nextLabel}</button>
    </div>`;
  }

  function renderStep() {
    const body = $('#step-body', view);
    if (step === 0) {
      body.innerHTML = `
        ${field('client_id', 'Client', select([{ value: '', label: '— choose client —' },
          ...clients.map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name} (${c.tier})`, selected: draft.client_id === c.id }))], 'data-number'))}
        <div class="form-grid">
          ${field('address_line1', 'Address', input(`value="${esc(draft.address_line1 || '')}"`))}
          ${field('city', 'City', input(`value="${esc(draft.city || '')}"`))}
          ${field('state', 'State', input(`value="${esc(draft.state || '')}" maxlength="2"`))}
          ${field('zip', 'ZIP', input(`value="${esc(draft.zip || '')}"`))}
          ${field('year_built', 'Year built', input(`type="number" value="${draft.year_built ?? ''}" data-number`))}
          ${field('permit_jurisdiction', 'Permit jurisdiction', input(`value="${esc(draft.permit_jurisdiction || '')}" placeholder="Boston ISD, LADBS…"`))}
        </div>
        <div id="vintage-note"></div>
        <div class="small muted">Pre-visit checklist: permit research done, client preferences confirmed, prior docs requested.</div>
        ${nav(false)}`;
      $('[name=year_built]', body).addEventListener('input', (e) => {
        $('#vintage-note', body).innerHTML = e.target.value && Number(e.target.value) < 1960
          ? '<div class="notice">Pre-1960 home — extended intake protocol (knob-and-tube, foundation, materials).</div>' : '';
      });
    }
    if (step === 1) {
      body.innerHTML = `<div class="form-grid">
        ${field('property_type', 'Property type', select(['single_family', 'two_family', 'triple_decker', 'condo', 'townhouse'].map((v) => ({ value: v, label: v.replace(/_/g, ' '), selected: draft.property_type === v }))))}
        ${field('construction_type', 'Construction', select(['wood_frame', 'masonry', 'stucco', 'mixed'].map((v) => ({ value: v, label: v.replace(/_/g, ' '), selected: draft.construction_type === v }))))}
        ${field('foundation_type', 'Foundation', select(['fieldstone', 'poured_concrete', 'slab', 'crawlspace', 'basement'].map((v) => ({ value: v, label: v.replace(/_/g, ' '), selected: draft.foundation_type === v }))))}
        ${field('square_footage', 'Square footage', input(`type="number" value="${draft.square_footage ?? ''}" data-number`))}
        ${field('stories', 'Stories', input(`type="number" step="0.5" value="${draft.stories ?? ''}" data-number`))}
        ${field('bedrooms', 'Bedrooms', input(`type="number" value="${draft.bedrooms ?? ''}" data-number`))}
        ${field('bathrooms', 'Bathrooms', input(`type="number" step="0.5" value="${draft.bathrooms ?? ''}" data-number`))}
        ${field('ownership_date', 'Client owned since', input(`type="date" value="${draft.ownership_date || ''}"`))}
      </div>${nav()}`;
    }
    if (step === 2) {
      body.innerHTML = `
        <p class="sub" style="margin-bottom:14px">The 60-second capture: category → condition → date → notes. Log every major system.</p>
        <div class="form-grid">
          ${field('category', 'Category', select(meta().categories))}
          ${field('system_name', 'System name', input(`placeholder="Gas boiler…"`))}
          <div class="field"><span class="field-label">Condition</span>${starInput('condition_rating', 0)}</div>
          ${field('install_date', 'Install date (or leave blank)', input(`type="date"`))}
          ${field('age_at_intake', 'Age if install unknown (yrs)', input(`type="number" data-number`))}
          ${field('expected_lifespan', 'Expected lifespan (yrs)', input(`type="number" data-number`))}
          <div class="span2">${field('description', 'Notes', input(`placeholder="Make, fuel, location…"`))}</div>
        </div>
        <button class="btn" id="sys-add">+ Add system to inventory</button>
        <hr class="divider">
        <div id="sys-list">${draft.systems.length
          ? draft.systems.map((s, i) => `<div class="item-line"><span class="chip">${esc(s.category)}</span><b>${esc(s.system_name)}</b>
              ${stars(s.condition_rating)}<span class="right"><button class="btn btn-sm" data-rm="${i}">remove</button></span></div>`).join('')
          : '<div class="empty">No systems logged yet.</div>'}</div>
        ${nav()}`;
      bindStarInputs(body);
      $('#sys-add', body).addEventListener('click', () => {
        const s = formValues(body);
        s.condition_rating = readStars(body, 'condition_rating');
        if (!s.system_name) return toast('Name the system', 'err');
        draft.systems.push(s);
        renderStep();
      });
      for (const b of $$('[data-rm]', body)) {
        b.addEventListener('click', () => { draft.systems.splice(Number(b.dataset.rm), 1); renderStep(); });
      }
    }
    if (step === 3) {
      body.innerHTML = `
        ${field('narrative_summary', 'Narrative summary — the essence of this home, for every future advisor', textarea(`rows="5"`))}
        ${field('record_completeness', 'Record completeness after intake (%)', input(`type="number" min="0" max="100" value="${draft.record_completeness ?? 60}" data-number`))}
        <div class="small muted">Interior & safety walk: detectors, egress, moisture, visible electrical.</div>
        ${nav()}`;
      $('[name=narrative_summary]', body).value = draft.narrative_summary || '';
    }
    if (step === 4) {
      body.innerHTML = `
        <p class="sub" style="margin-bottom:14px">Record each permit found — and gap-flag visible improvements with no matching permit.</p>
        <div class="form-grid">
          ${field('permit_number', 'Permit # (blank if gap)', input())}
          ${field('permit_type', 'Type', select(['electrical', 'plumbing', 'structural', 'mechanical', 'general_building', 'demolition', 'other']))}
          ${field('date_filed', 'Filed', input(`type="date"`))}
          ${field('status', 'Status', select(['finaled', 'open', 'expired', 'pending', 'unknown']))}
          <label class="checkbox-row span2"><input type="checkbox" name="gap_flag"> <b>Gap flag</b></label>
          <div class="span2">${field('scope_description', 'Scope / gap notes', input())}</div>
        </div>
        <button class="btn" id="permit-add">+ Add permit record</button>
        <hr class="divider">
        <div>${draft.permits.length ? draft.permits.map((pm, i) => `<div class="item-line">
            ${pm.gap_flag ? '<span class="badge b-critical">▲ gap</span>' : `<span class="chip">${esc(pm.permit_number || '—')}</span>`}
            ${esc(pm.scope_description || pm.permit_type || '')}
            <span class="right"><button class="btn btn-sm" data-rm="${i}">remove</button></span></div>`).join('')
          : '<div class="empty">No permits recorded.</div>'}</div>
        ${nav()}`;
      $('#permit-add', body).addEventListener('click', () => {
        const pm = formValues(body);
        if (!pm.permit_number && !pm.gap_flag) return toast('Enter a permit number or mark a gap flag', 'err');
        if (pm.gap_flag) { pm.gap_notes = pm.scope_description; pm.status = pm.status || 'unknown'; }
        draft.permits.push(pm);
        renderStep();
      });
      for (const b of $$('[data-rm]', body)) {
        b.addEventListener('click', () => { draft.permits.splice(Number(b.dataset.rm), 1); renderStep(); });
      }
    }
    if (step === 5) {
      const client = clients.find((c) => c.id === draft.client_id);
      body.innerHTML = `
        <h3 style="margin-bottom:12px">Ready to create this Home Record</h3>
        <dl class="kv">
          <dt>Client</dt><dd>${client ? esc(client.first_name + ' ' + client.last_name) : '—'}</dd>
          <dt>Address</dt><dd>${esc(draft.address_line1 || '')}, ${esc(draft.city || '')}</dd>
          <dt>Systems</dt><dd>${draft.systems.length} logged</dd>
          <dt>Permits</dt><dd>${draft.permits.length} recorded (${draft.permits.filter((x) => x.gap_flag).length} gap flags)</dd>
        </dl>
        <div class="form-grid" style="margin-top:14px">
          ${field('visit_date', 'Intake visit date', input(`type="date" value="${new Date().toISOString().slice(0, 10)}"`))}
          ${field('duration_hrs', 'Duration (hrs)', input(`type="number" step="0.5" value="5" data-number`))}
        </div>
        <div class="notice">On save: property + systems + permits are created, the intake visit is logged, and the rules engine generates the forward schedule automatically.</div>
        <div class="disclaimer">This assessment is an advisory walkthrough, not a licensed home inspection.</div>
        ${nav(true, 'Create Home Record')}`;
    }

    $('#step-back', body)?.addEventListener('click', () => { collect(body); step--; renderStep(); });
    $('#step-next', body)?.addEventListener('click', async () => {
      collect(body);
      if (step === 0 && (!draft.client_id || !draft.address_line1)) return toast('Pick a client and enter the address', 'err');
      if (step < 5) { step++; renderStep(); return; }
      await finish(body);
    });
  }

  function collect(body) {
    const vals = formValues(body);
    for (const [k, v] of Object.entries(vals)) {
      if (['category', 'system_name', 'condition_rating', 'install_date', 'age_at_intake', 'expected_lifespan',
        'description', 'permit_number', 'permit_type', 'date_filed', 'status', 'gap_flag', 'scope_description'].includes(k)
        && [2, 4].includes(step)) continue; // repeatable sub-forms are captured by their Add buttons
      if (v !== null && v !== undefined) draft[k] = v;
    }
  }

  async function finish(body) {
    const btn = $('#step-next', body);
    btn.disabled = true;
    try {
      const client = clients.find((c) => c.id === draft.client_id);
      const property = await api('/api/properties', { method: 'POST', body: {
        address_line1: draft.address_line1, city: draft.city, state: draft.state, zip: draft.zip,
        client_id: draft.client_id, market_id: client.market_id, year_built: draft.year_built,
        square_footage: draft.square_footage, stories: draft.stories, bedrooms: draft.bedrooms,
        bathrooms: draft.bathrooms, property_type: draft.property_type, construction_type: draft.construction_type,
        foundation_type: draft.foundation_type, ownership_date: draft.ownership_date,
        permit_jurisdiction: draft.permit_jurisdiction, intake_date: draft.visit_date,
        record_completeness: draft.record_completeness ?? 60, narrative_summary: draft.narrative_summary,
        advisor_id: state.me.user.id,
      } });
      let generated = 0;
      for (const s of draft.systems) {
        const res = await api('/api/systems', { method: 'POST', body: { ...s, property_id: property.id } });
        generated += res.generated_items || 0;
      }
      for (const pm of draft.permits) {
        await api('/api/permits', { method: 'POST', body: { ...pm, property_id: property.id } });
      }
      await api('/api/visits', { method: 'POST', body: {
        property_id: property.id, visit_date: draft.visit_date, visit_type: 'intake',
        duration_hrs: draft.duration_hrs, systems_reviewed: 'All systems (intake)',
        findings_summary: `Intake completed: ${draft.systems.length} systems, ${draft.permits.length} permits, ${draft.permits.filter((x) => x.gap_flag).length} gap flag(s).`,
        home_record_updated: 1, forward_items_generated: generated,
      } });
      toast(`Home Record created — rules engine generated ${generated} schedule item(s)`);
      location.hash = `#/property/${property.id}`;
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  }

  shell();
}

// ── Contractor network (US-A12, §5.1.6) ───────────────────────────────────
export async function renderContractors(view) {
  const contractors = await api('/api/contractors');
  const isFounder = state.me.user.role === 'founder';
  const byTrade = {};
  for (const c of contractors) for (const t of c.trades) (byTrade[t] ??= []).push(c);

  view.innerHTML = `
  <div class="page-head"><div><h1>Contractor Network</h1>
    <div class="sub">${contractors.length} vetted contractors · never refer without current license and insurance</div></div>
    <div class="actions"><button class="btn btn-primary" id="con-add">Add contractor</button></div>
  </div>
  <div class="grid g2">
    ${contractors.map((c) => `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><h3>${esc(c.company_name)}</h3>
          <div class="small muted">${esc(c.primary_contact || '')} · ${esc(c.phone || '')} · ${esc(c.email || '')}</div></div>
        <div style="text-align:right">${statusBadge(c.status)}<br>
          <span class="small muted">${c.avg_rating ? stars(Math.round(c.avg_rating)) + ' ' + c.avg_rating : 'no ratings'}</span></div>
      </div>
      <div style="margin-top:8px">${c.trades.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        ${c.preferred_pricing ? '<span class="chip" style="color:var(--brand)">preferred pricing</span>' : ''}</div>
      ${!c.referable ? `<div class="notice notice-critical" style="margin:10px 0 4px">■ Do not refer — ${!c.license_current ? 'license not current. ' : ''}${!c.insurance_on_file ? 'No insurance certificate on file. ' : ''}${['removed', 'inactive'].includes(c.status) ? 'Status: ' + c.status + '.' : ''}</div>` : ''}
      ${c.license_expiring || c.insurance_expiring ? `<div class="notice" style="margin:10px 0 4px">▲ ${c.license_expiring ? `License expires ${fmtDate(c.license_expiry)}. ` : ''}${c.insurance_expiring ? `Insurance expires ${fmtDate(c.insurance_expiry)}.` : ''} (90-day flag)</div>` : ''}
      <dl class="kv small" style="margin-top:10px">
        <dt>License</dt><dd>${esc(c.license_number || '—')} ${c.license_expiry ? `(to ${fmtDate(c.license_expiry)})` : ''}</dd>
        <dt>Insurance</dt><dd>${c.insurance_on_file ? `on file${c.insurance_expiry ? ` to ${fmtDate(c.insurance_expiry)}` : ''}` : '<b style="color:var(--critical-text)">missing</b>'}</dd>
        <dt>Referrals</dt><dd>${c.total_referrals}</dd>
        ${c.complaint_count ? `<dt>Complaints</dt><dd><b style="color:var(--critical-text)">${c.complaint_count} flag(s)</b>${c.complaint_count >= 3 ? ' — network review' : ''}</dd>` : ''}
        ${isFounder && c.referral_fee_rate != null ? `<dt>Fee rate</dt><dd>${Math.round(c.referral_fee_rate * 100)}%</dd>` : ''}
      </dl>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm" data-rate="${c.id}">Rate a job</button>
        <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
      </div>
    </div>`).join('')}
  </div>`;

  for (const b of $$('[data-rate]', view)) {
    b.addEventListener('click', () => ratingModal(b.dataset.rate, null, null, () => renderContractors(view)));
  }
  for (const b of $$('[data-edit]', view)) {
    b.addEventListener('click', () => contractorModal(contractors.find((c) => c.id === Number(b.dataset.edit)), () => renderContractors(view)));
  }
  $('#con-add', view).addEventListener('click', () => contractorModal(null, () => renderContractors(view)));
}

function contractorModal(existing, done) {
  const isFounder = state.me.user.role === 'founder';
  const m = modal(existing ? `Edit — ${existing.company_name}` : 'Add contractor', `
    <div class="form-grid">
      ${field('company_name', 'Company', input(`value="${esc(existing?.company_name || '')}"`))}
      ${field('primary_contact', 'Primary contact', input(`value="${esc(existing?.primary_contact || '')}"`))}
      ${field('email', 'Email', input(`type="email" value="${esc(existing?.email || '')}"`))}
      ${field('phone', 'Phone', input(`value="${esc(existing?.phone || '')}"`))}
      <div class="span2"><div class="field"><span class="field-label">Trades</span>
        <div>${state.meta.trades.map((t) => `<label class="chip" style="cursor:pointer">
          <input type="checkbox" data-trade value="${esc(t)}" ${existing?.trades?.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div></div></div>
      ${field('license_number', 'License #', input(`value="${esc(existing?.license_number || '')}"`))}
      ${field('license_expiry', 'License expiry', input(`type="date" value="${existing?.license_expiry || ''}"`))}
      <label class="checkbox-row"><input type="checkbox" name="license_current" ${existing?.license_current ? 'checked' : ''}> License verified current</label>
      <label class="checkbox-row"><input type="checkbox" name="insurance_on_file" ${existing?.insurance_on_file ? 'checked' : ''}> Insurance COI on file</label>
      ${field('insurance_expiry', 'Insurance expiry', input(`type="date" value="${existing?.insurance_expiry || ''}"`))}
      ${field('status', 'Status', select(['active', 'probation', 'inactive', 'removed'].map((s) => ({ value: s, label: s, selected: existing?.status === s }))))}
      ${isFounder ? field('referral_fee_rate', 'Referral fee rate (0.10 = 10%)', input(`type="number" step="0.01" value="${existing?.referral_fee_rate ?? 0.10}" data-number`)) : ''}
      <label class="checkbox-row"><input type="checkbox" name="preferred_pricing" ${existing?.preferred_pricing ? 'checked' : ''}> Preferred pricing for Steward clients</label>
      <div class="span2">${field('vetting_notes', 'Vetting notes (internal)', textarea(`rows="2"`))}</div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" id="con-save">${existing ? 'Save' : 'Add to network'}</button></div>`,
    { wide: true });
  if (existing) $('[name=vetting_notes]', m.body).value = existing.vetting_notes || '';
  $('#con-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    body.trades = $$('[data-trade]:checked', m.body).map((x) => x.value);
    if (!body.company_name) return toast('Company name required', 'err');
    try {
      if (existing) await api(`/api/contractors/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/contractors', { method: 'POST', body });
      toast('Contractor saved');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}
