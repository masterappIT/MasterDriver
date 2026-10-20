#!/usr/bin/env bash
# Daily backup of MasterDriver (installed as /usr/local/sbin/masterdriver-backup; run by cron):
# the database and the 客服 and 名片頁 files together, uploaded to the backup bucket in Cloud Storage.
# The bucket deletes backups by age; its service account can add and read, not overwrite or delete.
# The files go up as one dated archive, not file by file: deleting by age counts from the upload,
# so a file uploaded long ago and still in use would otherwise be deleted.
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
KEY="$APP/secrets/backup-sa.json"
BUCKET="$(env_value "$APP/backup.env" BACKUP_BUCKET)"
LOCAL_DAYS=7
[[ -n "$BUCKET" ]] || die 'BACKUP_BUCKET missing in backup.env'
[[ -s "$KEY" ]] || die "backup service account key missing: $KEY"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
day="$(date -u +%Y/%m/%d)"
out="$APP/backups/$stamp"
install -d -m 700 "$APP/backups" "$out"

dump_database "$out/master_driver.dump" || die 'database dump failed'
tar -C "$APP" -czf "$out/media.tar.gz" media || die 'file archive failed'
(cd "$out" && sha256sum ./* > SHA256SUMS)
chmod 600 "$out"/*

docker run --rm -v "$out:/backup:ro" -v "$KEY:/key.json:ro" "$RCLONE_IMAGE" \
  copy /backup ":gcs:$BUCKET/masterdriver/$day/$stamp" \
  --gcs-service-account-file /key.json --gcs-bucket-policy-only --gcs-no-check-bucket \
  || die 'upload to Cloud Storage failed'

find "$APP/backups" -mindepth 1 -maxdepth 1 -type d -mtime +"$LOCAL_DAYS" -exec rm -rf {} +
log "Backup uploaded: gs://$BUCKET/masterdriver/$day/$stamp ($(du -sh "$out" | cut -f1))"
