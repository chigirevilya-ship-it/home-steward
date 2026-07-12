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

function buildPrompt(payload, property) {
  const facts = [
    `Kind: ${payload.kind === 'equipment' ? 'a piece of equipment' : 'a home system'}`,
    payload.name && `Name: ${payload.name}`,
    payload.category && `Category: ${payload.category}`,
    payload.make && `Make: ${payload.make}`,
    payload.model_number && `Model: ${payload.model_number}`,
    payload.install_date && `Installed: ${payload.install_date}`,
    payload.age_at_intake != null && `Approximate age: ${payload.age_at_intake} years`,
    payload.expected_lifespan != null && `Expected lifespan: ${payload.expected_lifespan} years`,
    property?.year_built && `Home built: ${property.year_built}`,
    property?.city && `Location: ${property.city}, ${property.state ?? ''}`,
    property?.property_type && `Home type: ${String(property.property_type).replace(/_/g, ' ')}`,
  ].filter(Boolean).join('\n');

  return `You are the maintenance engine of a home-record app. A homeowner is documenting the following item in their home record:

${facts}

Suggest (1) a concise description for the record and (2) the maintenance tasks a diligent homeowner should put on their schedule for this specific item, considering its age, type, and climate/region. Practical homeowner-level tasks only — no commercial/industrial procedures.`;
}

async function suggestViaClaude(payload, property) {
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
        messages: [{ role: 'user', content: buildPrompt(payload, property) }],
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

// Fallback: match the built-in rule library by category, and template a
// description from the facts we have. Deterministic, instant, no network.
function suggestViaRules(payload, property) {
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

async function suggest(payload, property) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await suggestViaClaude(payload, property);
    } catch (err) {
      console.error('[suggest] Claude API failed, falling back to rule library:', err.message);
      return { ...suggestViaRules(payload, property), fallback_reason: 'ai_unavailable' };
    }
  }
  return suggestViaRules(payload, property);
}

module.exports = { suggest };
