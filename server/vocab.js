// Controlled vocabularies. The system-category list (§3.3) is the join key
// between Systems Inventory and Maintenance Rules — any mismatch breaks the
// rules engine, so both tables validate against this single list.

const SYSTEM_CATEGORIES = [
  'HVAC - Heating', 'HVAC - Cooling', 'Mini-Split / Heat Pump',
  'Water Heater - Gas', 'Water Heater - Oil', 'Water Heater - Tankless',
  'Electrical Panel', 'Electrical Wiring',
  'Plumbing - Supply', 'Plumbing - Drain',
  'Roof - Asphalt', 'Roof - Flat', 'Gutters',
  'Foundation', 'Exterior Cladding', 'Windows / Doors',
  'Insulation', 'Chimney / Fireplace', 'Deck / Exterior Wood',
  'Garage', 'Pest / Termite', 'Safety Systems',
  'Appliances', 'Septic', 'Well Water',
  'Other',
];

const TRADES = [
  'HVAC', 'Plumbing', 'Electrical', 'Roofing', 'Carpentry', 'Masonry',
  'Painting', 'Landscaping', 'Chimney', 'Insulation', 'Pest Control',
  'Foundation / Structural', 'Windows / Doors', 'Appliance Repair',
  'Septic', 'General Contracting', 'Handyman',
];

const TIERS = {
  guided:     { label: 'Guided',     price: 500,  advisor_hrs: 2.5, visits_per_year: 1 },
  managed:    { label: 'Managed',    price: 1200, advisor_hrs: 7,   visits_per_year: 2 },
  concierge:  { label: 'Concierge',  price: 2500, advisor_hrs: 26,  visits_per_year: 4 },
  self_serve: { label: 'Self-Serve', price: 129,  advisor_hrs: 0,   visits_per_year: 0 },
};

// Every client-facing intake output carries this (business rule #10).
const SCOPE_DISCLAIMER =
  'This assessment is an advisory walkthrough, not a licensed home inspection.';

module.exports = { SYSTEM_CATEGORIES, TRADES, TIERS, SCOPE_DISCLAIMER };
