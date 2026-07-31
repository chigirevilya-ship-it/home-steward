# Deploying Steward to a Synology NAS via Cloudflare Tunnel

This walks through running Steward on DSM's Container Manager and exposing it
at a public hostname with a Cloudflare Tunnel — no port-forwarding, automatic
TLS, and (optionally) an auth wall in front of the app via Cloudflare Access.

Everything here matches `docker-compose.yml` in the repo root.

**A note on the CLI command name:** older DSM Docker packages only ship the
legacy Python `docker-compose` (hyphenated, v1.x) rather than the newer
`docker compose` (space, V2 plugin) used by most current guides elsewhere.
This guide uses `docker-compose` throughout — if your DSM happens to have the
newer plugin instead, `docker compose` (no hyphen) works identically. Check
with `docker-compose version` vs `docker compose version` if unsure.

## 0. Before you start

Requirements on the NAS:
- DSM 7.2+ (for Container Manager's Compose-project support), or any DSM with
  **Container Manager** / **Docker** package installed and SSH access as a
  fallback
- A domain added to a **free Cloudflare account** (Cloudflare Tunnel requires
  your domain's DNS to be on Cloudflare — moving nameservers over is free and
  usually takes under an hour)

## 1. Get the code onto the NAS

**Option A — SSH (recommended if you have it enabled):**

Control Panel → Terminal & SNMP → check "Enable SSH service", then from your
own machine:

```bash
ssh <your-user>@<nas-ip>
mkdir -p /volume1/docker/steward && cd /volume1/docker/steward
git clone -b claude/steward-mockups-impl-4ao57n \
  https://github.com/chigirevilya-ship-it/home-steward.git .
```

(No `git` on the NAS? Install it from Package Center, or just download the
repo as a zip from GitHub and extract it into that folder via File Station.)

**Option B — File Station:** download the repo as a zip from GitHub's "Code"
button, then upload and extract it into a shared folder, e.g.
`/volume1/docker/steward`.

## 2. Create the Cloudflare Tunnel

1. Go to **one.dash.cloudflare.com** → your account → **Networks → Tunnels**
2. **Create a tunnel** → choose **Cloudflared** → name it `steward`
3. On the next screen, the install command shown contains a long token after
   `--token` — copy just that token value. This is your `TUNNEL_TOKEN`.
4. Still in the tunnel setup, add a **Public Hostname**:
   - Subdomain: e.g. `steward` (→ `steward.yourdomain.com`)
   - Service type: `HTTP`
   - URL: `steward:8710` — this is the Docker service name from
     `docker-compose.yml`, resolved over the internal Docker network, **not**
     the NAS's LAN IP
5. Save. The hostname will show "down" until the container is running (next
   step) — that's expected.

## 3. Configure and run the stack

Back on the NAS, in the `steward` folder:

```bash
cp .env.example .env
```

Edit `.env` and paste in your tunnel token:

```
TUNNEL_TOKEN=<the token from step 2>
COOKIE_SECURE=1
```

**Via SSH:**

```bash
cd /volume1/docker/steward
docker-compose up -d --build
docker-compose logs -f steward   # watch it seed on first boot, Ctrl-C to detach
```

**Via Container Manager UI (no SSH needed):** Container Manager → **Project**
→ **Create** → point it at the `steward` folder (it will detect
`docker-compose.yml`) → **Next** → **Done**. Container Manager reads the same
`.env` file if it's sitting next to the compose file.

Give it 15–20 seconds on first boot — it creates the SQLite database and
seeds demo data automatically. Check the Cloudflare Tunnel dashboard; the
public hostname should flip to "healthy" once `cloudflared` connects.

Visit **`https://steward.yourdomain.com`** — you should see the login screen.

## 4. Go-live checklist — do this before telling anyone the URL

The demo seed creates accounts with two fixed, publicly-documented passwords
(`steward123` for staff, `welcome123` for clients — they're in this repo's
README). That's fine on localhost; it is **not** fine once a real hostname is
live on the internet. Change every account you intend to keep:

```bash
docker-compose exec steward node server/set-password.js founder@steward.demo 'a-real-passphrase-here'
docker-compose exec steward node server/set-password.js marcus@steward.demo  'another-real-one'
docker-compose exec steward node server/set-password.js sarah@client.demo    'yet-another'
# ...repeat for every account you're keeping
```

(Passwords must be 8+ characters; the script rejects shorter ones.)

Other things worth doing at this point:
- **Delete or repurpose the demo clients/properties** you don't want — there's
  no delete-client UI yet, so for a clean start either leave the demo data as
  reference material or ask for a "wipe demo data, keep schema" pass before
  entering real client information.
- **Consider Cloudflare Access** (Zero Trust → Access → Applications → Add) to
  put an email/one-time-code gate in front of the whole hostname — an extra
  layer before Steward's own login, worthwhile given this app holds client PII
  and household security details (alarm systems, access notes per the design
  doc's NFRs).
- **Back up `data/`** on a schedule — it's the entire database plus uploaded
  files. The named Docker volume `steward-data` lives under
  `/volume1/@docker/volumes/` on DSM; Synology's Hyper Backup or a simple
  `docker-compose exec steward sqlite3 /app/data/steward.db ".backup /app/data/backup.db"`
  cron job both work (WAL mode is already on, so this is safe to run live).

## Operating it day to day

```bash
docker-compose logs -f steward      # tail app logs
docker-compose restart steward      # restart just the app
docker-compose pull && docker-compose up -d --build   # update to a new commit
docker-compose down                 # stop everything (data volume persists)
```

## Updating without losing data (safe runbook)

**Your data is safe across updates.** It lives in the `steward-data` Docker
volume, which `docker-compose up -d --build` never touches. Schema changes
migrate your existing database in place on startup — you do **not** need to
reseed. **Never run `npm run reset` on a database with real data — it wipes
everything.** (Reset is only for refreshing throwaway demo data.)

The safe update sequence, run in `/volume1/docker/steward`:

```bash
sudo docker-compose exec steward npm run backup   # 1. snapshot first (belt & braces)
git pull                                           # 2. get the new code
sudo docker-compose up -d --build                  # 3. rebuild + restart (data persists, migrates)
```

Then hard-refresh your browser (Ctrl-Shift-R). New regions and other shared
config apply automatically on startup — no reset needed.

### Backups & restore

`npm run backup` writes a consistent snapshot to `data/backups/` inside the
volume (safe to run live; keeps the last 20):

```bash
sudo docker-compose exec steward npm run backup
sudo docker-compose exec steward ls -lh /app/data/backups   # list snapshots
```

To **restore** a snapshot, stop the app, copy it over the live DB, restart:

```bash
sudo docker-compose stop steward
sudo docker-compose run --rm --entrypoint sh steward -c \
  'cp /app/data/backups/steward-<STAMP>.db /app/data/steward.db && rm -f /app/data/steward.db-wal /app/data/steward.db-shm'
sudo docker-compose up -d steward
```

## Property facts (RentCast) — nationwide beds/baths/sqft/year built

Address auto-build also prefills each home's **basics** — year built, square
footage, bedrooms, bathrooms, lot size, and property type — from the
[RentCast](https://www.rentcast.io/api) property API. It's **nationwide** (works
for any US address, not just wired permit regions) and is the one source that
includes bedrooms, which public assessor feeds usually omit.

It's key-gated exactly like the Anthropic key — with no key set, the auto-build
still drafts systems/permits, it just won't prefill the basics.

1. Sign up for a free account at **rentcast.io/api** and copy your API key. The
   free tier is ~50 lookups/month, which is plenty for alpha — Steward fetches
   each home **once** (at auto-build time), it doesn't re-poll.
2. Add it to the `.env` next to `docker-compose.yml`:

   ```bash
   RENTCAST_API_KEY=<your-key>
   ```
3. `sudo docker-compose up -d`. Verify from the NAS:

   ```bash
   curl -s "https://api.rentcast.io/v1/properties?address=5445%20Brookfield%20Dr,%20Virginia%20Beach,%20VA%2023464" \
     -H "X-Api-Key: $RENTCAST_API_KEY" | head -c 800
   ```

   A JSON object/array with `bedrooms`, `squareFootage`, `yearBuilt` means it's
   working; the "Build from my address" flow will now prefill those fields.

## Address auto-build: per-state permit feeds

Address auto-build drafts a Home Record from public permit records. Each state
is wired independently via `STEWARD_<ST>_PERMITS_*` env vars (`<ST>` = the
two-letter state code). **Boston, MA** and **Virginia Beach, VA** work out of
the box; **New Jersey** needs a feed URL set.

### Virginia (Hampton Roads / Virginia Beach) — works out of the box

Virginia Beach publishes its **"Building Permits Applications"** dataset as a
public **ArcGIS FeatureServer**, and Steward ships that feed as the built-in VA
default — a lookup for **5445 Brookfield Dr, Virginia Beach, VA 23464** returns
records with no configuration.

Verify it from the NAS (the built-in query, with the address filled in):

```bash
curl -s "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits_Applications_view/FeatureServer/0/query?f=json&outFields=*&resultRecordCount=5&where=UPPER(StreetAddress)%20LIKE%20UPPER('%255445%20Brookfield%20Dr%25')" | head -c 1200
```

If that returns `"features": [ … ]`, the in-app lookup works. If Virginia Beach
ever renames the address field (the query filters on `StreetAddress`), discover
the current name once and override the default:

```bash
# List the layer's field names:
curl -s "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits_Applications_view/FeatureServer/0?f=json" \
  | tr ',' '\n' | grep -i '"name"'
```

Then set (in a `.env` next to `docker-compose.yml`) `STEWARD_VA_PERMITS_URL` to
the same URL with the corrected field name, keeping the `{street}` placeholder,
and `sudo docker-compose up -d`. To point VA at a *different* Hampton Roads
town's feed (Norfolk, Chesapeake, etc.), set `STEWARD_VA_PERMITS_URL` to that
town's ArcGIS query or Socrata endpoint (same `{street}`/`{zip}` template).

### New Jersey (Bridgewater) — set a feed to enable

The Boston auto-build works out of the box. **Bridgewater, NJ** publishes its
permits through an **SDL Portal** (Selectron/SDL "Citizen Access"–style site),
which is a single-page app: the visible search box calls a backend **JSON
API** in the background. Steward talks to that JSON API directly. You wire it
up with four environment variables in a `.env` file next to
`docker-compose.yml` — no code change needed.

**Step 1 — capture the portal's real request.** Open Bridgewater's SDL permit
search in a desktop browser, open **DevTools → Network**, and run a search for
a known address (use **337 Garretson Rd**). In the Network list, find the
request that returns the permit results as JSON (usually a `POST` to a
`.../search` or `.../api/...` URL — click each XHR/fetch row and check its
**Response** tab for the permit rows). From that request note:

- the **Request URL**,
- the **Method** (GET or POST),
- for POST, the **Request Payload** (the JSON body it sends), and
- where the permit array sits in the **Response** JSON (e.g. top-level array,
  or nested under `data` / `results`).

**Step 2 — set the env vars.** Put `{street}` and `{zip}` where the address
goes. For an SDL POST search it typically looks like:

```bash
STEWARD_NJ_PERMITS_URL=https://<portal-host>/api/permits/search
STEWARD_NJ_PERMITS_METHOD=POST
STEWARD_NJ_PERMITS_BODY={"address":"{street}","zip":"{zip}","page":1}
# Only if the array is nested — e.g. {"data":{"results":[ ... ]}}:
STEWARD_NJ_PERMITS_PATH=data.results
```

For a simpler GET feed (some towns expose a Socrata/ArcGIS endpoint), just set
the URL with `{street}`/`{zip}` in the query string and leave `METHOD` unset
(defaults to GET):

```bash
STEWARD_NJ_PERMITS_URL=https://<the-feed>?address={street}&zip={zip}
```

**Step 3 — apply and verify.** `sudo docker-compose up -d`, then test the exact
request from the NAS first (a lookup for **337 Garretson Rd** should return
records):

```bash
# POST example — mirror the DevTools payload:
curl -s -X POST "https://<portal-host>/api/permits/search" \
  -H 'content-type: application/json' \
  -d '{"address":"337 Garretson Rd","zip":"08807","page":1}' | head -c 800
```

Steward maps common field names automatically (permit number, description,
issued date, status, contractor), so once the request/response shape matches,
the address auto-build populates systems from the returned permits. If the
variables are unset or the feed returns nothing, the NJ auto-build reports
that no records were found and the owner can still build the record by hand.

## If you don't want the LAN port open

`docker-compose.yml` publishes `8710:8710` so you can also reach it at
`http://<nas-ip>:8710` on your own network directly, bypassing the tunnel.
If you'd rather it only be reachable through Cloudflare, delete the `ports:`
block under the `steward` service — `cloudflared` still reaches it over the
internal Docker network by service name either way.

## If you'd rather use your own tunnel/reverse proxy

Delete the `cloudflared` service from `docker-compose.yml` and point whatever
you're already running (Nginx Proxy Manager, Traefik, Tailscale Funnel, etc.)
at `http://<nas-ip>:8710` or the `steward` container directly. Everything else
in this guide — the `.env`, the go-live checklist — still applies.
