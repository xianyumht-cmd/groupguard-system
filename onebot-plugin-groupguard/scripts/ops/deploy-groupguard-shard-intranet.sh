#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/mnt/sda1/groupguard/app}"
CONTAINER_NAME="${CONTAINER_NAME:-groupguard-snowluma}"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/sda1/groupguard/backups}"
LOL_API_BASE="${LOL_API_BASE:-http://127.0.0.1:5001}"
API_LIVE_URL="${API_LIVE_URL:-http://127.0.0.1:5001/livez}"
WEBUI_URL="${WEBUI_URL:-http://127.0.0.1:6108/?token=gg6108}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIST="$SCRIPT_DIR/dist"
RELEASE_MANIFEST="$SCRIPT_DIR/SHA256SUMS"
CONFIG_PATH="$APP_DIR/config/config.json"
TARGET_DIST="$APP_DIR/dist"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/${TIMESTAMP}-groupguard-shard-intranet"
DEPLOYMENT_STARTED=0

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\n[FAILED] %s\n' "$*" >&2
  exit 1
}

http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 8 "$url" >/dev/null
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -T 8 -O /dev/null "$url"
    return
  fi
  return 1
}

clear_directory_contents() {
  local directory="$1"
  mkdir -p "$directory"
  find "$directory" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

restore_previous_release() {
  set +e
  printf '\n============================================================\n'
  printf 'Deployment failed. Rolling back GroupGuard...\n'
  printf 'Backup: %s\n' "$BACKUP_DIR"
  printf '============================================================\n'

  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  clear_directory_contents "$TARGET_DIST"
  if [ -d "$BACKUP_DIR/dist" ]; then
    cp -a "$BACKUP_DIR/dist/." "$TARGET_DIST/"
  fi
  if [ -f "$BACKUP_DIR/config.json" ]; then
    cp -a "$BACKUP_DIR/config.json" "$CONFIG_PATH"
  fi
  docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
  sleep 8
  docker logs --tail 120 "$CONTAINER_NAME" >"$BACKUP_DIR/rollback-container.log" 2>&1 || true
  printf '[ROLLBACK] Previous dist and config restored.\n'
  printf '[ROLLBACK] Review: %s/rollback-container.log\n' "$BACKUP_DIR"
}

on_error() {
  local exit_code=$?
  local line_number="${BASH_LINENO[0]:-unknown}"
  if [ "$DEPLOYMENT_STARTED" -eq 1 ]; then
    restore_previous_release
  fi
  printf '\nDeployment stopped at line %s with exit code %s.\n' "$line_number" "$exit_code" >&2
  exit "$exit_code"
}
trap on_error ERR

printf '============================================================\n'
printf 'GroupGuard SnowLuma shard intranet deployment\n'
printf 'Container : %s\n' "$CONTAINER_NAME"
printf 'App dir   : %s\n' "$APP_DIR"
printf 'API       : %s\n' "$LOL_API_BASE"
printf '============================================================\n'

[ "$(id -u)" -eq 0 ] || fail 'Run this script as root.'
command -v docker >/dev/null 2>&1 || fail 'docker command was not found.'
command -v python3 >/dev/null 2>&1 || fail 'python3 command was not found.'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum command was not found.'
[ -d "$RELEASE_DIST" ] || fail "Release dist is missing: $RELEASE_DIST"
[ -f "$RELEASE_DIST/snowluma-service.mjs" ] || fail 'Release does not contain dist/snowluma-service.mjs.'
[ -f "$RELEASE_MANIFEST" ] || fail "SHA256 manifest is missing: $RELEASE_MANIFEST"
[ -d "$APP_DIR" ] || fail "Target app directory does not exist: $APP_DIR"
[ -f "$CONFIG_PATH" ] || fail "GroupGuard config does not exist: $CONFIG_PATH"
docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 || fail "Container does not exist: $CONTAINER_NAME"

log 'Verifying release SHA-256 manifest...'
(
  cd "$SCRIPT_DIR"
  sha256sum -c SHA256SUMS
)

log 'Checking LOLDataSystem port 5001 before touching GroupGuard...'
http_ok "$API_LIVE_URL" || fail "LOLDataSystem is not healthy: $API_LIVE_URL"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
log "Backing up current dist and config to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR/dist"
if [ -d "$TARGET_DIST" ]; then
  cp -a "$TARGET_DIST/." "$BACKUP_DIR/dist/"
fi
cp -a "$CONFIG_PATH" "$BACKUP_DIR/config.json"
docker inspect "$CONTAINER_NAME" >"$BACKUP_DIR/container-inspect-before.json"
docker logs --tail 200 "$CONTAINER_NAME" >"$BACKUP_DIR/container-before.log" 2>&1 || true

log 'Validating GroupGuard intranet API configuration...'
python3 - "$CONFIG_PATH" "$LOL_API_BASE" <<'PY'
import json
import pathlib
import sys
from urllib.parse import urlparse

path = pathlib.Path(sys.argv[1])
default_base = sys.argv[2].rstrip('/')
data = json.loads(path.read_text(encoding='utf-8'))
current = str(data.get('lolApiBaseUrl') or '').strip().rstrip('/')
if not current:
    data['lolApiBaseUrl'] = default_base
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'[CONFIG] lolApiBaseUrl was empty and is now {default_base}')
    current = default_base
parsed = urlparse(current)
host = (parsed.hostname or '').lower()
private = (
    host in {'localhost', '127.0.0.1', '::1'}
    or host.startswith('10.')
    or host.startswith('192.168.')
    or any(host.startswith(f'172.{n}.') for n in range(16, 32))
)
if parsed.scheme not in {'http', 'https'} or not private:
    raise SystemExit(f'lolApiBaseUrl must be an intranet HTTP address, got: {current}')
print(f'[CONFIG] lolApiBaseUrl={current}')
PY

DIST_UID="$(stat -c '%u' "$TARGET_DIST" 2>/dev/null || stat -c '%u' "$APP_DIR")"
DIST_GID="$(stat -c '%g' "$TARGET_DIST" 2>/dev/null || stat -c '%g' "$APP_DIR")"
DEPLOYMENT_STARTED=1

log "Stopping $CONTAINER_NAME..."
docker stop "$CONTAINER_NAME" >/dev/null

log 'Replacing dist contents while preserving the dist directory...'
clear_directory_contents "$TARGET_DIST"
cp -a "$RELEASE_DIST/." "$TARGET_DIST/"
chown -R "$DIST_UID:$DIST_GID" "$TARGET_DIST"

log "Starting $CONTAINER_NAME..."
docker start "$CONTAINER_NAME" >/dev/null

log 'Waiting for container and WebUI readiness...'
ready=0
for _ in $(seq 1 45); do
  running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$running" = 'true' ] && http_ok "$WEBUI_URL"; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  docker logs --tail 200 "$CONTAINER_NAME" >"$BACKUP_DIR/container-failed.log" 2>&1 || true
  fail "GroupGuard did not become ready. See $BACKUP_DIR/container-failed.log"
fi

sleep 3
docker logs --tail 200 "$CONTAINER_NAME" >"$BACKUP_DIR/container-after.log" 2>&1 || true
if grep -Eiq 'uncaught|fatal|syntaxerror|cannot find module' "$BACKUP_DIR/container-after.log"; then
  fail "Fatal startup text was found in $BACKUP_DIR/container-after.log"
fi

DEPLOYMENT_STARTED=0
cat >"$BACKUP_DIR/deployment-result.txt" <<EOF
status=completed
completed_at=$(date -Iseconds)
container=$CONTAINER_NAME
app_dir=$APP_DIR
api_live_url=$API_LIVE_URL
webui_url=$WEBUI_URL
release_commit=$(cat "$SCRIPT_DIR/RELEASE_COMMIT.txt" 2>/dev/null || printf unknown)
EOF

printf '\n============================================================\n'
printf 'GROUPGUARD DEPLOYMENT SUCCEEDED\n'
printf 'Backup : %s\n' "$BACKUP_DIR"
printf 'Result : %s/deployment-result.txt\n' "$BACKUP_DIR"
printf 'Next QQ test: 查合集 滑板鞋\n'
printf '============================================================\n'
