#!/usr/bin/env bash
# Puts MasterDriver's sites on the server's shared Caddy (installed as /usr/local/sbin/masterdriver-caddy-site).
#   masterdriver-caddy-site "<web host>[, <web host>…]" "<admin host>[, <admin host>…]"
# Caddy asks for each host's HTTPS certificate as soon as the site is there, so a host is added only once
# its DNS (or the load balancer's challenge path) reaches this server. See docs/HOSTKVM-MIGRATION.md.
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
SITES="${CADDY_SITES_DIR:-/srv/infra/sites}"
TEMPLATE=/usr/local/lib/masterdriver/masterdriver.caddy
hosts='^[a-z0-9.-]+(, [a-z0-9.-]+)*$'
[[ $# -eq 2 && "$1" =~ $hosts && "$2" =~ $hosts ]] || {
  printf 'Usage: masterdriver-caddy-site "<web hosts>" "<admin hosts>"  (comma and space between hosts)\n' >&2
  exit 64
}
caddy="$(shared_container caddy)"
[[ -n "$caddy" ]] || die 'the shared Caddy container is not running'
[[ -d "$SITES" ]] || die "Caddy sites directory not found: $SITES"

site="$SITES/masterdriver.caddy"
previous="$(mktemp)"
trap 'rm -f "$previous"' EXIT
[[ -f "$site" ]] && cp -p "$site" "$previous"
sed -e "s/__WEB_HOSTS__/$1/" -e "s/__ADMIN_HOSTS__/$2/" "$TEMPLATE" > "$site.new"
chmod 644 "$site.new"
mv "$site.new" "$site"
if ! docker exec "$caddy" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
  if [[ -s "$previous" ]]; then cp -p "$previous" "$site"; else rm -f "$site"; fi
  die 'Caddy rejected the site; the previous one is back'
fi
docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
log "Caddy sites: web=$1 admin=$2"
