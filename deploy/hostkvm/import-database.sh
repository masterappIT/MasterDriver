#!/usr/bin/env bash
# Replaces the master_driver database with a dump of the Cloud SQL one, or prints row counts
# (installed as /usr/local/sbin/masterdriver-import-database). Only while this server is not serving
# MasterDriver yet: steps 2 and 4 of docs/HOSTKVM-MIGRATION.md.
#   masterdriver-import-database --replace <dump made with pg_dump --format=custom --no-owner --no-acl>
#   masterdriver-import-database --counts
# The same row-count query, for Cloud SQL, is COUNTS_SQL in lib.sh.
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root

if [[ "${1:-}" == --counts && $# -eq 1 ]]; then
  database_psql -At -F ' ' -c "$COUNTS_SQL"
  exit 0
fi
[[ "${1:-}" == --replace && $# -eq 2 && -s "$2" ]] || {
  printf 'Usage: masterdriver-import-database --replace <dump> | --counts\n' >&2
  exit 64
}
dump="$2"
postgres="$(shared_container postgres)"
[[ -n "$postgres" ]] || die 'the shared Postgres container is not running'

# The API must not write while the database is replaced.
stopped=()
for slot in a b; do
  if [[ "$(docker inspect -f '{{.State.Running}}' "masterdriver-api-$slot" 2>/dev/null)" == true ]]; then
    docker stop --time 30 "masterdriver-api-$slot" >/dev/null
    stopped+=("masterdriver-api-$slot")
  fi
done

docker exec -i "$postgres" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity where datname = 'master_driver' and pid <> pg_backend_pid();
drop database if exists master_driver;
create database master_driver owner master_driver;
SQL
PGURL="$(database_url)" docker run --rm -i --network data -e PGURL "$POSTGRES_IMAGE" \
  sh -c 'exec pg_restore --no-owner --no-acl --exit-on-error -d "$PGURL"' < "$dump" \
  || die "restore failed: $dump (the API stays stopped)"
log "Database replaced from $dump"

for container in "${stopped[@]}"; do docker start "$container" >/dev/null; done
database_psql -At -F ' ' -c "$COUNTS_SQL"
