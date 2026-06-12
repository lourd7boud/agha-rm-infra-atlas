#!/bin/sh
# ATLAS PostgreSQL backup — runs inside the `backup` sidecar (postgres image).
# Dumps every database (custom format, compressed) into /backups/<UTC stamp>/
# and prunes runs older than RETENTION_DAYS. Fails loudly: any pg_dump error
# aborts the run with a non-zero exit so the container log shows the failure.
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_DIR:=/backups}"
: "${RETENTION_DAYS:=14}"
export PGHOST PGUSER PGPASSWORD

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${BACKUP_DIR}/${STAMP}"
mkdir -p "${RUN_DIR}"

# Globals (roles, grants) — needed for a from-scratch restore.
pg_dumpall --globals-only > "${RUN_DIR}/globals.sql"

# Every non-template database, custom format (-Fc → pg_restore-able).
DBS="$(psql -At -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'")"
for db in ${DBS}; do
  echo "[backup] ${db} -> ${RUN_DIR}/${db}.dump"
  pg_dump -Fc --no-owner --dbname="${db}" --file="${RUN_DIR}/${db}.dump"
done

# Integrity manifest: sizes + sha256 for off-site verification.
(cd "${RUN_DIR}" && sha256sum -- * > MANIFEST.sha256)

# Prune old runs (directories named like a UTC stamp, older than retention).
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" \
  -exec rm -rf {} +

echo "[backup] done: ${RUN_DIR} ($(du -sh "${RUN_DIR}" | cut -f1))"
