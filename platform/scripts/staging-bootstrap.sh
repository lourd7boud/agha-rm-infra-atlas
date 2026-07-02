#!/bin/sh
# ATLAS staging bootstrap — run ON the server from /opt/atlas/platform.
# Idempotent-ish: safe to re-run; secrets are generated only when missing.
# 1) Keycloak: import the atlas realm + expose on loopback for SSH tunnels.
# 2) Rotate the atlas DB role password (initdb placeholder -> random).
# 3) Materialize .env.apps from the template with generated secrets.
set -eu
cd "$(dirname "$0")/.."

cat > docker-compose.override.yml <<'EOF'
services:
  keycloak:
    command: ["start", "--http-enabled", "true", "--proxy-headers", "xforwarded", "--import-realm", "--hostname-strict", "false"]
    ports:
      - "127.0.0.1:8081:8080"
    volumes:
      - ./keycloak:/opt/keycloak/data/import:ro
EOF

if [ ! -f .env.apps ]; then
  APW=$(openssl rand -hex 16)
  docker compose exec -T postgres psql -U postgres \
    -c "ALTER ROLE atlas PASSWORD '$APW'" > /dev/null
  cp .env.apps.example .env.apps
  sed -i "s|postgres://atlas:CHANGE_ME|postgres://atlas:$APW|" .env.apps
  sed -i "s|OIDC_ISSUER=.*|OIDC_ISSUER=http://localhost:8081/realms/atlas|" .env.apps
  sed -i "s|AUTH_KEYCLOAK_ISSUER=.*|AUTH_KEYCLOAK_ISSUER=http://localhost:8081/realms/atlas|" .env.apps
  sed -i "s|S3_ACCESS_KEY=CHANGE_ME|S3_ACCESS_KEY=$(grep MINIO_ROOT_USER .env | cut -d= -f2)|" .env.apps
  sed -i "s|S3_SECRET_KEY=CHANGE_ME|S3_SECRET_KEY=$(grep MINIO_ROOT_PASSWORD .env | cut -d= -f2)|" .env.apps
  sed -i "s|AUTH_SECRET=CHANGE_ME|AUTH_SECRET=$(openssl rand -hex 32)|" .env.apps
  sed -i "s|AUTH_URL=.*|AUTH_URL=http://localhost:3001|" .env.apps
  sed -i "s|AUTH_KEYCLOAK_SECRET=CHANGE_ME|AUTH_KEYCLOAK_SECRET=|" .env.apps
fi

docker compose up -d keycloak
sleep 20
echo "realm check:"
curl -s -o /dev/null -w "kc-realm:%{http_code}\n" http://localhost:8081/realms/atlas
echo "remaining placeholders: $(grep -c CHANGE_ME .env.apps || true)"
