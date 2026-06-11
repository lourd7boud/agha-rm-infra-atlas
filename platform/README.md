# ATLAS Platform — Infrastructure Foundation

Phase 0 stack: PostgreSQL, Redis, MinIO, Keycloak, Odoo, Metabase, Caddy.
This seed runs on a developer machine or a staging VPS as-is.

## Quick Start

```bash
cp .env.example .env        # then edit every value — no default goes to prod
docker compose up -d
docker compose ps           # all services healthy
```

Local endpoints (via Caddy, set DOMAIN=localhost for dev):
- Keycloak    https://auth.{DOMAIN}
- Odoo        https://erp.{DOMAIN}
- Metabase    https://bi.{DOMAIN}
- MinIO API   https://s3.{DOMAIN}  (console: https://s3c.{DOMAIN})

## Hard Rules

- **Never** expose Postgres/Redis ports publicly; admin UIs go behind
  Tailscale in staging/prod (see 10-architecture/04-security-compliance.md).
- Every value in `.env` is a secret or environment-specific — `.env` is
  git-ignored; the template is `.env.example`.
- First boot: rotate the placeholder role passwords created by
  `initdb/01-databases.sql` (`ALTER ROLE … PASSWORD …`), configure Keycloak
  realm `atlas`, enforce MFA, then wire Odoo/Metabase OIDC.
- Backups (pgBackRest + MinIO replication) are added in build-sequence Step 0
  before anything else runs in production.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Service definitions |
| `.env.example` | Environment template (synthetic values) |
| `Caddyfile` | Reverse proxy + automatic TLS |
| `initdb/01-databases.sql` | Creates per-service databases & roles on first boot |
| `runbooks/` | Operational runbooks (populated during Phase 0) |
