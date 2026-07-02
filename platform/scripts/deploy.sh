#!/usr/bin/env bash
# ATLAS staging deploy — one command, encoding runbooks/staging-deploy.md.
# Run ON the VPS:  /opt/atlas/platform/scripts/deploy.sh
#
# Steps: pull → detect new migrations → apply platform-compose drift →
# rebuild app images (--no-cache) → migrate if needed → recreate → verify.
set -euo pipefail

REPO=/opt/atlas
PLATFORM="$REPO/platform"
HEALTH_URL="${ATLAS_HEALTH_URL:-https://atlas.marocinfra.com/api/health}"

cd "$REPO"
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)
echo "==> ${BEFORE:0:7} -> ${AFTER:0:7}"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> nothing new; rebuilding anyway (source may be locally patched)"
fi

# Count migrations added by this pull — they must run BEFORE the new code.
NEW_MIGRATIONS=$(git diff --name-only "$BEFORE" "$AFTER" -- 'apps/core/drizzle/*.sql' | wc -l)

# Platform compose drift (resource caps, healthchecks, new services).
PLATFORM_CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" -- platform/docker-compose.yml | wc -l)

cd "$PLATFORM"

if [ "$PLATFORM_CHANGED" -gt 0 ]; then
  echo "==> platform compose changed — applying (brief postgres blip possible)"
  docker compose up -d postgres redis minio keycloak backup
fi

echo "==> building app images (--no-cache: cached COPY layers ship stale source)"
docker compose -f docker-compose.apps.yml build --no-cache core worker web

if [ "$NEW_MIGRATIONS" -gt 0 ]; then
  echo "==> $NEW_MIGRATIONS new migration(s) — applying before recreate"
  docker compose -f docker-compose.apps.yml run --rm --entrypoint sh core \
    -c "cd /app/apps/core && pnpm db:migrate"
fi

echo "==> recreating app containers"
docker compose -f docker-compose.apps.yml -f apps-ports.yml up -d --force-recreate

echo "==> waiting for core to become healthy"
status=starting
for _ in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' atlas-apps-core-1 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 5
done
if [ "$status" != healthy ]; then
  echo "!! core never became healthy — inspect with:"
  echo "   docker compose -f docker-compose.apps.yml logs --tail=100 core"
  exit 1
fi

echo "==> public health probe"
curl -fsS "$HEALTH_URL" && echo

echo "==> deployed ${AFTER:0:7} OK"
echo "    rollback: cd $REPO && git reset --hard $BEFORE && platform/scripts/deploy.sh"
