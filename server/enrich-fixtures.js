// Bundled permit fixtures for offline / demo enrichment. Each record mirrors
// the real field shape of Boston's "Approved Building Permits" CKAN dataset
// (permitnumber, worktype, permittypedescr, description, applicant,
// issued_date, status, occupancytype, …) so the same extractor code runs
// against these and against the live API. Addresses are illustrative.

const fixtureKey = (address) =>
  String(address || '').split(',')[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const FIXTURES = {
  // A Jamaica Plain triple-decker with a rich permit history.
  [fixtureKey('35 Sample St')]: {
    city: 'Boston', state: 'MA', zip: '02130',
    property_type: 'triple_decker', year_built: 1905, square_footage: 2400,
    occupancytype: '3fam',
    permits: [
      { permitnumber: 'ERT2022-041882', worktype: 'INTREN', permittypedescr: 'Amendment to a Long Form',
        description: 'Install 3-zone ductless mini-split heat pump system for units 1–3.',
        applicant: 'Cool Comfort HVAC', issued_date: '2022-06-10', status: 'Open', occupancytype: '3fam' },
      { permitnumber: 'PLM2020-118820', worktype: 'PLM', permittypedescr: 'Plumbing Permit',
        description: 'Replace existing 50 gallon gas-fired water heater, unit 1.',
        applicant: 'Bay State Plumbing', issued_date: '2020-09-15', status: 'Closed', occupancytype: '3fam' },
      { permitnumber: 'ELV2021-009142', worktype: 'INTREN', permittypedescr: 'Electrical Permit',
        description: 'Upgrade electrical service to 200A; install new breaker panel and meter.',
        applicant: 'Beacon Electric', issued_date: '2021-03-22', status: 'Closed', occupancytype: '3fam' },
      { permitnumber: 'GAS2019-093310', worktype: 'GAS', permittypedescr: 'Gas Permit',
        description: 'Install one new gas-fired hot water boiler; remove existing unit.',
        applicant: 'Hearthside Mechanical', issued_date: '2019-11-04', status: 'Closed', occupancytype: '3fam' },
      { permitnumber: 'INT2018-070155', worktype: 'INTREN', permittypedescr: 'Long Form / Alteration',
        description: 'Gut renovation of kitchen and bathroom, unit 2. No change of occupancy.',
        applicant: 'Owner', issued_date: '2018-07-01', status: 'Closed', occupancytype: '3fam' },
      { permitnumber: 'EXT2016-051440', worktype: 'ROOF', permittypedescr: 'Roofing Permit',
        description: 'Strip and re-roof main roof; architectural asphalt shingles.',
        applicant: 'Copley Roofing', issued_date: '2016-05-14', status: 'Closed', occupancytype: '3fam' },
    ],
  },
  // A South Boston single-family with a lighter history.
  [fixtureKey('88 Example Ave')]: {
    city: 'Boston', state: 'MA', zip: '02127',
    property_type: 'single_family', year_built: 1925, square_footage: 1500,
    occupancytype: '1fam',
    permits: [
      { permitnumber: 'GAS2023-041551', worktype: 'GAS', permittypedescr: 'Gas Permit',
        description: 'Replace oil boiler with new high-efficiency gas furnace and central A/C.',
        applicant: 'South Shore Heating & Cooling', issued_date: '2023-04-15', status: 'Open', occupancytype: '1fam' },
      { permitnumber: 'EXT2014-080122', worktype: 'ROOF', permittypedescr: 'Roofing Permit',
        description: 'Re-roof; architectural asphalt shingles over main structure.',
        applicant: 'Harborview Roofing', issued_date: '2014-08-01', status: 'Closed', occupancytype: '1fam' },
      { permitnumber: 'BLD2011-052077', worktype: 'INTREN', permittypedescr: 'Short Form Alteration',
        description: 'Replace all windows (12) with new double-hung vinyl units.',
        applicant: 'Glass City Windows', issued_date: '2011-05-20', status: 'Closed', occupancytype: '1fam' },
    ],
  },
};

module.exports = { FIXTURES, fixtureKey };
