# Steward — User Stories

*A granular, functionality-level user-story specification for Steward. This
document is written so that the product's actual features could be
re-derived from the stories alone — each story maps to a real screen, API
route, or data-model behavior in the codebase (cited inline), or is
explicitly marked **[PLANNED]** where the behavior is designed but not yet
built. Read alongside `BUSINESS.md` (the "why") and `TECHNICAL.md` (the
"how") — this document is the "what," at the grain of a single user action.*

*Format: **As a** [persona], **I want** [capability], **so that** [reason].
Each story includes acceptance-level detail — the specific fields, gates, or
edge cases a rebuild would need to reproduce the real behavior.*

---

## Contents

1. [Personas (recap)](#1-personas-recap)
2. [Authentication & account lifecycle](#2-authentication--account-lifecycle)
3. [Self-serve onboarding & address auto-build](#3-self-serve-onboarding--address-auto-build)
4. [The Home Record — systems & equipment](#4-the-home-record--systems--equipment)
5. [Service history / maintenance log](#5-service-history--maintenance-log)
6. [The forward schedule (calendar & tasks)](#6-the-forward-schedule-calendar--tasks)
7. [AI-assisted recommendations](#7-ai-assisted-recommendations)
8. [Permits](#8-permits)
9. [Documents & the vault](#9-documents--the-vault)
10. [Contractors — client's personal book](#10-contractors--clients-personal-book)
11. [Forecast & cost intelligence](#11-forecast--cost-intelligence)
12. [Export & data ownership](#12-export--data-ownership)
13. [Tier gating & upgrade](#13-tier-gating--upgrade)
14. [Staff — advisor workflows](#14-staff--advisor-workflows)
15. [Staff — contractor network management](#15-staff--contractor-network-management)
16. [Staff — client requests](#16-staff--client-requests)
17. [Founder / operator console](#17-founder--operator-console)
18. [Rules library (shared maintenance logic)](#18-rules-library-shared-maintenance-logic)
19. [Notifications & delivery — PLANNED](#19-notifications--delivery--planned)
20. [Platform, security & audit](#20-platform-security--audit)

---

## 1. Personas (recap)

| # | Persona | One-line role |
|---|---|---|
| P1 | **Enhanced owner** | Paid self-serve homeowner; the primary target |
| P2 | **Basic owner** | Free self-serve homeowner; the lead magnet |
| P3 | **Guided owner** | Paid, human-validated, self-managed |
| P4 | **Managed owner** | Paid, fully managed by an advisor |
| P5 | **Founder / operator** | Runs the business end to end |
| P6 | **SME advisor** | Senior expert; complex intakes/assessments |
| P7 | **Advisor** | Runs visits, logs jobs, maintains records within a market |
| P8 | **Contractor** | Vetted trade partner receiving referrals |

P1–P3 log into the same **client portal**, but only self-managed tiers
(`isSelfManaged`: basic, enhanced, self_serve) see its edit affordances —
every add/edit control in the portal is gated behind `r.self_serve`. P4
(Guided/Managed) sees the **same portal in read-only form**: their advisor
maintains the record on their behalf via the staff app, and the client view
shows the result without write access. P5–P7 use the **staff app**. P8
never logs into Steward — they're a record, not a user.

---

## 2. Authentication & account lifecycle

**2.1** — As any user (staff or client), I want to log in with email +
password, so that I reach my own portal.
*`POST /api/login` → session cookie; `state.me.kind` (`staff`|`client`)
routes to the staff app or client portal.*

**2.2** — As a returning user, I want my session to persist across browser
restarts (until it expires), so that I don't have to log in every visit.
*`GET /api/me` on load resolves an existing session cookie.*

**2.3** — As any user, I want to sign out explicitly, so that a shared
device doesn't stay logged in.
*`POST /api/logout` clears the session.*

**2.4** — As a prospective homeowner, I want to create my own free account
without talking to anyone, so that I can start documenting my home today.
*`POST /api/signup` — first/last name, email, password (8+ chars), market
selection, tier choice (basic/enhanced radio). Creates a `clients` row with
`referral_source = '<tier>_signup'`.*

**2.5** — As a signup user, I want to pick my metro area from a list, so
that my account is scoped to the right regional rules/permit data.
*`GET /api/signup/markets` — active markets only; region label omits city
when `city IS NULL` (e.g. "Central New Jersey" vs. "Boston, MA").*

**2.6** — As a signup user, I want to choose Basic (free) or Enhanced at
signup, not after, so that I land in the right experience immediately.
*Tier radio defaults to `basic`; `enhanced` currently ships free ("free
during the demo") — same signup flow, no payment step exists yet.*

**2.7** — As a staff member, I want my role (founder/sme/advisor/coordinator/
biz_dev) to determine what navigation I see, so that I only reach tools
relevant to my job.
*`navFor(me)` in `app.js`; founder-only nav items: Market, Referral Ledger,
Rules, Network Health.*

**2.8** — As a founder, I want to set or reset any account's password from
the server, so that I can recover access without a self-service reset flow.
*`node server/set-password.js <email> <password>` — CLI only, 8+ char
minimum enforced.*

---

## 3. Self-serve onboarding & address auto-build

**3.1** — As a new self-serve owner with no home on record, I want to see an
onboarding screen the moment I log in, so that I'm immediately prompted to
build my record instead of landing on an empty dashboard.
*`renderOverview` → `renderOnboarding` when `r.self_serve && !r.property`.*

**3.2** — As a new owner, I want to type my full street address and have
Steward draft my entire home record — property basics, systems, and permit
history — so that I don't have to enter everything by hand.
*`POST /api/portal/enrich { address }` → `enrichAddress()`:*
- *Geocodes via US Census (state/city/zip resolution).*
- *Fetches property facts nationwide via RentCast (year built, sqft,
  bedrooms, bathrooms, lot size, property type) — key-gated on
  `RENTCAST_API_KEY`; a home is fetched once, not re-polled.*
- *Fetches permits: Boston (CKAN open data, with a bundled offline fixture
  fallback) for MA addresses; a per-state adapter
  (`STEWARD_<ST>_PERMITS_URL/METHOD/BODY/PATH`) for other states — Virginia
  ships a working default (Virginia Beach's public ArcGIS FeatureServer),
  New Jersey requires the operator to configure a feed (no fixture, "live
  only" by design).*
- *Classifies each permit's free-text description into a system category
  via a deterministic keyword ruleset (`CLASSIFY`) — e.g. "replace gas water
  heater" → `Water Heater - Gas`; unmatched permits are still kept as permit
  records with no system link.*
- *Groups classified permits into one system per category, taking the most
  recent permit's date as the install date and a category-based expected
  lifespan (`LIFESPAN` map).*

**3.3** — As an owner reviewing the draft, I want to see and individually
uncheck any drafted system or permit that's wrong, before anything is
saved, so that a bad match doesn't pollute my record.
*`renderEnrichDraft` — every system/permit row is a checked-by-default
checkbox; nothing is written until confirmation.*

**3.4** — As an owner whose address returns no permit records, I want a
clear, honest message saying so (not a silent empty screen), so that I know
to build my record by hand instead of assuming something broke.
*`draft.source === 'none'` renders `draft.note` — distinct copy for "no
permits found" vs. state-specific "confirm the feed is configured."*

**3.5** — As an owner whose address has property facts but no permit
matches, I want my basics (year built, size, etc.) filled in anyway, so
that partial public data isn't wasted.
*`source: 'facts_only'` — a dedicated draft outcome distinct from full
success and total failure.*

**3.6** — As an owner, I want to confirm the draft and have my property,
systems, and permits created in one action, with a maintenance schedule
generated immediately, so that I go from address to a working plan in one
step.
*`POST /api/portal/enrich/apply` — creates the `properties` row, one
`systems` row + one `equipment` (unit) row per drafted system (container
model — see §4), links matched permits to their system, then runs
`rulesEngine.generateForProperty()`.*

**3.7** — As an owner who prefers not to use auto-build (or whose address
returns nothing useful), I want a manual entry form with the same fields, so
that I'm never blocked from creating a record.
*The "…or enter your home manually" `<details>` panel — `POST
/api/portal/property` with the same field set (address, year built, type,
sqft, bedrooms, bathrooms, foundation, ownership date).*

**3.8** — As a system, I want each home to have exactly one active property
per client at a time, so that a client can't accidentally create duplicate
homes.
*`enrich/apply` and `portal/property` both 409 if `properties WHERE
client_id = ? AND active = 1` already exists.*

---

## 4. The Home Record — systems & equipment

**4.1** — As an owner, I want "systems" to be simple category containers
(name + category + description only, no dates or model numbers), so that
adding one is a 10-second action, not a form full of fields I may not know.
*`selfSystemModal` — three fields. Category is a controlled-vocabulary
dropdown (`SYSTEM_CATEGORIES`, 25 values: HVAC, water heaters, electrical,
roof, plumbing, appliances, septic, etc.).*

**4.2** — As an owner, I want every system to require at least one "unit"
(equipment) underneath it, so that the concrete facts (install date, make,
model, serial, warranty, condition) live in one consistent place instead of
being duplicated or ambiguous between system and equipment.
*Creating a system immediately chains into `selfEquipmentModal` for the
first unit; a system with zero active units is treated as incomplete.*

**4.3** — As an owner, I want a system's displayed age/install date to be
derived automatically from its equipment, so that I only ever enter a date
once.
*`deriveSystemDates(system, equipList)` in the rules engine — picks the
oldest/most relevant unit's install date when the system itself has none;
no-ops when the system already carries its own dates (e.g. drafted directly
from a permit).*

**4.4** — As an owner with a multi-component system (e.g. a mini-split with
an outdoor condenser and three indoor heads), I want to add each component
as its own equipment row under one system, so that I can track them
individually (each has its own install date, warranty, condition) while
still seeing them as one logical system.
*`equipment.system_id` is a nullable FK — many equipment rows per system.*

**4.5** — As an owner, I want a system card to show a live rollup — number
of units, service count, document count, permit count — so that I can judge
a system's completeness/health at a glance without opening it.
*`renderSystems` cards aggregate child counts across equipment, maintenance
log, documents, and permits.*

**4.6** — As an owner retiring a system I no longer have (e.g. sold the
generator), I want to mark it inactive rather than delete it, so that its
history (past service, documents, permits) is preserved.
*`POST /api/portal/systems/:id/retire` — sets `active = 0`; never a hard
delete.*

**4.7** — As an owner replacing a system's core equipment (e.g. new
furnace), I want a "replace" action that retires the old unit and starts a
new one while keeping the old one's history attached to the system, so that
my system's record doesn't lose its past when the equipment inside it
changes.
*`POST /api/portal/systems/:id/replace` and the equipment-level
equivalent `POST /api/portal/equipment/:id/replace`.*

**4.8** — As an owner, when I'm entering *any* record (a service, a
document, a permit) and the system, equipment, or contractor it relates to
doesn't exist yet, I want to create it inline from within that same form —
not have to cancel, go create it elsewhere, and start over.
*"+ Add new…" inline-create pattern used across the service modal, document
upload, and permit modal pickers.*

**4.9** — As an owner, I want any record entered against a piece of
equipment to automatically also count toward that equipment's parent
system, so that the system's rollup is always accurate without me manually
linking both.
*`parentSystemId(db, equipmentId)` — auto-resolved server-side on
service/task/document/permit creation; also backfilled via migration for
any pre-existing rows (`server/db.js` migrate step).*

**4.10** — As a staff advisor managing a client's record directly, I want
the same system/equipment CRUD available in the staff app, so that I can
build or correct a Guided/Managed client's record on their behalf.
*`POST/PATCH /api/systems`, `POST/PATCH /api/equipment` (staff-scoped,
market-checked).*

---

## 5. Service history / maintenance log

**5.1** — As an owner, I want to log a completed service (what was done,
when, cost, who did it) against a system or piece of equipment, so that my
home's maintenance history is captured in one place instead of a shoebox of
receipts.
*`POST /api/portal/service` — `date`, `description`, `invoice_amount`,
`performed_by` (free text) or `client_contractor_id` (from my own book).*

**5.2** — As an owner, I want to edit or delete a service entry I logged,
so that I can fix a typo or remove a mistaken entry.
*`PATCH`/`DELETE /api/portal/service/:id` — ownership-checked against the
caller's own property.*

**5.3** — As an owner, I want completing a scheduled task to be able to
generate the next occurrence automatically (for repeating items), so that
routine maintenance doesn't require me to manually re-add it every time.
*`forward_schedule.repeat_value` / `repeat_unit` (days/months/years) on
custom tasks; logging a service against an open schedule item marks it
`completed` and can spawn the next due date.*

**5.4** — As an owner, I want a chronological timeline of everything that's
happened to my home — services, documents, permits — so that I can see the
full story of the house in one scroll.
*The timeline view in the client portal merges `maintenance_log`,
`documents`, and `permits` by date.*

**5.5** — As a staff advisor, I want to log a service on behalf of a
Guided/Managed client (including marking whether I was present and whether
it updated the home record or generated a new forward item), so that
professional visits are captured with the same rigor as a client's own
entries.
*`POST /api/maintenance-log` (staff) — extra fields: `advisor_present`,
`updated_system_record`, `forward_item_generated`, `contractor_id` (network
contractor, not `client_contractor_id`).*

---

## 6. The forward schedule (calendar & tasks)

**6.1** — As an owner, I want a generated maintenance schedule the moment I
have systems on record, so that I know what's coming without having to
research it myself.
*`rulesEngine.generateForProperty()` runs on every relevant write (system
add, equipment add, enrich/apply) — matches active `maintenance_rules` by
system category, computes a due date, and inserts into
`forward_schedule` with status `upcoming`.*

**6.2** — As an owner, I want my calendar to update automatically as my
data changes (a new install date, a newly added system), not stay frozen
from when I first set it up, so that the plan stays accurate over time.
*Re-derivation is triggered by writes and by `POST
/api/portal/recompute`; a rule with an already-open item for the same
system doesn't duplicate; one-time rules never regenerate after completion;
condition-triggered rules re-fire as `urgent` only when the triggering
condition persists.*

**6.3** — As an owner, I want to add my own custom task (not from the rules
library) — e.g. "clean out the gutters myself every fall" — with an optional
repeat interval, so that the schedule reflects things unique to my home,
not just generic rules.
*`POST /api/portal/tasks` — `custom = 1`; only custom tasks are
owner-editable/deletable (`PATCH`/`DELETE /api/portal/tasks/:id`);
rule-generated tasks are not.*

**6.4** — As an owner, I want each schedule item tagged with a priority
(urgent / standard / planning) and a due window (30d/90d/180d/1yr/2yr/
3–5yr/5yr+), so that I can tell what needs attention now versus what's
just on the horizon.
*`forward_schedule.priority` + `.due_window`, both enums.*

**6.5** — As an owner, I want to mark a schedule item as scheduled,
completed, deferred, or cancelled, so that my calendar reflects reality,
not just what the rules engine proposed.
*`PATCH /api/portal/schedule/:id` (staff) and task-completion flows
(client) transition `status`.*

**6.6** — As a staff advisor, I want to trigger a full recompute for one
property or run the nightly-style recompute across all active properties,
so that I can force the schedule current after a bulk data correction.
*`POST /api/properties/:id/recompute` (single) and `POST
/api/rules/recompute` (all-properties, `recomputeAll()`).*

---

## 7. AI-assisted recommendations

**7.1** — As an Enhanced+ owner, I want maintenance suggestions tuned to
the specific system or equipment I'm looking at — not a generic rule — using
its actual context (make, model, install date, condition, related
documents), so that the advice is relevant to *my* unit, not a category
average.
*`POST /api/portal/suggest` → `suggest.js` → Claude (model
`claude-opus-4-8` by default, overridable via `STEWARD_AI_MODEL`) when
`opts.allowAI !== false` and `ANTHROPIC_API_KEY` is set; `buildPrompt()`
assembles the system/equipment record plus related documents and fleet
context into the prompt.*

**7.2** — As a Basic (free) owner, I want maintenance suggestions even
without AI, so that the free tier is still genuinely useful, just less
personalized.
*`opts.allowAI = false` for Basic → `suggestViaRules()` — matches the
deterministic `maintenance_rules` library by category only, no model
call.*

**7.3** — As the platform, I want AI suggestions to fall back to the rules
engine automatically if the AI call fails or no API key is configured, so
that the feature degrades gracefully instead of breaking.
*`suggest()` catches AI failure and falls through to `suggestViaRules()`
regardless of tier.*

**7.4** — As the platform, I want to learn from which suggested tasks
homeowners actually keep, grouped by a normalized "profile" (system
category, optionally refined by equipment make), so that recommendations
become consistent across similar homes instead of independently
regenerated (and possibly contradictory) advice each time.
*`suggestion_feedback` table + `profileKey()`/`fleetContext()` — an
accepted suggestion for "Water Heater - Gas" (or "Water Heater - Gas |
Rheem") becomes part of the anchor context for the next home with the same
profile. `POST /api/portal/suggest/accept` records the acceptance.*

**7.5** — As an owner, I want a "✨ Suggest schedule & description" action
available right inside the system/equipment editor, so that I don't have to
leave the form to get help filling it in.
*`sg-btn` in `selfSystemModal`/equipment modal opens the suggest panel
inline.*

**7.6 [PLANNED]** — As an owner, I want to enter just a make + model number
for a piece of equipment and have Steward search the web for its manual/
spec sheet, extract the maintenance schedule and product specs, show me the
sourced draft to confirm, and cache the result so the next home with the
same model gets it instantly. *(Discussed; not yet built. Would use
Claude's web-search/web-fetch tools, a confirm-before-write pattern
matching §3.3, and a shared model→spec cache table analogous to
`suggestion_feedback`.)*

---

## 8. Permits

**8.1** — As an owner, I want to manually add a permit record (number,
dates, status, type, scope, contractor of record) and link it to the system
or equipment it's about, so that I have a place to record my home's permit
history even outside the auto-build flow.
*`POST /api/portal/permits` — pickers for system/equipment with inline-
create (§4.8); `PERMIT_TYPES` enum (electrical/plumbing/structural/
mechanical/general_building/demolition/other); `PERMIT_STATUS` enum
(finaled/open/expired/pending/unknown).*

**8.2** — As an owner, I want to edit or remove a permit I entered, so that
I can correct a mistake.
*`PATCH`/`DELETE /api/portal/permits/:id`.*

**8.3** — As an owner, I want permits found during address auto-build to
already be linked to the system they're about (not just a flat list), so
that a system's detail view shows its full permit history without me
re-linking anything.
*`enrich/apply` sets `permits.system_id` from the drafted permit's
`matched_category`; the detail panel query joins system/equipment names
onto each permit.*

**8.4** — As a staff advisor, I want to record a permit-gap flag — visible
improvement with no matching permit on file — so that unpermitted work is
tracked as a known issue on the record, not silently missing.
*`permits.gap_flag` + `gap_notes` (staff-only fields, not client-created).*

---

## 9. Documents & the vault

**9.1** — As an owner, I want to upload photos, invoices, warranties,
quotes, and other files and attach them to a system, piece of equipment, a
specific service entry, or a permit, so that my paperwork lives with the
thing it's about.
*`POST /api/portal/documents` (multipart-free raw body upload) —
`document_type` enum (photo/permit_doc/quote/invoice/receipt/contract/
warranty/home_record_pdf/inspection_report/other); optional relates-to
links, each ownership-verified against the caller's property.*

**9.2** — As a Basic (free) owner, I want to know when I'm approaching my
storage limit, so that I'm not surprised by a blocked upload.
*Hard cap of 15 documents per property (`BASIC_DOC_CAP`); Enhanced+ is
unlimited. The 403 on the 16th upload explicitly names the upgrade path.*

**9.3** — As an owner, I want a document to auto-associate with its
equipment's parent system when I don't explicitly pick one, so that the
system-level rollup stays accurate without extra clicks.
*Same `parentSystemId()` auto-link as §4.9, applied on document upload.*

---

## 10. Contractors — client's personal book

**10.1** — As a self-serve owner, I want to keep my own list of contractors
I've hired (name, company, specialty, phone, email, notes) — completely
separate from Steward's vetted network — so that I can reference and reuse
them without any licensing/insurance gate.
*`client_contractors` table — distinct from the staff-managed `contractors`
network table; `POST`/`PATCH /api/portal/contractors`.*

**10.2** — As an owner logging a service, I want to pick from my own
contractor book (or add a new one inline) instead of typing a name as free
text every time, so that my service history is consistently attributed.
*`maintenance_log.client_contractor_id` FK; inline-create picker per §4.8.*

---

## 11. Forecast & cost intelligence

**11.1** — As an Enhanced+ owner, I want a full multi-year spend forecast
built from my forward schedule's cost estimates, so that I can plan and
budget instead of being surprised by a large bill.
*Forecast view aggregates `forward_schedule.est_cost_low/high` by year;
`capital_forecast_item` flags big-ticket items for the capital-planning
view.*

**11.2** — As a Basic (free) owner, I want to see only a headline forecast
number (not the full year-by-year breakdown), so that I still get value but
have a clear reason to upgrade.
*`isBasic(tier)` gates the detailed forecast view to headline-only.*

**11.3 [PARTIAL]** — As an owner, I want to know what a specific job
*should* cost (not just what my own schedule estimates), benchmarked
against what the fleet has actually paid, so that I can tell if a quote is
fair before I accept it. *(The cost-range fields exist per rule/task
`est_cost_low/high`; true cross-fleet invoice benchmarking — "Steward logs
real invoice amounts, aggregated across the fleet" — is a business-doc
target, not yet a built aggregation.)*

---

## 12. Export & data ownership

**12.1** — As an owner, I want to export my entire home record as a
document, so that I own my data and can hand it to a buyer, an insurer, or
just keep an offline copy.
*`handleExport()` in `server/index.js` → `renderHomeRecord(client,
property)` in `export.js` — a direct-dispatch HTML export route (not the
`route()` table in portal.js), reachable for a client's own home or any
staff member within their market scope (founders: any market). Available
regardless of tier — export is one of the few things every tier gets.*

**12.2 [ROADMAP]** — As a home seller, I want my record to transfer to the
new owner at sale, so that the "Carfax for houses" value (a documented home
becomes an asset a buyer inherits and a seller can prove care with) is
realized. *(Named directly as differentiator #1 in `BUSINESS.md` §6; no
transfer/handoff mechanism is built yet — export exists, a transfer
*workflow* between two Steward accounts does not.)*

---

## 13. Tier gating & upgrade

**13.1** — As a Basic owner, I want a visible, specific upgrade prompt at
each point where I hit a limitation (document cap, headline-only forecast,
rules-only suggestions), so that the value of upgrading is concrete, not
abstract.
*Each gate (§9.2, §11.2, §7.2) carries its own explicit message rather than
a generic "upgrade" banner.*

**13.2** — As a Basic owner, I want to upgrade to Enhanced from within the
app, so that I don't have to go through signup again or lose my existing
record.
*`POST /api/portal/upgrade` — same client row, `tier` field updated
in place; record, history, and login are preserved.*

**13.3** — As the platform, I want tier semantics centralized in one place
(`vocab.js`: `TIERS`, `isSelfManaged`, `isBasic`), so that every gate in the
codebase reads from the same source of truth instead of duplicating tier
logic.
*Current tier set in code: `basic, enhanced, guided, managed, concierge
(legacy), self_serve (legacy ≈ enhanced)`. Business-doc target collapses
this to Basic/Enhanced/Guided/Managed — see the gap note in §17 and
`BUSINESS.md` §12.*

---

## 14. Staff — advisor workflows

**14.1** — As an advisor, I want a dashboard of my assigned clients/
properties (or all of them, if I'm a founder), so that I know where my
attention is needed.
*`GET /api/dashboard` — market-scoped for non-founder roles via
`scopedWhere()`.*

**14.2** — As an advisor, I want to view a client's full property record —
systems, equipment, permits, documents, service history, schedule — in one
screen, so that I have full context before a visit or a call.
*`GET /api/properties/:id/record`.*

**14.3** — As an advisor, I want to create and edit clients and properties
directly (for Guided/Managed clients, who don't self-serve), so that I can
build and maintain their record on their behalf.
*`POST/PATCH /api/clients`, `POST/PATCH /api/properties`.*

**14.4** — As an advisor, I want to log a visit (type: intake/annual/
spring/fall/quarterly/ad_hoc, duration, systems reviewed, findings,
satisfaction score, follow-up flag), so that professional visits are
tracked with full detail distinct from a simple service-log entry.
*`POST /api/visits`.*

**14.5** — As an SME advisor, I want to run a full intake for a complex or
ambiguous property (e.g. very old construction, unclear systems), so that
professional judgment builds the initial record where auto-build or a
homeowner's own knowledge can't.
*Same staff intake tooling as §14.3, used by the `sme` role for
higher-complexity cases; no code-level distinction between `sme` and
`advisor` beyond the role field and market scoping today.*

**14.6** — As any staff member, I want every client-facing output (e.g. an
intake summary) to carry the scope disclaimer that this is an advisory
walkthrough, not a licensed home inspection, so that Steward's liability
boundary is always explicit.
*`SCOPE_DISCLAIMER` constant, attached to intake outputs.*

---

## 15. Staff — contractor network management

**15.1** — As an advisor or founder, I want to view and filter the vetted
contractor network (by market, trade, status), so that I can find the
right partner for a referral.
*`GET /api/contractors`.*

**15.2** — As a founder, I want to add a contractor to the network with
license number/expiry, insurance-on-file status, trades, and referral fee
rate, so that only vetted partners receive client referrals.
*`POST /api/contractors` — `license_current`, `insurance_on_file` are
explicit gates; `contractors.market_id` — contractors never cross markets.*

**15.3** — As staff, I want to rate a contractor's performance on a
completed job (1–5, with comments), so that the network maintains quality
signal over time.
*`POST /api/ratings` — a score ≤2 auto-sets `complaint_flag`.*

**15.4** — As a founder, I want to see the referral fee ledger — what's
owed by which contractor, by status (pending/invoiced/paid/disputed/
waived) — so that I can manage the referral-fee side of the business.
*`GET /api/founder/fees`, `PATCH /api/founder/fees/:id` — fee amount is
calculated as `invoice_amount × fee_rate`, never stored directly.*

**15.5** — As a founder, I want a network health view — vetting status,
rating trends, complaint flags across the whole contractor base — so that I
can spot a partner who needs to be put on probation or removed.
*`GET /api/founder/network`; `contractors.status` enum includes
`probation`/`removed` with a `removal_reason`.*

**15.6** — As the platform, I want it structurally impossible for Steward to
be in the payment chain between an owner and a contractor, so that the
business model's core boundary (referral fee only, never a payment
processor) is enforced by the data model, not just policy.
*No payment-processing table exists; `referral_fees` tracks the fee owed to
Steward by the contractor, never a client-to-contractor transaction.*

---

## 16. Staff — client requests

**16.1** — As an owner (any tier), I want to submit a free-text request to
my advisor/Steward, so that I have a way to ask something that doesn't fit
a structured form.
*`POST /api/portal/requests` — subject + body; `client_requests.status`
starts `open`.*

**16.2** — As an owner, I want to see my own submitted requests and their
status, so that I know if something's been picked up.
*`GET /api/portal/requests`.*

**16.3** — As staff, I want to see open client requests and mark them
in-progress or resolved, so that nothing submitted by a client falls
through.
*`PATCH /api/requests/:id` — `status` transition sets `resolved_by` /
`resolved_at`.*

---

## 17. Founder / operator console

**17.1** — As a founder, I want a market-level dashboard — active clients,
revenue, subscription status — across every region, so that I can judge
business health at a glance.
*`GET /api/founder/dashboard`.*

**17.2** — As a founder, I want full visibility into every market, client,
and property regardless of advisor assignment, so that nothing is hidden
from the operator role.
*`staff.role === 'founder'` bypasses `scopedWhere()` market restrictions
throughout `routes.js`.*

**17.3** — As a founder, I want a full audit log of every record change —
who, when, what action, on what table/record — so that any change is
traceable.
*`GET /api/founder/audit` reads `audit_log`; every mutating route calls
`audit(actorKind, actorId, action, table, recordId, detail)`.*

**17.4 [GAP]** — As a founder, I want the tier names, prices, and gates in
the running code to match the target business model (Basic/Enhanced/
Guided/Managed) exactly, so that the product I'm operating matches the
model I'm selling. *(Currently the schema/vocab still carries the legacy
`self_serve` ($129) and `concierge` ($2,500) tiers alongside the new
Basic/Enhanced split — see `BUSINESS.md` §12 "the gap between the target
and the code." Not a missing feature so much as unfinished cleanup.)*

---

## 18. Rules library (shared maintenance logic)

**18.1** — As a founder, I want to view, add, edit, and deactivate
maintenance rules (task name, system category, frequency type/value,
lead time, cost range, priority, market scope, age/condition triggers), so
that the baseline maintenance logic driving every Basic-tier and
AI-fallback recommendation is centrally controlled.
*`GET/POST/PATCH/DELETE /api/rules` — rules are deactivated
(`active = 0`), never hard-deleted, preserving history of what generated a
given schedule item.*

**18.2** — As a founder, I want to preview what a rule change would
generate before committing it, so that I don't accidentally flood every
matching property with new schedule items.
*`POST /api/rules/preview`.*

**18.3** — As the platform, I want a rule to be scoped to a specific
market or apply to all markets (`market_id IS NULL`), so that regional
variation (e.g. different seasonal timing) is possible without duplicating
the whole rule set.
*`maintenance_rules.market_id` nullable FK.*

**18.4** — As the platform, I want rule frequency types to cover recurring
(annual/seasonal/monthly/custom), age-based, one-time (at intake or at
install), and condition-triggered logic, so that the rule engine can
express the real variety of how home maintenance actually needs to be
timed.
*`frequency_type` enum, 8 values — see §6.2 for the regeneration
semantics per type.*

---

## 19. Notifications & delivery — PLANNED

*None of this section is built. It is the single most load-bearing gap
between the current app and the "Proactive" pillar's promise — see
`TECHNICAL.md` §5.8. Included here at full granularity because the whole
pillar depends on it, and a rebuild must not treat it as optional.*

**19.1 [PLANNED]** — As an Enhanced+ owner, I want to be notified (email/
push) when a schedule item is coming due, rather than having to open the
app to discover it, so that Steward genuinely watches my home instead of
just displaying a plan I have to remember to check.

**19.2 [PLANNED]** — As an Enhanced+ owner, I want to be alerted when a
piece of equipment's warranty is about to expire, so that I can use it
before it's too late.

**19.3 [PLANNED]** — As an Enhanced+ owner, I want a manufacturer recall
watch on my recorded equipment (by make/model), so that I learn about a
safety recall from Steward, not by accident.

**19.4 [PLANNED]** — As an Enhanced+ owner, I want seasonal/weather-
triggered nudges (e.g. a freeze warning prompts a "protect your pipes"
reminder), so that timely, condition-specific advice reaches me instead of
only calendar-based reminders.

**19.5 [PLANNED]** — As the platform, I want notification delivery
decoupled from the request/response cycle (a scheduled job, not a page
load), so that alerts fire even when no one is actively using the app.

---

## 20. Platform, security & audit

**20.1** — As the platform, I want passwords stored as hashes, never
plaintext, and session tokens opaque and expiring, so that credential
compromise is contained.
*`password_hash` columns on `users`/`clients`; `sessions` table with
`expires_at`.*

**20.2** — As the platform, I want the client portal to only ever expose a
client-safe field allowlist (never internal advisor notes, never other
clients' data), so that a client can't see anything they shouldn't via API
response shape.
*`VISIBLE` allowlists per entity in `portal.js` (e.g. `property`, `system`,
`permit`) filter every response.*

**20.3** — As the platform, I want every write scoped to verified
ownership — a client can only write to their own property; a non-founder
staff member only to their own market, so that authorization is enforced
at the data layer, not just hidden in the UI.
*`assertOwnSystem`, `assertOwnEquipment`, `clientProperty()`,
`scopedWhere()`.*

**20.4** — As the platform, I want cookies marked `Secure` once the app is
only reachable over HTTPS, so that session tokens can't be intercepted over
plaintext HTTP.
*`COOKIE_SECURE` env var — off for local/LAN testing, on behind the
Cloudflare Tunnel in production.*

**20.5** — As an operator, I want a one-command hot backup of the live
database that doesn't require stopping the app, so that I can snapshot
before every risky change (an update, a migration) without downtime.
*`npm run backup` → `VACUUM INTO` a timestamped file under
`data/backups/`; keeps the last 20.*

**20.6** — As an operator, I want schema and reference-data changes
(new columns, new regions) to apply automatically to a live database on
startup, so that shipping a code update never requires a destructive reset.
*`server/db.js` `migrate()` — `ensureColumn()` for additive changes,
full-table-rebuild for CHECK-constraint changes (documents' type list,
clients'/subscriptions' tier list), `ensureReferenceData()` for idempotent
region seeding.*

**20.7** — As an operator, I want `npm run reset` to be a distinct,
clearly-separate command from normal startup, so that wiping demo data is
never something that happens by accident during a routine update.
*`reset` is `node server/seed.js --reset` — an explicit, separate script
invocation, never triggered by `up -d --build`.*

---

## How to use this document

- **Rebuilding a feature?** Find its section, and the acceptance detail
  under each story tells you the exact fields, gates, and edge cases the
  original implementation covers — not just the happy path.
- **Scoping new work?** Sections 19 (Notifications) and the `[PLANNED]` /
  `[PARTIAL]` / `[ROADMAP]` / `[GAP]`-tagged stories elsewhere are the
  actual backlog, derived from what's *actually* missing rather than
  restated from memory.
- **Auditing tier fidelity?** §13 and §17.4 are the two places where the
  running code and the target business model (`BUSINESS.md`) are known to
  diverge — start there before trusting any tier-gating story at face
  value elsewhere in this document.
