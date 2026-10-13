#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${REGION:?Set REGION}"
: "${SERVICE_NAME:?Set SERVICE_NAME}"
: "${REVISION:?Set REVISION to a previously verified revision}"

if ! gcloud run revisions describe "$REVISION" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service "$SERVICE_NAME" >/dev/null; then
  printf 'Revision does not belong to the target service: %s\n' "$REVISION" >&2
  exit 2
fi

gcloud run services update-traffic "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "${REVISION}=100"

traffic_revision=""
traffic_percent=""
for attempt in {1..60}; do
  traffic_revision="$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.traffic[0].revisionName)')"
  traffic_percent="$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.traffic[0].percent)')"
  if [[ "$traffic_revision" == "$REVISION" && "$traffic_percent" == "100" ]]; then
    break
  fi
  sleep 5
done
if [[ "$traffic_revision" != "$REVISION" || "$traffic_percent" != "100" ]]; then
  printf 'Rollback traffic convergence timed out: service=%s revision=%s percent=%s expected_revision=%s\n' \
    "$SERVICE_NAME" "$traffic_revision" "$traffic_percent" "$REVISION" >&2
  gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='yaml(status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)' >&2 || true
  exit 1
fi
revision_image="$(gcloud run revisions describe "$REVISION" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(spec.containers[0].image)')"
traffic_image="$(gcloud run revisions describe "$traffic_revision" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(spec.containers[0].image)')"
if [[ "$traffic_revision" != "$REVISION" || "$traffic_percent" != "100" || "$traffic_image" != "$revision_image" ]]; then
  printf 'Rollback traffic verification failed: service=%s revision=%s percent=%s image=%s expected_revision=%s expected_image=%s\n' \
    "$SERVICE_NAME" "$traffic_revision" "$traffic_percent" "$traffic_image" "$REVISION" "$revision_image" >&2
  gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='yaml(status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)' >&2 || true
  exit 1
fi
printf 'Rollback traffic verified: service=%s revision=%s percent=%s image=%s\n' \
  "$SERVICE_NAME" "$traffic_revision" "$traffic_percent" "$traffic_image"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"
SERVICE_URL="$SERVICE_URL" "$(dirname "$0")/smoke-test.sh"
