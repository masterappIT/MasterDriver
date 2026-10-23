#!/usr/bin/env bash
# Releases MasterDriver on the HostKVM server. Installed as /usr/local/sbin/masterdriver-deploy and run
# as root: by deploy-production.yml through the deploy-masterdriver account (one command for each of the
# workflow's deploy steps, so the workflow still checks the commit is current before each), or by hand.
#
#   masterdriver-deploy backup <commit>
#   masterdriver-deploy api <commit> <api image digest>
#   masterdriver-deploy frontends <commit> <web image digest> <admin image digest>
#   masterdriver-deploy status
#
# Images come from Artifact Registry by digest. Every service has two slots: the new version starts in
# the other slot and takes no traffic until its checks pass; only then is the old one stopped. A failed
# check stops the new slot and leaves the old one serving. See docs/HOSTKVM-MIGRATION.md.
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
umask 022

RELEASE="$APP/release.env"
KEYS=(API_SLOT API_A_IMAGE API_B_IMAGE API_COMMIT FRONTEND_SLOT WEB_A_IMAGE WEB_B_IMAGE ADMIN_A_IMAGE ADMIN_B_IMAGE FRONTEND_COMMIT)
PREDEPLOY_KEEP=5
LOG_DAYS=30
# The name both API slots answer to on the `masterdriver` network; the front ends' nginx asks for it (api-upstream.conf).
API_NAME=masterdriver-api

usage() {
  printf 'Usage: masterdriver-deploy backup <commit> | api <commit> <api digest> | frontends <commit> <web digest> <admin digest> | status\n' >&2
  exit 64
}
check_commit() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { printf 'Invalid commit SHA.\n' >&2; exit 64; }; }
check_digest() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'Invalid image digest.\n' >&2; exit 64; }; }
upper() { tr '[:lower:]' '[:upper:]' <<<"$1"; }
other() { [[ "$1" == a ]] && printf b || printf a; }

declare -A R
load_release() {
  local key
  for key in "${KEYS[@]}"; do R[$key]="$(env_value "$RELEASE" "$key")"; done
}
# Writes R to a new env file and prints its path; the caller moves it into place once the release holds.
write_release() {
  local file key
  file="$(mktemp "$APP/release.env.XXXXXX")"
  {
    printf '# Written by masterdriver-deploy, %s\n' "$(date -u +%FT%TZ)"
    for key in "${KEYS[@]}"; do printf '%s=%s\n' "$key" "${R[$key]}"; done
  } > "$file"
  chmod 644 "$file"
  printf '%s' "$file"
}
commit_release() {
  [[ -f "$RELEASE" ]] && cp -p "$RELEASE" "$RELEASE.prev"
  mv "$1" "$RELEASE"
}

compose() { docker compose --project-directory "$APP" -f "$APP/compose.yaml" --env-file "$1" "${@:2}"; }

running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == true ]]; }
image_of() { docker inspect -f '{{.Config.Image}}' "$1" 2>/dev/null || true; }

# A slot's container is about to be replaced: keep its log (docker drops it with the container).
save_logs() {
  local container="$1"
  docker inspect "$container" >/dev/null 2>&1 || return 0
  docker logs --timestamps "$container" 2>&1 | gzip > "$APP/logs/$container-$(date -u +%Y%m%dT%H%M%SZ).log.gz" || true
  find "$APP/logs" -name 'masterdriver-*.log.gz' -mtime +"$LOG_DAYS" -delete || true
}

api_healthy() {
  docker exec "$1" node -e '
    Promise.all(["/api/health/live", "/api/health/ready"].map((path) =>
      fetch("http://127.0.0.1:8080" + path).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); })))
      .then(() => process.exit(0), () => process.exit(1));' >/dev/null 2>&1
}
# A front end answers itself and reaches the API through its own /api.
frontend_healthy() {
  docker exec "$1" wget -q --spider http://127.0.0.1:8080/healthz 2>/dev/null \
    && docker exec "$1" wget -q -O /dev/null http://127.0.0.1:8080/api/health/ready 2>/dev/null
}
# Waits until every container runs the expected image and passes check $1 (up to 5 minutes).
wait_until() {
  local check="$1" container image attempt ok pair
  shift
  for attempt in $(seq 1 60); do
    ok=1
    for pair in "$@"; do
      container="${pair%%=*}"; image="${pair#*=}"
      if ! running "$container" || [[ "$(image_of "$container")" != "$image" ]] || ! "$check" "$container"; then ok=0; break; fi
    done
    [[ "$ok" == 1 ]] && return 0
    sleep 5
  done
  return 1
}

# Seconds between a new API slot taking traffic and the old one stopping. nginx looks the shared name up
# every 5 seconds. A front end started before 2026-10-23 still asks for each slot's own name, and tries
# a name it could not find only every 30 seconds, so it is given longer. Its configuration is the file
# it was started with: setup.sh installs a new file, and a running container keeps the one it mounted.
api_switch_wait() {
  local web="masterdriver-web-${R[FRONTEND_SLOT]}"
  if [[ -n "${R[FRONTEND_SLOT]}" ]] && running "$web" \
    && ! docker exec "$web" grep -qF "server $API_NAME:8080" /etc/nginx/conf.d/api-upstream.conf 2>/dev/null; then
    printf 35
  else
    printf 8
  fi
}

cmd_backup() {
  local sha="$1" dump
  install -d -m 700 "$APP/predeploy"
  dump="$APP/predeploy/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.dump"
  dump_database "$dump" || die "pre-release database backup failed: commit=$sha"
  chmod 600 "$dump"
  ls -1t "$APP"/predeploy/*.dump | tail -n +$((PREDEPLOY_KEEP + 1)) | xargs -r rm -f
  log "Database backed up: commit=$sha file=$dump"
}

cmd_api() {
  local sha="$1" image="$REGISTRY/api@$2" old new container file web
  load_release
  old="${R[API_SLOT]}"
  new="$(other "${old:-b}")"
  container="masterdriver-api-$new"
  log "API release started: commit=$sha image=$image slot=$new"

  docker pull --quiet "$image" >/dev/null || die "API image pull failed: $image"

  # The schema is changed before the new API starts, as by the migration job on Cloud Run. The old
  # API keeps running, so a migration must work with both versions.
  docker run --rm --network data --env-file "$APP/app.env" "$image" npm run prisma:migrate:deploy \
    || die "migration failed; nothing deployed: image=$image"
  log "Migration completed: image=$image"

  save_logs "$container"
  R[API_$(upper "$new")_IMAGE]="$image"
  # First release: the other slot names the same image, so the compose file always resolves.
  [[ -n "$old" ]] || R[API_$(upper "$(other "$new")")_IMAGE]="$image"
  file="$(write_release)"
  compose "$file" up --detach --no-deps --force-recreate --quiet-pull "api-$new"

  if ! wait_until api_healthy "$container=$image"; then
    docker logs --tail 40 "$container" >&2 || true
    docker stop "$container" >/dev/null || true
    rm -f "$file"
    die "candidate API failed its checks; the previous version keeps serving: slot=$new image=$image"
  fi
  log "Candidate ready: container=$container image=$image"

  # Traffic: the new slot joins under the shared name and the front ends' nginx finds it (api-upstream.conf).
  # While the old one stops, nginx sends what it refuses to the new one; it leaves the name once it has stopped.
  docker network connect --alias "$API_NAME" masterdriver "$container"
  sleep "$(api_switch_wait)"
  if [[ -n "$old" ]]; then docker stop --time 30 "masterdriver-api-$old" >/dev/null; fi

  # Check through a running front end, as a user's request goes. If that fails, go back to the old slot.
  web="masterdriver-web-${R[FRONTEND_SLOT]}"
  if [[ -n "${R[FRONTEND_SLOT]}" ]] && running "$web" && ! wait_until frontend_healthy "$web=$(image_of "$web")"; then
    if [[ -n "$old" ]]; then docker start "masterdriver-api-$old" >/dev/null || true; fi
    docker network disconnect masterdriver "$container" || true
    docker stop "$container" >/dev/null || true
    rm -f "$file"
    die "traffic check through $web failed; went back to slot ${old:-none}: image=$image"
  fi

  R[API_SLOT]="$new"
  R[API_COMMIT]="$sha"
  rm -f "$file"
  commit_release "$(write_release)"
  log "API released: commit=$sha slot=$new image=$image"
}

cmd_frontends() {
  local sha="$1" web_image="$REGISTRY/web@$2" admin_image="$REGISTRY/admin@$3" old new file caddy name
  load_release
  [[ -n "${R[API_SLOT]}" ]] || die 'no API is released yet; release the API first'
  caddy="$(shared_container caddy)"
  [[ -n "$caddy" ]] || die 'the shared Caddy container is not running'
  old="${R[FRONTEND_SLOT]}"
  new="$(other "${old:-b}")"
  log "Front-end release started: commit=$sha web=$web_image admin=$admin_image slot=$new"

  docker pull --quiet "$web_image" >/dev/null || die "web image pull failed: $web_image"
  docker pull --quiet "$admin_image" >/dev/null || die "admin image pull failed: $admin_image"

  for name in web admin; do save_logs "masterdriver-$name-$new"; done
  R[WEB_$(upper "$new")_IMAGE]="$web_image"
  R[ADMIN_$(upper "$new")_IMAGE]="$admin_image"
  if [[ -z "$old" ]]; then
    R[WEB_$(upper "$(other "$new")")_IMAGE]="$web_image"
    R[ADMIN_$(upper "$(other "$new")")_IMAGE]="$admin_image"
  fi
  file="$(write_release)"
  compose "$file" up --detach --no-deps --force-recreate --quiet-pull "web-$new" "admin-$new"

  if ! wait_until frontend_healthy "masterdriver-web-$new=$web_image" "masterdriver-admin-$new=$admin_image"; then
    for name in web admin; do docker logs --tail 20 "masterdriver-$name-$new" >&2 || true; done
    docker stop "masterdriver-web-$new" "masterdriver-admin-$new" >/dev/null || true
    rm -f "$file"
    die "candidate front ends failed their checks; the previous version keeps serving: slot=$new"
  fi
  log "Candidate front ends ready: slot=$new"

  # Traffic: Caddy finds the new slot once it is on `edge` and its health check passes (every 10 s).
  for name in web admin; do docker network connect edge "masterdriver-$name-$new"; done
  for name in web admin; do
    docker exec "$caddy" wget -q --spider "http://masterdriver-$name-$new:8080/healthz" \
      || { rm -f "$file"; die "Caddy cannot reach masterdriver-$name-$new; the previous version keeps serving"; }
  done
  sleep 12
  if [[ -n "$old" ]]; then docker stop --time 100 "masterdriver-web-$old" "masterdriver-admin-$old" >/dev/null; fi

  for name in web admin; do
    if ! docker exec "$caddy" wget -q --spider "http://masterdriver-$name-$new:8080/healthz"; then
      if [[ -n "$old" ]]; then docker start "masterdriver-web-$old" "masterdriver-admin-$old" >/dev/null || true; fi
      docker stop "masterdriver-web-$new" "masterdriver-admin-$new" >/dev/null || true
      rm -f "$file"
      die "traffic check through Caddy failed for masterdriver-$name-$new; started slot ${old:-none} again"
    fi
  done

  R[FRONTEND_SLOT]="$new"
  R[FRONTEND_COMMIT]="$sha"
  rm -f "$file"
  commit_release "$(write_release)"
  log "Front ends released: commit=$sha slot=$new web=$web_image admin=$admin_image"
}

cmd_status() {
  [[ -f "$RELEASE" ]] && cat "$RELEASE" || printf 'Nothing released yet.\n'
  docker ps --all --filter name=masterdriver- --format '{{.Names}}\t{{.Status}}\t{{.Image}}'
}

[[ $# -ge 1 ]] || usage
command="$1"
shift
case "$command" in
  backup) [[ $# -eq 1 ]] || usage; check_commit "$1" ;;
  api) [[ $# -eq 2 ]] || usage; check_commit "$1"; check_digest "$2" ;;
  frontends) [[ $# -eq 3 ]] || usage; check_commit "$1"; check_digest "$2"; check_digest "$3" ;;
  status) [[ $# -eq 0 ]] || usage; cmd_status; exit 0 ;;
  *) usage ;;
esac

install -d -m 755 "$APP/logs"
exec 9>/run/masterdriver-deploy.lock
flock -w 900 9 || die 'another release is still running'
"cmd_$command" "$@"
