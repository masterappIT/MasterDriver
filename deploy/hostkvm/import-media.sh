#!/usr/bin/env bash
# Copies 客服 and 名片頁 files into the server's file directory (installed as /usr/local/sbin/masterdriver-import-media):
# a copy of the Cloud Storage bucket (support/ and profile/), during the move. Files already there are kept,
# so it can run again to bring over only what is new.
#   masterdriver-import-media <directory with support/ and profile/>
set -euo pipefail
source "${MASTERDRIVER_LIB:-/usr/local/lib/masterdriver}/lib.sh"
require_root
src="${1:?directory required}"
[[ -d "$src" ]] || die "not a directory: $src"
for entry in "$src"/*; do
  case "$(basename "$entry")" in
    support | profile) ;;
    *) die "unexpected entry in $src: $(basename "$entry") (expected support/ and profile/)" ;;
  esac
done
rsync -a "$src"/ "$APP/media/"
chown -R 1000:1000 "$APP/media"
log "Files copied from $src: $(find "$APP/media" -type f | wc -l) files, $(du -sh "$APP/media" | cut -f1) in $APP/media"
