# shellcheck shell=bash
# Shared by the masterdriver-* scripts. Installed by setup.sh to /usr/local/lib/masterdriver/lib.sh.
# See docs/HOSTKVM-MIGRATION.md.

APP=/srv/apps/masterdriver
REGISTRY="${MASTERDRIVER_REGISTRY:-asia-east2-docker.pkg.dev/master-driver-511510/masterdriver}"
# The same major version as the server's Postgres, for pg_dump and pg_restore.
POSTGRES_IMAGE=postgres:16-bookworm
RCLONE_IMAGE=rclone/rclone:1.68.2

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$APP/logs/masterdriver.log" >&2; }
die() { log "FAILED: $1"; exit "${2:-1}"; }

require_root() { [[ "${EUID}" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }; }

# The value of KEY in an env file (KEY=VALUE, one per line); empty when it is not there.
env_value() { { grep -m1 "^$2=" "$1" 2>/dev/null || true; } | cut -d= -f2-; }

# The API's database URL without Prisma's own parameters (?schema=…), which libpq does not accept.
database_url() {
  local url
  url="$(env_value "$APP/app.env" DATABASE_URL)"
  [[ -n "$url" ]] || die 'DATABASE_URL missing in app.env'
  printf '%s' "${url%%\?*}"
}

# The server's shared Caddy and Postgres, found by their compose labels.
shared_container() {
  docker ps --filter "label=com.docker.compose.project=infra" --filter "label=com.docker.compose.service=$1" \
    --format '{{.Names}}' | head -1
}

# pg_dump of master_driver with the API's own account. The URL goes in by environment, not on a command line.
dump_database() {
  local out="$1"
  PGURL="$(database_url)" docker run --rm --network data -e PGURL "$POSTGRES_IMAGE" \
    sh -c 'exec pg_dump --format=custom --no-owner --no-acl "$PGURL"' > "$out" || return 1
  [[ -s "$out" ]]
}

# psql against master_driver with the API's own account; extra arguments go to psql.
database_psql() {
  PGURL="$(database_url)" docker run --rm -i --network data -e PGURL "$POSTGRES_IMAGE" \
    sh -c 'exec psql "$PGURL" -v ON_ERROR_STOP=1 "$@"' psql "$@"
}

# Exact row counts of every table, to compare with the same query on Cloud SQL.
COUNTS_SQL="select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
