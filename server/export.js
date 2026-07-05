// Home Record export (US-C6/C7, §8 "Export fidelity"). Server-rendered,
// print-optimized HTML — open it and print to PDF from any browser. The
// content is the client-visible record: it uses the same sanitized builder
// as the portal, so internal notes can never leak into an export.

const { buildPortalRecord } = require('./portal');
const { TIERS } = require('./vocab');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const moneyRange = (lo, hi) => lo == null && hi == null ? '—' : (!lo && !hi) ? 'no cost' : `${money(lo)}–${money(hi)}`;
const fmtDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
};
const stars = (n) => n == null ? '—' : '★'.repeat(n) + '☆'.repeat(5 - n);
const enumLabel = (s) => s ? s.replace(/_/g, ' ') : '—';

function renderHomeRecord(client, property) {
  const r = buildPortalRecord(client, property);
  const p = r.property;
  const address = `${p.address_line1}${p.address_line2 ? ', ' + p.address_line2 : ''}, ${p.city}, ${p.state} ${p.zip}`;

  const openItems = r.schedule.filter((i) => ['upcoming', 'scheduled'].includes(i.status) || i.overdue);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Home Record — ${esc(address)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 15px/1.55 Georgia, 'Times New Roman', serif; color: #23211c; background: #fff; max-width: 860px; margin: 0 auto; padding: 40px 24px; }
  header { border-bottom: 3px double #23211c; padding-bottom: 20px; margin-bottom: 28px; }
  .brand { font: 700 13px/1 system-ui, sans-serif; letter-spacing: .28em; text-transform: uppercase; color: #6b6455; margin-bottom: 14px; }
  h1 { font-size: 30px; font-weight: 400; letter-spacing: .01em; }
  .sub { font: 13px/1.5 system-ui, sans-serif; color: #6b6455; margin-top: 6px; }
  h2 { font-size: 19px; font-weight: 400; border-bottom: 1px solid #d8d3c4; padding-bottom: 6px; margin: 34px 0 14px; }
  h2 .n { font: 12px system-ui, sans-serif; color: #a39a85; letter-spacing: .12em; margin-right: 10px; }
  p.narrative { font-style: italic; font-size: 16px; color: #3a372f; }
  table { width: 100%; border-collapse: collapse; font: 13px/1.5 system-ui, sans-serif; margin-top: 8px; }
  th { text-align: left; font-weight: 600; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6b6455; border-bottom: 1.5px solid #23211c; padding: 6px 10px 6px 0; }
  td { border-bottom: 1px solid #e6e1d4; padding: 7px 10px 7px 0; vertical-align: top; }
  tr { break-inside: avoid; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 24px; font: 13px/1.45 system-ui, sans-serif; }
  .facts b { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6b6455; font-weight: 600; }
  .badge { font: 600 10px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; border: 1px solid currentColor; border-radius: 3px; padding: 2px 6px; white-space: nowrap; }
  .badge.gap { color: #9a3324; }
  .badge.overdue { color: #9a3324; }
  .muted { color: #8a8272; }
  footer { margin-top: 44px; padding-top: 14px; border-top: 1px solid #d8d3c4; font: 11px/1.6 system-ui, sans-serif; color: #8a8272; }
  .disclaimer { margin-top: 6px; font-style: italic; }
  @media print { body { padding: 0; } .no-print { display: none; } }
  .no-print { position: fixed; top: 16px; right: 16px; font: 13px system-ui, sans-serif; }
  .no-print button { padding: 8px 16px; cursor: pointer; }
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
<header>
  <div class="brand">Steward · Home Record</div>
  <h1>${esc(address)}</h1>
  <div class="sub">
    Prepared for ${esc(r.client.first_name)} ${esc(r.client.last_name)} · ${esc(r.tier_label)} member${r.client.charter_member ? ' · Charter member' : ''}
    · Advisor: ${esc(r.advisor?.full_name || '—')} · Exported ${fmtDate(r.today)} · Record ${p.record_completeness}% complete
  </div>
</header>

<section>
  <h2><span class="n">01</span>The Home</h2>
  ${p.narrative_summary ? `<p class="narrative">${esc(p.narrative_summary)}</p>` : ''}
  <div class="facts" style="margin-top:16px">
    <div><b>Built</b>${p.year_built ?? '—'}</div>
    <div><b>Type</b>${enumLabel(p.property_type)}</div>
    <div><b>Size</b>${p.square_footage ? p.square_footage.toLocaleString() + ' sq ft' : '—'}</div>
    <div><b>Stories</b>${p.stories ?? '—'}</div>
    <div><b>Bedrooms</b>${p.bedrooms ?? '—'}</div>
    <div><b>Bathrooms</b>${p.bathrooms ?? '—'}</div>
    <div><b>Construction</b>${enumLabel(p.construction_type)}</div>
    <div><b>Foundation</b>${enumLabel(p.foundation_type)}</div>
    <div><b>Owned since</b>${fmtDate(p.ownership_date)}</div>
    <div><b>Steward intake</b>${fmtDate(p.intake_date)}</div>
    <div><b>Permit jurisdiction</b>${esc(p.permit_jurisdiction || '—')}</div>
  </div>
</section>

<section>
  <h2><span class="n">02</span>Systems Inventory <span class="muted" style="font-size:13px">(${r.systems.length} systems, sorted by remaining life)</span></h2>
  <table>
    <thead><tr><th>System</th><th>Category</th><th>Installed</th><th>Condition</th><th>Expected life</th><th>Remaining</th></tr></thead>
    <tbody>
    ${r.systems.map((s) => `<tr>
      <td><strong>${esc(s.system_name)}</strong>${s.description ? `<br><span class="muted">${esc(s.description)}</span>` : ''}</td>
      <td>${esc(s.category)}</td>
      <td>${s.install_date ? fmtDate(s.install_date) : (s.age_years != null ? `~${Math.round(s.age_years)} yrs old` : '—')}</td>
      <td>${stars(s.condition_rating)}</td>
      <td>${s.expected_lifespan ? s.expected_lifespan + ' yrs' : '—'}</td>
      <td>${s.remaining_life == null ? '—' : (s.remaining_life <= 0 ? 'at end of life' : s.remaining_life + ' yrs')}</td>
    </tr>`).join('')}
    </tbody>
  </table>
</section>

<section>
  <h2><span class="n">03</span>Forward Maintenance Schedule <span class="muted" style="font-size:13px">(${openItems.length} open items)</span></h2>
  <table>
    <thead><tr><th>Item</th><th>System</th><th>Due</th><th>Priority</th><th>Est. cost</th></tr></thead>
    <tbody>
    ${openItems.map((i) => `<tr>
      <td><strong>${esc(i.item_name)}</strong>${i.deferral_risk ? `<br><span class="muted">${esc(i.deferral_risk)}</span>` : ''}</td>
      <td>${esc(i.system_name || '—')}</td>
      <td>${fmtDate(i.due_date)} ${i.overdue ? '<span class="badge overdue">overdue</span>' : ''}</td>
      <td>${enumLabel(i.priority)}</td>
      <td>${moneyRange(i.est_cost_low, i.est_cost_high)}</td>
    </tr>`).join('')}
    </tbody>
  </table>
</section>

${r.forecast_eligible && r.forecast?.length ? `
<section>
  <h2><span class="n">04</span>Five-Year Capital Forecast</h2>
  <table>
    <thead><tr><th>System</th><th>Item</th><th>Est. year</th><th>Cost range</th></tr></thead>
    <tbody>
    ${r.forecast.map((f) => `<tr>
      <td>${esc(f.system_name || '—')}</td><td>${esc(f.item_name)}</td>
      <td>${f.est_year ?? '—'}</td><td>${money(f.est_cost_low)}–${money(f.est_cost_high)}</td>
    </tr>`).join('')}
    </tbody>
  </table>
</section>` : ''}

<section>
  <h2><span class="n">${r.forecast_eligible && r.forecast?.length ? '05' : '04'}</span>Maintenance History</h2>
  <table>
    <thead><tr><th>Date</th><th>Work performed</th><th>Contractor</th><th>Invoice</th></tr></thead>
    <tbody>
    ${r.log.map((l) => `<tr>
      <td style="white-space:nowrap">${fmtDate(l.date)}</td>
      <td>${esc(l.description)}${l.outcome_notes ? `<br><span class="muted">${esc(l.outcome_notes)}</span>` : ''}</td>
      <td>${esc(l.contractor_name || '—')}</td>
      <td>${money(l.invoice_amount)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">No logged work yet.</td></tr>'}
    </tbody>
  </table>
</section>

<section>
  <h2><span class="n">${r.forecast_eligible && r.forecast?.length ? '06' : '05'}</span>Permit History</h2>
  <table>
    <thead><tr><th>Permit</th><th>Type</th><th>Filed</th><th>Status</th><th>Scope</th></tr></thead>
    <tbody>
    ${r.permits.map((pm) => `<tr>
      <td style="white-space:nowrap">${esc(pm.permit_number || '—')} ${pm.gap_flag ? '<span class="badge gap">gap flag</span>' : ''}</td>
      <td>${enumLabel(pm.permit_type)}</td>
      <td>${fmtDate(pm.date_filed)}</td>
      <td>${enumLabel(pm.status)}</td>
      <td>${esc(pm.scope_description || '')}${pm.gap_notes ? `<br><span class="muted">${esc(pm.gap_notes)}</span>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">No permits researched yet.</td></tr>'}
    </tbody>
  </table>
</section>

<footer>
  <div>This Home Record is the property of ${esc(r.client.first_name)} ${esc(r.client.last_name)} and is exportable in full at any time — including on cancellation. ${esc(r.fee_disclosure)}</div>
  <div class="disclaimer">${esc(r.disclaimer)}</div>
  <div style="margin-top:8px">Steward Home Advisory · ${TIERS[r.client.tier]?.label || ''} membership · Generated ${fmtDate(r.today)}</div>
</footer>
</body>
</html>`;
}

module.exports = { renderHomeRecord };
