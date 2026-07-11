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

To pull a new version of the code after I push more changes:

```bash
git pull
docker-compose up -d --build
```

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
