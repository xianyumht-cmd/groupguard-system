#!/bin/sh
set -eu

REQUESTED_APP_DIR=${1:?app_dir_required}
REQUESTED_BACKUP_ROOT=${2:?backup_root_required}
REQUESTED_CONTAINER=${3:?container_required}
SEARCH_ROOT=/mnt/sda1/groupguard

safe_path() {
  value=$1
  case "$value" in
    /mnt/sda1/groupguard/*) ;;
    *) return 1 ;;
  esac
  case "$value" in
    *..*|*" "*|*"'"*) return 1 ;;
  esac
  printf '%s' "$value" | grep -Eq '^/mnt/sda1/groupguard/[A-Za-z0-9._/-]+$'
}

valid_app_dir() {
  candidate=$1
  safe_path "$candidate" || return 1
  [ -d "$candidate/config" ] || return 1
  [ -d "$candidate/data" ] || return 1
  [ -d "$candidate/dist" ] || return 1
  [ -f "$candidate/dist/snowluma-service.mjs" ] || return 1
  return 0
}

mounts_for_container() {
  docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$1" 2>/dev/null || true
}

path_related_to_mounts() {
  candidate=$1
  mounts=$2
  while IFS= read -r source; do
    [ -n "$source" ] || continue
    case "$source" in
      "$candidate"|"$candidate"/*) return 0 ;;
    esac
    case "$candidate" in
      "$source"/*) return 0 ;;
    esac
  done <<EOF
$mounts
EOF
  return 1
}

container=$REQUESTED_CONTAINER
container_source=configured

command -v docker >/dev/null 2>&1 || {
  echo 'TOPOLOGY_DOCKER_MISSING=true' >&2
  exit 21
}

if ! docker inspect --type container "$container" >/dev/null 2>&1; then
  candidates=''
  for name in $(docker ps -a --format '{{.Names}}' 2>/dev/null || true); do
    [ -n "$name" ] || continue
    env_text=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null || true)
    mount_text=$(mounts_for_container "$name")
    if printf '%s\n' "$env_text" | grep -q '^GROUPGUARD_' || \
       printf '%s\n' "$name" | grep -qi 'groupguard' || \
       printf '%s\n' "$mount_text" | grep -q '^/mnt/sda1/groupguard/'; then
      candidates="${candidates}${name}\n"
    fi
  done
  candidates=$(printf '%b' "$candidates" | sed '/^$/d' | sort -u)
  count=$(printf '%s\n' "$candidates" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$count" = '1' ]; then
    container=$(printf '%s\n' "$candidates" | head -n 1)
    container_source=discovered
  else
    echo "TOPOLOGY_CONTAINER_MISSING=$REQUESTED_CONTAINER" >&2
    echo "TOPOLOGY_CONTAINER_CANDIDATE_COUNT=$count" >&2
    printf '%s\n' "$candidates" | sed '/^$/d;s/^/TOPOLOGY_CONTAINER_CANDIDATE=/' >&2
    docker ps -a --format 'TOPOLOGY_AVAILABLE_CONTAINER={{.Names}} image={{.Image}} status={{.Status}}' 2>/dev/null >&2 || true
    exit 21
  fi
fi

mounts=$(mounts_for_container "$container")
[ -n "$mounts" ] || {
  echo "TOPOLOGY_CONTAINER_HAS_NO_MOUNTS=$container" >&2
  exit 21
}

candidate_file=$(mktemp /tmp/groupguard-topology-candidates.XXXXXX)
trap 'rm -f "$candidate_file"' EXIT HUP INT TERM

add_candidate() {
  candidate=$1
  [ -n "$candidate" ] || return 0
  if valid_app_dir "$candidate" && path_related_to_mounts "$candidate" "$mounts"; then
    printf '%s\n' "$candidate" >> "$candidate_file"
  fi
}

add_candidate "$REQUESTED_APP_DIR"

while IFS= read -r source; do
  [ -n "$source" ] || continue
  add_candidate "$source"
  add_candidate "$(dirname "$source")"
  add_candidate "$(dirname "$(dirname "$source")")"
done <<EOF
$mounts
EOF

if [ -d "$SEARCH_ROOT" ]; then
  find "$SEARCH_ROOT" -maxdepth 6 -type f -path '*/dist/snowluma-service.mjs' 2>/dev/null | while IFS= read -r entry; do
    candidate=$(dirname "$(dirname "$entry")")
    if valid_app_dir "$candidate" && path_related_to_mounts "$candidate" "$mounts"; then
      printf '%s\n' "$candidate" >> "$candidate_file"
    fi
  done
fi

sort -u "$candidate_file" -o "$candidate_file"
app_count=$(wc -l < "$candidate_file" | tr -d ' ')
if [ "$app_count" != '1' ]; then
  echo "TOPOLOGY_APP_CANDIDATE_COUNT=$app_count" >&2
  sed 's/^/TOPOLOGY_APP_CANDIDATE=/' "$candidate_file" >&2 || true
  printf '%s\n' "$mounts" | sed '/^$/d;s/^/TOPOLOGY_CONTAINER_MOUNT_SOURCE=/' >&2
  echo "TOPOLOGY_REQUESTED_APP_DIR=$REQUESTED_APP_DIR" >&2
  exit 22
fi

app_dir=$(head -n 1 "$candidate_file")
if [ "$app_dir" = "$REQUESTED_APP_DIR" ] && safe_path "$REQUESTED_BACKUP_ROOT"; then
  backup_root=$REQUESTED_BACKUP_ROOT
  app_source=configured
else
  backup_root="$(dirname "$app_dir")/backups"
  app_source=container-mount
fi

safe_path "$app_dir" || {
  echo "TOPOLOGY_UNSAFE_APP_DIR=$app_dir" >&2
  exit 23
}
safe_path "$backup_root" || {
  echo "TOPOLOGY_UNSAFE_BACKUP_ROOT=$backup_root" >&2
  exit 23
}
[ "$app_dir" != "$backup_root" ] || {
  echo 'TOPOLOGY_OVERLAPPING_ROOTS=true' >&2
  exit 23
}
case "$backup_root" in
  "$app_dir"/*) echo 'TOPOLOGY_BACKUP_INSIDE_APP=true' >&2; exit 23 ;;
esac
case "$container" in
  ''|*[!A-Za-z0-9_.-]*) echo "TOPOLOGY_UNSAFE_CONTAINER=$container" >&2; exit 23 ;;
esac

echo 'TOPOLOGY_OK=true'
echo "TOPOLOGY_APP_DIR=$app_dir"
echo "TOPOLOGY_BACKUP_ROOT=$backup_root"
echo "TOPOLOGY_CONTAINER=$container"
echo "TOPOLOGY_APP_SOURCE=$app_source"
echo "TOPOLOGY_CONTAINER_SOURCE=$container_source"
