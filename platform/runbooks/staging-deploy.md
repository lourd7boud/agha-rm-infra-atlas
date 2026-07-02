# Runbook — ATLAS staging deployment

The live deployment of ATLAS on the company VPS, captured so it is
reproducible and operable by the team — not a one-off.

**Live:** https://atlas.marocinfra.com · **Host:** Ubuntu 24.04, Docker 29.

## Topology

The VPS already runs the company's nginx (ports 80/443) and other sites
(`dev.marocinfra.com`, `munaqasat.marocinfra.com`). ATLAS does **not** use
the bundled Caddy — it slots in behind the existing nginx:

```
internet ──▶ nginx (host, 80/443, TLS via certbot)
               ├─ /auth/      ─▶ keycloak  (127.0.0.1:8081, KC_HTTP_RELATIVE_PATH=/auth)
               ├─ /api/auth/  ─▶ web        (127.0.0.1:13001)   # NextAuth — must precede /api/
               ├─ /api/       ─▶ core       (127.0.0.1:13000)
               └─ /           ─▶ web        (127.0.0.1:13001)
```

Ports 3000/3001 are taken by existing containers, so ATLAS apps publish on
**13000/13001** via `platform/apps-ports.yml` (loopback only).

## First deploy (already done — for rebuild from scratch)

```bash
# 1. Platform: db, redis, minio, keycloak, daily backup sidecar
cd /opt/atlas && git pull
cd platform && docker compose up -d postgres redis minio keycloak backup

# 2. Bootstrap: realm import + atlas DB role password + .env.apps
./scripts/staging-bootstrap.sh
#    If keycloak crash-loops on "password authentication failed for keycloak":
#    sync the role to the .env value, then restart:
#    docker compose exec -T postgres psql -U postgres \
#      -c "ALTER ROLE keycloak PASSWORD '<KEYCLOAK_DB_PASSWORD from .env>'"
#    docker compose restart keycloak

# 3. Build + run the apps on loopback ports
docker compose -f docker-compose.apps.yml build core web
docker compose -f docker-compose.apps.yml -f apps-ports.yml up -d

# 4. Apply database migrations (REQUIRES OPERATOR AUTHORIZATION)
docker compose -f docker-compose.apps.yml run --rm --entrypoint sh core \
  -c "cd /app/apps/core && pnpm db:migrate"
```

## Deploying an update

One command — pulls, detects new migrations, rebuilds, recreates, verifies:

```bash
/opt/atlas/platform/scripts/deploy.sh
```

The script encodes the manual sequence below (kept for reference/debugging):

```bash
cd /opt/atlas && git pull
cd platform
docker compose -f docker-compose.apps.yml build --no-cache core worker web
docker compose -f docker-compose.apps.yml -f apps-ports.yml up -d --force-recreate
# run db:migrate ONLY if new migrations were added (check apps/core/drizzle)
```

> Gotcha: a plain `docker compose build` can reuse the cached COPY layer and
> ship stale source. Use `--no-cache` for the app images after a `git pull`,
> and confirm with:
> `docker compose -f docker-compose.apps.yml exec -T core \
>   grep -c <new-symbol> /app/apps/core/src/...`

## TLS / domain

`certbot --nginx -d atlas.marocinfra.com` issued the certificate and wired
auto-renewal. Keycloak runs with `KC_HOSTNAME=https://atlas.marocinfra.com/auth`
and `--hostname-strict false`; the `atlas-web` and `atlas-mobile` realm
clients carry `https://atlas.marocinfra.com/*` redirect URIs.

## Operations

| Task | Command |
|------|---------|
| Health | `curl https://atlas.marocinfra.com/api/health` |
| App logs | `docker compose -f docker-compose.apps.yml logs --tail=50 core` |
| Tunnel (pre-DNS debug) | `ssh -L 3001:localhost:13001 -L 8081:localhost:8081 root@<vps>` |
| Backup drill | `docker compose exec backup /scripts/pg-restore-drill.sh` |
| Rotate user pwd | `docker compose exec keycloak /opt/keycloak/bin/kcadm.sh set-password ...` |
| Credentials | `cat /root/atlas-credentials.txt` (root-only, never in git/chat) |

## Going live on the PMMP portal

The Sentinel source flips to live via `.env.apps`:

```
WATCH_SOURCE=live
WATCH_PMMP_URL=https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons&EnCours
```

The consultation rows are server-rendered on the **advanced-search** page
(Atexo MPE), not the `/pmmp/` landing page — the parser handles that layout.
Recrawl coverage is visible at `GET /api/watch/coverage` and on the
dashboard. (C1 Result Miner live mining of award notices needs a per-
consultation detail crawl — those pages are ASP.NET PostBack, not simple
GET — and is not yet built.)
