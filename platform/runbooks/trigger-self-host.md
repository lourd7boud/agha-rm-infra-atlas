# Runbook — Trigger.dev v4 self-hosted (datao-parity orchestration)

Deploys the same stack `backend.datao.app` runs (Remix webapp + Node worker +
Postgres + Redis + ClickHouse + MinIO + Docker registry). Isolated from ATLAS
so a task avalanche can never starve the API's DB pool — this is the exact
lesson datao learned by putting Trigger.dev on a separate Hetzner box.

**Compose:** `platform/trigger/docker-compose.yml`
**Env template:** `platform/trigger/.env.example`

## 0. Choose the target VPS

The current `atlas.marocinfra.com` VPS **cannot host this stack** — it runs
at 3.7 GB / 85 % disk. Trigger.dev v4 needs at least 8 GB RAM and 40 GB free
disk to breathe (16 GB / 100 GB recommended for prod).

Suggested Hetzner match to datao's footprint:

| Instance | Cores | RAM   | Disk  | Price/mo | Verdict |
|----------|-------|-------|-------|----------|---------|
| CPX21    | 3 vCPU| 4 GB  | 80 GB | €7.55    | Too small |
| CPX31    | 4 vCPU| 8 GB  |160 GB | €13.10   | Minimum viable |
| CPX41    | 8 vCPU|16 GB  |240 GB | €25.20   | Comfortable |
| CCX23    | 4 vCPU|16 GB  |160 GB | €50.85   | Dedicated CPU — matches datao |

Datao's `registry.datao.app` box (46.224.129.154) reverses to a Hetzner
CCX-class dedicated-CPU instance.

Once you've provisioned the target VPS, point a DNS A record for
`trigger.marocinfra.com` at it before continuing.

## 1. First deploy

```bash
# On the target VPS:
apt update && apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Clone ATLAS (only need platform/trigger/*):
git clone https://github.com/lourd7boud/agha-rm-infra-atlas.git /opt/atlas
cd /opt/atlas/platform/trigger

# Fill secrets (four `openssl rand -hex 16` calls, plus DB/CH/MinIO/registry pw):
cp .env.example .env
for k in SESSION_SECRET MAGIC_LINK_SECRET ENCRYPTION_KEY MANAGED_WORKER_SECRET \
         POSTGRES_PASSWORD CLICKHOUSE_PASSWORD MINIO_ROOT_PASSWORD \
         DOCKER_REGISTRY_PASSWORD ; do
  v=$(openssl rand -hex 16)
  sed -i "s|^${k}=.*|${k}=${v}|" .env
done
sed -i "s|APP_ORIGIN=.*|APP_ORIGIN=https://trigger.marocinfra.com|" .env

# Registry htpasswd (mounted read-only by the registry service):
docker run --rm --entrypoint htpasswd httpd:2 -Bbn \
  "$(grep DOCKER_REGISTRY_USERNAME .env | cut -d= -f2)" \
  "$(grep DOCKER_REGISTRY_PASSWORD .env | cut -d= -f2)" > htpasswd

# Bring up the state services first, then the webapp:
docker compose up -d postgres redis clickhouse minio registry
sleep 20
docker compose up -d webapp

# The webapp prints the worker token on FIRST boot only — capture it:
docker compose logs webapp | grep -A 1 TRIGGER_WORKER_TOKEN
# Paste that value into .env:
nano .env    # TRIGGER_WORKER_TOKEN=...

# Now start the worker:
docker compose up -d worker
docker compose ps
```

## 2. TLS + nginx

```bash
apt install -y nginx certbot python3-certbot-nginx
cat > /etc/nginx/sites-available/trigger.marocinfra.com <<'NGINX'
server {
  server_name trigger.marocinfra.com;
  client_max_body_size 100M;
  location / {
    proxy_pass http://127.0.0.1:8030;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }
  listen 80;
}
NGINX
ln -s /etc/nginx/sites-available/trigger.marocinfra.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d trigger.marocinfra.com --agree-tos -m ops@marocinfra.com --non-interactive
```

## 3. First login + ATLAS project

- Open `https://trigger.marocinfra.com` in a browser.
- Sign up as the first admin (this becomes the workspace owner).
- Create org `AGHA`, project `atlas`.
- Under **Settings → API Keys**, generate a `prod` and `dev` project ref key.
- Store both keys in the ATLAS core `.env.apps`:
  ```
  TRIGGER_PROJECT_REF=proj_...
  TRIGGER_SECRET_KEY_PROD=tr_prod_...
  TRIGGER_SECRET_KEY_DEV=tr_dev_...
  ```

## 4. Wire ATLAS to Trigger.dev (next runbook — T3/T4)

Once the stack is live:

- `pnpm --filter @atlas/core add @trigger.dev/sdk` — install SDK
- Author `apps/core/trigger/sentinel-sweep.ts` — wrap the current Sentinel
  logic as a `schedules.task({ cron: "*/15 * * * *" })`
- Author `apps/core/trigger/dossier-extract.ts` — `task({ id: "dossier.extract",
  run: async ({ tenderId }) => ... })`
- `npx trigger.dev@latest deploy --self-hosted` — pushes the task image to the
  registry running on this VPS
- Retire the `worker` container from `docker-compose.apps.yml` — Trigger.dev's
  worker fully replaces the BullMQ one.

## Operations

| Task | Command |
|------|---------|
| Health | `curl -sSf https://trigger.marocinfra.com` |
| App logs | `docker compose logs --tail=100 webapp` |
| Task logs | Use the web UI's Runs page |
| Restart worker | `docker compose restart worker` |
| DB backup | `docker compose exec postgres pg_dump -U postgres main > backup.sql` |
| Rotate worker token | Trigger.dev UI → Settings → Worker groups → Rotate |
