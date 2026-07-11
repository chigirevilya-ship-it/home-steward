// Seed the database with demo data: two markets (Greater Boston, Los Angeles),
// staff for every role, client homes with systems/permits/history, a
// maintenance-rule library, and the contractor network. Dates are computed
// relative to "now" so dashboards always show live overdue/upcoming items.
//
//   node server/seed.js            seed only if the database is empty
//   node server/seed.js --reset    wipe and reseed

const fs = require('node:fs');
const path = require('node:path');
const { open, DB_PATH, FILES_DIR, today } = require('./db');
const { hashPassword } = require('./auth');
const rulesEngine = require('./rules-engine');

const DAY = 24 * 60 * 60 * 1000;
// days offset from today → 'YYYY-MM-DD' (negative = past)
const rel = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const yearsAgo = (y) => rel(-Math.round(y * 365.25));

function seed({ reset = false } = {}) {
  if (reset && fs.existsSync(DB_PATH)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(DB_PATH + suffix); } catch {}
    }
  }
  const db = open();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (existing.n > 0) {
    console.log('Database already seeded — skipping. Use --reset to reseed.');
    return false;
  }

  const staffPw = hashPassword('steward123');
  const clientPw = hashPassword('welcome123');
  const ins = (sql) => db.prepare(sql);

  // ── Markets ────────────────────────────────────────────────────────────
  const mkMarket = ins(`INSERT INTO markets (name, city, state, launch_date, active_zip_codes, status, notes) VALUES (?,?,?,?,?,?,?)`);
  const BOS = mkMarket.run('Greater Boston', 'Boston', 'MA', rel(-540),
    '02130,02131,02135,02138,02144,02155',
    'active', 'Old housing stock: steam heat, fieldstone foundations, knob-and-tube risk pre-1950.').lastInsertRowid;
  const LA = mkMarket.run('Los Angeles', 'Los Angeles', 'CA', rel(-360),
    '90026,90039,90042,91423,91604',
    'active', 'Seismic retrofit awareness, stucco/slab stock, brush-clearance season, no basements.').lastInsertRowid;
  mkMarket.run('Austin', 'Austin', 'TX', rel(300), '78704,78745', 'planned', 'Operator-partner candidate market, Year 3.');

  // ── Users (staff) ──────────────────────────────────────────────────────
  const mkUser = ins(`INSERT INTO users (full_name, email, phone, role, market_id, hire_date, comp_model, active, password_hash) VALUES (?,?,?,?,?,?,?,1,?)`);
  const founder   = mkUser.run('Alex Morgan',   'founder@steward.demo',     '617-555-0100', 'founder',     BOS, rel(-600), 'na',      staffPw).lastInsertRowid;
  const smeBos    = mkUser.run('Marcus Reed',   'marcus@steward.demo',      '617-555-0101', 'sme',         BOS, rel(-540), 'model_a', staffPw).lastInsertRowid;
  const advBos    = mkUser.run('Elena Vasquez', 'elena@steward.demo',       '617-555-0102', 'advisor',     BOS, rel(-400), 'salary',  staffPw).lastInsertRowid;
  const smeLa     = mkUser.run('Dana Kim',      'dana@steward.demo',        '213-555-0103', 'sme',         LA,  rel(-360), 'model_b', staffPw).lastInsertRowid;
  mkUser.run('Priya Shah', 'priya@steward.demo', '617-555-0104', 'coordinator', BOS, rel(-200), 'salary', staffPw);

  // ── Clients ────────────────────────────────────────────────────────────
  const mkClient = ins(`INSERT INTO clients
    (first_name, last_name, email, phone, preferred_contact, market_id, advisor_id, tier,
     subscription_start, subscription_renewal, annual_rate, charter_member,
     intake_fee_paid, intake_fee_date, referral_source, status, notes, password_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const whitfield = mkClient.run('Sarah', 'Whitfield', 'sarah@client.demo', '617-555-0201', 'email',
    BOS, smeBos, 'concierge', rel(-420), rel(-420 + 730), 2125, 1, 1, rel(-425),
    'Realtor referral — K. Donnelly', 'active',
    'Charter member. Detail-oriented; over-communicate before every visit. Husband Tom handles finances.', clientPw).lastInsertRowid;
  const obrien = mkClient.run('James', "O'Brien", 'james@client.demo', '617-555-0202', 'text',
    BOS, advBos, 'managed', rel(-300), rel(65), 1200, 1, 1, rel(-310),
    'Neighborhood association talk', 'active',
    'Prefers texts, works nights — never call before noon. Inherited the triple-decker from his mother.', clientPw).lastInsertRowid;
  const chen = mkClient.run('Mia', 'Chen', 'mia@client.demo', '617-555-0203', 'email',
    BOS, advBos, 'guided', rel(-150), rel(215), 500, 0, 1, rel(-160),
    'Google search', 'active', 'First-time owner, asks great questions. Candidate to upgrade to Managed at renewal.', clientPw).lastInsertRowid;
  const hassan = mkClient.run('Nadia', 'Hassan', 'nadia@client.demo', '323-555-0204', 'call',
    LA, smeLa, 'managed', rel(-240), rel(125), 1200, 1, 1, rel(-250),
    'Client referral — Alvarez', 'active', 'Anxious about earthquake risk; lead with seismic items.', clientPw).lastInsertRowid;
  const alvarez = mkClient.run('Victor', 'Alvarez', 'victor@client.demo', '818-555-0205', 'email',
    LA, smeLa, 'concierge', rel(-330), rel(35), 2500, 1, 1, rel(-340),
    'Estate attorney referral', 'active', 'Travels often; wants everything handled without him.', clientPw).lastInsertRowid;
  mkClient.run('Robert', 'Feld', 'robert@client.demo', '617-555-0206', 'email',
    BOS, smeBos, 'guided', null, null, 500, 0, 0, null, 'Open house event', 'prospect',
    'Toured the service at the JP open house. Follow up mid-month.', clientPw);

  // ── Properties ─────────────────────────────────────────────────────────
  const mkProp = ins(`INSERT INTO properties
    (address_line1, city, state, zip, client_id, market_id, year_built, square_footage, stories,
     bedrooms, bathrooms, property_type, construction_type, foundation_type, ownership_date,
     permit_jurisdiction, intake_date, advisor_id, record_completeness, narrative_summary, active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);

  const pWhit = mkProp.run('47 Sumner Hill Rd', 'Jamaica Plain', 'MA', '02130', whitfield, BOS,
    1892, 3400, 3, 5, 2.5, 'single_family', 'wood_frame', 'fieldstone', rel(-2900),
    'Boston ISD', rel(-415), smeBos, 92,
    'An 1892 Queen Anne, lovingly kept but running on original bones: steam heat off a 2009 gas boiler, fieldstone foundation that weeps in March, and a slate roof past its prime on the north face. The Whitfields treat the house as the sixth member of the family — schedule around school pickup, and always walk the basement with Tom.').lastInsertRowid;
  const pObr = mkProp.run('118 Draper St', 'Dorchester', 'MA', '02122', obrien, BOS,
    1915, 3900, 3, 6, 3, 'triple_decker', 'wood_frame', 'fieldstone', rel(-1100),
    'Boston ISD', rel(-295), advBos, 74,
    "Classic 1915 triple-decker, owner-occupied on the first floor with two rental units above. Three of everything: three gas water heaters, three panels (two updated, one fuse box — flagged), one aging flat roof over it all. James inherited it and is catching up on two decades of deferred maintenance one season at a time.").lastInsertRowid;
  const pChen = mkProp.run('9 Fairmont Ave, Unit 2', 'Cambridge', 'MA', '02139', chen, BOS,
    1987, 1150, 1, 2, 1, 'condo', 'wood_frame', 'poured_concrete', rel(-500),
    'Cambridge ISD', rel(-145), advBos, 61,
    'A tidy 1987 condo conversion. Mia owns the mechanicals inside her unit — heat pump, water heater, panel — while the association carries roof and envelope. Record focuses on unit systems plus association timeline awareness.').lastInsertRowid;
  const pHas = mkProp.run('5214 Range View Ave', 'Highland Park', 'CA', '90042', hassan, LA,
    1948, 1420, 1, 3, 2, 'single_family', 'stucco', 'crawlspace', rel(-1800),
    'LADBS', rel(-235), smeLa, 68,
    'A 1948 stucco bungalow on a raised foundation — classic cripple-wall seismic candidate, retrofit not yet done. Original galvanized supply lines partially replaced with copper. Nadia is safety-motivated: frame every recommendation around risk reduction.').lastInsertRowid;
  const pAlv = mkProp.run('4530 Nagle Ave', 'Sherman Oaks', 'CA', '91423', alvarez, LA,
    1962, 2600, 1, 4, 3, 'single_family', 'stucco', 'slab', rel(-3600),
    'LADBS', rel(-325), smeLa, 88,
    "A 1962 mid-century on slab, meticulously renovated in 2018 — new roof, new HVAC, tankless hot water. The record's job here is preservation: keep the renovation investment on schedule and document everything for eventual resale.").lastInsertRowid;

  // ── Systems Inventory ──────────────────────────────────────────────────
  const mkSys = ins(`INSERT INTO systems
    (system_name, property_id, category, description, install_date, age_at_intake, expected_lifespan,
     condition_rating, model_number, serial_number, warranty_expiry, last_service_date, needs_specialist, advisor_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Whitfield — 1892 Victorian
  const sWhitBoiler = mkSys.run('Gas steam boiler', pWhit, 'HVAC - Heating',
    'Weil-McLain EG-45, single-pipe steam, 4 zones off original radiators.', yearsAgo(17), null, 25, 3,
    'EG-45-PIDN', 'WM-88412', null, rel(-427), 0,
    'Runs well but 17 years in. Start replacement conversation at year 20.').lastInsertRowid;
  const sWhitWH = mkSys.run('Gas water heater', pWhit, 'Water Heater - Gas',
    'AO Smith 50-gal atmospheric vent, in basement NE corner.', yearsAgo(11), null, 12, 2,
    'GCR-50', 'AOS-30117', null, rel(-427), 0,
    'Rust at base seam, anode never changed. Condition 2 — replacement planning now.').lastInsertRowid;
  mkSys.run('Slate roof (main)', pWhit, 'Roof - Asphalt',
    'Original slate, north face losing pieces; copper flashing 1998.', null, 110, 120, 2,
    null, null, null, rel(-390), 1, 'Slate specialist only. North face is the priority.');
  mkSys.run('Electrical panel', pWhit, 'Electrical Panel',
    '200A Square D, upgraded 2015. Whole-house surge protector.', yearsAgo(11), null, 40, 5,
    'QO142M200PC', null, null, rel(-415), 0, null);
  mkSys.run('Fieldstone foundation', pWhit, 'Foundation',
    'Fieldstone + brick, repointed 2012. Seasonal weep at NE corner in spring melt.', null, 134, 150, 3,
    null, null, null, rel(-415), 0, 'Monitor NE corner each spring visit.');
  mkSys.run('Chimney (2 flues)', pWhit, 'Chimney / Fireplace',
    'Two brick flues: boiler + living room fireplace. Relined 2009.', yearsAgo(17), null, 50, 4,
    null, null, null, rel(-620), 0, null);
  const sWhitAppl = mkSys.run('Kitchen appliances', pWhit, 'Appliances',
    'Sub-Zero 48" fridge (2019), Wolf range (2019), Bosch dishwasher (2021).', yearsAgo(7), null, 15, 4,
    'BI-48SD', null, rel(120), null, 0, null).lastInsertRowid;

  // O'Brien — triple-decker
  const sObrFurn = mkSys.run('Gas furnace (unit 1)', pObr, 'HVAC - Heating',
    'Carrier 80% AFUE forced hot air, owner unit only. Units 2–3 electric baseboard.', yearsAgo(14), null, 20, 3,
    '58STA090', null, null, rel(-430), 0, null).lastInsertRowid;
  mkSys.run('Water heaters ×3', pObr, 'Water Heater - Gas',
    'Three 40-gal Bradford White, one per unit. Unit 3 heater is oldest (2016).', yearsAgo(10), null, 12, 3,
    'RG240T6N', null, null, rel(-295), 0, null);
  const sObrRoof = mkSys.run('Flat rubber roof', pObr, 'Roof - Flat',
    'EPDM membrane over original deck, patched twice at parapet.', yearsAgo(16), null, 18, 2,
    null, null, null, rel(-295), 1, 'Ponding at NW corner. Budget full replacement within 2 years.').lastInsertRowid;
  mkSys.run('Electrical panels ×3', pObr, 'Electrical Panel',
    'Units 1–2 on 100A breakers (2011). Unit 3 still on 60A fuse box.', yearsAgo(15), null, 40, 2,
    null, null, null, rel(-295), 1, 'Unit 3 fuse box is the top capital item. Insurance risk.');
  mkSys.run('Knob-and-tube remnants', pObr, 'Electrical Wiring',
    'Live K&T found in basement ceiling and rear stairwell during intake.', null, 111, 100, 1,
    null, null, null, rel(-295), 1, 'Remediation quotes in hand. Health of record depends on closing this.');
  mkSys.run('Front porch (3 levels)', pObr, 'Deck / Exterior Wood',
    'Stacked porches, structural posts sistered 2019. Paint failing on rails.', yearsAgo(7), null, 25, 3,
    null, null, null, rel(-660), 0, null);

  // Chen — condo
  const sChenHP = mkSys.run('Mini-split heat pump', pChen, 'Mini-Split / Heat Pump',
    'Mitsubishi hyper-heat, 2 heads (living + bedroom).', yearsAgo(5), null, 15, 4,
    'MXZ-2C20NAHZ', null, rel(730), rel(-460), 0, null).lastInsertRowid;
  mkSys.run('Electric water heater', pChen, 'Water Heater - Gas',
    'Rheem 40-gal electric, closet install with pan + drain.', yearsAgo(6), null, 12, 4,
    'XE40M06ST45U1', null, null, rel(-145), 0, null);
  mkSys.run('Unit electrical panel', pChen, 'Electrical Panel',
    '100A sub-panel, labeled, AFCI on bedroom circuits.', yearsAgo(9), null, 40, 4,
    null, null, null, rel(-145), 0, null);
  mkSys.run('Smoke / CO detectors', pChen, 'Safety Systems',
    'Hardwired interconnected, replaced at purchase.', yearsAgo(1.4), null, 10, 5,
    null, null, null, rel(-145), 0, null);

  // Hassan — 1948 bungalow
  mkSys.run('Wall furnace', pHas, 'HVAC - Heating',
    'Williams direct-vent wall furnace, hallway. No ducting.', yearsAgo(12), null, 20, 3,
    '3509622', null, null, rel(-235), 0, null);
  const sHasWH = mkSys.run('Gas water heater', pHas, 'Water Heater - Gas',
    'Rheem 40-gal in garage, seismic straps present but loose.', yearsAgo(9), null, 12, 3,
    'PROG40-38N', null, null, rel(-450), 0, 'Re-tension straps — done at intake, verify annually.').lastInsertRowid;
  mkSys.run('Cripple-wall foundation', pHas, 'Foundation',
    'Raised foundation, unbraced cripple walls. Retrofit NOT done.', null, 78, 100, 2,
    null, null, null, rel(-235), 1, 'EBB retrofit candidate; quotes from two structural contractors pending.');
  mkSys.run('Galvanized supply (partial)', pHas, 'Plumbing - Supply',
    'Rear bath + kitchen still on original galvanized; front bath repiped copper 2015.', null, 78, 70, 2,
    null, null, null, rel(-235), 0, 'Low pressure at kitchen. Repipe remainder within 3 years.');
  mkSys.run('Comp shingle roof', pHas, 'Roof - Asphalt',
    '30-yr architectural shingle, installed 2013.', yearsAgo(13), null, 30, 4,
    null, null, null, rel(-235), 0, null);
  mkSys.run('Floor furnace grille (decomm.)', pHas, 'Other',
    'Original floor furnace decommissioned in place, capped gas line verified.', null, 78, 100, 4,
    null, null, null, rel(-235), 0, null);

  // Alvarez — 1962 mid-century
  const sAlvAC = mkSys.run('Central HVAC (heat + AC)', pAlv, 'HVAC - Cooling',
    'Lennox XC20 condenser + matching air handler, attic ducts resealed 2018.', yearsAgo(8), null, 16, 4,
    'XC20-036', null, rel(365), rel(-90), 0, null).lastInsertRowid;
  mkSys.run('Gas furnace', pAlv, 'HVAC - Heating',
    'Lennox EL296V two-stage, closet install.', yearsAgo(8), null, 20, 4,
    'EL296UH070', null, rel(365), rel(-90), 0, null);
  mkSys.run('Tankless water heater', pAlv, 'Water Heater - Tankless',
    'Navien NPE-240A, exterior wall mount, annual descale on file.', yearsAgo(8), null, 20, 5,
    'NPE-240A', null, rel(730), rel(-380), 0, null);
  mkSys.run('Comp shingle roof', pAlv, 'Roof - Asphalt',
    'Full tear-off 2018, 40-yr presidential shake profile.', yearsAgo(8), null, 40, 5,
    null, null, rel(2900), null, 0, null);
  mkSys.run('Electrical panel', pAlv, 'Electrical Panel',
    '200A upgrade with EV circuit (2018).', yearsAgo(8), null, 40, 5,
    null, null, null, rel(-325), 0, null);
  mkSys.run('Pool equipment', pAlv, 'Other',
    'Pentair VS pump (2021) + cartridge filter. Serviced monthly by pool co.', yearsAgo(5), null, 12, 4,
    'P6E6VS4H-209L', null, null, rel(-35), 0, null);

  // ── Equipment (components with their own lifespan/warranty story) ──────
  const mkEquip = ins(`INSERT INTO equipment
    (property_id, system_id, name, description, make, model_number, serial_number,
     install_date, expected_lifespan, warranty_expiry, condition_rating, advisor_notes, active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  const eqWolf = mkEquip.run(pWhit, sWhitAppl, 'Wolf 48" range', 'Six burner + griddle, dual ovens.', 'Wolf', 'DF486G', 'WF-99120',
    yearsAgo(7), 20, rel(45), 4, 'Extended warranty expires soon — remind Sarah before renewal window closes.').lastInsertRowid;
  mkEquip.run(pWhit, sWhitAppl, 'Sub-Zero 48" refrigerator', 'Built-in, dual compressor.', 'Sub-Zero', 'BI-48SD', 'SZ-44107',
    yearsAgo(7), 19, rel(120), 4, null);
  mkEquip.run(pWhit, sWhitBoiler, 'Boiler low-water cutoff', 'Probe-type LWCO, replaced with boiler service.', 'McDonnell & Miller', 'PS-801', null,
    yearsAgo(2), 10, rel(300), 5, null);
  mkEquip.run(pAlv, sAlvAC, 'AC condenser', 'Variable-capacity outdoor unit.', 'Lennox', 'XC20-036-230', 'LX-77451',
    yearsAgo(8), 16, rel(730), 4, null);
  mkEquip.run(pAlv, sAlvAC, 'Air handler', 'Matching variable-speed air handler, attic.', 'Lennox', 'CBA38MV', 'LX-77452',
    yearsAgo(8), 16, rel(730), 4, null);
  mkEquip.run(pAlv, null, 'Pool robot cleaner', 'Freestanding — client-owned, not tied to a documented system.', 'Dolphin', 'M600', null,
    yearsAgo(2), 5, rel(-30), 3, 'Warranty already lapsed; note replacement cost at next quarterly.');

  // ── Permit History ─────────────────────────────────────────────────────
  const mkPermit = ins(`INSERT INTO permits
    (property_id, permit_number, date_filed, date_finaled, status, permit_type, scope_description,
     contractor_of_record, final_inspection_passed, gap_flag, gap_notes, researched_date, researched_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  mkPermit.run(pWhit, 'ISD-2015-44810', yearsAgo(11.2), yearsAgo(11), 'finaled', 'electrical',
    '200A service upgrade, whole-house surge protection.', 'Beacon Electric', 1, 0, null, rel(-430), smeBos);
  mkPermit.run(pWhit, 'ISD-2009-30122', yearsAgo(17.3), yearsAgo(17.1), 'finaled', 'mechanical',
    'Gas steam boiler replacement, chimney reline.', 'Hearthside Mechanical', 1, 0, null, rel(-430), smeBos);
  mkPermit.run(pWhit, null, null, null, 'unknown', 'plumbing',
    'Second-floor bath fully renovated (visible ~2018 finishes). No permit on file.', null, null, 1,
    'GAP: high-end bath remodel with no plumbing or electrical permit found in ISD records. Disclose before resale; recommend retroactive inspection.', rel(-430), smeBos);
  mkPermit.run(pObr, 'ISD-2011-18904', yearsAgo(15), yearsAgo(14.8), 'finaled', 'electrical',
    'Units 1–2 panel upgrades to 100A breakers.', 'Dot Ave Electric', 1, 0, null, rel(-300), advBos);
  mkPermit.run(pObr, null, null, null, 'unknown', 'general_building',
    'Rear porch structural posts visibly sistered (~2019). No permit found.', null, null, 1,
    'GAP: structural work without permit. Get engineer letter when porch is next serviced.', rel(-300), advBos);
  mkPermit.run(pHas, 'LADBS-2015-70331', yearsAgo(11), yearsAgo(10.8), 'finaled', 'plumbing',
    'Front bathroom repipe to copper.', 'Arroyo Plumbing Co', 1, 0, null, rel(-240), smeLa);
  mkPermit.run(pAlv, 'LADBS-2018-55210', yearsAgo(8.2), yearsAgo(7.9), 'finaled', 'general_building',
    'Full renovation: roof, HVAC, 200A panel, tankless WH.', 'Meridian Builders', 1, 0, null, rel(-330), smeLa);

  // ── Contractors ────────────────────────────────────────────────────────
  const mkCon = ins(`INSERT INTO contractors
    (company_name, primary_contact, email, phone, market_id, trades, license_number, license_expiry,
     license_current, insurance_on_file, insurance_expiry, first_vetted_date, vetting_notes,
     referral_fee_rate, preferred_pricing, status, removal_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const conHearth = mkCon.run('Hearthside Mechanical', 'Gus Pappas', 'gus@hearthside.demo', '617-555-0301',
    BOS, JSON.stringify(['HVAC', 'Plumbing']), 'MA-PL-30441', rel(400), 1, 1, rel(310), rel(-520),
    'Steam specialists — rare and valuable. Gus trained half the techs in the metro.', 0.10, 1, 'active', null).lastInsertRowid;
  const conBeacon = mkCon.run('Beacon Electric', 'Rosa Delgado', 'rosa@beaconelec.demo', '617-555-0302',
    BOS, JSON.stringify(['Electrical']), 'MA-EL-11872', rel(75), 1, 1, rel(200), rel(-500),
    'Fast, tidy, great with old-house wiring. K&T remediation experience.', 0.12, 1, 'active', null).lastInsertRowid;
  const conCopley = mkCon.run('Copley Roofing & Slate', 'Brendan Walsh', 'brendan@copleyroof.demo', '617-555-0303',
    BOS, JSON.stringify(['Roofing', 'Chimney']), 'MA-CS-77210', rel(600), 1, 1, rel(45), rel(-460),
    'One of three slate-capable crews in the metro. Books out 8 weeks.', 0.10, 0, 'active', null).lastInsertRowid;
  const conFlynn = mkCon.run('Flynn & Sons Plumbing', 'Pat Flynn', 'pat@flynnsons.demo', '617-555-0304',
    BOS, JSON.stringify(['Plumbing']), 'MA-PL-19008', rel(500), 1, 1, rel(380), rel(-430),
    'Solid on standard work. Two recent complaints on communication — watching closely.', 0.10, 0, 'probation',
    null).lastInsertRowid;
  mkCon.run('Minuteman Pest Solutions', 'Terri Novak', 'terri@minutemanpest.demo', '617-555-0305',
    BOS, JSON.stringify(['Pest Control']), 'MA-PC-40551', rel(700), 1, 0, rel(-20), rel(-390),
    'Insurance certificate EXPIRED — do not refer until renewed COI on file.', 0.10, 0, 'active', null);
  const conArroyo = mkCon.run('Arroyo Plumbing Co', 'Miguel Santos', 'miguel@arroyoplumbing.demo', '323-555-0306',
    LA, JSON.stringify(['Plumbing']), 'CA-C36-88102', rel(800), 1, 1, rel(400), rel(-350),
    'Copper repipe specialists. Preferred pricing negotiated at 8%.', 0.11, 1, 'active', null).lastInsertRowid;
  const conQuake = mkCon.run('QuakeSafe Retrofit', 'Lena Fischer', 'lena@quakesafe.demo', '213-555-0307',
    LA, JSON.stringify(['Foundation / Structural']), 'CA-B-55019', rel(900), 1, 1, rel(500), rel(-340),
    'EBB-registered seismic retrofitter. Engineer on staff.', 0.10, 0, 'active', null).lastInsertRowid;
  const conValley = mkCon.run('Valley Air Systems', 'Omar Haddad', 'omar@valleyair.demo', '818-555-0308',
    LA, JSON.stringify(['HVAC']), 'CA-C20-71446', rel(650), 1, 1, rel(600), rel(-330),
    'Lennox certified, handles all Sherman Oaks book.', 0.12, 1, 'active', null).lastInsertRowid;

  // ── Maintenance Rules (the rule library) ───────────────────────────────
  const mkRule = ins(`INSERT INTO maintenance_rules
    (task_name, system_category, frequency_type, frequency_value, frequency_unit, seasonal_timing,
     lead_time_days, est_cost_low, est_cost_high, priority, capital_forecast_item,
     applies_age_min_yrs, applies_age_max_yrs, home_vintage_before, condition_threshold,
     market_id, specialist_required, diy_possible, advisor_talking_points, rule_source, active, last_reviewed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const R = (...a) => mkRule.run(...a).lastInsertRowid;

  R('Annual heating system service', 'HVAC - Heating', 'recurring_annual', 1, 'years', null,
    45, 180, 350, 'standard', 0, null, null, null, null, null, 0, 0,
    'A tuned burner runs 5–10% more efficiently and catches small failures before a no-heat call in January.',
    'ACCA/manufacturer guideline', rel(-90));
  R('Steam system: skim, flush & vent check', 'HVAC - Heating', 'recurring_seasonal', null, null, 'fall',
    60, 250, 450, 'standard', 0, null, null, null, null, BOS, 1, 0,
    'Steam is a Boston specialty — a fall skim and vent check is the difference between silent, even heat and banging pipes all winter.',
    'Steward field practice (Boston)', rel(-90));
  R('Heating system replacement planning', 'HVAC - Heating', 'age_based', null, null, null,
    365, 8000, 15000, 'planning', 1, 15, null, null, null, null, 1, 0,
    'Boilers and furnaces rarely fail politely. Planning the replacement two heating seasons ahead means choosing a contractor calmly, not in an emergency.',
    'ASHRAE service-life tables', rel(-90));
  R('Cooling system spring service', 'HVAC - Cooling', 'recurring_seasonal', null, null, 'spring',
    45, 150, 300, 'standard', 0, null, null, null, null, null, 0, 0,
    'A spring coil clean and refrigerant check before the first heat wave — AC contractors are unbookable in July.',
    'ACCA guideline', rel(-90));
  R('Mini-split deep clean & filter service', 'Mini-Split / Heat Pump', 'recurring_annual', 1, 'years', null,
    30, 120, 250, 'standard', 0, null, null, null, null, null, 0, 1,
    'Heat pump heads grow mold and lose capacity quietly. An annual deep clean keeps efficiency where you paid for it.',
    'Manufacturer guideline', rel(-90));
  R('Water heater flush & anode inspection', 'Water Heater - Gas', 'recurring_annual', 1, 'years', null,
    30, 120, 220, 'standard', 0, null, null, null, null, null, 0, 1,
    'A yearly flush plus an anode check is the cheapest way to buy extra years from a tank heater.',
    'Manufacturer guideline', rel(-90));
  R('Water heater replacement planning', 'Water Heater - Gas', 'age_based', null, null, null,
    180, 1800, 3200, 'planning', 1, 8, null, null, null, null, 0, 0,
    'Tank heaters fail by leaking, and they choose the worst weekend to do it. At this age we plan the swap on your schedule.',
    'ASHRAE service-life tables', rel(-90));
  R('URGENT: water heater at end of condition', 'Water Heater - Gas', 'condition_triggered', null, null, null,
    0, 1800, 3200, 'urgent', 0, null, null, null, 2, null, 0, 0,
    'The tank is showing failure signs now — rust at seams or fittings means replacement moves from "planned" to "this month."',
    'Steward field practice', rel(-90));
  R('Tankless descale service', 'Water Heater - Tankless', 'recurring_annual', 1, 'years', null,
    30, 150, 250, 'standard', 0, null, null, null, null, null, 0, 1,
    'Tankless units need an annual vinegar descale to keep their heat exchanger — skipping it voids most warranties.',
    'Manufacturer requirement', rel(-90));
  R('Electrical panel thermal scan & tighten', 'Electrical Panel', 'recurring_custom', 5, 'years', null,
    60, 200, 400, 'standard', 0, null, null, null, null, null, 1, 0,
    'Every five years an electrician should scan and re-torque the panel — loose lugs are the quiet cause of most panel fires.',
    'NFPA 70B', rel(-90));
  R('Knob-and-tube assessment', 'Electrical Wiring', 'one_time_at_intake', null, null, null,
    30, 300, 600, 'urgent', 0, null, null, 1950, null, null, 1, 0,
    'Homes this age often hide live knob-and-tube. One assessment tells us whether remediation is needed and what insurance will ask for.',
    'Steward intake protocol', rel(-90));
  R('Roof condition survey', 'Roof - Asphalt', 'recurring_custom', 2, 'years', null,
    60, 150, 300, 'standard', 0, 10, null, null, null, null, 0, 0,
    'From year ten, a biennial look at the roof catches flashing and shingle wear years before a ceiling stain does.',
    'NRCA guideline', rel(-90));
  R('Roof replacement planning', 'Roof - Asphalt', 'age_based', null, null, null,
    730, 12000, 28000, 'planning', 1, 15, null, null, null, null, 1, 0,
    'A roof is the largest single capital item on most homes. We put it in the five-year forecast so the number never surprises you.',
    'NRCA service-life data', rel(-90));
  R('Flat roof inspection & ponding check', 'Roof - Flat', 'recurring_annual', 1, 'years', null,
    45, 200, 400, 'standard', 0, null, null, null, null, null, 1, 0,
    'Flat roofs fail at seams and ponding spots. An annual walk finds the $300 patch before the $3,000 ceiling repair.',
    'NRCA guideline', rel(-90));
  R('Flat roof replacement planning', 'Roof - Flat', 'age_based', null, null, null,
    365, 15000, 30000, 'planning', 1, 12, null, null, null, null, 1, 0,
    'EPDM membranes give 15–18 years. Planning the replacement early lets us schedule it in dry season at a fair price.',
    'NRCA service-life data', rel(-90));
  R('Gutter cleaning & drainage check', 'Gutters', 'recurring_seasonal', null, null, 'spring_and_fall',
    21, 150, 300, 'standard', 0, null, null, null, null, null, 0, 1,
    'Clean gutters twice a year is the single highest-return maintenance dollar — clogged gutters quietly destroy fascia and foundations.',
    'Steward field practice', rel(-90));
  R('Chimney sweep & flue inspection', 'Chimney / Fireplace', 'recurring_annual', 1, 'years', null,
    60, 250, 450, 'standard', 0, null, null, null, null, null, 1, 0,
    'Any flue that vents combustion — fireplace or boiler — gets an annual look. Creosote and liner cracks are invisible until they are not.',
    'NFPA 211', rel(-90));
  R('Foundation moisture walk', 'Foundation', 'recurring_seasonal', null, null, 'spring',
    30, 0, 150, 'standard', 0, null, null, null, null, BOS, 0, 1,
    'Fieldstone foundations weep in spring melt. A spring walk of the basement perimeter catches new water paths early.',
    'Steward field practice (Boston)', rel(-90));
  R('Deck & exterior wood reseal', 'Deck / Exterior Wood', 'recurring_custom', 2, 'years', null,
    45, 400, 900, 'standard', 0, null, null, null, null, null, 0, 1,
    'Resealing every other year is what separates a 25-year porch from a 12-year porch.',
    'Steward field practice', rel(-90));
  R('Smoke & CO detector test / battery cycle', 'Safety Systems', 'recurring_annual', 1, 'years', null,
    14, 0, 100, 'standard', 0, null, null, null, null, null, 0, 1,
    'Ten minutes a year. Detectors also age out entirely at ten years — we track that date so you never think about it.',
    'NFPA 72', rel(-90));
  R('Seismic strap & cripple-wall check', 'Foundation', 'one_time_at_intake', null, null, null,
    30, 0, 250, 'urgent', 0, null, null, 1980, null, LA, 1, 0,
    'Pre-1980 LA homes on raised foundations are the classic retrofit candidates — one structural assessment tells us if you qualify for the EBB grant.',
    'CEA / EBB program', rel(-90));
  R('Brush clearance & defensible space', 'Exterior Cladding', 'recurring_seasonal', null, null, 'summer',
    45, 300, 800, 'standard', 0, null, null, null, null, LA, 0, 1,
    'LAFD compliance date lands in early summer. We schedule clearance before the inspection letters go out.',
    'LAFD requirement', rel(-90));
  R('Supply piping replacement planning', 'Plumbing - Supply', 'age_based', null, null, null,
    365, 6000, 14000, 'planning', 1, 50, null, null, null, null, 1, 0,
    'Original galvanized pipe closes up like an artery. A planned repipe beats an emergency one through a finished ceiling.',
    'Copper Development Assn data', rel(-90));
  R('Appliance recall & warranty sweep', 'Appliances', 'one_time_at_intake', null, null, null,
    30, 0, 0, 'standard', 0, null, null, null, null, null, 0, 1,
    'We run every model number against the CPSC recall database and log warranty end dates during intake.',
    'Steward intake protocol', rel(-90));

  // ── Maintenance Log (history) + Referral Fees + Ratings ───────────────
  const mkLog = ins(`INSERT INTO maintenance_log
    (property_id, system_id, date, description, contractor_id, invoice_amount, invoice_reference,
     advisor_present, outcome_notes, updated_system_record, forward_item_generated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const mkFee = ins(`INSERT INTO referral_fees
    (contractor_id, property_id, maintenance_log_id, job_date, invoice_amount, fee_rate, status, invoice_date, payment_date, payment_method)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const mkRating = ins(`INSERT INTO contractor_ratings
    (contractor_id, property_id, maintenance_log_id, rating_date, score, client_comments, advisor_notes, complaint_flag)
    VALUES (?,?,?,?,?,?,?,?)`);

  let log = mkLog.run(pWhit, sWhitBoiler, rel(-427), 'Annual steam boiler service: burner tune, LWCO test, skim and flush, main vent replaced.',
    conHearth, 385, 'HM-8841', 1, 'Boiler in good order for age. Recommended replacing two radiator vents next season.', 1, 1).lastInsertRowid;
  mkFee.run(conHearth, pWhit, log, rel(-427), 385, 0.10, 'paid', rel(-400), rel(-385), 'ACH');
  mkRating.run(conHearth, pWhit, log, rel(-425), 5, 'Gus explained everything. Heat is silent this winter for the first time.', null, 0);

  log = mkLog.run(pWhit, null, rel(-200), 'Repointed NE fieldstone corner, regraded downspout drainage at same corner.',
    conCopley, 1450, 'CR-2210', 1, 'Weep reduced but not eliminated — monitor in spring.', 1, 0).lastInsertRowid;
  mkFee.run(conCopley, pWhit, log, rel(-200), 1450, 0.10, 'paid', rel(-170), rel(-160), 'Check');
  mkRating.run(conCopley, pWhit, log, rel(-198), 4, 'Clean work, slightly over estimate.', null, 0);

  log = mkLog.run(pObr, sObrRoof, rel(-160), 'Patched EPDM at NW parapet, resealed two seams, cleared roof drain.',
    conCopley, 780, 'CR-2289', 1, 'Buys 18–24 months. Replacement planning stands.', 0, 1).lastInsertRowid;
  mkFee.run(conCopley, pObr, log, rel(-160), 780, 0.10, 'invoiced', rel(-130), null, null);
  mkRating.run(conCopley, pObr, log, rel(-158), 5, 'Fast and honest about the roof’s real condition.', null, 0);

  log = mkLog.run(pObr, null, rel(-120), 'Snaked main drain, replaced unit 2 kitchen trap arm.',
    conFlynn, 420, 'FS-1180', 0, null, 0, 0).lastInsertRowid;
  mkFee.run(conFlynn, pObr, log, rel(-120), 420, 0.10, 'invoiced', rel(-90), null, null);
  mkRating.run(conFlynn, pObr, log, rel(-118), 2, 'Showed up four hours late, no call. Work itself was fine.',
    'Second communication complaint this quarter.', 1);

  log = mkLog.run(pWhit, sWhitWH, rel(-100), 'Water heater flush attempted; drain valve seized. Anode inaccessible — corroded in.',
    conFlynn, 180, 'FS-1201', 0, 'Heater confirmed near end of life. Escalated to replacement planning.', 1, 1).lastInsertRowid;
  mkFee.run(conFlynn, pWhit, log, rel(-100), 180, 0.10, 'pending', null, null, null);
  mkRating.run(conFlynn, pWhit, log, rel(-98), 2, 'Left the basement a mess and didn’t explain what he found.',
    'Two complaint flags now on Flynn — one more triggers network review.', 1);

  log = mkLog.run(pHas, sHasWH, rel(-450), 'Re-tensioned seismic straps, replaced flex gas connector with rated line.',
    conArroyo, 240, 'AP-5510', 1, null, 1, 0).lastInsertRowid;
  mkFee.run(conArroyo, pHas, log, rel(-450), 240, 0.11, 'paid', rel(-420), rel(-410), 'ACH');
  mkRating.run(conArroyo, pHas, log, rel(-448), 5, 'Miguel was wonderful — explained the straps to my mother in Spanish.', null, 0);

  log = mkLog.run(pAlv, null, rel(-90), 'Spring HVAC service: coil clean, refrigerant verified, condensate line flushed, filters ×2.',
    conValley, 260, 'VA-3320', 0, null, 1, 1).lastInsertRowid;
  mkFee.run(conValley, pAlv, log, rel(-90), 260, 0.12, 'paid', rel(-60), rel(-50), 'ACH');
  mkRating.run(conValley, pAlv, log, rel(-88), 5, null, 'Client traveling; advisor accepted work on his behalf.', 0);

  log = mkLog.run(pChen, sChenHP, rel(-460), 'Mini-split deep clean, both heads: blower wheel, coil, drain pan treatment.',
    null, 220, null, 0, 'Owner arranged directly with manufacturer-certified tech before joining Steward.', 1, 0).lastInsertRowid;

  // ── Visits ─────────────────────────────────────────────────────────────
  const mkVisit = ins(`INSERT INTO visits
    (property_id, advisor_id, visit_date, visit_type, duration_hrs, systems_reviewed, findings_summary,
     home_record_updated, forward_items_generated, client_satisfaction, follow_up_required, follow_up_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  mkVisit.run(pWhit, smeBos, rel(-415), 'intake', 5.5, 'All systems',
    'Full intake. 7 systems logged, 3 permits researched, 1 gap flag (2nd-floor bath). Slate roof and water heater are the near-term stories.', 1, 9, 5, 0, null);
  mkVisit.run(pWhit, smeBos, rel(-95), 'spring', 2.0, 'Foundation, roof, gutters',
    'NE corner weep much improved after regrade. North slate face lost two more pieces over winter — moved replacement conversation up.', 1, 2, 5, 1, 'Get Copley slate quote before fall.');
  mkVisit.run(pObr, advBos, rel(-295), 'intake', 6.0, 'All systems, all 3 units',
    'Intake across three units. K&T discovery is the headline; unit 3 fuse box second. Flat roof patched but on borrowed time.', 1, 11, 4, 1, 'K&T remediation quotes.');
  mkVisit.run(pObr, advBos, rel(-25), 'annual', 2.5, 'Roof, electrical, water heaters',
    'Roof patch holding. James approved getting K&T remediation scheduled — coordinating with Beacon.', 1, 1, 5, 1, 'Confirm Beacon start date.');
  mkVisit.run(pChen, advBos, rel(-145), 'intake', 3.0, 'Unit systems',
    'Condo intake: unit mechanicals in good shape. Association reserve study requested for roof/envelope awareness.', 1, 5, 5, 0, null);
  mkVisit.run(pHas, smeLa, rel(-235), 'intake', 5.0, 'All systems',
    'Intake. Cripple-wall retrofit is the defining item; galvanized supply second. Client very engaged on safety framing.', 1, 8, 5, 1, 'QuakeSafe assessment scheduling.');
  mkVisit.run(pAlv, smeLa, rel(-325), 'intake', 4.5, 'All systems',
    '2018 renovation intake — excellent condition throughout. Record is about preserving warranty and service cadence.', 1, 6, 5, 0, null);
  mkVisit.run(pAlv, smeLa, rel(-40), 'quarterly', 1.5, 'HVAC, pool, exterior',
    'Quarterly walk. All quiet. Brush clearance scheduled ahead of LAFD date.', 1, 1, 5, 0, null);
  mkVisit.run(pHas, smeLa, rel(0), 'ad_hoc', 1.0, 'Foundation',
    'QuakeSafe on site for retrofit assessment — advisor attending.', 0, 0, null, 1, 'Review retrofit proposal with Nadia when quote lands.');

  // ── Subscriptions & Intake Fees ────────────────────────────────────────
  const mkSub = ins(`INSERT INTO subscriptions (client_id, period_start, period_end, tier, annual_amount, discount_applied, payment_date, payment_method, status) VALUES (?,?,?,?,?,?,?,?,?)`);
  mkSub.run(whitfield, rel(-420), rel(-55), 'concierge', 2125, 'Charter 15% for life', rel(-420), 'ACH', 'paid');
  mkSub.run(whitfield, rel(-55), rel(310), 'concierge', 2125, 'Charter 15% for life', rel(-50), 'ACH', 'paid');
  mkSub.run(obrien, rel(-300), rel(65), 'managed', 1020, 'Charter 15% for life', rel(-300), 'Card', 'paid');
  mkSub.run(chen, rel(-150), rel(215), 'guided', 500, null, rel(-150), 'Card', 'paid');
  mkSub.run(hassan, rel(-240), rel(125), 'managed', 1020, 'Charter 15% for life', rel(-240), 'ACH', 'paid');
  mkSub.run(alvarez, rel(-330), rel(35), 'concierge', 2125, 'Charter 15% for life', rel(-330), 'ACH', 'paid');

  const mkIntakeFee = ins(`INSERT INTO intake_fees (client_id, property_id, amount, date_paid, payment_method, credit_applied, credit_date) VALUES (?,?,?,?,?,?,?)`);
  mkIntakeFee.run(whitfield, pWhit, 375, rel(-425), 'Card', 1, rel(-420));
  mkIntakeFee.run(obrien, pObr, 375, rel(-310), 'Card', 1, rel(-300));
  mkIntakeFee.run(chen, pChen, 375, rel(-160), 'Card', 1, rel(-150));
  mkIntakeFee.run(hassan, pHas, 375, rel(-250), 'ACH', 1, rel(-240));
  mkIntakeFee.run(alvarez, pAlv, 375, rel(-340), 'ACH', 1, rel(-330));

  // ── Self-Serve demo (US-S1/S2): software only, no advisor, no intake ──
  const taylor = mkClient.run('Taylor', 'Brooks', 'taylor@client.demo', '617-555-0207', 'email',
    BOS, null, 'self_serve', rel(-60), rel(305), 129, 0, 0, null,
    'self_serve_signup', 'active', null, clientPw).lastInsertRowid;
  const pTaylor = mkProp.run('86 Winter Hill Ave', 'Somerville', 'MA', '02145', taylor, BOS,
    1998, 1650, 2, 3, 1.5, 'townhouse', 'wood_frame', 'poured_concrete', rel(-1500),
    null, rel(-58), null, 40,
    null).lastInsertRowid;
  mkSys.run('Gas furnace', pTaylor, 'HVAC - Heating',
    'Forced hot air, basement closet.', yearsAgo(10), null, 20, 4,
    null, null, null, rel(-430), 0, null);
  mkSys.run('Gas water heater', pTaylor, 'Water Heater - Gas',
    '40-gal tank, basement.', yearsAgo(7), null, 12, 4,
    null, null, null, null, 0, null);
  mkSys.run('Asphalt shingle roof', pTaylor, 'Roof - Asphalt',
    'Installed by previous owner, per disclosure.', yearsAgo(16), null, 30, 3,
    null, null, null, null, 0, null);
  mkSys.run('Smoke / CO detectors', pTaylor, 'Safety Systems',
    'Battery units, replaced last year.', yearsAgo(1), null, 10, 5,
    null, null, null, null, 0, null);
  mkSub.run(taylor, rel(-60), rel(305), 'self_serve', 129, 'payments bypassed (demo)', rel(-60), 'Card', 'paid');
  mkEquip.run(pTaylor, null, 'Portable generator', 'Kept in garage for outages; self-entered.', 'Honda', 'EU2200i', null,
    yearsAgo(3), 12, rel(200), 4, null);

  // ── Documents (small real files so download works out of the box) ─────
  const mkDoc = ins(`INSERT INTO documents
    (document_name, document_type, file_path, mime_type, size_bytes, property_id, system_id, equipment_id, maintenance_log_id, permit_id, description, upload_date, uploaded_by_user, uploaded_by_client)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const writeDemoFile = (name, content) => {
    const p = path.join(FILES_DIR, name);
    fs.writeFileSync(p, content);
    return { rel: name, size: Buffer.byteLength(content) };
  };
  let f = writeDemoFile('whitfield-boiler-service-invoice.txt',
    'Hearthside Mechanical — Invoice HM-8841\nAnnual steam boiler service, 47 Sumner Hill Rd\nTotal: $385.00\n');
  mkDoc.run('Boiler service invoice (Hearthside)', 'invoice', f.rel, 'text/plain', f.size, pWhit, sWhitBoiler, null, null, null,
    'Annual steam service invoice.', rel(-427), smeBos, null);
  f = writeDemoFile('whitfield-intake-summary.txt',
    'Steward Intake Summary — 47 Sumner Hill Rd, Jamaica Plain\n7 systems logged; 3 permits researched; 1 gap flag.\n\nThis assessment is an advisory walkthrough, not a licensed home inspection.\n');
  mkDoc.run('Intake summary', 'inspection_report', f.rel, 'text/plain', f.size, pWhit, null, null, null, null,
    'Client-facing intake debrief document.', rel(-414), smeBos, null);
  f = writeDemoFile('hassan-strap-photo-note.txt',
    '[Photo placeholder] Water heater seismic straps after re-tensioning, garage, 5214 Range View Ave.\n');
  mkDoc.run('Seismic straps — after photo', 'photo', f.rel, 'text/plain', f.size, pHas, sHasWH, null, null, null,
    'Straps re-tensioned at intake.', rel(-450), smeLa, null);
  f = writeDemoFile('whitfield-wolf-range-warranty.txt',
    'Wolf Extended Warranty Certificate\nModel DF486G, Serial WF-99120\nCoverage: parts and labor.\n');
  mkDoc.run('Wolf range — extended warranty', 'warranty', f.rel, 'text/plain', f.size, pWhit, sWhitAppl, eqWolf, null, null,
    'Extended warranty certificate for the Wolf range.', rel(-400), smeBos, null);

  // ── Client request (portal) ────────────────────────────────────────────
  ins(`INSERT INTO client_requests (client_id, property_id, created_at, subject, body, status) VALUES (?,?,?,?,?,?)`)
    .run(obrien, pObr, new Date(Date.now() - 2 * DAY).toISOString(),
      'Dripping sound in rear stairwell wall',
      'Since last week there is a faint drip inside the wall of the rear stairwell after anyone showers in unit 2. Can someone take a look?', 'open');

  // ── Rules engine pass + curated schedule state ────────────────────────
  const gen = rulesEngine.recomputeAll({ kind: 'system', id: null });

  // Make the demo dashboard tell the full story: some items overdue, one
  // scheduled with a contractor, plus a couple of hand-entered items the
  // engine wouldn't know about.
  const mkFwd = ins(`INSERT INTO forward_schedule
    (item_name, property_id, system_id, due_date, due_window, priority, status, est_cost_low, est_cost_high,
     capital_forecast_item, assigned_contractor_id, deferral_risk, advisor_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  mkFwd.run('North-face slate repair — priority sections', pWhit, null, rel(-21), '30d', 'urgent', 'upcoming',
    2500, 6000, 0, null,
    'Each winter freeze-thaw cycle without repair loses more slates; interior leak risk at the master bedroom ceiling.',
    'Copley quote requested at spring visit — chase Brendan.');
  mkFwd.run('Knob-and-tube remediation — basement & rear stairwell', pObr, null, rel(14), '30d', 'urgent', 'scheduled',
    4500, 8000, 0, conBeacon,
    'Live K&T is an active fire risk and an insurance non-renewal trigger.',
    'Beacon confirmed crew for two weeks out. James approved at annual visit.');
  mkFwd.run('Unit 3 fuse box → breaker panel upgrade', pObr, null, rel(180), '180d', 'standard', 'upcoming',
    2800, 4500, 1, null,
    'Fuse boxes are an insurance flag and a tenant-safety issue; do together with K&T work if budget allows.', null);
  mkFwd.run('Cripple-wall seismic retrofit', pHas, null, rel(75), '90d', 'urgent', 'scheduled',
    5500, 9500, 1, conQuake,
    'Unretrofitted cripple walls are the primary failure mode for pre-1980 LA bungalows in a major quake.',
    'QuakeSafe assessment today; EBB grant window open.');
  mkFwd.run('LAFD brush clearance', pAlv, null, rel(10), '30d', 'standard', 'scheduled',
    400, 700, 0, null, 'LAFD inspection letters go out early summer; non-compliance fines start at $356.', null);

  console.log(`Seeded: 3 markets, 5 staff, ${db.prepare('SELECT COUNT(*) n FROM clients').get().n} clients, ` +
    `${db.prepare('SELECT COUNT(*) n FROM properties').get().n} properties, ${db.prepare('SELECT COUNT(*) n FROM systems').get().n} systems, ` +
    `${db.prepare('SELECT COUNT(*) n FROM maintenance_rules').get().n} rules, ` +
    `${db.prepare('SELECT COUNT(*) n FROM forward_schedule').get().n} schedule items (${gen.created} rule-generated).`);
  console.log('Logins — staff: founder@steward.demo / marcus@ / elena@ / dana@ / priya@steward.demo (steward123)');
  console.log('         clients: sarah@ / james@ / mia@ / nadia@ / victor@client.demo (welcome123)');
  console.log('         self-serve demo: taylor@client.demo (welcome123)');
  return true;
}

if (require.main === module) {
  seed({ reset: process.argv.includes('--reset') });
}

module.exports = { seed };
