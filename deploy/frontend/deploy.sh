#!/usr/bin/env bash
# Releases one static app (web or admin) as a Cloud Run service running nginx.
# After Master Travel's deploy/frontend/deploy.sh (see docs/REUSE.md).
set -euo pipefail

required=(PROJECT_ID REGION SERVICE_NAME IMAGE SERVICE_ACCOUNT API_ORIGIN)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required variable: %s\n' "$name" >&2
    exit 2
  fi
done

if [[ "$IMAGE" != *@sha256:* ]]; then
  printf 'IMAGE must use an immutable sha256 digest: %s\n' "$IMAGE" >&2
  exit 2
fi

deploy_args=(
  run deploy "$SERVICE_NAME"
  --project "$PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE"
  --service-account "$SERVICE_ACCOUNT"
  --set-env-vars "API_ORIGIN=$API_ORIGIN"
  --port 8080
  --memory 256Mi
  --cpu 1
  --min-instances "${MIN_INSTANCES:-0}"
  --max-instances "${MAX_INSTANCES:-3}"
  --allow-unauthenticated
  --quiet
)

# A new revision takes no traffic until it is checked below. The very first
# deployment has nothing to keep serving, and Cloud Run refuses --no-traffic then.
existing_ready_revision="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"
if [[ -n "$existing_ready_revision" ]]; then
  deploy_args+=(--no-traffic)
fi

gcloud "${deploy_args[@]}"

revision="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.latestCreatedRevisionName)')"
if [[ -z "$revision" ]]; then
  printf 'Cloud Run did not report a created revision for %s\n' "$SERVICE_NAME" >&2
  exit 1
fi

revision_image=""
revision_ready=""
for attempt in {1..60}; do
  revision_image="$(gcloud run revisions describe "$revision" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(spec.containers[0].image)' 2>/dev/null || true)"
  revision_ready="$(gcloud run revisions describe "$revision" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format=json | python3 "$(dirname "$0")/../cloud-run/revision-ready.py")"
  if [[ "$revision_image" == "$IMAGE" && "$revision_ready" == "True" ]]; then
    break
  fi
  sleep 5
done
if [[ "$revision_image" != "$IMAGE" || "$revision_ready" != "True" ]]; then
  printf 'Revision readiness failed: service=%s revision=%s expected_image=%s actual_image=%s ready=%s\n' \
    "$SERVICE_NAME" "$revision" "$IMAGE" "$revision_image" "$revision_ready" >&2
  gcloud run revisions describe "$revision" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='yaml(metadata.name,status.conditions,status.logUrl)' >&2 || true
  exit 1
fi
printf 'Revision ready: service=%s revision=%s image=%s\n' "$SERVICE_NAME" "$revision" "$IMAGE"

printf 'Promoting traffic: service=%s revision=%s image=%s percent=100\n' "$SERVICE_NAME" "$revision" "$IMAGE"
gcloud run services update-traffic "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "${revision}=100" \
  --quiet

traffic_revision=""
traffic_percent=""
traffic_image=""
for attempt in {1..60}; do
  traffic_revision="$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.traffic[0].revisionName)')"
  traffic_percent="$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.traffic[0].percent)')"
  if [[ "$traffic_revision" == "$revision" && "$traffic_percent" == "100" ]]; then
    traffic_image="$(gcloud run revisions describe "$traffic_revision" \
      --project "$PROJECT_ID" \
      --region "$REGION" \
      --format='value(spec.containers[0].image)')"
    if [[ "$traffic_image" == "$IMAGE" ]]; then
      break
    fi
  fi
  sleep 5
done
if [[ "$traffic_revision" != "$revision" || "$traffic_percent" != "100" || "$traffic_image" != "$IMAGE" ]]; then
  printf 'Traffic verification failed: service=%s revision=%s percent=%s image=%s expected_revision=%s expected_image=%s\n' \
    "$SERVICE_NAME" "$traffic_revision" "$traffic_percent" "$traffic_image" "$revision" "$IMAGE" >&2
  gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='yaml(status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)' >&2 || true
  exit 1
fi
printf 'Traffic verified: service=%s revision=%s percent=%s image=%s\n' \
  "$SERVICE_NAME" "$traffic_revision" "$traffic_percent" "$traffic_image"

service_url="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"
# The page itself, then the API through this container's /api proxy.
curl --fail --silent --show-error --retry 5 --retry-delay 2 \
  "$service_url/" >/dev/null
curl --fail --silent --show-error --retry 5 --retry-delay 2 \
  "$service_url/api/health/ready" >/dev/null
printf '%s=%s revision=%s image=%s\n' "$SERVICE_NAME" "$service_url" "$revision" "$IMAGE"
