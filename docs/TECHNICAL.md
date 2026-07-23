# Steward — Technical Requirements & Implementation

*How Steward is built: the architecture, the data model, the subsystems, the
API, security, deployment, and the path to scale. This document reflects the
current implementation and is meant to be enough to build, run, operate, and
extend the system.*

---

## 1. Design principles

1. **Self-hosted, zero external dependencies.** The entire stack is Node.js
   built-ins. No npm packages in the runtime, no cloud database, no CDN, no
   build step. This is a deliberate constraint: it makes the app trivial to
   self-host (a privacy selling point) and eliminates supply-chain and
   dependency risk. The single optional external call is to the recommendation
   API, and the app is fully functional without it.
2. **The Home Record is the product.** Every subsystem exists to build,
   protect, or act on that record.
3. **Server-side truth.** Data visibility, tier gating, and ownership are
   enforced at the API with column whitelists — never trusted to the client.
4. **Records are permanent.** Deletion deactivates; history is preserved.

---

## 2. Stack

| Layer | Technology | Notes |
|---|---|---|
| Database | SQLite via `node:sqlite` (`DatabaseSync`) | Single file, WAL mode. Requires Node ≥ 22.5 |
| API server | `node:http` | Hand-rolled router, zero dependencies |
| Auth | `node:crypto` scrypt + httpOnly session cookies | No JWT, no library |
| Frontend | Vanilla ES-module SPA from `public/` | Hash router, no framework, no bundler |
| File storage | Local disk under `data/files/` | Raw-body uploads |
| Recommendations | Claude API via built-in `fetch` (optional) | Graceful rule-based fallback |

**Runtime shape:** one Node process serves the HTTP API, static assets, file
uploads/downloads, and the export document. State is one SQLite file plus an
uploaded-files directory, both under `STEWARD_DATA_DIR` (`./data` by default).

---

## 3. Code layout

```
server/
  index.js         HTTP server, static files, auth endpoints, uploads, export routing
  schema.sql       SQL schema (all tables)
  db.js            SQLite bootstrap, in-place migrations, audit helper
  vocab.js         controlled vocabularies (system categories, trades) + tier definitions
  auth.js          scrypt hashing + session management
  rules-engine.js  maintenance schedule generation (match → calculate → write)
  routes.js        staff API (market-scoped, role-gated)
  portal.js        client API (column-whitelist sanitized)
  suggest.js       recommendation engine (Claude + fleet learning + rule fallback)
  export.js        print-ready Home Record document
  seed.js          demo data (relative dates so dashboards always look live)
  http-util.js     request/response helpers
public/
  index.html, css/app.css
  js/core.js       API client, formatting, shared UI components (modals, fields)
  js/app.js        login, shell, hash router
  js/advisor.js    advisor app
  js/portal.js     client portal (incl. all Self-Serve flows)
  js/founder.js    founder console
data/              created at runtime: steward.db + files/ (gitignored)
docs/              this documentation
```

---

## 4. Data model

The schema is a clean relational model. Core entities and their relationships:

```
markets ──< users
markets ──< clients ──< properties ──< systems ──< equipment
                            │              │           │
                            │              ├──< maintenance_log ──< documents
                            │              ├──< forward_schedule (the schedule)
                            │              ├──< permits ──< documents
                            │              └──< visits
                            └──< client_contractors (self-serve personal book)
markets ──< contractors ──< contractor_ratings
                          └──< referral_fees
clients ──< subscriptions, intake_fees, client_requests
maintenance_rules  (the engine's rule library; joins to systems by category)
suggestion_feedback (fleet-learning signal)
audit_log, sessions
```

### Key tables

- **`properties`** — the home. Address, year built, type, foundation,
  `record_completeness` (0–100), `narrative_summary`, `market_id`, `active`.
- **`systems`** — a home system, tagged with a **category** from the
  controlled vocabulary (the join key to the rules engine). Carries its own
  install date, condition, expected lifespan, warranty, last-service date, and
  `active` (0 once retired/replaced). *A system is the category-level bucket.*
- **`equipment`** — components under a system (or freestanding). Own
  make/model/serial/warranty/condition and `active`. *Informational + warranty
  tracking; the rules engine runs on systems, not equipment.*
- **`maintenance_log`** — every job done. References `system_id` and/or
  `equipment_id`, plus either a network `contractor_id`, a self-serve
  `client_contractor_id`, or free-text `performed_by`.
- **`forward_schedule`** — upcoming and completed maintenance items. The
  engine writes here; self-serve custom tasks also live here (`custom=1`,
  optional `repeat_value`/`repeat_unit`). Tracks status, due window, cost
  range, capital-forecast flag.
- **`permits`** — permit history. Advisor-researched fields (`gap_flag`,
  `researched_by`) are distinct from client-editable fields.
- **`documents`** — uploaded files, each optionally linked to a system,
  equipment, maintenance-log entry, or permit, and typed
  (invoice/receipt/quote/contract/warranty/permit_doc/photo/…).
- **`maintenance_rules`** — the engine's library: category + age/vintage/market
  scoping + frequency, with cost ranges and talking points.
- **`contractors`, `contractor_ratings`, `referral_fees`** — the network and
  its economics.
- **`client_contractors`** — the self-serve personal contractor book,
  deliberately separate from the vetted network.
- **`suggestion_feedback`** — records which recommended tasks owners keep,
  keyed by an item profile (category, refined by make). The fleet-learning
  signal.
- **`subscriptions`, `intake_fees`, `client_requests`** — commercial + portal.
- **`sessions`, `audit_log`** — auth state and an append-only change log.

### Controlled vocabulary

`server/vocab.js` is the single source of truth for **system categories** (the
rules-engine join key), **trades**, and **tier definitions**. Both the systems
table and the rules library validate against the category list — a mismatch
would silently break schedule generation, so it lives in exactly one place.

---

## 5. Subsystems

### 5.1 Authentication

scrypt password hashing (`node:crypto`), httpOnly session cookies backed by
the `sessions` table. Sessions carry the user/client identity; every API
handler resolves the session and scopes queries to that identity. Cookie
security flags are environment-configurable for production behind TLS.

### 5.2 Rules engine (`rules-engine.js`)

The maintenance schedule is generated, not hand-entered. **Match → calculate →
write:**

- **Match:** for each *active* system, find active rules whose category, age
  scope, vintage scope, and market scope apply.
- **Calculate:** compute due dates from install/last-service dates across all
  frequency types (annual, seasonal, monthly, custom, age-based capital
  items, condition-triggered urgent items).
- **Write:** insert `forward_schedule` items, deduplicated per rule + system.

It runs on system create/update, on demand per property, from the founder's
Rules Manager (with a propagation preview — "this rule matches N properties"),
and on a daily interval. Retired systems are excluded, so replacing or
retiring a system stops its schedule.

### 5.3 Portal API & data sanitization (`portal.js`)

The client-facing API. Its central mechanism is **column whitelisting**: a
`VISIBLE` map defines exactly which columns of each table may serialize into a
client session. Internal data — advisor notes, vetting notes, referral-fee
accounting — has no path to a client because it isn't in the whitelist. Tier
gating (e.g. the capital forecast) and per-property/per-client ownership are
enforced here on every write.

### 5.4 Recommendation engine (`suggest.js`)

Drafts a description and a proposed maintenance schedule for a system or piece
of equipment. Three ideas stack:

1. **Whole-item context.** For an existing item, the server assembles its full
   context — nested equipment, documents on file, service history, and the
   tasks already scheduled — so recommendations reflect the whole picture and
   never duplicate what's already planned.
2. **Fleet learning.** Before recommending, it aggregates the fleet: how many
   comparable homes exist and what they commonly schedule, preferring the
   *accepted-suggestion* signal (`suggestion_feedback`) over raw schedules.
   These norms are fed into the recommendation so identical systems get
   consistent advice. Accepted tasks are recorded back, closing the loop.
3. **Graceful fallback.** With an API key, the Claude API produces the
   recommendation grounded in the above. Without a key, a deterministic
   rule-library engine produces it — also enriched by the fleet signal, so it
   improves as data grows. The user-facing behavior is identical; only quality
   differs.

> **Product framing note:** in the UI this is presented as **Steward's
> recommendations** — the service, not the mechanism. The Claude integration
> and fleet logic are implementation details. A planned UI-language pass will
> remove "AI"/"Claude" wording from the interface while keeping the function
> and the accumulated-data provenance ("learned from N similar homes")
> intact. This does **not** relax the privacy obligation: when an API key is
> configured, item metadata is sent to a third-party processor (Anthropic) and
> that must be disclosed in the privacy policy regardless of UI wording.

### 5.5 System ↔ component lifecycle

A system is the bucket; its equipment are the components. Component health
rolls up to the system card (a failing component flags the system without
lowering the system's own rating). **Retire** archives a component or a whole
system (keeps history, cancels pending schedule, cascades to a system's
components). **Replace** retires the old and stands up a fresh record with a
reset clock, carrying a system's components over. Both log the event to the
maintenance history. Retired items remain queryable in a "Replaced & retired"
view.

### 5.6 Export (`export.js`)

Renders the complete Home Record as a print-optimized HTML document (print →
save as PDF), including systems, schedule, full history, permits, and — at
eligible tiers — the capital forecast. This is the owner's portable,
transferable artifact and a core data-ownership guarantee.

---

## 6. API surface (representative)

All under `/api`. Staff routes (`routes.js`) are market-scoped and role-gated;
client routes (`portal.js`) are identity-scoped and whitelist-sanitized.

- **Auth:** `POST /api/login`, `POST /api/logout`, session-cookie based.
- **Portal read:** `GET /api/portal/record` — the sanitized, assembled record
  for the logged-in client's property (systems, schedule, log, permits,
  documents, contractors, forecast, hero stats).
- **Self-serve writes:** `property`, `systems`, `equipment`, `service`,
  `tasks`, `contractors`, `permits`, `documents` — each POST/PATCH/DELETE as
  appropriate, ownership-checked.
- **Lifecycle:** `POST /api/portal/{systems,equipment}/:id/{retire,replace}`.
- **Recommendations:** `POST /api/portal/suggest`,
  `POST /api/portal/suggest/accept` (feedback loop). Per-client hourly rate
  limit on the paid path.
- **Files:** `POST /api/portal/documents` (raw-body upload, metadata in query),
  `GET /api/documents/:id/file`.
- **Export:** `GET /api/export/:propertyId`.
- **Staff:** intake, system capture, job completion, contractor network,
  ratings, founder market/ledger/rules/network endpoints.

---

## 7. Security & privacy

**Implemented:**

- scrypt hashing; httpOnly session cookies; configurable secure-cookie flag.
- **Server-side column whitelists** — the enforcement mechanism for
  internal-vs-client-visible data.
- **Market isolation** — non-founder staff queries scoped to their market.
- **Ownership checks** on every self-serve write (property/client scoping).
- **Full data export** anytime (portal + API) — data-ownership guarantee.
- **Append-only `audit_log`** — who changed what, when.
- **Records permanence** — deletes deactivate; history preserved.

**Required before a real commercial launch (gaps):**

- **Privacy policy + third-party disclosure.** With a recommendation API key
  set, item metadata is sent to Anthropic (a data processor); this must be
  disclosed and, ideally, consented to.
- **Right-to-be-forgotten.** Current deletes deactivate (`active=0`). A true
  PII purge path is needed for deletion requests (addresses, contractor
  contacts).
- **Encryption at rest** for the SQLite file and uploaded files.
- **Consent for cross-user data use** powering the fleet-learning engine
  (aggregation is already anonymous — counts and task names only — but consent
  should be explicit).
- **Rate limiting / abuse controls** beyond the per-client suggestion limit;
  secrets management for the API key.

---

## 8. Migrations

New tables use `CREATE TABLE IF NOT EXISTS` in `schema.sql` and apply
automatically on open. New columns are added idempotently via an
`ensureColumn` helper in `db.js`. Because SQLite cannot `ALTER` a `CHECK`
constraint, expanding a constrained column (e.g. the document-type list)
requires an **in-place table rebuild** — create new, copy, drop, rename — which
`db.js` does inside a transaction. This pattern is the main friction point in a
future Postgres port and should be replaced by a real migration tool before
then. Migrations run on every `open()`, so upgrades are just "deploy new code
and restart."

---

## 9. Build & run (local)

```bash
node server/index.js          # starts on http://localhost:8710
```

On first run the server creates `data/steward.db`, applies the schema, runs
migrations, and seeds demo data (markets, homes, a rule library, a contractor
network, and a fully-populated self-serve demo home). `npm run reset` starts
over. Requires **Node ≥ 22.5** for `node:sqlite`.

**Configuration (environment variables):**

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8710` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `STEWARD_DATA_DIR` | `./data` | database + file storage location |
| `ANTHROPIC_API_KEY` | *(unset)* | enables the API-backed recommendation path; rule-library fallback without it |
| `STEWARD_AI_MODEL` | `claude-opus-4-8` | model used for recommendations |
| cookie/secure flags | — | tighten for production behind TLS |

---

## 10. Deployment

The reference deployment (see `DEPLOY.md`) is **Docker on a Synology NAS,
exposed via a Cloudflare Tunnel** — a fully self-hosted, no-cloud-database
posture that matches the privacy story:

1. **Container:** the app builds to a small Node image; `docker-compose`
   mounts a persistent volume for `data/` (the SQLite file + uploaded files)
   and sets the environment (including the optional `ANTHROPIC_API_KEY`).
2. **Ingress:** a Cloudflare Tunnel exposes the container to the public
   internet without opening inbound ports on the NAS — TLS terminates at
   Cloudflare; the origin stays private.
3. **Go-live checklist:** replace all demo passwords, set secure cookie flags,
   confirm the data volume is backed up.

**Backups (single-file advantage):** because state is one SQLite file, backup
is a file snapshot — `sqlite3 data/steward.db ".backup ..."` for a hot copy
(WAL mode is on), on any schedule, plus the `files/` directory.

**Alternatives** documented in `DEPLOY.md`: keep the LAN port closed and reach
it only through the tunnel, or front it with your own reverse proxy/tunnel.

---

## 11. Scalability path

The **schema** is a strength and ports cleanly; the **runtime** is the ceiling.
Each limit has a well-worn upgrade path — this is swap-the-substrate, not a
rewrite.

| Limit today | Trigger to act | Path |
|---|---|---|
| SQLite single-writer | High write concurrency / many thousands of homes | Port to Postgres (schema is portable; replace the in-place-rebuild migrations with a migration tool) |
| Files on local disk | Multi-node deploy | Object storage (S3 / R2), store keys not paths |
| Rules engine runs synchronously on writes + daily interval | Engine work grows | Move generation to a background job queue |
| Fleet-aggregation queries scan cross-property | `suggestion_feedback`/history volume | Materialized rollups + indexing per profile |
| Single Node process | Traffic | Horizontal scale once DB and files are externalized |

Market isolation is already in the data model, so multi-region/market scaling
is a data-partitioning story, not a redesign.

---

## 12. Testing & verification

Verification in this project is **behavioral, driven end-to-end** — flows are
exercised in a real headless browser (Playwright/Chromium) against a seeded
instance, observing actual behavior (create a system, run a recommendation,
retire a component, confirm the export), not just unit assertions. Migrations
are verified against a simulated legacy database. The seed is designed so
dashboards and demos always look live (relative dates, a populated self-serve
home including a composite multi-component system).

---

## 13. Roadmap / known technical debt

- **Growth analytics** — the founder console covers operations; funnel, cohort
  retention, LTV/CAC, and data-asset density reporting are not yet built.
- **UI language pass** — present recommendations as "Steward's" rather than
  "AI"/"Claude" (function unchanged; privacy disclosure unchanged).
- **Privacy hardening** — policy, consent, right-to-be-forgotten purge,
  encryption at rest (see §7).
- **Migration tooling** — replace the hand-rolled in-place rebuilds before a
  Postgres port.
- **Guided assessment depth** — turn onboarding into a system-by-system,
  photo/data-plate-capture walkthrough to raise both completion and data
  quality.
- **Component-level scheduling** — the rules engine currently schedules per
  system/category; scheduling against a specific component is a deliberate,
  larger change to the engine's match/write loop, intentionally deferred.
