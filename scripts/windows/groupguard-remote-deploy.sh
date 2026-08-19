#!/bin/sh
set -eu

APP_DIR=${1:?app_dir_required}
BACKUP_ROOT=${2:?backup_root_required}
CONTAINER=${3:?container_required}
TARGET_COMMIT=${4:?target_commit_required}
ARCHIVE=${5:?candidate_archive_required}
RELEASE_ID=${6:?release_id_required}
EXPECTED_SHA256=${7:?archive_sha256_required}

fail_unsafe() {
  echo "UNSAFE_DEPLOY_PARAMETER=$1" >&2
  exit 10
}

case "$APP_DIR" in
  /mnt/sda1/groupguard/*) ;;
  *) fail_unsafe app_dir ;;
esac
case "$BACKUP_ROOT" in
  /mnt/sda1/groupguard/*) ;;
  *) fail_unsafe backup_root ;;
esac
case "$APP_DIR:$BACKUP_ROOT" in
  *..*) fail_unsafe parent_path ;;
esac
[ "$APP_DIR" != "$BACKUP_ROOT" ] || fail_unsafe overlapping_roots
case "$CONTAINER" in
  ''|*[!A-Za-z0-9_.-]*) fail_unsafe container ;;
esac
case "$TARGET_COMMIT" in
  ''|*[!0-9a-fA-F]*) fail_unsafe target_commit ;;
esac
[ "${#TARGET_COMMIT}" -eq 40 ] || fail_unsafe target_commit_length
case "$RELEASE_ID" in
  ''|*[!A-Za-z0-9_.-]*) fail_unsafe release_id ;;
esac
case "$EXPECTED_SHA256" in
  ''|*[!0-9a-fA-F]*) fail_unsafe archive_sha256 ;;
esac
[ "${#EXPECTED_SHA256}" -eq 64 ] || fail_unsafe archive_sha256_length
case "$ARCHIVE" in
  /tmp/*) ;;
  *) fail_unsafe candidate_archive ;;
esac

[ -d "$APP_DIR" ] || { echo "APP_DIR_MISSING=$APP_DIR" >&2; exit 11; }
[ -d "$APP_DIR/config" ] || { echo "APP_CONFIG_DIR_MISSING=true" >&2; exit 11; }
[ -d "$APP_DIR/data" ] || { echo "APP_DATA_DIR_MISSING=true" >&2; exit 11; }
[ -d "$APP_DIR/dist" ] || { echo "APP_DIST_DIR_MISSING=true" >&2; exit 11; }
command -v docker >/dev/null 2>&1 || { echo "DOCKER_MISSING=true" >&2; exit 11; }
command -v tar >/dev/null 2>&1 || { echo "TAR_MISSING=true" >&2; exit 11; }
docker inspect --type container "$CONTAINER" >/dev/null 2>&1 || { echo "CONTAINER_MISSING=$CONTAINER" >&2; exit 11; }

BASE_DIR=$(dirname "$APP_DIR")
STATE_DIR="$APP_DIR/deployment-state"
RELEASE_ROOT="$BASE_DIR/releases"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
PENDING_FILE="$STATE_DIR/pending-code-deploy.env"
LATEST_ENV="$STATE_DIR/latest-code-deploy.env"
LATEST_JSON="$STATE_DIR/latest-code-deploy.json"
MANIFEST_JSON="$STATE_DIR/deployment-$RELEASE_ID.json"

mkdir -p "$STATE_DIR" "$BACKUP_ROOT" "$RELEASE_ROOT"

json_commit() {
  file=$1
  [ -f "$file" ] || return 0
  sed -n 's/.*"commit_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n 1
}

# Deployment state is untrusted data. Never source/eval it: doing so could both
# execute shell and overwrite the CLI-validated APP_DIR/CONTAINER/TARGET_COMMIT.
state_value() {
  file=$1
  key=$2
  [ -f "$file" ] || return 0
  case "$key" in
    ''|*[!A-Z0-9_]*) return 1 ;;
  esac
  sed -n "s/^${key}='\([^']*\)'$/\1/p" "$file" | head -n 1
}

valid_commit_or_unknown() {
  value=$1
  [ "$value" = "unknown" ] && return 0
  case "$value" in
    ''|*[!0-9a-fA-F]*) return 1 ;;
  esac
  [ "${#value}" -eq 40 ]
}

validate_backup_state_path() {
  value=$1
  [ -z "$value" ] && return 0
  case "$value" in
    "$BACKUP_ROOT"/*) ;;
    *) return 1 ;;
  esac
  case "$value" in
    *..*) return 1 ;;
  esac
  return 0
}

sha256_file() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v busybox >/dev/null 2>&1; then
    busybox sha256sum "$file" | awk '{print $1}'
  else
    echo "sha256_tool_missing" >&2
    return 1
  fi
}

# All WebUI API routes, including /api/readyz, are behind GroupGuard auth.
# Verify the exact running build instead of treating a merely-running container
# as a successful deployment. The service may use either an explicit token env
# or its generated token file under GROUPGUARD_DATA_DIR.
health_check() {
  expected_commit=${1:-unknown}
  attempts=${2:-45}
  valid_commit_or_unknown "$expected_commit" || return 1
  i=1
  while [ "$i" -le "$attempts" ]; do
    if docker inspect "$CONTAINER" >/dev/null 2>&1 && \
       docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q '^true$'; then
      if docker exec -i "$CONTAINER" node - "$expected_commit" >/dev/null 2>&1 <<'NODE'
const http = require('http');
const fs = require('fs');
const path = require('path');
const expectedCommit = String(process.argv[2] || 'unknown').toLowerCase();
const port = Number(process.env.GROUPGUARD_WEBUI_PORT || 6108);
const dataDir = path.resolve(process.env.GROUPGUARD_DATA_DIR || path.join(process.cwd(), 'data'));
let token = String(process.env.GROUPGUARD_WEBUI_TOKEN || '').trim();
if (!token) {
  try { token = fs.readFileSync(path.join(dataDir, '.groupguard-webui-token'), 'utf8').trim(); } catch { /* fail below */ }
}
if (!token) process.exit(10);
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers: { 'x-groupguard-token': token, accept: 'application/json' },
      timeout: 3000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${pathname} HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`${pathname} invalid JSON`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${pathname} timeout`)));
    req.on('error', reject);
    req.end();
  });
}
(async () => {
  const [build, health] = await Promise.all([getJson('/api/build-info'), getJson('/api/health')]);
  const buildCommit = String(build && build.commit_sha || '').toLowerCase();
  const healthCommit = String(health && health.build && health.build.commit_sha || '').toLowerCase();
  if (health && health.ready !== true) throw new Error('service not ready');
  if (expectedCommit !== 'unknown' && (buildCommit !== expectedCommit || healthCommit !== expectedCommit)) {
    throw new Error('running build commit mismatch');
  }
  if (build && build.dirty === true) throw new Error('running build is dirty');
})().then(() => process.exit(0)).catch(() => process.exit(11));
NODE
      then
        return 0
      fi
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

write_manifest() {
  previous_commit=$1
  backup_path=$2
  reconciled=$3
  deployed_at=$4
  cat > "$MANIFEST_JSON.tmp" <<EOF
{
  "schema_version": 1,
  "release_id": "$RELEASE_ID",
  "target_commit": "$TARGET_COMMIT",
  "previous_commit": "$previous_commit",
  "backup_path": "$backup_path",
  "container": "$CONTAINER",
  "app_dir": "$APP_DIR",
  "archive_sha256": "$EXPECTED_SHA256",
  "reconciled_existing_target": $reconciled,
  "deployed_at_utc": "$deployed_at",
  "health": "passed"
}
EOF
  mv "$MANIFEST_JSON.tmp" "$MANIFEST_JSON"
  cp "$MANIFEST_JSON" "$LATEST_JSON.tmp"
  mv "$LATEST_JSON.tmp" "$LATEST_JSON"
  cat > "$LATEST_ENV.tmp" <<EOF
RELEASE_ID='$RELEASE_ID'
TARGET_COMMIT='$TARGET_COMMIT'
PREVIOUS_COMMIT='$previous_commit'
BACKUP_PATH='$backup_path'
CONTAINER='$CONTAINER'
APP_DIR='$APP_DIR'
ARCHIVE_SHA256='$EXPECTED_SHA256'
DEPLOYED_AT_UTC='$deployed_at'
EOF
  mv "$LATEST_ENV.tmp" "$LATEST_ENV"
  chmod 600 "$LATEST_ENV" "$LATEST_JSON" "$MANIFEST_JSON" 2>/dev/null || true
  rm -f "$PENDING_FILE"
}

actual_sha=$(sha256_file "$ARCHIVE")
if [ "$actual_sha" != "$EXPECTED_SHA256" ]; then
  echo "CANDIDATE_HASH_MISMATCH expected=$EXPECTED_SHA256 actual=$actual_sha" >&2
  exit 12
fi

echo "CANDIDATE_ARCHIVE_OK=$actual_sha"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"

if [ ! -f "$RELEASE_DIR/dist/snowluma-service.mjs" ] || [ ! -f "$RELEASE_DIR/dist/build-info.json" ]; then
  echo "CANDIDATE_LAYOUT_INVALID" >&2
  exit 13
fi

candidate_commit=$(json_commit "$RELEASE_DIR/dist/build-info.json")
if [ "$candidate_commit" != "$TARGET_COMMIT" ]; then
  echo "CANDIDATE_COMMIT_MISMATCH expected=$TARGET_COMMIT actual=$candidate_commit" >&2
  exit 14
fi

echo "CANDIDATE_VALIDATION_OK=true"

current_commit=$(json_commit "$APP_DIR/dist/build-info.json")
current_commit=${current_commit:-unknown}
# The live build metadata is data too. Validate it before using even a short
# prefix inside backup/staging paths; malformed metadata must never influence
# filesystem destinations.
if ! valid_commit_or_unknown "$current_commit"; then
  echo "CURRENT_BUILD_COMMIT_INVALID=true" >&2
  exit 14
fi
echo "CURRENT_COMMIT=$current_commit"
echo "TARGET_COMMIT=$TARGET_COMMIT"

# Resume-safe reconciliation: if the target is already live, do not overwrite it.
if [ "$current_commit" = "$TARGET_COMMIT" ]; then
  backup_path=""
  previous_commit="unknown"
  if [ -f "$PENDING_FILE" ]; then
    pending_target=$(state_value "$PENDING_FILE" PENDING_TARGET_COMMIT)
    if [ "$pending_target" = "$TARGET_COMMIT" ]; then
      backup_path=$(state_value "$PENDING_FILE" PENDING_BACKUP_PATH)
      previous_commit=$(state_value "$PENDING_FILE" PENDING_PREVIOUS_COMMIT)
      previous_commit=${previous_commit:-unknown}
    fi
  fi
  if [ -z "$backup_path" ] && [ -f "$LATEST_ENV" ]; then
    latest_target=$(state_value "$LATEST_ENV" TARGET_COMMIT)
    latest_app=$(state_value "$LATEST_ENV" APP_DIR)
    latest_container=$(state_value "$LATEST_ENV" CONTAINER)
    if [ "$latest_target" = "$current_commit" ] && \
       { [ -z "$latest_app" ] || [ "$latest_app" = "$APP_DIR" ]; } && \
       { [ -z "$latest_container" ] || [ "$latest_container" = "$CONTAINER" ]; }; then
      backup_path=$(state_value "$LATEST_ENV" BACKUP_PATH)
      previous_commit=$(state_value "$LATEST_ENV" PREVIOUS_COMMIT)
      previous_commit=${previous_commit:-unknown}
    fi
  fi
  if ! validate_backup_state_path "$backup_path" || ! valid_commit_or_unknown "$previous_commit"; then
    echo "RECONCILE_STATE_INVALID=true" >&2
    exit 15
  fi
  if ! health_check "$TARGET_COMMIT" 45; then
    echo "RECONCILED_TARGET_HEALTH_FAILED=true" >&2
    exit 15
  fi
  deployed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  write_manifest "$previous_commit" "$backup_path" true "$deployed_at"
  echo "RECONCILED_EXISTING_TARGET=true"
  echo "HEALTH_OK=true"
  echo "DEPLOYMENT_OK=true"
  exit 0
fi

short_current=$(printf '%s' "$current_commit" | cut -c1-12)
backup_path="$BACKUP_ROOT/$RELEASE_ID-from-$short_current"
if [ -e "$backup_path" ]; then
  echo "BACKUP_ALREADY_EXISTS=$backup_path" >&2
  exit 16
fi
mkdir -p "$backup_path"
cp -a "$APP_DIR/dist" "$backup_path/dist"
if [ -f "$APP_DIR/package.json" ]; then
  cp -a "$APP_DIR/package.json" "$backup_path/package.json"
fi
cat > "$backup_path/backup-meta.txt" <<EOF
release_id=$RELEASE_ID
previous_commit=$current_commit
target_commit=$TARGET_COMMIT
created_at_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF

[ -d "$backup_path/dist" ] || { echo "BACKUP_CAPTURE_FAILED=$backup_path" >&2; exit 17; }
[ -f "$backup_path/dist/snowluma-service.mjs" ] || { echo "BACKUP_ENTRY_MISSING=$backup_path" >&2; exit 17; }

echo "BACKUP_CAPTURE_OK=true"
echo "BACKUP_PATH=$backup_path"

cat > "$PENDING_FILE.tmp" <<EOF
PENDING_RELEASE_ID='$RELEASE_ID'
PENDING_TARGET_COMMIT='$TARGET_COMMIT'
PENDING_PREVIOUS_COMMIT='$current_commit'
PENDING_BACKUP_PATH='$backup_path'
PENDING_ARCHIVE_SHA256='$EXPECTED_SHA256'
EOF
mv "$PENDING_FILE.tmp" "$PENDING_FILE"
chmod 600 "$PENDING_FILE" 2>/dev/null || true

old_dist="$APP_DIR/.dist-pre-$RELEASE_ID"
rm -rf "$old_dist"
mv "$APP_DIR/dist" "$old_dist"
if ! mv "$RELEASE_DIR/dist" "$APP_DIR/dist"; then
  mv "$old_dist" "$APP_DIR/dist"
  echo "SWITCH_FAILED=true" >&2
  exit 18
fi

echo "SWITCH_OK=true"

if ! docker restart "$CONTAINER" >/dev/null; then
  echo "CONTAINER_RESTART_FAILED=true" >&2
else
  echo "CONTAINER_RESTARTED=true"
fi

if health_check "$TARGET_COMMIT" 45; then
  rm -rf "$old_dist" "$RELEASE_DIR"
  deployed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  write_manifest "$current_commit" "$backup_path" false "$deployed_at"
  echo "HEALTH_OK=true"
  echo "DEPLOYMENT_OK=true"
  exit 0
fi

echo "HEALTH_FAILED_AUTO_ROLLBACK=true" >&2
bad_dist="$APP_DIR/.dist-failed-$RELEASE_ID"
rm -rf "$bad_dist"
if [ -d "$APP_DIR/dist" ]; then mv "$APP_DIR/dist" "$bad_dist"; fi
if [ -d "$old_dist" ]; then
  mv "$old_dist" "$APP_DIR/dist"
elif [ -d "$backup_path/dist" ]; then
  cp -a "$backup_path/dist" "$APP_DIR/dist"
else
  echo "AUTO_ROLLBACK_SOURCE_MISSING=true" >&2
  exit 19
fi

docker restart "$CONTAINER" >/dev/null 2>&1 || true
if health_check "$current_commit" 45; then
  rm -rf "$bad_dist" "$RELEASE_DIR"
  rm -f "$PENDING_FILE"
  echo "AUTO_ROLLBACK_OK=true" >&2
  exit 20
fi

echo "AUTO_ROLLBACK_HEALTH_FAILED=true" >&2
exit 21