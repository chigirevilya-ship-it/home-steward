-- Steward — Home Advisory & Concierge Platform
-- SQLite schema. One table per §3.2 of the system design, plus
-- sessions, audit_log, and client_requests (portal request submission, §2.1).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS markets (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  city             TEXT,
  state            TEXT,
  launch_date      TEXT,
  operator_partner TEXT,
  active_zip_codes TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','planned','inactive')),
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('founder','sme','advisor','coordinator','biz_dev')),
  market_id     INTEGER REFERENCES markets(id),
  hire_date     TEXT,
  comp_model    TEXT CHECK (comp_model IN ('model_a','model_b','salary','na') OR comp_model IS NULL),
  active        INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT UNIQUE,
  phone                TEXT,
  preferred_contact    TEXT CHECK (preferred_contact IN ('email','text','call') OR preferred_contact IS NULL),
  market_id            INTEGER NOT NULL REFERENCES markets(id),
  advisor_id           INTEGER REFERENCES users(id),
  tier                 TEXT NOT NULL CHECK (tier IN ('guided','managed','concierge','self_serve')),
  subscription_start   TEXT,
  subscription_renewal TEXT,
  annual_rate          REAL,
  charter_member       INTEGER NOT NULL DEFAULT 0,
  intake_fee_paid      INTEGER NOT NULL DEFAULT 0,
  intake_fee_date      TEXT,
  referral_source      TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','prospect')),
  notes                TEXT,             -- internal only: never rendered in client portal
  password_hash        TEXT              -- client portal login
);

CREATE TABLE IF NOT EXISTS properties (
  id                  INTEGER PRIMARY KEY,
  address_line1       TEXT NOT NULL,
  address_line2       TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  market_id           INTEGER NOT NULL REFERENCES markets(id),
  year_built          INTEGER,           -- pre-1960 triggers extended intake protocol
  square_footage      INTEGER,
  stories             REAL,
  bedrooms            INTEGER,
  bathrooms           REAL,
  property_type       TEXT CHECK (property_type IN ('single_family','two_family','triple_decker','condo','townhouse') OR property_type IS NULL),
  construction_type   TEXT CHECK (construction_type IN ('wood_frame','masonry','stucco','mixed') OR construction_type IS NULL),
  foundation_type     TEXT CHECK (foundation_type IN ('fieldstone','poured_concrete','slab','crawlspace','basement') OR foundation_type IS NULL),
  ownership_date      TEXT,
  permit_jurisdiction TEXT,
  intake_date         TEXT,
  advisor_id          INTEGER REFERENCES users(id),
  record_completeness INTEGER NOT NULL DEFAULT 0 CHECK (record_completeness BETWEEN 0 AND 100),
  narrative_summary   TEXT,              -- the free-text essence of the home
  active              INTEGER NOT NULL DEFAULT 1
);

-- Controlled vocabulary (§3.3) is enforced in application code so the list can
-- be surfaced to the UI from one place (see server/vocab.js).
CREATE TABLE IF NOT EXISTS systems (
  id                INTEGER PRIMARY KEY,
  system_name       TEXT NOT NULL,
  property_id       INTEGER NOT NULL REFERENCES properties(id),
  category          TEXT NOT NULL,       -- join key to maintenance_rules.system_category
  description       TEXT,
  install_date      TEXT,
  age_at_intake     REAL,                -- only if install date unknown
  expected_lifespan REAL,                -- years
  condition_rating  INTEGER CHECK (condition_rating BETWEEN 1 AND 5 OR condition_rating IS NULL),
  model_number      TEXT,
  serial_number     TEXT,
  warranty_expiry   TEXT,
  last_service_date TEXT,
  needs_specialist  INTEGER NOT NULL DEFAULT 0,
  advisor_notes     TEXT,                -- internal only
  active            INTEGER NOT NULL DEFAULT 1   -- 0 once retired/replaced (history kept)
);

-- Equipment: individual components with their own lifespan/warranty story.
-- Finer-grained than a system and optionally attached to one (a condenser and
-- air handler inside "HVAC - Cooling"), or freestanding (a generator).
-- Informational + warranty reminders only: the rules engine runs on systems.
CREATE TABLE IF NOT EXISTS equipment (
  id                INTEGER PRIMARY KEY,
  property_id       INTEGER NOT NULL REFERENCES properties(id),
  system_id         INTEGER REFERENCES systems(id),   -- optional parent system
  name              TEXT NOT NULL,
  description       TEXT,
  make              TEXT,
  model_number      TEXT,
  serial_number     TEXT,
  install_date      TEXT,
  expected_lifespan REAL,                             -- years
  warranty_expiry   TEXT,
  condition_rating  INTEGER CHECK (condition_rating BETWEEN 1 AND 5 OR condition_rating IS NULL),
  advisor_notes     TEXT,                             -- internal only
  active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS permits (
  id                      INTEGER PRIMARY KEY,
  property_id             INTEGER NOT NULL REFERENCES properties(id),
  permit_number           TEXT,
  date_filed              TEXT,
  date_finaled            TEXT,
  status                  TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('finaled','open','expired','pending','unknown')),
  permit_type             TEXT CHECK (permit_type IN ('electrical','plumbing','structural','mechanical','general_building','demolition','other') OR permit_type IS NULL),
  scope_description       TEXT,
  contractor_of_record    TEXT,
  final_inspection_passed INTEGER,
  gap_flag                INTEGER NOT NULL DEFAULT 0,  -- visible improvement, no matching permit
  gap_notes               TEXT,
  researched_date         TEXT,
  researched_by           INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS maintenance_log (
  id                     INTEGER PRIMARY KEY,
  property_id            INTEGER NOT NULL REFERENCES properties(id),
  system_id              INTEGER REFERENCES systems(id),
  date                   TEXT NOT NULL,
  description            TEXT NOT NULL,
  contractor_id          INTEGER REFERENCES contractors(id),
  invoice_amount         REAL,
  invoice_reference      TEXT,
  advisor_present        INTEGER NOT NULL DEFAULT 0,
  outcome_notes          TEXT,
  updated_system_record  INTEGER NOT NULL DEFAULT 0,
  forward_item_generated INTEGER NOT NULL DEFAULT 0,
  equipment_id           INTEGER REFERENCES equipment(id),
  performed_by           TEXT,              -- free text: self-serve / non-network work
  client_contractor_id   INTEGER REFERENCES client_contractors(id)
);

CREATE TABLE IF NOT EXISTS forward_schedule (
  id                       INTEGER PRIMARY KEY,
  item_name                TEXT NOT NULL,
  property_id              INTEGER NOT NULL REFERENCES properties(id),
  system_id                INTEGER REFERENCES systems(id),
  due_date                 TEXT,
  due_window               TEXT CHECK (due_window IN ('30d','90d','180d','1yr','2yr','3_5yr','5yr_plus') OR due_window IS NULL),
  priority                 TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('urgent','standard','planning')),
  status                   TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','scheduled','completed','deferred','cancelled')),
  est_cost_low             REAL,
  est_cost_high            REAL,
  capital_forecast_item    INTEGER NOT NULL DEFAULT 0,
  assigned_contractor_id   INTEGER REFERENCES contractors(id),
  completed_date           TEXT,
  maintenance_log_id       INTEGER REFERENCES maintenance_log(id),
  deferral_risk            TEXT,
  advisor_notes            TEXT,          -- internal only
  source_rule_id           INTEGER REFERENCES maintenance_rules(id), -- set when generated by the rules engine
  equipment_id             INTEGER REFERENCES equipment(id),
  custom                   INTEGER NOT NULL DEFAULT 0,  -- client-created task (editable/deletable by its owner)
  repeat_value             REAL,          -- custom tasks: repeat every N units on completion
  repeat_unit              TEXT CHECK (repeat_unit IN ('days','months','years') OR repeat_unit IS NULL)
);

CREATE TABLE IF NOT EXISTS visits (
  id                      INTEGER PRIMARY KEY,
  property_id             INTEGER NOT NULL REFERENCES properties(id),
  advisor_id              INTEGER NOT NULL REFERENCES users(id),
  visit_date              TEXT NOT NULL,
  visit_type              TEXT NOT NULL CHECK (visit_type IN ('intake','annual','spring','fall','quarterly','ad_hoc')),
  duration_hrs            REAL,
  systems_reviewed        TEXT,
  findings_summary        TEXT,
  home_record_updated     INTEGER NOT NULL DEFAULT 0,
  forward_items_generated INTEGER NOT NULL DEFAULT 0,
  client_satisfaction     INTEGER CHECK (client_satisfaction BETWEEN 1 AND 5 OR client_satisfaction IS NULL),
  follow_up_required      INTEGER NOT NULL DEFAULT 0,
  follow_up_notes         TEXT
);

CREATE TABLE IF NOT EXISTS contractors (
  id                 INTEGER PRIMARY KEY,
  company_name       TEXT NOT NULL,
  primary_contact    TEXT,
  email              TEXT,
  phone              TEXT,
  market_id          INTEGER NOT NULL REFERENCES markets(id),  -- contractors never cross markets
  trades             TEXT NOT NULL DEFAULT '[]',               -- JSON array of trade names
  license_number     TEXT,
  license_expiry     TEXT,
  license_current    INTEGER NOT NULL DEFAULT 0,
  insurance_on_file  INTEGER NOT NULL DEFAULT 0,
  insurance_expiry   TEXT,
  first_vetted_date  TEXT,
  vetting_notes      TEXT,
  referral_fee_rate  REAL,                                     -- 0.10–0.12 typical
  preferred_pricing  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','probation','inactive','removed')),
  removal_reason     TEXT
);

CREATE TABLE IF NOT EXISTS contractor_ratings (
  id                 INTEGER PRIMARY KEY,
  contractor_id      INTEGER NOT NULL REFERENCES contractors(id),
  property_id        INTEGER REFERENCES properties(id),
  maintenance_log_id INTEGER REFERENCES maintenance_log(id),
  rating_date        TEXT NOT NULL,
  score              INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  client_comments    TEXT,
  advisor_notes      TEXT,                -- internal only
  complaint_flag     INTEGER NOT NULL DEFAULT 0   -- auto-set when score <= 2
);

CREATE TABLE IF NOT EXISTS referral_fees (
  id                 INTEGER PRIMARY KEY,
  contractor_id      INTEGER NOT NULL REFERENCES contractors(id),
  property_id        INTEGER REFERENCES properties(id),
  maintenance_log_id INTEGER REFERENCES maintenance_log(id),
  job_date           TEXT,
  invoice_amount     REAL,
  fee_rate           REAL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invoiced','paid','disputed','waived')),
  invoice_date       TEXT,
  payment_date       TEXT,
  payment_method     TEXT
  -- fee_amount is calculated: invoice_amount * fee_rate (see API)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               INTEGER PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES clients(id),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN ('guided','managed','concierge','self_serve')),
  annual_amount    REAL,
  discount_applied TEXT,
  payment_date     TEXT,
  payment_method   TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','pending','overdue','refunded','cancelled'))
);

CREATE TABLE IF NOT EXISTS intake_fees (
  id             INTEGER PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id),
  property_id    INTEGER REFERENCES properties(id),
  amount         REAL NOT NULL DEFAULT 375,
  date_paid      TEXT,
  payment_method TEXT,
  credit_applied INTEGER NOT NULL DEFAULT 0,
  credit_date    TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id                 INTEGER PRIMARY KEY,
  document_name      TEXT NOT NULL,
  document_type      TEXT NOT NULL DEFAULT 'other' CHECK (document_type IN ('photo','permit_doc','quote','invoice','receipt','contract','warranty','home_record_pdf','inspection_report','other')),
  file_path          TEXT,               -- relative path under data/files/
  mime_type          TEXT,
  size_bytes         INTEGER,
  property_id        INTEGER REFERENCES properties(id),
  system_id          INTEGER REFERENCES systems(id),
  equipment_id       INTEGER REFERENCES equipment(id),
  maintenance_log_id INTEGER REFERENCES maintenance_log(id),
  permit_id          INTEGER REFERENCES permits(id),
  description        TEXT,
  upload_date        TEXT,
  uploaded_by_user   INTEGER REFERENCES users(id),
  uploaded_by_client INTEGER REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS maintenance_rules (
  id                     INTEGER PRIMARY KEY,
  task_name              TEXT NOT NULL,
  system_category        TEXT NOT NULL,   -- must match systems.category exactly
  frequency_type         TEXT NOT NULL CHECK (frequency_type IN ('recurring_annual','recurring_seasonal','recurring_monthly','recurring_custom','age_based','one_time_at_intake','one_time_at_install','condition_triggered')),
  frequency_value        REAL,
  frequency_unit         TEXT CHECK (frequency_unit IN ('days','months','years') OR frequency_unit IS NULL),
  seasonal_timing        TEXT CHECK (seasonal_timing IN ('spring','fall','spring_and_fall','winter','summer') OR seasonal_timing IS NULL),
  lead_time_days         INTEGER NOT NULL DEFAULT 30,
  est_cost_low           REAL,
  est_cost_high          REAL,
  priority               TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('urgent','standard','planning')),
  capital_forecast_item  INTEGER NOT NULL DEFAULT 0,
  applies_age_min_yrs    REAL,
  applies_age_max_yrs    REAL,
  home_vintage_before    INTEGER,
  condition_threshold    INTEGER,
  market_id              INTEGER REFERENCES markets(id),  -- NULL = all markets
  specialist_required    INTEGER NOT NULL DEFAULT 0,
  diy_possible           INTEGER NOT NULL DEFAULT 0,
  advisor_talking_points TEXT,
  rule_source            TEXT,
  active                 INTEGER NOT NULL DEFAULT 1,      -- rules are deactivated, never deleted
  last_reviewed          TEXT
);

-- Personal contractor book for Self-Serve clients: people they hire
-- themselves. Entirely separate from the vetted market network (contractors
-- table) — no licenses, no insurance gating, no referral fees.
CREATE TABLE IF NOT EXISTS client_contractors (
  id         INTEGER PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  name       TEXT NOT NULL,
  company    TEXT,
  specialty  TEXT,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_client_contractors ON client_contractors(client_id);

-- AI suggestion feedback: which suggested tasks homeowners actually accepted,
-- keyed by an item "profile" (category, refined by make). This is the fleet
-- learning signal — as more homes keep the same recommendations for, say, a
-- gas water heater, those tasks become the consistent baseline the next
-- suggestion is anchored to, so identical systems get identical advice.
CREATE TABLE IF NOT EXISTS suggestion_feedback (
  id               INTEGER PRIMARY KEY,
  profile_key      TEXT NOT NULL,       -- normalized: "system:water_heater" (+ "|make")
  category         TEXT,
  kind             TEXT,                -- 'system' | 'equipment'
  make             TEXT,
  task_name        TEXT NOT NULL,
  interval_months  INTEGER,
  priority         TEXT,
  source           TEXT,                -- 'ai' | 'rules' (which engine proposed it)
  client_id        INTEGER REFERENCES clients(id),
  property_id      INTEGER REFERENCES properties(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggest_feedback_profile ON suggestion_feedback(profile_key);
CREATE INDEX IF NOT EXISTS idx_suggest_feedback_cat ON suggestion_feedback(category, kind);

-- Portal request submission (§2.1: clients "can submit requests")
CREATE TABLE IF NOT EXISTS client_requests (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  property_id INTEGER REFERENCES properties(id),
  created_at  TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT
);

-- Auditability (§8): every record change tracked — who, when, what.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  ts         TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff','client','system')),
  actor_id   INTEGER,
  action     TEXT NOT NULL,             -- create / update / delete / login / rules_recompute / ...
  table_name TEXT,
  record_id  INTEGER,
  detail     TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('staff','client')),
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_properties_client  ON properties(client_id);
CREATE INDEX IF NOT EXISTS idx_properties_market  ON properties(market_id);
CREATE INDEX IF NOT EXISTS idx_systems_property   ON systems(property_id);
CREATE INDEX IF NOT EXISTS idx_equipment_property ON equipment(property_id);
CREATE INDEX IF NOT EXISTS idx_permits_property   ON permits(property_id);
CREATE INDEX IF NOT EXISTS idx_log_property       ON maintenance_log(property_id);
CREATE INDEX IF NOT EXISTS idx_fwd_property       ON forward_schedule(property_id);
CREATE INDEX IF NOT EXISTS idx_fwd_status         ON forward_schedule(status);
CREATE INDEX IF NOT EXISTS idx_visits_property    ON visits(property_id);
CREATE INDEX IF NOT EXISTS idx_ratings_contractor ON contractor_ratings(contractor_id);
CREATE INDEX IF NOT EXISTS idx_fees_contractor    ON referral_fees(contractor_id);
CREATE INDEX IF NOT EXISTS idx_docs_property      ON documents(property_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts           ON audit_log(ts);
