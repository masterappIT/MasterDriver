#!/usr/bin/env bash
# First installation of MasterDriver on the HostKVM server, run as root from a copy of this directory.
# Safe to run again: it updates the scripts and the compose file, and keeps what already exists
# (app.env, the database password, backup.env, the keys). See docs/HOSTKVM-MIGRATION.md, step 1.
#
#   setup.sh [--secrets <file>] [--deploy-key <file>] [--backup-key <file>] [--backup-bucket <name>]
#
#   --secrets        KEY=VALUE lines OTP_PEPPER and DATA_ENCRYPTION_KEY, copied unchanged from Secret
#                    Manager (a new DATA_ENCRYPTION_KEY could not read the payment and SMS keys already saved).
#                    Needed the first time; deleted after use.
#   --deploy-key     The public key (ed25519) whose private half is in GitHub's production environment.
#   --backup-key     The JSON key of the backup service account; moved into place.
#   --backup-bucket  The backup bucket's name.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
source "$SRC/lib.sh"
require_root

secrets="" deploy_key="" backup_key="" backup_bucket=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --secrets) secrets="$2"; shift 2 ;;
    --deploy-key) deploy_key="$2"; shift 2 ;;
    --backup-key) backup_key="$2"; shift 2 ;;
    --backup-bucket) backup_bucket="$2"; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 64 ;;
  esac
done
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://masterdriverapp.masterappinc.com}"
DEPLOY_USER=deploy-masterdriver

postgres="$(shared_container postgres)"
[[ -n "$postgres" ]] || { printf 'The shared Postgres container is not running.\n' >&2; exit 2; }
docker network inspect data >/dev/null 2>&1 || { printf 'The shared "data" network is missing.\n' >&2; exit 2; }
docker network inspect edge >/dev/null 2>&1 || { printf 'The shared "edge" network is missing.\n' >&2; exit 2; }

# Directories. The files belong to the API container's user (node, uid 1000).
install -d -m 755 /srv/apps "$APP" "$APP/logs"
install -d -m 700 "$APP/secrets" "$APP/backups" "$APP/predeploy"
install -d -m 750 -o 1000 -g 1000 "$APP/media"

# Files and scripts.
install -m 644 "$SRC/compose.yaml" "$APP/compose.yaml"
install -m 644 "$SRC/api-upstream.conf" "$APP/api-upstream.conf"
install -d -m 755 /usr/local/lib/masterdriver
install -m 644 "$SRC/lib.sh" /usr/local/lib/masterdriver/lib.sh
install -m 644 "$SRC/masterdriver.caddy" /usr/local/lib/masterdriver/masterdriver.caddy
for name in deploy backup restore-test purge import-database import-media caddy-site; do
  install -m 755 -o root -g root "$SRC/$name.sh" "/usr/local/sbin/masterdriver-$name"
done
install -m 755 -o root -g root "$SRC/forced-command.sh" /usr/local/bin/masterdriver-forced-command
install -m 644 -o root -g root "$SRC/cron" /etc/cron.d/masterdriver

docker network inspect masterdriver >/dev/null 2>&1 || docker network create masterdriver >/dev/null

# Database account and database, with a new password, and the API's settings.
if [[ ! -f "$APP/app.env" ]]; then
  [[ -n "$secrets" && -s "$secrets" ]] || { printf 'First installation: --secrets is required.\n' >&2; exit 3; }
  otp_pepper="$(env_value "$secrets" OTP_PEPPER)"
  data_key="$(env_value "$secrets" DATA_ENCRYPTION_KEY)"
  [[ ${#otp_pepper} -ge 32 ]] || { printf 'OTP_PEPPER missing or shorter than 32 characters in %s.\n' "$secrets" >&2; exit 3; }
  [[ "$(printf '%s' "$data_key" | base64 -d 2>/dev/null | wc -c)" -eq 32 ]] \
    || { printf 'DATA_ENCRYPTION_KEY in %s is not a base64-encoded 32-byte key.\n' "$secrets" >&2; exit 3; }
  umask 077
  db_password="$(openssl rand -hex 24)"
  # The password goes in on standard input, not on a command line.
  if [[ "$(docker exec "$postgres" psql -U postgres -Atc "select 1 from pg_roles where rolname = 'master_driver'")" == 1 ]]; then
    printf "alter role master_driver with login password '%s';\n" "$db_password" | docker exec -i "$postgres" psql -U postgres -v ON_ERROR_STOP=1 -q
  else
    printf "create role master_driver with login password '%s';\n" "$db_password" | docker exec -i "$postgres" psql -U postgres -v ON_ERROR_STOP=1 -q
  fi
  if [[ "$(docker exec "$postgres" psql -U postgres -Atc "select 1 from pg_database where datname = 'master_driver'")" != 1 ]]; then
    docker exec "$postgres" psql -U postgres -v ON_ERROR_STOP=1 -qc 'create database master_driver owner master_driver'
  fi
  cat > "$APP/app.env" <<EOF
NODE_ENV=production
PORT=8080
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
SESSION_COOKIE_SECURE=true
SUPPORT_MEDIA_DIR=/data/media
DATABASE_URL=postgresql://master_driver:$db_password@postgres:5432/master_driver?schema=public
OTP_PEPPER=$otp_pepper
DATA_ENCRYPTION_KEY=$data_key
EOF
  chmod 600 "$APP/app.env"
  umask 022
  printf 'Wrote %s/app.env (new database password; OTP_PEPPER and DATA_ENCRYPTION_KEY copied)\n' "$APP"
fi
if [[ -n "$secrets" && -f "$secrets" ]]; then shred -u "$secrets"; fi

# Daily backup: bucket name and key.
if [[ -n "$backup_bucket" ]]; then
  [[ "$backup_bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || { printf 'Invalid bucket name.\n' >&2; exit 3; }
  printf 'BACKUP_BUCKET=%s\n' "$backup_bucket" > "$APP/backup.env"
  chmod 644 "$APP/backup.env"
fi
if [[ -n "$backup_key" ]]; then
  [[ -s "$backup_key" ]] || { printf 'Backup key not found: %s\n' "$backup_key" >&2; exit 3; }
  install -m 600 -o root -g root "$backup_key" "$APP/secrets/backup-sa.json"
  shred -u "$backup_key"
fi
docker pull --quiet "$POSTGRES_IMAGE" >/dev/null
docker pull --quiet "$RCLONE_IMAGE" >/dev/null

# The deploy account: key only, no shell, no forwarding, not in the docker group; sudo for masterdriver-deploy only.
if [[ -n "$deploy_key" ]]; then
  grep -qE '^ssh-ed25519 [A-Za-z0-9+/=]+( |$)' "$deploy_key" || { printf '%s: expected one ed25519 public key.\n' "$deploy_key" >&2; exit 3; }
  id "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/sh "$DEPLOY_USER"
  passwd -l "$DEPLOY_USER" >/dev/null
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  # .ssh belongs to root, so the account cannot change its own authorized_keys.
  install -d -m 755 -o root -g root "$home/.ssh"
  printf 'restrict,command="/usr/local/bin/masterdriver-forced-command" %s\n' "$(head -1 "$deploy_key")" > "$home/.ssh/authorized_keys"
  chown root:root "$home/.ssh/authorized_keys"
  chmod 644 "$home/.ssh/authorized_keys"
  sudoers="$(mktemp)"
  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/masterdriver-deploy\n' "$DEPLOY_USER" > "$sudoers"
  visudo -cqf "$sudoers"
  install -m 440 -o root -g root "$sudoers" "/etc/sudoers.d/$DEPLOY_USER"
  rm -f "$sudoers"
  # The server's SSH accepts listed accounts only (AllowUsers); add this one where that list is.
  for conf in /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf; do
    [[ -f "$conf" ]] && grep -qE '^AllowUsers ' "$conf" || continue
    if ! grep -qE "^AllowUsers .*\b$DEPLOY_USER\b" "$conf"; then
      sed -i -E "s/^AllowUsers (.*)$/AllowUsers \1 $DEPLOY_USER/" "$conf"
      sshd -t
      systemctl reload ssh
    fi
  done
  printf '%s ready\n' "$DEPLOY_USER"
fi

printf 'MasterDriver is set up in %s. Next: release with masterdriver-deploy (api, then frontends).\n' "$APP"
[[ -s "$APP/secrets/backup-sa.json" && -f "$APP/backup.env" ]] || printf 'Note: the daily backup has no bucket or key yet.\n'
