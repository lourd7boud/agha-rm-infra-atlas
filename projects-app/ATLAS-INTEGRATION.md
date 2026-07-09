# Projets & Chantiers — BTP source app (REFERENCE ONLY)

> **STATUS (2026-07-09): retired as a served app.** `/projects` on
> `atlas.marocinfra.com` is now the NATIVE ATLAS module (NestJS `/api/btp/*` +
> Next.js `apps/web/src/app/projects/**`), a faithful rebuild of this app's
> engine (bordereau → métré → décompte auto, révision des prix, registres,
> photothèque). This directory stays in the repo as the **blueprint + data
> source**: the `projects-postgres` container (btpdb) feeds
> `apps/core/scripts/migrate-btp.ts`. Do not serve it at /projects again.

This directory is the **lift-and-shift** of the standalone BTP construction-management
app (formerly served at `marocinfra.com`) into the ATLAS platform. It was briefly
served at `https://atlas.marocinfra.com/projects/` before the native rebuild.

It is intentionally **isolated from the pnpm workspace** (it lives at the repo root,
not under `apps/*`), because it has its own npm toolchain and lockfiles.

## Layout
- `backend/` — the original Express + raw-`pg` API (JWT auth, socket.io realtime via
  Postgres LISTEN/NOTIFY, PDF/Excel export, local-disk uploads). Only real deps:
  **Postgres + the uploads dir** (the CouchDB/Redis/MinIO references in the source are
  vestigial and unused by the running code).
- `frontend-web/` — the React + Vite + Tailwind SPA (HashRouter, offline via Dexie).
  Re-pointed to the `/projects` subpath via `import.meta.env.BASE_URL` (vite
  `base: '/projects/'`): API → `/projects/api`, socket.io → `/projects/socket.io/`,
  uploads → `/projects/uploads`. See the `BASE_URL` edits in `src/services/*`,
  `src/hooks/*`, `src/utils/logger.ts`, `src/components/**`.

## Deployment (on the VPS)
- Stack: `platform/docker-compose.projects.yml` — `projects-postgres` (db `btpdb`) +
  `projects-api` (loopback `127.0.0.1:13010`). Secrets in `platform/.env.projects`
  (git-ignored).
- Reverse proxy: the `/projects/*` blocks in
  `platform/nginx/atlas.marocinfra.com.conf` (SPA static from `/var/www/atlas-projects`,
  API/socket/uploads proxied to `:13010`).
- Rail-nav entry: `apps/web/src/components/nav/RailNav.tsx` → "Projets & Chantiers"
  is a full-page `<a href="/projects/">` (external to the Next app).

### Build the SPA
```bash
cd projects-app/frontend-web
npm install --include=dev
npm run build            # = vite build (base=/projects/)
cp -r dist/. /var/www/atlas-projects/
```

### Build/run the API
```bash
cd platform
docker compose -f docker-compose.projects.yml --env-file .env.projects up -d --build
```

### Data
Migrated from the old box via `pg_dump btpdb` (restored into `projects-postgres`) plus
the `backend/uploads` file store (bind-mounted at `/opt/atlas/projects-data/uploads`).
Existing users log in with their previous credentials (same bcrypt hashes).
