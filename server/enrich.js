// Address enrichment (Track A — the Enhanced "Effortless" pillar). Given an
// address, draft a Home Record from public records: fetch permits, classify
// them into systems, and infer install dates from permit dates.
//
// Same graceful-degradation posture as suggest.js: it calls live civic APIs
// (US Census geocoder + Boston's CKAN open-data permits) when the network
// allows, and falls back to a bundled fixture of real-shaped Boston permit
// records so the entire flow stays testable/demoable offline and on
// locked-down deployments. The permit→system classifier is deterministic —
// it needs no network and no API key, and is the core of the pipeline.

const { SYSTEM_CATEGORIES } = require('./vocab');

// Boston "Approved Building Permits" CKAN datastore resource id. Confirm on
// deploy (data.boston.gov → dataset → API); the fixture path doesn't need it.
const BOSTON_RESOURCE_ID = '6ddcd912-32a0-43df-9908-63574f8c7e77';
const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// ── Deterministic permit → system classifier ───────────────────────────────
// Ordered most-specific-first; the first match wins. Categories come from the
// controlled vocabulary so the drafted systems drop straight into the schema
// and the rules engine. A permit that matches nothing is kept as a permit
// record with no system (e.g. a kitchen remodel is a project, not a system).
const CLASSIFY = [
  { re: /tankless/i, category: 'Water Heater - Tankless', name: 'Tankless water heater' },
  { re: /water heater|hot water heater|hot water tank|domestic hot water/i, category: 'Water Heater - Gas', name: 'Gas water heater' },
  { re: /mini.?split|ductless|heat pump/i, category: 'Mini-Split / Heat Pump', name: 'Mini-split / heat pump' },
  { re: /boiler|furnace|warm air|forced (hot )?air|steam heat|hot water heat|heating system|\bhvac\b/i, category: 'HVAC - Heating', name: 'Heating system' },
  { re: /central a\/?c|air.?condition|condenser|\bcooling\b/i, category: 'HVAC - Cooling', name: 'Central A/C' },
  { re: /rubber roof|epdm|flat roof/i, category: 'Roof - Flat', name: 'Flat roof' },
  { re: /re-?roof|roof(ing)?|\bshingle|strip and re/i, category: 'Roof - Asphalt', name: 'Asphalt shingle roof' },
  { re: /knob and tube|re-?wire|rewire|new wiring/i, category: 'Electrical Wiring', name: 'Electrical wiring' },
  { re: /electrical (service|panel)|service (upgrade|change)|\d+\s*a(mp)? service|breaker panel|new panel|meter/i, category: 'Electrical Panel', name: 'Electrical panel' },
  { re: /chimney|fireplace/i, category: 'Chimney / Fireplace', name: 'Chimney / fireplace' },
  { re: /\bdeck\b|porch/i, category: 'Deck / Exterior Wood', name: 'Deck / porch' },
  { re: /siding|clapboard|cladding|stucco|exterior wall/i, category: 'Exterior Cladding', name: 'Exterior cladding' },
  { re: /window|\bdoors?\b/i, category: 'Windows / Doors', name: 'Windows / doors' },
  { re: /insulat|weatheriz/i, category: 'Insulation', name: 'Insulation' },
  { re: /gutter/i, category: 'Gutters', name: 'Gutters' },
  { re: /foundation|underpin|footing/i, category: 'Foundation', name: 'Foundation' },
  { re: /solar|photovoltaic|\bpv\b/i, category: 'Other', name: 'Solar PV' },
];

function classifyPermit(permit) {
  const text = [permit.worktype, permit.permittypedescr, permit.description, permit.comments]
    .filter(Boolean).join(' ');
  for (const rule of CLASSIFY) {
    if (rule.re.test(text) && SYSTEM_CATEGORIES.includes(rule.category)) {
      return { category: rule.category, name: rule.name };
    }
  }
  return null;
}

// Rough expected lifespans (years) for the drafted systems; the owner refines.
const LIFESPAN = {
  'HVAC - Heating': 20, 'HVAC - Cooling': 15, 'Mini-Split / Heat Pump': 15,
  'Water Heater - Gas': 12, 'Water Heater - Oil': 12, 'Water Heater - Tankless': 20,
  'Electrical Panel': 40, 'Electrical Wiring': 50, 'Roof - Asphalt': 25, 'Roof - Flat': 20,
  'Windows / Doors': 25, 'Chimney / Fireplace': 40, 'Deck / Exterior Wood': 20,
  'Exterior Cladding': 30, 'Insulation': 40, 'Gutters': 20, 'Foundation': 75, 'Other': null,
};

const permitDate = (p) => p.issued_date || p.date_finaled || p.date_filed || null;
const yr = (d) => (d && /^\d{4}/.test(d) ? d.slice(0, 10) : null);

// Group classified permits into systems: one system per category, install date
// from the most recent matching permit. Every permit is also returned as a
// permit record (matched or not) so the home's permit history is captured.
function extractSystems(permits) {
  const byCat = new Map();
  const permitRecords = [];
  for (const p of permits) {
    const date = yr(permitDate(p));
    const cls = classifyPermit(p);
    permitRecords.push({
      permit_number: p.permitnumber || p.permit_number || null,
      date_filed: yr(p.date_filed) || date,
      date_finaled: yr(p.date_finaled) || null,
      status: mapStatus(p.status),
      permit_type: mapPermitType(p),
      scope_description: (p.description || p.comments || p.permittypedescr || '').slice(0, 300),
      contractor_of_record: p.applicant || null,
      matched_category: cls ? cls.category : null,
    });
    if (!cls) continue;
    const cur = byCat.get(cls.category);
    if (!cur || (date && (!cur._date || date > cur._date))) {
      byCat.set(cls.category, {
        system_name: cls.name, category: cls.category,
        install_date: date, _date: date,
        expected_lifespan: LIFESPAN[cls.category] ?? null,
        description: `Documented from permit ${p.permitnumber || ''}`.trim(),
        source_permit: p.permitnumber || null,
      });
    }
  }
  const systems = [...byCat.values()].map(({ _date, ...s }) => s)
    .sort((a, b) => (b.install_date || '').localeCompare(a.install_date || ''));
  return { systems, permits: permitRecords };
}

function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/closed|complete|final/.test(v)) return 'finaled';
  if (/open|issued|active/.test(v)) return 'open';
  if (/expired/.test(v)) return 'expired';
  return 'unknown';
}
function mapPermitType(p) {
  const t = [p.worktype, p.permittypedescr, p.description].filter(Boolean).join(' ').toLowerCase();
  if (/plumb|gas|water|boiler|hvac|heat/.test(t)) return 'plumbing';
  if (/elec|panel|wiring|service/.test(t)) return 'electrical';
  if (/roof|siding|window|deck|structural|foundation|frame/.test(t)) return 'structural';
  if (/hvac|mechanical|a\/?c|furnace/.test(t)) return 'mechanical';
  return 'general_building';
}
const OCC_TO_TYPE = { '1fam': 'single_family', '2fam': 'two_family', '3fam': 'triple_decker',
  '1-3fam': 'triple_decker', 'condo': 'condo', 'condominium': 'condo', 'row': 'townhouse' };
function mapPropertyType(occ) {
  const v = String(occ || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  for (const [k, val] of Object.entries(OCC_TO_TYPE)) if (v.includes(k)) return val;
  return null;
}

// ── Live civic-data fetch (used when the network allows) ────────────────────
async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await promise(ctrl.signal); } finally { clearTimeout(t); }
}

async function geocode(address) {
  try {
    return await withTimeout(async (signal) => {
      const url = `${CENSUS_GEOCODER}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`census ${res.status}`);
      const data = await res.json();
      const m = data.result?.addressMatches?.[0];
      if (!m) return null;
      const c = m.addressComponents || {};
      return {
        matched: m.matchedAddress,
        line1: [c.fromAddress && c.toAddress ? c.streetName : c.streetName, c.streetName].filter(Boolean)[0] || null,
        city: c.city || null, state: c.state || null, zip: c.zip || null,
        lat: m.coordinates?.y ?? null, lon: m.coordinates?.x ?? null,
      };
    }, 15000);
  } catch { return null; }
}

async function fetchBostonPermitsLive(address) {
  try {
    return await withTimeout(async (signal) => {
      const q = encodeURIComponent(address.split(',')[0].trim());
      const url = `https://data.boston.gov/api/3/action/datastore_search?resource_id=${BOSTON_RESOURCE_ID}&q=${q}&limit=100`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`ckan ${res.status}`);
      const data = await res.json();
      const records = data.result?.records || [];
      return records.length ? records : null;
    }, 20000);
  } catch { return null; }
}

// ── Bundled fixture (real-shaped Boston records) for offline / demo ─────────
const { FIXTURES, fixtureKey } = require('./enrich-fixtures');

// NJ construction permits (live only — no bundled fallback, by request). The
// per-address source varies by town (Bridgewater uses an SDL portal, which is
// a single-page app posting a search to a backend JSON API). It's configured
// with env vars so the real feed is wired without a code change:
//
//   STEWARD_NJ_PERMITS_URL    — URL template with {street}/{zip} placeholders.
//   STEWARD_NJ_PERMITS_METHOD — GET (default) or POST.
//   STEWARD_NJ_PERMITS_BODY   — POST only: a JSON body template with
//                               {street}/{zip} (SDL-style search payloads).
//   STEWARD_NJ_PERMITS_PATH   — optional dot-path to the records array in the
//                               response (e.g. "data.results"); default: auto.
//
// e.g. (Socrata) URL=https://data.nj.gov/resource/XXXX.json?$q={street}
//      (ArcGIS)  URL=https://host/FeatureServer/0/query?f=json&where=ADDRESS LIKE '%{street}%'&outFields=*
//      (SDL/POST) URL=https://<town>.sdlportal.com/api/<search>  METHOD=POST
//                 BODY={"address":"{street}","zip":"{zip}"}
//
// The normalizer maps common field names into the shape the classifier reads,
// so most feeds work by just setting these.
async function fetchNjPermitsLive(address) {
  const tmpl = process.env.STEWARD_NJ_PERMITS_URL;
  if (!tmpl) return null; // no source configured → nothing to look up
  const street = address.split(',')[0].trim();
  const zip = (address.match(/\b(\d{5})\b/) || [])[1] || '';
  const enc = (s) => s.replace(/\{street\}/g, encodeURIComponent(street)).replace(/\{zip\}/g, encodeURIComponent(zip));
  const raw = (s) => s.replace(/\{street\}/g, street.replace(/["\\]/g, '\\$&')).replace(/\{zip\}/g, zip);
  const method = (process.env.STEWARD_NJ_PERMITS_METHOD || 'GET').toUpperCase();
  const bodyTmpl = process.env.STEWARD_NJ_PERMITS_BODY;
  const arrPath = process.env.STEWARD_NJ_PERMITS_PATH;
  try {
    return await withTimeout(async (signal) => {
      const init = { signal, method, headers: { accept: 'application/json' } };
      if (method === 'POST' && bodyTmpl) { init.headers['content-type'] = 'application/json'; init.body = raw(bodyTmpl); }
      const res = await fetch(enc(tmpl), init);
      if (!res.ok) throw new Error(`nj source ${res.status}`);
      const data = await res.json();
      let rows;
      if (arrPath) rows = arrPath.split('.').reduce((o, k) => (o == null ? o : o[k]), data);
      else rows = Array.isArray(data) ? data
        : (data.features ? data.features.map((f) => f.attributes || f.properties || f)
          : data.records || data.results || data.data || []);
      if (!Array.isArray(rows)) return null;
      const norm = rows.map(normalizeNjRecord).filter((r) => r.description || r.permitnumber);
      return norm.length ? norm : null;
    }, 20000);
  } catch { return null; }
}

const pickField = (o, keys) => { for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase())) return o[k]; return null; };
function normalizeNjRecord(o) {
  return {
    permitnumber: pickField(o, ['permitnumber', 'permit_number', 'permit_no', 'permit', 'permitnum', 'record_number']),
    worktype: pickField(o, ['worktype', 'work_type', 'permit_type', 'permittype', 'type']),
    permittypedescr: pickField(o, ['permittypedescr', 'permit_type_description', 'type_description', 'subtype']),
    description: pickField(o, ['description', 'work_description', 'scope', 'scope_of_work', 'permit_description', 'project_description']),
    comments: pickField(o, ['comments', 'notes', 'remarks']),
    applicant: pickField(o, ['applicant', 'contractor', 'contractor_name', 'business_name', 'company']),
    issued_date: pickField(o, ['issued_date', 'issue_date', 'date_issued', 'issueddate', 'status_date', 'application_date']),
    status: pickField(o, ['status', 'permit_status', 'record_status']),
    occupancytype: pickField(o, ['occupancytype', 'occupancy', 'use', 'property_use']),
    address: pickField(o, ['address', 'full_address', 'site_address', 'location']),
  };
}

async function enrichAddress(address, opts = {}) {
  const geo = opts.skipGeocode ? null : await geocode(address);
  const state = String(geo?.state || (address.match(/,\s*([A-Za-z]{2})\b/) || [])[1] || '').toUpperCase();
  const isNJ = state === 'NJ' || /\bnew jersey\b/i.test(address);

  let records = null, source = 'none';
  if (isNJ) {
    records = opts.skipLive ? null : await fetchNjPermitsLive(address);
    source = records ? 'nj_live' : 'none';
  } else {
    records = opts.skipLive ? null : await fetchBostonPermitsLive(address);
    source = records ? 'boston_live' : null;
    if (!records) { records = FIXTURES[fixtureKey(address)]?.permits || null; source = records ? 'fixture' : 'none'; }
  }

  if (!records) {
    return { source: 'none', address, matched: geo?.matched || null,
      property: draftProperty(address, geo, null), systems: [], permits: [],
      note: isNJ
        ? 'No NJ permit records returned. Confirm STEWARD_NJ_PERMITS_URL points at Bridgewater’s permit feed (see DEPLOY.md). You can still build your record by hand.'
        : 'No public permit records found for this address. You can still build your record by hand.' };
  }

  const { systems, permits } = extractSystems(records);
  const occ = records.find((r) => r.occupancytype)?.occupancytype
    || FIXTURES[fixtureKey(address)]?.occupancytype;
  return {
    source, address, matched: geo?.matched || records[0]?.address || null,
    property: draftProperty(address, geo, occ, FIXTURES[fixtureKey(address)]),
    systems, permits,
  };
}

function draftProperty(address, geo, occ, fx) {
  const parts = address.split(',').map((s) => s.trim());
  return {
    address_line1: parts[0] || null,
    city: geo?.city || parts[1] || fx?.city || null,
    state: geo?.state || (parts[2] || '').split(' ')[0] || fx?.state || null,
    zip: geo?.zip || (parts[2] || '').split(' ')[1] || fx?.zip || null,
    property_type: mapPropertyType(occ) || fx?.property_type || null,
    year_built: fx?.year_built ?? null, // from assessor / commercial API when available
    square_footage: fx?.square_footage ?? null,
  };
}

module.exports = { enrichAddress, classifyPermit, extractSystems };
