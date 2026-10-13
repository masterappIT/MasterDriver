#!/usr/bin/env bash
set -euo pipefail

: "${SERVICE_URL:?Set SERVICE_URL to the deployed API URL}"

request() {
  local path="$1"
  curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --retry 4 \
    --retry-all-errors \
    "${SERVICE_URL%/}${path}"
}

request /api/health/live >/dev/null
request /api/health/ready >/dev/null
printf 'Smoke tests passed for %s\n' "$SERVICE_URL"
