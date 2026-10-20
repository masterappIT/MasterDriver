#!/usr/bin/env bash
# Restores a backup into a throwaway Postgres with no network and checks it
# (installed as /usr/local/sbin/masterdriver-restore-test):
# the checksums hold, the tables are there, and every file the database names is in the archive.
#   masterdriver-restore-test [backup directory]    (default: the newest under /srv/apps/masterdriver/backups)
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
dir="${1:-$(ls -1d "$APP"/backups/*/ 2>/dev/null | sort | tail -1)}"
dir="${dir%/}"
[[ -s "$dir/master_driver.dump" && -s "$dir/media.tar.gz" ]] || die "no complete backup in ${dir:-$APP/backups}"
(cd "$dir" && sha256sum --check --quiet SHA256SUMS) || die "checksums do not match in $dir"

name="masterdriver-restore-test-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" -e POSTGRES_DB=restore "$POSTGRES_IMAGE" >/dev/null
for attempt in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$name" pg_restore -U postgres -d restore --no-owner --no-acl --exit-on-error < "$dir/master_driver.dump" \
  || die "restore failed: $dir"

sql() { docker exec -i "$name" psql -U postgres -d restore -v ON_ERROR_STOP=1 -At -c "$1"; }
tables="$(sql "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
keys="$(sql 'select "storageKey" from "SupportMedia" where "deletedAt" is null union all select "storageKey" from "ProfilePhoto"' | sort)"
files="$(tar -tzf "$dir/media.tar.gz" | grep -v '/$' | sed 's#^media/##' | sort)"
missing="$(comm -23 <(printf '%s\n' "$keys" | grep .) <(printf '%s\n' "$files" | grep .) || true)"
count() { printf '%s\n' "$1" | grep -c . || true; }
if [[ -n "$missing" ]]; then
  printf '%s\n' "$missing" >&2
  die "restore test: $(count "$missing") file(s) named in the database are not in the archive: $dir"
fi
log "Restore test passed: $dir ($tables tables, $(count "$keys") files named in the database, $(count "$files") in the archive)"
