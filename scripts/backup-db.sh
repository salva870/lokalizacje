#!/bin/bash
set -euo pipefail

BACKUP_DIR="${LOC_BACKUP_DIR:-/root/lokalizacje/backups}"
CONTAINER="${LOC_DB_CONTAINER:-lokalizacje-db}"
RETENTION_DAYS="${LOC_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/lokalizacje-${STAMP}.sql.gz"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Kontener $CONTAINER nie dziala — backup pominiety." >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump -U postgres -d lokalizacje | gzip > "$OUT"
find "$BACKUP_DIR" -name 'lokalizacje-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete
echo "Backup zapisany: $OUT"
