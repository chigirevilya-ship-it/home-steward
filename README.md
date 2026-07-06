# Steward — Home Advisory & Concierge Platform

A fully self-hosted implementation of the Steward platform (see
*Steward — System Design & User Stories*, v1.0): the system of record for a
home advisory service — Home Records, a proactive maintenance rules engine,
a client portal, and founder business operations.

**No external services, no external dependencies.** The entire stack is
Node.js built-ins:

| Layer | Technology |
|---|---|
| Database | **Own SQL database** — SQLite file via `node:sqlite` (no Airtable, no cloud DB) |
| API server | `node:http` — zero npm dependencies |
| Auth | `node:crypto` scrypt password hashing + httpOnly session cookies |
| Frontend | Vanilla ES-module SPA served from `public/` — no CDNs, no build step |
| Files | Document uploads stored on local disk under `data/files/` |

## Quick start

```bash
node server/index.js          # starts on http://localhost:8710
```

Requires Node.js ≥ 22.5 (for the built-in `node:sqlite` module). On first run
the server creates `data/steward.db`, applies the schema, and seeds demo data
(two markets, five homes, a 24-rule maintenance library, a contractor
network). To start over: `npm run reset`.

**Deploying it for real?** See `DEPLOY.md` for running it in Docker on a NAS
and putting it live behind a Cloudflare Tunnel — including the go-live
checklist for replacing the demo passwords below before exposing it.

### Demo logins

| Role | Email | Password |
|---|---|---|
| Founder | `founder@steward.demo` | `steward123` |
| SME advisor (Boston) | `marcus@steward.demo` | `steward123` |
| Advisor (Boston) | `elena@steward.demo` | `steward123` |
| SME advisor (LA) | `dana@steward.demo` | `steward123` |
| Client (Concierge) | `sarah@client.demo` | `welcome123` |
| Client (Managed) | `james@client.demo` | `welcome123` |
| Client (Guided) | `mia@client.demo` | `welcome123` |

## What's implemented

### Data model (§3)
All 17 tables from the design doc — markets, users, clients, properties,
systems inventory, permit history, maintenance log, forward schedule, visits,
contractors, contractor ratings, referral fees, subscriptions, intake fees,
documents, maintenance rules — plus sessions, an audit log (§8
*Auditability*), and client requests. The §3.3 system-category controlled
vocabulary lives in one place (`server/vocab.js`) and is validated on both
sides of the rules-engine join.

### Rules engine (§3.4)
`server/rules-engine.js` implements match → calculate → write:
category + age scoping + vintage scoping + market scoping, due dates from
install/last-service dates for all eight frequency types (including
condition-triggered urgent items and age-based capital-forecast items).
Runs automatically on system create/update, on demand per property, from the
founder's Rules Manager, and on a daily interval while the server runs.
Generated items are deduplicated per rule + system.

### Advisor app (§5.1)
- **Dashboard** (US-A8/A9) — next-90-days by urgency with overdue visually
  distinct, today's visits, client requests, tier visit-cadence warnings
- **Home Record view** (US-A10) — the 2-minute pre-call review: systems
  sorted by remaining life with age bars, schedule, history, permits with gap
  flags, visits, documents, narrative
- **Intake flow** (US-A2) — guided six-step wizard ending with automatic
  rules-engine schedule generation; pre-1960 extended-protocol prompt
- **60-second system capture** (US-A3) — category picker → condition stars →
  dates → notes
- **Job completion flow** (US-A11/A12) — one action logs the job, closes the
  matching schedule item, updates last-service date, resets the next
  recurrence, records the referral fee, and prompts the 48-hour rating
- **Contractor network** — trades, ratings, license/insurance expiry flags at
  90 days, do-not-refer banners

### Client portal (§5.2)
Overview with hero stats, 12-month color-coded maintenance calendar, systems
with age bars, full maintenance history (US-C2), five-year capital forecast
(Managed/Concierge only — US-C3), the home's contractor roster (US-C4),
document browse/upload (US-C5), request submission, and full Home Record
export (US-C6/C7) as a print-optimized document (print → save as PDF).

### Founder console (§5.3)
Market dashboard (clients by tier, ARR/MRR, renewals due in 60 days, churn
signals, advisor books with implied hours), referral-fee ledger with monthly
per-contractor invoicing rollup, Rules Manager with **propagation preview**
("this rule matches N properties"), and network health (credential risk,
complaint flags, referral volume by trade).

### Business rules (§6) — enforced server-side
1. **Data ownership** — full client export at any time, from portal and API
2. **Market isolation** — non-founder staff queries are scoped to their market
3. **Contractor gating** — referrals/assignments rejected without current
   license + insurance; 90-day expiry flags
4. **Three-complaint rule** — third complaint flag (score ≤ 2) auto-moves the
   contractor to probation and logs a founder-review audit entry
5. **Never in the payment chain** — the ledger records and invoices referral
   fees; there is no client→contractor payment processing
6. **Fee transparency** — the referral relationship is disclosed in the portal
   and on exports (while fee *accounting* stays founder-only, §2.2)
7. **Rule immortality** — DELETE on a rule deactivates it; nothing is erased
8. **Tier-scoped features** — capital forecast API returns nothing for Guided;
   visit cadence tracked against tier promises
9. **Internal vs client-visible** — enforced at the API with column
   whitelists; advisor notes, household notes, vetting notes, and fee data
   never serialize into a client session
10. **Scope disclaimer** — rendered on intake output, portal, and exports

## Layout

```
server/
  index.js         HTTP server, static files, auth endpoints, uploads, export
  schema.sql       the SQL schema (17 tables + sessions/audit/requests)
  db.js            SQLite bootstrap + audit helper
  vocab.js         controlled vocabularies (§3.3) + tier definitions
  auth.js          scrypt hashing + sessions
  rules-engine.js  §3.4 match/calculate/write + propagation preview
  routes.js        staff API (market-scoped, role-gated)
  portal.js        client API (column-whitelist sanitized)
  export.js        print-ready Home Record document
  seed.js          demo data (relative dates — dashboards always look live)
public/
  index.html, css/app.css
  js/core.js       API client, formatting, shared components
  js/app.js        login, shell, hash router
  js/advisor.js    advisor app
  js/portal.js     client portal
  js/founder.js    founder console
data/              created at runtime: steward.db + uploaded files (gitignored)
```

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `8710` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `STEWARD_DATA_DIR` | `./data` | database + file storage location |

Backups (§8): the database is a single file — snapshot `data/` on any
schedule (`sqlite3 data/steward.db ".backup ..."` for a hot copy, since WAL
mode is enabled).
