// The Rules Engine (§3.4). Three steps: match rules to systems, calculate due
// dates, write Forward Schedule items. Runs automatically on system
// create/update and on demand ("recompute"); idempotent — an open item
// generated from the same rule+system is never duplicated.

const { open, audit, today } = require('./db');

const DAY = 24 * 60 * 60 * 1000;

function addYears(dateStr, years) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const days = Math.round(years * 365.25);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

function addUnits(dateStr, value, unit) {
  if (unit === 'years') return addYears(dateStr, value);
  const d = new Date(dateStr + 'T00:00:00Z');
  const days = unit === 'months' ? Math.round(value * 30.44) : value;
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

// Age of a system in years, from install_date or age_at_intake + intake_date.
function systemAgeYears(system, property, asOf = today()) {
  const now = new Date(asOf + 'T00:00:00Z').getTime();
  if (system.install_date) {
    return (now - new Date(system.install_date + 'T00:00:00Z').getTime()) / (365.25 * DAY);
  }
  if (system.age_at_intake != null && property.intake_date) {
    const sinceIntake = (now - new Date(property.intake_date + 'T00:00:00Z').getTime()) / (365.25 * DAY);
    return system.age_at_intake + sinceIntake;
  }
  return null;
}

function remainingLife(system, property) {
  if (system.expected_lifespan == null) return null;
  const age = systemAgeYears(system, property);
  if (age == null) return null;
  return Math.round((system.expected_lifespan - age) * 10) / 10;
}

// Next occurrence of a season's anchor date on/after `from`.
const SEASON_ANCHORS = { spring: '04-15', fall: '10-01', winter: '01-15', summer: '07-01' };
function nextSeasonal(timing, from) {
  const seasons = timing === 'spring_and_fall' ? ['spring', 'fall'] : [timing];
  const year = Number(from.slice(0, 4));
  const candidates = [];
  for (const s of seasons) {
    for (const y of [year, year + 1]) candidates.push(`${y}-${SEASON_ANCHORS[s]}`);
  }
  return candidates.filter((c) => c >= from).sort()[0];
}

function dueWindowFor(dueDate, asOf = today()) {
  if (!dueDate) return null;
  const days = (new Date(dueDate + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / DAY;
  if (days <= 30) return '30d';
  if (days <= 90) return '90d';
  if (days <= 180) return '180d';
  if (days <= 365) return '1yr';
  if (days <= 730) return '2yr';
  if (days <= 5 * 365) return '3_5yr';
  return '5yr_plus';
}

// Step 1 — match: active rules whose category, age scoping, vintage scoping,
// and market scoping all apply to this system.
function matchRules(db, system, property) {
  const rules = db.prepare(
    `SELECT * FROM maintenance_rules
     WHERE active = 1 AND system_category = ?
       AND (market_id IS NULL OR market_id = ?)`
  ).all(system.category, property.market_id);

  const age = systemAgeYears(system, property);
  return rules.filter((r) => {
    if (r.applies_age_min_yrs != null && (age == null || age < r.applies_age_min_yrs)) return false;
    if (r.applies_age_max_yrs != null && (age == null || age > r.applies_age_max_yrs)) return false;
    if (r.home_vintage_before != null && (property.year_built == null || property.year_built >= r.home_vintage_before)) return false;
    return true;
  });
}

// For recurring rules whose anchor is far in the past (an old install date,
// never serviced), surface only the most recent missed occurrence — "the
// annual service was due in May", never "due 14 years ago".
function advanceRecurrence(base, value, unit, t) {
  let due = addUnits(base, value, unit);
  let guard = 0;
  while (due < t && guard++ < 600) {
    const next = addUnits(due, value, unit);
    if (next > t) break; // `due` is the most recent missed occurrence
    due = next;
  }
  return due;
}

// Step 2 — calculate the next due date for a rule applied to a system.
// Returns null when the rule doesn't currently produce an item.
function calcDueDate(rule, system, property) {
  const t = today();
  const base = system.last_service_date || system.install_date || property.intake_date || t;

  switch (rule.frequency_type) {
    case 'recurring_annual':
      return advanceRecurrence(base, 1, 'years', t);
    case 'recurring_monthly':
      return advanceRecurrence(base, rule.frequency_value || 1, 'months', t);
    case 'recurring_custom':
      return advanceRecurrence(base, rule.frequency_value || 1, rule.frequency_unit || 'months', t);
    case 'recurring_seasonal':
      return nextSeasonal(rule.seasonal_timing || 'spring', t);
    case 'age_based': {
      // End-of-life planning: due when the system exhausts expected lifespan.
      if (!system.expected_lifespan) return null;
      const age = systemAgeYears(system, property);
      if (age == null) return null;
      const yearsLeft = system.expected_lifespan - age;
      return yearsLeft <= 0 ? t : addYears(t, yearsLeft);
    }
    case 'one_time_at_intake':
      return property.intake_date || t;
    case 'one_time_at_install':
      return system.install_date || t;
    case 'condition_triggered':
      // Regardless of schedule: fires the moment condition drops to threshold.
      if (rule.condition_threshold != null && system.condition_rating != null
          && system.condition_rating <= rule.condition_threshold) return t;
      return null;
    default:
      return null;
  }
}

// Step 3 — write Forward Schedule items for one property. Skips rule+system
// pairs that already have an open (upcoming/scheduled) or completed one-time
// item. Returns the number of items created.
function generateForProperty(propertyId, actor = { kind: 'system', id: null }) {
  const db = open();
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) return { created: 0 };
  const systems = db.prepare('SELECT * FROM systems WHERE property_id = ?').all(propertyId);
  let created = 0;

  const insert = db.prepare(
    `INSERT INTO forward_schedule
       (item_name, property_id, system_id, due_date, due_window, priority, status,
        est_cost_low, est_cost_high, capital_forecast_item, deferral_risk, advisor_notes, source_rule_id)
     VALUES (?,?,?,?,?,?,'upcoming',?,?,?,?,?,?)`
  );

  for (const system of systems) {
    for (const rule of matchRules(db, system, property)) {
      const dueDate = calcDueDate(rule, system, property);
      if (!dueDate) continue;

      const openItem = db.prepare(
        `SELECT id FROM forward_schedule
         WHERE property_id = ? AND system_id = ? AND source_rule_id = ?
           AND status IN ('upcoming','scheduled')`
      ).get(propertyId, system.id, rule.id);
      if (openItem) continue;

      // One-time rules never regenerate after any completion.
      if (rule.frequency_type.startsWith('one_time')) {
        const done = db.prepare(
          `SELECT id FROM forward_schedule
           WHERE property_id = ? AND system_id = ? AND source_rule_id = ? AND status = 'completed'`
        ).get(propertyId, system.id, rule.id);
        if (done) continue;
      }

      // Condition-triggered items don't re-fire while a recent completion
      // exists at the same (still-low) condition.
      if (rule.frequency_type === 'condition_triggered') {
        const recent = db.prepare(
          `SELECT id FROM forward_schedule
           WHERE property_id = ? AND system_id = ? AND source_rule_id = ?
             AND status IN ('completed','deferred')`
        ).get(propertyId, system.id, rule.id);
        if (recent) continue;
      }

      const priority = rule.frequency_type === 'condition_triggered' ? 'urgent' : rule.priority;
      insert.run(
        rule.task_name, propertyId, system.id, dueDate, dueWindowFor(dueDate), priority,
        rule.est_cost_low, rule.est_cost_high, rule.capital_forecast_item,
        rule.advisor_talking_points, null, rule.id
      );
      created++;
    }
  }

  if (created > 0) {
    audit(actor.kind, actor.id, 'rules_recompute', 'forward_schedule', propertyId,
      `generated ${created} item(s) for property ${propertyId}`);
  }
  return { created };
}

// Nightly-style recompute across all active properties (also exposed via API).
function recomputeAll(actor = { kind: 'system', id: null }) {
  const db = open();
  const props = db.prepare('SELECT id FROM properties WHERE active = 1').all();
  let created = 0;
  for (const p of props) created += generateForProperty(p.id, actor).created;
  return { properties: props.length, created };
}

// How many properties an (edited) rule would touch — the propagation preview
// shown in the founder's Rules Manager ("this change affects 34 properties").
function propagationPreview(rule) {
  const db = open();
  const rows = db.prepare(
    `SELECT s.*, p.id AS pid, p.year_built, p.intake_date, p.market_id
     FROM systems s JOIN properties p ON p.id = s.property_id
     WHERE p.active = 1 AND s.category = ?
       AND (? IS NULL OR p.market_id = ?)`
  ).all(rule.system_category, rule.market_id ?? null, rule.market_id ?? null);

  const affected = new Set();
  for (const row of rows) {
    const property = { id: row.pid, year_built: row.year_built, intake_date: row.intake_date, market_id: row.market_id };
    const age = systemAgeYears(row, property);
    if (rule.applies_age_min_yrs != null && (age == null || age < rule.applies_age_min_yrs)) continue;
    if (rule.applies_age_max_yrs != null && (age == null || age > rule.applies_age_max_yrs)) continue;
    if (rule.home_vintage_before != null && (property.year_built == null || property.year_built >= rule.home_vintage_before)) continue;
    affected.add(row.pid);
  }
  return { properties: affected.size, systems: rows.length };
}

// Warranty posture for equipment/systems: 'expired', 'expiring' (≤90 days),
// 'active', or null when no warranty is recorded. Reminder-only by design —
// warranties never generate Forward Schedule items.
function warrantyStatus(expiry, asOf = today()) {
  if (!expiry) return null;
  if (expiry < asOf) return 'expired';
  const days = (new Date(expiry + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / DAY;
  return days <= 90 ? 'expiring' : 'active';
}

module.exports = {
  generateForProperty, recomputeAll, propagationPreview,
  remainingLife, systemAgeYears, dueWindowFor, warrantyStatus,
};
