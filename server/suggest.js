// AI suggestions for systems and equipment (self-serve): a proposed
// maintenance schedule and a drafted description. Powered by the Claude API
// when ANTHROPIC_API_KEY is set; otherwise falls back to matching the
// built-in maintenance-rule library. The app stays fully functional with no
// key — the button just returns rule-based suggestions instead.
//
// Uses Node's built-in fetch rather than the Anthropic SDK deliberately:
// this project ships with zero npm dependencies (no `npm install` anywhere
// in the deployment), and this is its single optional external call.

const { open } = require('./db');
const { SYSTEM_CATEGORIES } = require('./vocab');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.STEWARD_AI_MODEL || 'claude-opus-4-8';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A 1-2 sentence factual description of this system/equipment for a home record: what it is, key characteristics, anything a future owner should know. No marketing language.',
    },
    tasks: {
      type: 'array',
      description: 'Recommended recurring maintenance tasks a homeowner should schedule, most important first. 2-6 tasks.',
      items: {
        type: 'object',
        properties: {
          task_name: { type: 'string', description: 'Short imperative task name, e.g. "Annual burner service"' },
          interval_months: { type: 'integer', description: 'Repeat interval in months (12 = yearly, 0 = one-time)' },
          priority: { type: 'string', enum: ['urgent', 'standard', 'planning'] },
          note: { type: 'string', description: 'One sentence: why this matters or what happens if skipped' },
          est_cost_low: { type: 'integer', description: 'Rough low-end professional cost in USD, 0 if DIY' },
          est_cost_high: { type: 'integer', description: 'Rough high-end professional cost in USD' },
        },
        required: ['task_name', 'interval_months', 'priority', 'note', 'est_cost_low', 'est_cost_high'],
        additionalProperties: false,
      },
    },
  },
  required: ['description', 'tasks'],
  additionalProperties: false,
};

const norm = (s) => String(s || '').trim().toLowerCase();

// A stable "profile" for an item so the fleet signal groups like with like:
// category is the primary key, make refines it (a Rheem water heater learns
// from other Rheem water heaters first, then water heaters in general).
function profileKey(payload) {
  const kind = payload.kind === 'equipment' ? 'equipment' : 'system';
  const base = `${kind}:${norm(payload.category) || 'unknown'}`;
  return payload.make ? `${base}|${norm(payload.make)}` : base;
}

// What the rest of the fleet does with items like this one. Two signals, in
// order of trust: (a) accepted suggestions (suggestion_feedback) — a homeowner
// chose to keep these; (b) tasks currently on schedule for same-category items
// across every home. Aggregate counts only — no per-home data leaves here.
function fleetContext(db, payload) {
  const kind = payload.kind === 'equipment' ? 'equipment' : 'system';
  const cat = payload.category || null;
  const out = { similar_homes: 0, common_tasks: [], from_feedback: false };
  if (!cat) return out;

  const homesRow = kind === 'equipment'
    ? db.prepare(`SELECT COUNT(DISTINCT e.property_id) n FROM equipment e
                    JOIN systems s ON s.id = e.system_id WHERE s.category = ?`).get(cat)
    : db.prepare('SELECT COUNT(DISTINCT property_id) n FROM systems WHERE category = ?').get(cat);
  out.similar_homes = homesRow?.n || 0;

  // Prefer the accepted-suggestion signal when we have any.
  const fb = db.prepare(
    `SELECT MIN(task_name) task_name, COUNT(DISTINCT property_id) homes,
            CAST(ROUND(AVG(interval_months)) AS INTEGER) interval_months,
            MIN(priority) priority
       FROM suggestion_feedback
      WHERE profile_key = ? OR (category = ? AND kind = ?)
      GROUP BY LOWER(task_name)
      ORDER BY homes DESC, task_name LIMIT 8`).all(profileKey(payload), cat, kind);
  if (fb.length) { out.common_tasks = fb; out.from_feedback = true; return out; }

  // Otherwise, what same-category systems fleet-wide keep on their schedules.
  out.common_tasks = db.prepare(
    `SELECT MIN(f.item_name) task_name, COUNT(DISTINCT f.property_id) homes
       FROM forward_schedule f JOIN systems s ON s.id = f.system_id
      WHERE s.category = ?
      GROUP BY LOWER(f.item_name)
      ORDER BY homes DESC, task_name LIMIT 8`).all(cat);
  return out;
}

// Small, UI-facing provenance for the suggestion panel.
const fleetSummary = (fleet) => ({
  similar_homes: fleet.similar_homes || 0,
  from_feedback: !!fleet.from_feedback,
  task_count: (fleet.common_tasks || []).length,
});

function buildPrompt(payload, property, related = {}, fleet = {}) {
  const facts = [
    `Kind: ${payload.kind === 'equipment' ? 'a piece of equipment' : 'a home system'}`,
    payload.name && `Name: ${payload.name}`,
    payload.category && `Category: ${payload.category}`,
    payload.make && `Make: ${payload.make}`,
    payload.model_number && `Model: ${payload.model_number}`,
    payload.install_date && `Installed: ${payload.install_date}`,
    payload.age_at_intake != null && `Approximate age: ${payload.age_at_intake} years`,
    payload.expected_lifespan != null && `Expected lifespan: ${payload.expected_lifespan} years`,
    payload.warranty_expiry && `Warranty until: ${payload.warranty_expiry}`,
    payload.last_service_date && `Last serviced: ${payload.last_service_date}`,
    payload.condition_rating != null && `Current condition (1 worst – 5 best): ${payload.condition_rating}`,
    payload.description && `Owner's existing note: ${payload.description}`,
    property?.year_built && `Home built: ${property.year_built}`,
    property?.city && `Location: ${property.city}, ${property.state ?? ''}`,
    property?.property_type && `Home type: ${String(property.property_type).replace(/_/g, ' ')}`,
  ].filter(Boolean).join('\n');

  // The item's own surrounding context (Q2): components, documents, history,
  // and what's already scheduled — so advice reflects the whole picture.
  const ctx = [];
  if (related.equipment?.length) {
    ctx.push('Components / equipment inside this system:\n' + related.equipment.map((e) => {
      const spec = [e.make, e.model_number].filter(Boolean).join(' ');
      return `- ${e.name}${spec ? ` (${spec})` : ''}${e.install_date ? `, installed ${e.install_date}` : ''}`;
    }).join('\n'));
  }
  if (related.documents?.length) {
    ctx.push('Documents already on file (do not tell them to obtain what they already have): '
      + related.documents.map((d) => `${d.document_type} “${d.document_name}”`).join(', '));
  }
  if (related.history?.length) {
    ctx.push('Service history so far:\n' + related.history.map((h) => `- ${h.date}: ${h.description}`).join('\n'));
  }
  if (related.scheduled?.length) {
    ctx.push('Already on the homeowner’s schedule — DO NOT duplicate these:\n'
      + related.scheduled.map((s) => `- ${s.item_name}${s.due_date ? ` (due ${s.due_date})` : ''}`).join('\n'));
  }

  // Fleet norms (Q1): anchor to what comparable homes do, for consistency.
  const fleetBlock = fleet.common_tasks?.length
    ? `\nAcross the Steward network, ${fleet.similar_homes} home(s) have documented a comparable ${payload.category}. The tasks most commonly ${fleet.from_feedback ? 'kept from past suggestions' : 'on their schedules'} are:\n`
      + fleet.common_tasks.map((t) => `- ${t.task_name}${t.homes ? ` (${t.homes} home${t.homes === 1 ? '' : 's'})` : ''}${t.interval_months ? `, ~every ${t.interval_months} mo` : ''}`).join('\n')
      + `\nFavor these where appropriate so identical systems get consistent advice. Deviate only when this item’s specific context above justifies it.\n`
    : '';

  return `You are the maintenance engine of a home-record app. A homeowner is documenting the following item in their home record:

${facts}
${ctx.length ? '\n' + ctx.join('\n\n') + '\n' : ''}${fleetBlock}
Using ALL of the above — the item’s age and condition, its components, what has already been serviced, which documents exist, and the fleet norms — suggest (1) a concise description for the record and (2) the maintenance tasks a diligent homeowner should put on their schedule for this specific item. Never repeat a task that is already scheduled. Practical homeowner-level tasks only — no commercial/industrial procedures.`;
}

async function suggestViaClaude(payload, property, related, fleet) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
        messages: [{ role: 'user', content: buildPrompt(payload, property, related, fleet) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') {
      throw new Error(`Claude API stop_reason=${data.stop_reason}`);
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    return { source: 'ai', model: data.model, ...normalize(parsed) };
  } finally {
    clearTimeout(timer);
  }
}

// Fallback: match the built-in rule library by category, fold in the fleet
// signal so identical items still converge, and template a description from
// the facts we have. Deterministic, instant, no network.
function suggestViaRules(payload, property, fleet = {}) {
  const db = open();
  const category = SYSTEM_CATEGORIES.includes(payload.category) ? payload.category : null;
  let tasks = [];
  if (category) {
    const rules = db.prepare(
      `SELECT * FROM maintenance_rules WHERE active = 1 AND system_category = ?
         AND (market_id IS NULL OR market_id = ?)
         AND frequency_type IN ('recurring_annual','recurring_seasonal','recurring_monthly','recurring_custom')`
    ).all(category, property?.market_id ?? null);
    tasks = rules.map((r) => ({
      task_name: r.task_name,
      interval_months: r.frequency_type === 'recurring_annual' ? 12
        : r.frequency_type === 'recurring_seasonal' ? (r.seasonal_timing === 'spring_and_fall' ? 6 : 12)
        : r.frequency_unit === 'years' ? Math.round((r.frequency_value || 1) * 12)
        : r.frequency_unit === 'days' ? Math.max(1, Math.round((r.frequency_value || 30) / 30))
        : Math.round(r.frequency_value || 1),
      priority: r.priority,
      note: r.advisor_talking_points || '',
      est_cost_low: r.est_cost_low ?? 0,
      est_cost_high: r.est_cost_high ?? 0,
    }));
  }
  // Merge the fleet signal: append commonly-kept tasks the rule library didn't
  // already cover, so identical items converge even without an API key.
  const seen = new Set(tasks.map((t) => norm(t.task_name)));
  for (const f of fleet.common_tasks || []) {
    if (seen.has(norm(f.task_name))) continue;
    seen.add(norm(f.task_name));
    tasks.push({
      task_name: f.task_name,
      interval_months: f.interval_months || 12,
      priority: ['urgent', 'standard', 'planning'].includes(f.priority) ? f.priority : 'standard',
      note: f.homes ? `Commonly scheduled across ${f.homes} similar home${f.homes === 1 ? '' : 's'} in the network.` : '',
      est_cost_low: null, est_cost_high: null,
    });
  }
  const bits = [payload.make, payload.model_number].filter(Boolean).join(' ');
  const description = [
    payload.name || 'Item',
    bits ? `(${bits})` : null,
    payload.install_date ? `installed ${payload.install_date}` : payload.age_at_intake != null ? `~${payload.age_at_intake} years old` : null,
    payload.expected_lifespan != null ? `expected lifespan ~${payload.expected_lifespan} years` : null,
  ].filter(Boolean).join(', ') + '.';
  return { source: 'rules', description, tasks: tasks.slice(0, 6) };
}

function normalize(parsed) {
  return {
    description: String(parsed.description || '').slice(0, 1000),
    tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : []).slice(0, 8).map((t) => ({
      task_name: String(t.task_name || '').slice(0, 120),
      interval_months: Number.isFinite(t.interval_months) ? Math.max(0, Math.round(t.interval_months)) : 12,
      priority: ['urgent', 'standard', 'planning'].includes(t.priority) ? t.priority : 'standard',
      note: String(t.note || '').slice(0, 400),
      est_cost_low: Number.isFinite(t.est_cost_low) ? t.est_cost_low : null,
      est_cost_high: Number.isFinite(t.est_cost_high) ? t.est_cost_high : null,
    })).filter((t) => t.task_name),
  };
}

// Record which suggested tasks a homeowner accepted. This is the learning
// loop: it strengthens the fleet signal so the next comparable item is
// anchored to what real owners kept, not just a one-shot ask.
function recordFeedback(db, payload, tasks, source, clientId, propertyId) {
  const key = profileKey(payload);
  const kind = payload.kind === 'equipment' ? 'equipment' : 'system';
  const stmt = db.prepare(`INSERT INTO suggestion_feedback
    (profile_key, category, kind, make, task_name, interval_months, priority, source, client_id, property_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  let recorded = 0;
  for (const t of tasks || []) {
    if (!t || !t.task_name) continue;
    stmt.run(key, payload.category || null, kind, payload.make || null,
      String(t.task_name).slice(0, 120),
      Number.isFinite(t.interval_months) ? Math.round(t.interval_months) : null,
      ['urgent', 'standard', 'planning'].includes(t.priority) ? t.priority : 'standard',
      source === 'ai' ? 'ai' : 'rules', clientId ?? null, propertyId ?? null, now);
    recorded++;
  }
  return recorded;
}

async function suggest(payload, property, related = {}) {
  const fleet = fleetContext(open(), payload);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { ...(await suggestViaClaude(payload, property, related, fleet)), fleet: fleetSummary(fleet) };
    } catch (err) {
      console.error('[suggest] Claude API failed, falling back to rule library:', err.message);
      return { ...suggestViaRules(payload, property, fleet), fleet: fleetSummary(fleet), fallback_reason: 'ai_unavailable' };
    }
  }
  return { ...suggestViaRules(payload, property, fleet), fleet: fleetSummary(fleet) };
}

module.exports = { suggest, recordFeedback };
