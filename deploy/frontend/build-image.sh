#!/usr/bin/env bash
set -euo pipefail

app=${1:?App is required: web or admin}
source_dir=${2:?Static build directory is required}
image=${3:?Image reference is required}

if [[ "$app" != "web" && "$app" != "admin" ]]; then
  printf 'Unknown app: %s (expected web or admin)\n' "$app" >&2
  exit 2
fi

if [[ ! -f "$source_dir/index.html" ]]; then
  printf 'Static build is missing index.html: %s\n' "$source_dir" >&2
  exit 2
fi

docker buildx build \
  --platform linux/amd64 \
  --build-context "static=$source_dir" \
  --build-arg "APP=$app" \
  --file deploy/frontend/Dockerfile \
  --tag "$image" \
  ${PUSH_IMAGE:---push} \
  --provenance=false \
  .
