# Deploying Bazaar Companion on your own VPS (Docker Compose)

One container serves the web app and `/api/*` and reads one read-only SQLite file (~130 MB). The database is
**not in git and not in the image**: it is copied to the VPS once (and again whenever the data changes) and
mounted read-only at `/data`. Everything here has been run locally with the real database; nothing has been
deployed to a real server yet.

Measured locally (real DB, 225,903 products): image 234 MB; the server listens < 1 s after start and the
12 demo categories are pre-warmed in ~0.6 s; "healthy" in ~7 s (Docker's 5 s start-interval dominates);
memory 77 MB idle, 84 MB after the smoke chain plus 40 parses.

> Render also works: build the same `Dockerfile` with `DATA_URL` / `DATA_SHA256` set (build-time data, see section 9).

## 0. What I need from the owner (checklist)

| # | Need | Notes |
|---|---|---|
| 1 | **VPS SSH access**: `user@host`, port if not 22, key-based login | A sudo-capable user that is in the `docker` group. No password is ever stored in this repo. |
| 2 | **VPS specs / OS** | Any Linux with Docker Engine 24+ and the compose plugin. 1 vCPU / 1 GB RAM is enough (app limit 512 MB). |
| 3 | **Domain (optional)** | With a domain: automatic HTTPS. Without: plain HTTP on the VPS IP (section 5). DNS A/AAAA record must point at the VPS before the first HTTPS start. |
| 4 | **How the database gets there** | Default: `deploy/push-data.sh` from the machine that has `data/market.sqlite` (rsync over ssh). Alternative: you `scp`/`rsync` it yourself to `<dir>/data/market.sqlite`. Optional: bake it in via `DATA_URL` (section 9). The file must **not** be published publicly (PLAN B7 is an open licensing decision). |
| 5 | **`LLM_API_KEY` (optional)** | Without it the product runs fully deterministically. Put it only in the VPS `.env` (mode 600). |
| 6 | **Is Docker Hub reachable from the VPS?** | If not, set `NODE_IMAGE` / `CADDY_IMAGE` to a mirror in `.env`. |

## 1. Prerequisites on the VPS (once)

```bash
# Docker Engine + compose plugin (Debian/Ubuntu): https://docs.docker.com/engine/install/
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"        # log out and in again
docker compose version                 # must print v2.x

sudo mkdir -p /opt/bazaar && sudo chown "$USER" /opt/bazaar
sudo apt-get install -y rsync          # needed by the deploy scripts (also on your own machine)

# firewall: keep 22; open 80 and 443 only if you use the bundled proxy / a domain
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Docker publishes ports **around** ufw. That is why the app is published on `127.0.0.1` by default and only
Caddy (or nginx) faces the internet.

On your own machine (the one that runs the deploy scripts): `bash`, `ssh`, `rsync`, `curl`, `jq`.

## 2. First deploy

From a checkout of this repo on a machine that has `data/market.sqlite`:

```bash
cp .env.example .env                    # edit: LLM_API_KEY (optional), DOMAIN (optional), see section 4
export DEPLOY_HOST=deploy@203.0.113.10  # or pass --host to each script
export DEPLOY_DIR=/opt/bazaar           # default

deploy/push-data.sh --dry-run           # shows exactly what will happen
deploy/push-data.sh                     # 1. database -> <dir>/data (sha256 verified on the VPS)
deploy/remote-up.sh --env-file .env --proxy   # 2. sync source, build image, start app + Caddy, wait healthy
deploy/smoke.sh https://bazaar.example.com    # 3. health, meta, parse->resolve->plan, Persian page
```

Drop `--proxy` to run the app alone (then see section 5 for how to reach it). Both scripts print each command
before running it, and `--dry-run` prints without doing anything. Order matters only a little: if you run
`remote-up.sh` first, the app starts with `db:false` and you finish with `push-data.sh --restart`.

Things to check right after (details in sections 4 and 11): `curl -i <url>/api/health` shows `"db":true`;
the TRUST_PROXY test from `docs/SECURITY.md` section 4.

## 3. Updating

```bash
deploy/remote-up.sh --proxy             # code: sync, rebuild (layer-cached), restart, wait healthy
deploy/smoke.sh https://bazaar.example.com
deploy/push-data.sh --restart           # data: new database file (section 7)
```

Each `remote-up.sh` run tags the previous image `bazaar-companion:previous` and the new one with the build id
(`/api/health` shows it as `commit`). Rollback is in `deploy/rollback.md`.

## 4. Configuration (`.env` on the VPS)

`compose.yaml` reads `<dir>/.env` for its own `${...}` settings and also passes it to the container.
`compose.yaml` pins `NODE_ENV=production`, `PORT`, `HOST` and `DATABASE_PATH=/data/market.sqlite`.

| Variable | Default | Meaning |
|---|---|---|
| `LLM_API_KEY` | empty | Optional Anthropic key (`/api/health` -> `"llm": true`). Secret: only in the VPS `.env`. |
| `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_RATE_LIMIT`, `LLM_DAILY_PER_IP`, `LLM_DAILY_GLOBAL`, `LLM_MAX_CONCURRENCY`, ... | see `.env.example` | Optional LLM tuning and cost caps. Kill switch: empty `LLM_API_KEY` or `LLM_RATE_LIMIT=0`, then `docker compose up -d`. |
| `RATE_LIMIT`, `ASSIST_RATE_LIMIT` | 120 / 30 per IP per minute | Public-endpoint limits. |
| `TRUST_PROXY` | `1` | Proxy hops in front of the app. **See below.** |
| `DOMAIN` | unset | Bundled Caddy: your domain => automatic HTTPS. Unset => plain HTTP on `:80`. |
| `APP_BIND`, `APP_PORT` | `127.0.0.1`, `8080` | Host address/port the app is published on. |
| `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT` | `80`, `443` | Host ports of the bundled Caddy. |
| `DATA_DIR` | `./data` | Host directory holding `market.sqlite` (mounted read-only at `/data`). |
| `APP_MEM_LIMIT`, `APP_CPUS` | `512m`, `1.0` | Container limits (measured need: ~85 MB; the DB page cache is kernel memory). |
| `NODE_IMAGE`, `CADDY_IMAGE` | `node:22-slim`, `caddy:2-alpine` | Mirror images where Docker Hub is blocked. |
| `DATA_URL`, `DATA_SHA256` | empty | Optional build-time database (section 9). |
| `IMAGE_TAG` | `latest` | Leave alone: the deploy scripts rely on it. |

### TRUST_PROXY: which value

The app derives the client IP for rate limiting and the LLM budget from `X-Forwarded-For`, trusting exactly
`TRUST_PROXY` hops (`docs/SECURITY.md` sections 2 and 4). Set it to the number of proxies **you** run in front:

| Setup | Value |
|---|---|
| compose + bundled Caddy (`--proxy`), domain or not | **`1`** (compose default). Caddy replaces any client `X-Forwarded-For` with the address it saw. |
| nginx (or another proxy) on the host in front of `127.0.0.1:8080` | **`1`**, if the proxy sets `X-Forwarded-For` (snippet in section 6). |
| Cloudflare (or another CDN) in front of Caddy | `2`, **and** tell Caddy to trust the CDN ranges (`trusted_proxies` in `deploy/Caddyfile`); otherwise keep `1` and accept that all clients appear as the CDN. |
| No proxy: app published on the VPS IP (`APP_BIND=0.0.0.0`) | **`0`**. With `1` anyone could forge `X-Forwarded-For` and dodge every per-IP limit. |

Too low => every client shares one bucket (everyone gets 429). Too high => clients can spoof their IP.
Verify once after the first deploy, using the procedure in `docs/SECURITY.md` section 4 item 1 (send
`RATE_LIMIT`+1 requests to `/api/meta`, expect the last to be 429, then repeat with a forged
`X-Forwarded-For`, which must stay 429). Verified locally through the bundled Caddy: 429 after the budget even
when every request carried a different forged header. One Docker caveat: with IPv6 clients on a host without
`ip6tables` support, Docker's userland proxy can make all IPv6 clients look like the bridge gateway; if the
test shows "everyone limited together", serve IPv4 only or use host-level nginx.

## 5. No domain: plain HTTP on the VPS IP

Two equivalent options, both without HTTPS (browsers will not treat the site as secure, and the app's HSTS
header is ignored over HTTP):

```bash
# a) bundled Caddy on :80 (leave DOMAIN unset; TRUST_PROXY stays 1)
deploy/remote-up.sh --proxy               # then open http://<vps-ip>/

# b) the app alone, published directly (put these in the VPS .env)
APP_BIND=0.0.0.0
APP_PORT=80
TRUST_PROXY=0                             # nothing in front: do not trust X-Forwarded-For
deploy/remote-up.sh
```

Temporary access without opening any port: `ssh -L 8080:127.0.0.1:8080 user@vps`, then `http://127.0.0.1:8080`.

## 6. nginx on the host instead of Caddy

Leave `APP_BIND=127.0.0.1`, `TRUST_PROXY=1`, do not use `--proxy`. Get a certificate with certbot
(`sudo certbot --nginx -d bazaar.example.com`), then:

```nginx
server {
    listen 443 ssl http2;
    server_name bazaar.example.com;
    # ssl_certificate / ssl_certificate_key: managed by certbot

    client_max_body_size 64k;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;   # REPLACE, never append the client's value
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 15s;
    }
}
server { listen 80; server_name bazaar.example.com; return 301 https://$host$request_uri; }
```

## 7. Updating the data

```bash
deploy/push-data.sh --restart             # new data/market.sqlite -> VPS, checksum verified, app restarted
deploy/smoke.sh https://bazaar.example.com    # /api/meta shows the new snapshotDate / dataVersion
```

The old file is kept as `<dir>/data/market.sqlite.prev` (restore with `mv` + `docker compose restart app`).
The directory, not the single file, is mounted, so the atomic rename inside `push-data.sh` is safe; the restart
is needed because a running server keeps the old file open. The app opens the file read-only and never
writes next to it, so a `:ro` mount works.

## 8. Operations: logs, status, backup

```bash
cd /opt/bazaar
docker compose ps                         # state + (healthy)
docker compose logs -f --tail 100 app     # JSON lines: method, path, status, timing; never bodies or query strings
docker compose logs --tail 50 caddy
docker stats --no-stream                  # memory / CPU
docker compose restart app
docker compose down                       # stop (data and certificates survive)
```

Logs rotate (10 MB x 3 per container). What is worth backing up: `<dir>/.env` (secrets), `<dir>/data/market.sqlite`
(reproducible with `npm run data:build`, but a copy saves time), and Caddy's `caddy_data` volume
(certificates; losing it only means re-issuing): `docker run --rm -v bazaar_caddy_data:/d -v "$PWD":/b alpine tar czf /b/caddy_data.tgz -C /d .`

Rollback: `deploy/rollback.md`.

## 9. Optional: bake the database into the image

For platforms where mounting a file is awkward (e.g. Render). Not the default here.

```bash
# the asset: raw market.sqlite or market.sqlite.zst (zstd -19 -T0 data/market.sqlite -o data/market.sqlite.zst)
sha256sum data/market.sqlite.zst
docker build -t bazaar-companion:baked \
  --build-arg DATA_URL=https://<private-or-public-host>/market.sqlite.zst \
  --build-arg DATA_SHA256=<sha256> .
docker run --rm -p 8080:8080 bazaar-companion:baked       # no -v needed
```

With compose, set `DATA_URL` / `DATA_SHA256` in `.env` and remove the `./data:/data:ro` volume (a mount on
`/data` hides the baked file). The download must be reachable without authentication headers, and the build
fails on a checksum mismatch. Only publish the file if the dataset licence allows it (PLAN B7).

Without data in the image **and** no mount, the app still starts and reports `/api/health` `"db": false`.

## 10. Image build facts

| Piece | Where it comes from |
|---|---|
| Server | `apps/server` bundled to one `server.mjs` by esbuild (`@app/core` compiled in) |
| Web app | `npm run build -w @app/web` -> `/app/web` (460 KB) |
| Native addon | `better-sqlite3` prebuilt linux-x64 binary only (no compiler in the image) |
| Runtime | `node:22-slim`, user `node` (uid 1000), `NODE_ENV=production`, `VOLUME /data`, `HEALTHCHECK /api/health` |
| Compose hardening | read-only root FS, `/tmp` tmpfs, all capabilities dropped, 512 MB / 1 CPU / 128 pids, log rotation |

Local build where Docker Hub is blocked: `docker build --build-arg NODE_IMAGE=docker.arvancloud.ir/library/node:22-slim -t bazaar-companion:local .`
Local run with a mounted database and no compose:
`docker run --rm -p 18080:8080 -v "$PWD/data:/data:ro" bazaar-companion:local`.

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/api/health` -> `"db": false`, status `degraded` | `market.sqlite` is not in `DATA_DIR` (check `ls -l /opt/bazaar/data`), is not readable by uid 1000 (`chmod 644`; `push-data.sh` does it), or is not a valid database. `docker compose logs app` prints `dbReason`. |
| Site works but everyone gets 429 | `TRUST_PROXY` too low for the real proxy chain (section 4). |
| Clients dodge the limits by sending `X-Forwarded-For` | `TRUST_PROXY` too high (use `0` when the app is published directly). |
| `deploy/smoke.sh` fails on `GET /` "no /assets/*" | The web app did not build into the image (placeholder page); check the `npm run build -w @app/web` step of `docker compose build app`. |
| Caddy never gets a certificate | DNS does not point at the VPS yet, or ports 80/443 are blocked (cloud firewall / ufw). `docker compose logs caddy`. Let's Encrypt rate-limits repeated failures: fix DNS first, keep the `caddy_data` volume. |
| Build fails pulling `node:22-slim` | Docker Hub unreachable: set `NODE_IMAGE=<mirror>/library/node:22-slim` in `.env`. |
| `exec ... operation not permitted` at container start | A hardening option (`no-new-privileges`) conflicting with snap-packaged Docker's AppArmor. `compose.yaml` does not set it; do not add it on snap Docker. |
| Port already in use | Change `APP_PORT` / `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT`. |
| Container `unhealthy` | `docker compose logs --tail 50 app`; the health check is `GET /api/health` inside the container. |
| Disk fills with old images | Each deploy keeps tags `latest`, `previous` and the build id. `docker image prune -f` removes untagged layers; `docker rmi bazaar-companion:<old-build-id>` removes old builds. |
| Memory | 77 MB idle / 84 MB after load locally; raise `APP_MEM_LIMIT` only if `docker stats` shows the limit being approached. |
