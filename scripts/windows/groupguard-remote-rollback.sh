#!/bin/sh
set -eu

APP_DIR=${1:?app_dir_required}
BACKUP_ROOT=${2:?backup_root_required}
CONTAINER=${3:?container_required}

fail_unsafe() {
  echo "UNSAFE_ROLLBACK_PARAMETER=$1" >&2
  exit 30
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

STATE_DIR="$APP_DIR/deployment-state"
LATEST_ENV="$STATE_DIR/latest-code-deploy.env"

[ -d "$APP_DIR" ] || { echo "ROLLBACK_APP_DIR_MISSING=$APP_DIR" >&2; exit 31; }
command -v docker >/dev/null 2>&1 || { echo "ROLLBACK_DOCKER_MISSING=true" >&2; exit 31; }
docker inspect --type container "$CONTAINER" >/dev/null 2>&1 || { echo "ROLLBACK_CONTAINER_MISSING=$CONTAINER" >&2; exit 31; }

if [ ! -f "$LATEST_ENV" ]; then
  echo "ROLLBACK_STATE_MISSING=$LATEST_ENV" >&2
  exit 32
fi

# shellcheck disable=SC1090
. "$LATEST_ENV"
backup_path=${BACKUP_PATH:-}
target_commit=${TARGET_COMMIT:-unknown}
previous_commit=${PREVIOUS_COMMIT:-unknown}
release_id=${RELEASE_ID:-unknown}

case "$backup_path" in
  "$BACKUP_ROOT"/*) ;;
  *) echo "ROLLBACK_BACKUP_OUTSIDE_ROOT=$backup_path" >&2; exit 33 ;;
esac
case "$backup_path" in
  *..*) echo "ROLLBACK_BACKUP_UNSAFE=$backup_path" >&2; exit 33 ;;
esac
case "$release_id" in
  ''|*[!A-Za-z0-9_.-]*) echo "ROLLBACK_RELEASE_ID_UNSAFE=$release_id" >&2; exit 33 ;;
esac

if [ -z "$backup_path" ] || [ ! -d "$backup_path/dist" ]; then
  echo "ROLLBACK_BACKUP_MISSING=$backup_path" >&2
  exit 34
fi
if [ ! -f "$backup_path/dist/snowluma-service.mjs" ]; then
  echo "ROLLBACK_BACKUP_ENTRY_MISSING=$backup_path" >&2
  exit 34
fi

json_commit() {
  file=$1
  [ -f "$file" ] || return 0
  sed -n 's/.*"commit_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n 1
}

health_check() {
  attempts=${1:-45}
  i=1
  while [ "$i" -le "$attempts" ]; do
    if docker inspect "$CONTAINER" >/dev/null 2>&1 && \
       docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q '^true$'; then
      if docker exec "$CONTAINER" node -e "const h=require('http');const r=h.get('http://127.0.0.1:6108/api/readyz',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>{let o={};try{o=JSON.parse(b)}catch{};process.exit(x.statusCode===200&&o&&o.ready===true?0:2)})});r.on('error',()=>process.exit(3));r.setTimeout(2500,()=>{r.destroy();process.exit(4)})" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

current_commit=$(json_commit "$APP_DIR/dist/build-info.json")
backup_commit=$(json_commit "$backup_path/dist/build-info.json")
current_commit=${current_commit:-unknown}
backup_commit=${backup_commit:-$previous_commit}

echo "CURRENT_COMMIT=$current_commit"
echo "ROLLBACK_FROM_TARGET=$target_commit"
echo "ROLLBACK_TO_COMMIT=$backup_commit"
echo "BACKUP_PATH=$backup_path"

if [ "$current_commit" = "$backup_commit" ]; then
  if health_check 30; then
    echo "ROLLBACK_ALREADY_APPLIED=true"
    echo "HEALTH_OK=true"
    exit 0
  fi
  echo "ROLLBACK_TARGET_ALREADY_PRESENT_BUT_UNHEALTHY=true" >&2
  exit 35
fi

ts=$(date -u '+%Y%m%d-%H%M%S')
preimage="$BACKUP_ROOT/manual-rollback-preimage-$ts-$(printf '%s' "$current_commit" | cut -c1-12)"
if [ -e "$preimage" ]; then
  echo "ROLLBACK_PREIMAGE_EXISTS=$preimage" >&2
  exit 36
fi
mkdir -p "$preimage"
if [ -d "$APP_DIR/dist" ]; then cp -a "$APP_DIR/dist" "$preimage/dist"; fi
cat > "$preimage/rollback-preimage-meta.txt" <<EOF
source_release_id=$release_id
source_commit=$current_commit
rollback_to=$backup_commit
created_at_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF

restore_stage="$APP_DIR/.dist-rollback-$ts"
failed_stage="$APP_DIR/.dist-before-rollback-$ts"
rm -rf "$restore_stage" "$failed_stage"
cp -a "$backup_path/dist" "$restore_stage"
if [ -d "$APP_DIR/dist" ]; then mv "$APP_DIR/dist" "$failed_stage"; fi
if ! mv "$restore_stage" "$APP_DIR/dist"; then
  [ -d "$failed_stage" ] && mv "$failed_stage" "$APP_DIR/dist"
  echo "ROLLBACK_SWITCH_FAILED=true" >&2
  exit 37
fi

docker restart "$CONTAINER" >/dev/null 2>&1 || true
if health_check 45; then
  rm -rf "$failed_stage"
  cat > "$STATE_DIR/last-code-rollback.json.tmp" <<EOF
{
  "schema_version": 1,
  "rolled_back_release_id": "$release_id",
  "from_commit": "$current_commit",
  "to_commit": "$backup_commit",
  "backup_path": "$backup_path",
  "preimage_path": "$preimage",
  "rolled_back_at_utc": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "health": "passed"
}
EOF
  mv "$STATE_DIR/last-code-rollback.json.tmp" "$STATE_DIR/last-code-rollback.json"
  echo "ROLLBACK_OK=true"
  echo "ROLLBACK_PREIMAGE=$preimage"
  echo "HEALTH_OK=true"
  exit 0
fi

echo "ROLLBACK_HEALTH_FAILED_RESTORING_PREIMAGE=true" >&2
bad_restore="$APP_DIR/.dist-bad-rollback-$ts"
if [ -d "$APP_DIR/dist" ]; then mv "$APP_DIR/dist" "$bad_restore"; fi
if [ -d "$failed_stage" ]; then
  mv "$failed_stage" "$APP_DIR/dist"
elif [ -d "$preimage/dist" ]; then
  cp -a "$preimage/dist" "$APP_DIR/dist"
else
  echo "ROLLBACK_PREIMAGE_SOURCE_MISSING=true" >&2
  exit 38
fi

docker restart "$CONTAINER" >/dev/null 2>&1 || true
if health_check 45; then
  rm -rf "$bad_restore"
  echo "ROLLBACK_REVERTED_TO_PREIMAGE=true" >&2
  exit 39
fi

echo "ROLLBACK_AND_PREIMAGE_HEALTH_FAILED=true" >&2
exit 40
