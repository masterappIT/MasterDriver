#!/usr/bin/env bash
# Removes 客服 files past their keep-until time (installed as /usr/local/sbin/masterdriver-purge; daily by cron).
# Runs in the API container that is serving, which has the files and the database settings.
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
slot="$(env_value "$APP/release.env" API_SLOT)"
[[ -n "$slot" ]] || die 'no API is released yet'
docker exec "masterdriver-api-$slot" node dist/cli/support-media.js --purge
