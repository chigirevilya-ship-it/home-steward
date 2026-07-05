// Founder console (§5.3): market dashboard, referral fee ledger,
// rules manager (with propagation preview), network health.

import {
  api, esc, fmtDate, fmtMonth, money, moneyRange, label, stars,
  statusBadge, tierBadge, statTile, empty,
  $, $$, toast, modal, field, input, textarea, select, formValues,
} from './core.js';
import { state } from './app.js';

function marketFilter(current, onChange) {
  const markets = state.meta.markets.filter((m) => m.status !== 'planned');
  return {
    html: `<select id="market-filter" class="control" style="max-width:220px">
      <option value="">All markets</option>
      ${markets.map((m) => `<option value="${m.id}" ${current === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
    </select>`,
    bind: (view) => $('#market-filter', view).addEventListener('change', (e) => onChange(e.target.value)),
  };
}

// ── Market dashboard (US-F1, US-F4) ───────────────────────────────────────
export async function renderMarketDashboard(view, _m, _s, marketId = '') {
  const d = await api(`/api/founder/dashboard${marketId ? `?market_id=${marketId}` : ''}`);
  const mf = marketFilter(marketId, (v) => renderMarketDashboard(view, _m, _s, v));
  const tierOrder = ['concierge', 'managed', 'guided', 'self_serve'];
  const byTier = tierOrder.map((t) => d.byTier.find((x) => x.tier === t)).filter(Boolean);
  const maxTier = Math.max(1, ...byTier.map((t) => t.n));

  view.innerHTML = `
  <div class="page-head"><div><h1>Market Dashboard</h1>
    <div class="sub">The health of the business at a glance</div></div>
    <div class="actions">${mf.html}</div></div>

  <div class="tiles">
    ${statTile(d.totals.active_clients, 'active clients', 'brand')}
    ${statTile(money(d.totals.arr), 'annual recurring revenue')}
    ${statTile(money(d.totals.mrr), 'monthly equivalent')}
    ${statTile(d.renewals.length, 'renewals in 60 days', d.renewals.length ? 'serious' : '')}
    ${statTile(d.churn.length, 'churn signals', d.churn.length ? 'critical' : 'good')}
  </div>

  <div class="grid g2 section">
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:12px">Active clients by tier</h2>
      ${byTier.map((t) => `<div class="hbar-row">
        <span>${tierBadge(t.tier)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((t.n / maxTier) * 100)}%"></div></div>
        <span class="hbar-val">${t.n} · ${money(t.arr)}</span>
      </div>`).join('') || empty('No active clients.')}
      <div class="small muted" style="margin-top:10px">Intake fees collected to date: <b>${money(d.totals.intake_fees)}</b></div>
    </div>
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:12px">Renewals due — next 60 days</h2>
      ${d.renewals.map((r) => `<div class="item-line">
        <b>${esc(r.first_name)} ${esc(r.last_name)}</b> ${tierBadge(r.tier)}
        <span class="small muted">${esc(r.market_name)}</span>
        <span class="right"><b>${fmtDate(r.subscription_renewal)}</b><br><span class="small muted">${money(r.annual_rate)}/yr</span></span>
      </div>`).join('') || empty('No renewals in the window.')}
      ${d.churn.length ? `<hr class="divider"><h3 style="color:var(--critical-text)">Churn signals</h3>
        ${d.churn.map((c) => `<div class="item-line">${statusBadge(c.status)} ${esc(c.first_name)} ${esc(c.last_name)} ${tierBadge(c.tier)}
          <span class="right small muted">${esc(c.market_name)}</span></div>`).join('')}` : ''}
    </div>
  </div>

  <div class="section"><div class="section-head"><h2>Advisor books</h2>
    <span class="small muted">hire trigger: ~200 clients per market</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Advisor</th><th>Market</th><th class="num">Clients</th><th class="num">Hours implied / yr</th><th class="num">Book ARR</th><th>Mix</th></tr></thead>
      <tbody>${d.books.map((b) => `<tr>
        <td><b>${esc(b.full_name)}</b><br><span class="small muted">${esc(b.role)}</span></td>
        <td>${esc(b.market_name)}</td>
        <td class="num">${b.client_count}</td>
        <td class="num">${Math.round(b.hours_implied)}</td>
        <td class="num">${money(b.book_arr)}</td>
        <td>${b.tiers.map((t) => `<span class="chip">${label(t.tier)} × ${t.n}</span>`).join('') || '<span class="muted">—</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
  mf.bind(view);
}

// ── Referral fee ledger (US-F2) ───────────────────────────────────────────
export async function renderFees(view, _m, _s, marketId = '') {
  const d = await api(`/api/founder/fees${marketId ? `?market_id=${marketId}` : ''}`);
  const mf = marketFilter(marketId, (v) => renderFees(view, _m, _s, v));
  const pending = d.fees.filter((f) => f.status === 'pending');
  const invoiced = d.fees.filter((f) => f.status === 'invoiced');
  const collected = d.fees.filter((f) => f.status === 'paid').reduce((s, f) => s + (f.fee_amount || 0), 0);

  view.innerHTML = `
  <div class="page-head"><div><h1>Referral Fee Ledger</h1>
    <div class="sub">Contractors invoice clients directly; Steward invoices contractors monthly. Fee accounting is founder-only.</div></div>
    <div class="actions">${mf.html}</div></div>

  <div class="tiles">
    ${statTile(money(pending.reduce((s, f) => s + (f.fee_amount || 0), 0)), 'pending — to invoice', pending.length ? 'serious' : '')}
    ${statTile(money(invoiced.reduce((s, f) => s + (f.fee_amount || 0), 0)), 'invoiced — awaiting payment')}
    ${statTile(money(collected), 'collected to date', 'good')}
  </div>

  <div class="section"><div class="section-head"><h2>Monthly rollup by contractor</h2>
    <span class="small muted">the invoicing view</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Month</th><th>Contractor</th><th>Market</th><th class="num">Jobs</th><th class="num">Fees</th><th>Status</th></tr></thead>
      <tbody>${d.rollup.map((r) => `<tr>
        <td>${fmtMonth(r.month + '-01')}</td>
        <td><b>${esc(r.company_name)}</b></td>
        <td>${esc(r.market_name)}</td>
        <td class="num">${r.jobs}</td>
        <td class="num"><b>${money(r.fee_total)}</b></td>
        <td>${r.pending ? `<span class="badge b-serious">${r.pending} to invoice</span>` : '<span class="badge b-good">all invoiced</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="6">${empty('No referral fees recorded.')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="section"><div class="section-head"><h2>All fee events</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Job date</th><th>Contractor</th><th>Property</th><th class="num">Job value</th><th class="num">Rate</th><th class="num">Fee</th><th>Status</th></tr></thead>
      <tbody>${d.fees.map((f) => `<tr>
        <td>${fmtDate(f.job_date)}</td>
        <td>${esc(f.company_name)}</td>
        <td>${esc(f.address_line1 || '—')}</td>
        <td class="num">${money(f.invoice_amount)}</td>
        <td class="num">${f.fee_rate != null ? Math.round(f.fee_rate * 100) + '%' : '—'}</td>
        <td class="num"><b>${money(f.fee_amount)}</b></td>
        <td><select class="control" style="padding:4px 6px;font-size:12px" data-fee="${f.id}">
          ${['pending', 'invoiced', 'paid', 'disputed', 'waived'].map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
  mf.bind(view);
  for (const sel of $$('[data-fee]', view)) {
    sel.addEventListener('change', async () => {
      const status = sel.value;
      const body = { status };
      if (status === 'invoiced') body.invoice_date = new Date().toISOString().slice(0, 10);
      if (status === 'paid') body.payment_date = new Date().toISOString().slice(0, 10);
      await api(`/api/founder/fees/${sel.dataset.fee}`, { method: 'PATCH', body });
      toast(`Fee marked ${status}`);
    });
  }
}

// ── Rules manager (US-F5) ─────────────────────────────────────────────────
export async function renderRules(view) {
  const rules = await api('/api/rules');
  const active = rules.filter((r) => r.active);
  const inactive = rules.filter((r) => !r.active);

  const freqText = (r) => {
    switch (r.frequency_type) {
      case 'recurring_annual': return 'every year';
      case 'recurring_monthly': return `every ${r.frequency_value || 1} mo`;
      case 'recurring_custom': return `every ${r.frequency_value} ${r.frequency_unit}`;
      case 'recurring_seasonal': return label(r.seasonal_timing);
      case 'age_based': return 'at end of expected life';
      case 'one_time_at_intake': return 'once, at intake';
      case 'one_time_at_install': return 'once, at install';
      case 'condition_triggered': return `condition ≤ ${r.condition_threshold}`;
      default: return label(r.frequency_type);
    }
  };

  view.innerHTML = `
  <div class="page-head"><div><h1>Maintenance Rules</h1>
    <div class="sub">Update a rule once — every matching property updates. Rules are deactivated, never deleted.</div></div>
    <div class="actions">
      <button class="btn" id="engine-run">Run engine across all properties</button>
      <button class="btn btn-primary" id="rule-add">New rule</button>
    </div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Rule</th><th>Category (join key)</th><th>Frequency</th><th>Priority</th><th class="num">Est. cost</th><th>Scope</th><th></th></tr></thead>
    <tbody>${active.map((r) => `<tr>
      <td><b>${esc(r.task_name)}</b>${r.capital_forecast_item ? '<br><span class="chip">capital forecast</span>' : ''}
        ${r.advisor_talking_points ? `<br><span class="small muted">${esc(r.advisor_talking_points)}</span>` : ''}</td>
      <td><span class="chip">${esc(r.system_category)}</span></td>
      <td>${freqText(r)}</td>
      <td>${label(r.priority)}</td>
      <td class="num">${moneyRange(r.est_cost_low, r.est_cost_high)}</td>
      <td class="small">${r.market_name ? esc(r.market_name) : 'all markets'}
        ${r.home_vintage_before ? `<br>pre-${r.home_vintage_before} homes` : ''}
        ${r.applies_age_min_yrs != null ? `<br>age ≥ ${r.applies_age_min_yrs}` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" data-edit="${r.id}">Edit</button>
        <button class="btn btn-sm btn-danger" data-off="${r.id}">Deactivate</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${inactive.length ? `<div class="section"><div class="section-head"><h2>Deactivated rules</h2>
    <span class="small muted">preserved forever — business rule #7</span></div>
    <div class="card card-pad">${inactive.map((r) => `<div class="item-line">
      <span class="badge b-muted">inactive</span> ${esc(r.task_name)} <span class="chip">${esc(r.system_category)}</span>
      <span class="right"><button class="btn btn-sm" data-on="${r.id}">Reactivate</button></span></div>`).join('')}</div></div>` : ''}`;

  $('#rule-add', view).addEventListener('click', () => ruleModal(null, () => renderRules(view)));
  $('#engine-run', view).addEventListener('click', async () => {
    const r = await api('/api/rules/recompute', { method: 'POST' });
    toast(`Engine ran on ${r.properties} properties — ${r.created} new item(s) generated`);
  });
  for (const b of $$('[data-edit]', view)) {
    b.addEventListener('click', () => ruleModal(rules.find((r) => r.id === Number(b.dataset.edit)), () => renderRules(view)));
  }
  for (const b of $$('[data-off]', view)) {
    b.addEventListener('click', async () => {
      const rule = rules.find((r) => r.id === Number(b.dataset.off));
      const preview = await api('/api/rules/preview', { method: 'POST', body: rule });
      if (!confirm(`Deactivate "${rule.task_name}"?\n\nThis rule currently matches ${preview.properties} propert${preview.properties === 1 ? 'y' : 'ies'}. Existing schedule items stay; no new ones will generate.`)) return;
      await api(`/api/rules/${rule.id}`, { method: 'DELETE' });
      toast('Rule deactivated (never deleted)');
      renderRules(view);
    });
  }
  for (const b of $$('[data-on]', view)) {
    b.addEventListener('click', async () => {
      await api(`/api/rules/${b.dataset.on}`, { method: 'PATCH', body: { active: 1 } });
      toast('Rule reactivated');
      renderRules(view);
    });
  }
}

function ruleModal(existing, done) {
  const meta = state.meta;
  const m = modal(existing ? `Edit rule — ${existing.task_name}` : 'New maintenance rule', `
    <div class="form-grid">
      <div class="span2">${field('task_name', 'Task name', input(`value="${esc(existing?.task_name || '')}"`))}</div>
      ${field('system_category', 'System category (join key — §3.3)', select(meta.categories.map((c) =>
        ({ value: c, label: c, selected: existing?.system_category === c }))))}
      ${field('frequency_type', 'Frequency type', select(['recurring_annual', 'recurring_seasonal', 'recurring_monthly',
        'recurring_custom', 'age_based', 'one_time_at_intake', 'one_time_at_install', 'condition_triggered']
        .map((f) => ({ value: f, label: f.replace(/_/g, ' '), selected: existing?.frequency_type === f }))))}
      ${field('frequency_value', 'Frequency value', input(`type="number" step="0.5" value="${existing?.frequency_value ?? ''}" data-number`))}
      ${field('frequency_unit', 'Frequency unit', select([{ value: '', label: '—' }, ...['days', 'months', 'years']
        .map((u) => ({ value: u, label: u, selected: existing?.frequency_unit === u }))]))}
      ${field('seasonal_timing', 'Seasonal timing', select([{ value: '', label: '—' }, ...['spring', 'fall', 'spring_and_fall', 'winter', 'summer']
        .map((s) => ({ value: s, label: label(s), selected: existing?.seasonal_timing === s }))]))}
      ${field('priority', 'Priority', select(['urgent', 'standard', 'planning'].map((p) => ({ value: p, label: p, selected: existing?.priority === p }))))}
      ${field('est_cost_low', 'Est. cost low ($)', input(`type="number" value="${existing?.est_cost_low ?? ''}" data-number`))}
      ${field('est_cost_high', 'Est. cost high ($)', input(`type="number" value="${existing?.est_cost_high ?? ''}" data-number`))}
      ${field('lead_time_days', 'Lead time (days)', input(`type="number" value="${existing?.lead_time_days ?? 30}" data-number`))}
      ${field('condition_threshold', 'Condition threshold (for condition-triggered)', input(`type="number" min="1" max="5" value="${existing?.condition_threshold ?? ''}" data-number`))}
      ${field('applies_age_min_yrs', 'Applies from system age (yrs)', input(`type="number" value="${existing?.applies_age_min_yrs ?? ''}" data-number`))}
      ${field('applies_age_max_yrs', 'Up to system age (yrs)', input(`type="number" value="${existing?.applies_age_max_yrs ?? ''}" data-number`))}
      ${field('home_vintage_before', 'Homes built before (year)', input(`type="number" value="${existing?.home_vintage_before ?? ''}" data-number`))}
      ${field('market_id', 'Market scope', select([{ value: '', label: 'All markets' },
        ...meta.markets.map((mk) => ({ value: mk.id, label: mk.name, selected: existing?.market_id === mk.id }))], 'data-number'))}
      <label class="checkbox-row"><input type="checkbox" name="capital_forecast_item" ${existing?.capital_forecast_item ? 'checked' : ''}> Capital forecast item</label>
      <label class="checkbox-row"><input type="checkbox" name="specialist_required" ${existing?.specialist_required ? 'checked' : ''}> Specialist required</label>
      <div class="span2">${field('advisor_talking_points', 'Advisor talking points — the client-facing language', textarea(`rows="2"`))}</div>
      <div class="span2">${field('rule_source', 'Rule source', input(`value="${esc(existing?.rule_source || '')}" placeholder="ASHRAE guideline, Steward field data…"`))}</div>
    </div>
    <div class="notice" id="preview-box">Propagation preview: <b id="preview-n">…</b></div>
    <div class="form-actions"><button class="btn btn-primary" id="rule-save">${existing ? 'Save rule' : 'Create rule'}</button></div>`,
    { wide: true });
  if (existing) $('[name=advisor_talking_points]', m.body).value = existing.advisor_talking_points || '';

  async function updatePreview() {
    const body = formValues(m.body);
    if (!body.system_category) return;
    try {
      const pv = await api('/api/rules/preview', { method: 'POST', body });
      $('#preview-n', m.body).textContent =
        `this rule matches ${pv.properties} propert${pv.properties === 1 ? 'y' : 'ies'} (${pv.systems} system records)`;
    } catch { /* preview is best-effort */ }
  }
  updatePreview();
  for (const el of $$('[name=system_category],[name=market_id],[name=applies_age_min_yrs],[name=applies_age_max_yrs],[name=home_vintage_before]', m.body)) {
    el.addEventListener('change', updatePreview);
  }
  $('#rule-save', m.body).addEventListener('click', async () => {
    const body = formValues(m.body);
    if (!body.task_name || !body.system_category || !body.frequency_type) return toast('Task name, category, frequency required', 'err');
    try {
      if (existing) await api(`/api/rules/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/rules', { method: 'POST', body });
      toast('Rule saved — it now applies to every matching property');
      m.close(); done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── Network health (US-F3) ────────────────────────────────────────────────
export async function renderNetwork(view, _m, _s, marketId = '') {
  const d = await api(`/api/founder/network${marketId ? `?market_id=${marketId}` : ''}`);
  const mf = marketFilter(marketId, (v) => renderNetwork(view, _m, _s, v));
  const maxVol = Math.max(1, ...d.volumeByTrade.map((t) => t.job_value));

  view.innerHTML = `
  <div class="page-head"><div><h1>Network Health</h1>
    <div class="sub">Surface network risk before it becomes client-facing</div></div>
    <div class="actions">${mf.html}</div></div>

  <div class="grid g2">
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:10px">Credential risk — action needed</h2>
      ${d.expiring.map((c) => `<div class="item-line" style="align-items:flex-start">
        <span class="badge ${!c.insurance_on_file || !c.license_current ? 'b-critical' : 'b-serious'}">
          ${!c.insurance_on_file ? '■ no insurance' : !c.license_current ? '■ license lapsed' : '▲ expiring'}</span>
        <div><b>${esc(c.company_name)}</b> <span class="small muted">${esc(c.market_name)}</span><br>
          <span class="small muted">
            ${c.license_expiry ? `license to ${fmtDate(c.license_expiry)}` : ''}
            ${c.insurance_expiry ? ` · insurance to ${fmtDate(c.insurance_expiry)}` : ''}
            ${!c.insurance_on_file ? ' · <b>no COI on file — referrals blocked</b>' : ''}</span></div>
      </div>`).join('') || empty('All credentials current and outside the 90-day window.')}
    </div>
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:10px">Complaint flags & probation</h2>
      ${d.flagged.map((c) => `<div class="item-line">
        ${statusBadge(c.status)}
        <div><b>${esc(c.company_name)}</b> <span class="small muted">${esc(c.market_name)}</span><br>
          <span class="small ${c.complaints >= 3 ? '' : 'muted'}" ${c.complaints >= 3 ? 'style="color:var(--critical-text)"' : ''}>
            ${c.complaints} complaint flag(s) · avg rating ${c.avg_rating ?? '—'}
            ${c.complaints >= 3 ? ' — <b>network review required</b>' : ''}</span></div>
      </div>`).join('') || empty('No complaint flags in the network.')}
    </div>
  </div>

  <div class="grid g2 section">
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:12px">Referral volume by trade</h2>
      ${d.volumeByTrade.map((t) => `<div class="hbar-row">
        <span class="small">${esc(t.trade)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((t.job_value / maxVol) * 100)}%"></div></div>
        <span class="hbar-val">${money(t.job_value)}</span>
      </div>`).join('') || empty('No referral volume yet.')}
    </div>
    <div class="card card-pad">
      <h2 class="serif" style="margin-bottom:10px">Recent ratings</h2>
      ${d.recentRatings.slice(0, 8).map((r) => `<div class="item-line">
        ${stars(r.score)} <b>${esc(r.company_name)}</b>
        ${r.complaint_flag ? '<span class="badge b-critical">▲ complaint</span>' : ''}
        <span class="right small muted">${fmtDate(r.rating_date)}</span>
      </div>`).join('') || empty('No ratings yet.')}
    </div>
  </div>`;
  mf.bind(view);
}
