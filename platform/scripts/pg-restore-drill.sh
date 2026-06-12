#!/bin/sh
# ATLAS restore drill — proves a backup is actually restorable (a backup that
# was never restored is a hope, not a backup). Restores the latest dump of
# DRILL_DB into a scratch database, counts rows in a probe table, drops the
# scratch. Run monthly (governance ritual) or after any backup-chain change:
#   docker compose -f platform/docker-compose.yml exec backup /scripts/pg-restore-drill.sh
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_DIR:=/backups}"
: "${DRILL_DB:=atlas}"
: "${DRILL_PROBE:=SELECT count(*) FROM tender.tender}"
export PGHOST PGUSER PGPASSWORD

LATEST="$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
[ -n "${LATEST}" ] || { echo "[drill] FAIL: no backup runs in ${BACKUP_DIR}"; exit 1; }
DUMP="${LATEST}/${DRILL_DB}.dump"
[ -f "${DUMP}" ] || { echo "[drill] FAIL: ${DUMP} not found"; exit 1; }

# Verify integrity manifest before trusting the dump.
(cd "${LATEST}" && sha256sum -c MANIFEST.sha256 > /dev/null) \
  || { echo "[drill] FAIL: checksum mismatch in ${LATEST}"; exit 1; }

SCRATCH="${DRILL_DB}_drill"
echo "[drill] restoring ${DUMP} -> ${SCRATCH}"
dropdb --if-exists "${SCRATCH}"
createdb "${SCRATCH}"
pg_restore --no-owner --dbname="${SCRATCH}" "${DUMP}"

ROWS="$(psql -At -d "${SCRATCH}" -c "${DRILL_PROBE}")"
dropdb "${SCRATCH}"

echo "[drill] OK: ${LATEST} restored, probe returned ${ROWS} row(s)"
