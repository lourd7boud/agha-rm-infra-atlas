# ATLAS Platform — Infrastructure Foundation

Phase 0 stack: PostgreSQL, Redis, MinIO, Keycloak, Odoo, Metabase, Caddy,
plus a daily backup sidecar. This seed runs on a developer machine or a
staging VPS as-is. The ATLAS applications (Core API + staff portal) deploy
on top via `docker-compose.apps.yml`.

## Quick Start

```bash
cp .env.example .env        # then edit every value — no default goes to prod
docker compose up -d
docker compose ps           # all services healthy
```

Local endpoints (via Caddy, set DOMAIN=localhost for dev):
- ATLAS portal https://atlas.{DOMAIN}
- ATLAS API   https://api.{DOMAIN}
- Keycloak    https://auth.{DOMAIN}
- Odoo        https://erp.{DOMAIN}
- Metabase    https://bi.{DOMAIN}
- MinIO API   https://s3.{DOMAIN}  (console: https://s3c.{DOMAIN})

## Deploying the ATLAS apps (staging/prod)

```bash
# 1. Platform first (creates the shared network + databases)
docker compose -f docker-compose.yml up -d

# 2. App secrets — every CHANGE_ME must be replaced
cp .env.apps.example .env.apps && $EDITOR .env.apps

# 3. Build & start Core API + portal (joins atlas-platform_default)
docker compose -f docker-compose.apps.yml up -d --build
```

Production safety: `apps/core/src/main.ts` refuses to boot with
`NODE_ENV=production` unless DATABASE_URL, OIDC_ISSUER, REDIS_URL and the
S3_* trio are set — no silent in-memory fallbacks in production.

## Backups & restore drill

The `backup` sidecar dumps **every** database daily (custom format +
`globals.sql` + sha256 manifest) into `./backups/<UTC stamp>/` and prunes
runs older than `RETENTION_DAYS` (14). A backup that was never restored is
a hope, not a backup — run the drill monthly (governance ritual):

```bash
docker compose exec backup /scripts/pg-restore-drill.sh
# [drill] OK: /backups/20260612T141644Z restored, probe returned N row(s)
```

The drill verifies the manifest, restores the latest `atlas` dump into a
scratch database, probes `tender.tender`, and drops the scratch. Copy
`./backups` off-site (rclone/restic to object storage) — a backup on the
same disk only survives software failures.

## Hard Rules

- **Never** expose Postgres/Redis ports publicly; admin UIs go behind
  Tailscale in staging/prod (see 10-architecture/04-security-compliance.md).
- Every value in `.env` / `.env.apps` is a secret or environment-specific —
  both are git-ignored; templates are `.env.example` / `.env.apps.example`.
- First boot: rotate the placeholder role passwords created by
  `initdb/01-databases.sql` (`ALTER ROLE … PASSWORD …`), configure Keycloak
  realm `atlas`, enforce MFA, then wire Odoo/Metabase OIDC.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Platform services + backup sidecar |
| `docker-compose.apps.yml` | ATLAS Core API + staff portal (production) |
| `docker-compose.dev.yml` | Lean local stack for development |
| `docker-compose.observability.yml` | Prometheus + Grafana profile |
| `.env.example` / `.env.apps.example` | Environment templates (synthetic values) |
| `Caddyfile` | Reverse proxy + automatic TLS + security headers |
| `initdb/01-databases.sql` | Creates per-service databases & roles on first boot |
| `scripts/pg-backup.sh` | Daily dump of all databases + rotation |
| `scripts/pg-restore-drill.sh` | Proves the latest backup restores |
| `runbooks/` | Operational runbooks (populated during Phase 0) |
