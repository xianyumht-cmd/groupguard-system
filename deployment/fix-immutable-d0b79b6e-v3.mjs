import fs from 'node:fs';

const launcherPath = process.argv[2];
const readmePath = process.argv[3];
const manifestPath = process.argv[4];
if (!launcherPath || !readmePath || !manifestPath) {
  throw new Error('usage: node fix-immutable-d0b79b6e-v3.mjs <launcher.ps1> <README.txt> <PACKAGE-MANIFEST.txt>');
}

let launcher = fs.readFileSync(launcherPath, 'utf8');
const payloadMatch = launcher.match(/\$RemoteScriptBase64 = '([^']+)'/);
if (!payloadMatch) throw new Error('embedded remote script payload is missing');
let remote = Buffer.from(payloadMatch[1], 'base64').toString('utf8');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`v3 patch point is missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`v3 patch point is duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

remote = replaceOnce(
  remote,
  'WEBUI_TOKEN="$7"\nHEALTH_TIMEOUT="$8"',
  'WEBUI_TOKEN_HINT="$7"\nHEALTH_TIMEOUT="$8"',
  'token argument name'
);

remote = replaceOnce(
  remote,
  'ROLLBACK_STARTED=0\n',
  `ROLLBACK_STARTED=0
TOKEN_SOURCE=""
TOKEN_DATA_DIR=""
TOKEN_FILE=""
TOKEN_FILE_EXISTED=0
TOKEN_FILE_CHANGED=0
IMAGE=""
`,
  'token state initialization'
);

remote = replaceOnce(
  remote,
  `container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" = "true" ]
}

check_http_health() {`,
  `container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" = "true" ]
}

container_env_value() {
  local key="$1"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \\
    | awk -v prefix="$key=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }'
}

read_container_token_file() {
  docker exec "$CONTAINER" node -e '
    const fs = require("fs");
    const file = process.argv[1];
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (!value) process.exit(2);
      process.stdout.write(value);
    } catch {
      process.exit(1);
    }
  ' "$TOKEN_FILE" 2>/dev/null
}

legacy_token_works() {
  local token="$1"
  [ -n "$token" ] || return 1
  curl -fsS --max-time 8 -H "x-groupguard-token: $token" \\
    "http://127.0.0.1:$WEBUI_PORT/api/livez" >/dev/null 2>&1
}

restore_token_file() {
  [ "$TOKEN_FILE_CHANGED" -eq 1 ] || return 0
  if [ "$TOKEN_FILE_EXISTED" -eq 1 ] && [ -f "$BACKUP/webui-token-before" ]; then
    docker cp "$BACKUP/webui-token-before" "$CONTAINER:$TOKEN_FILE" >>"$REPORT" 2>&1
  else
    docker exec "$CONTAINER" node -e '
      const fs = require("fs");
      fs.rmSync(process.argv[1], { force: true });
    ' "$TOKEN_FILE" >>"$REPORT" 2>&1
  fi
  docker restart -t 20 "$CONTAINER" >>"$REPORT" 2>&1
}

check_http_health() {`,
  'token compatibility helpers'
);

remote = replaceOnce(
  remote,
  `  if [ "$STOPPED" -eq 1 ]; then
    docker start "$CONTAINER" >>"$REPORT" 2>&1
  fi
`,
  `  if [ "$STOPPED" -eq 1 ]; then
    docker start "$CONTAINER" >>"$REPORT" 2>&1
  fi

  if container_running; then
    restore_token_file
  fi
`,
  'rollback token restoration'
);

remote = replaceOnce(
  remote,
  `grep -Fq "\\\"commit\\\": \\\"$COMMIT\\\"" "$STAGE/DEPLOYMENT-METADATA.json" || fail "candidate metadata commit mismatch"
grep -Fq "\\\"commit_sha\\\": \\\"$COMMIT\\\"" "$STAGE/dist/build-info.json" || fail "candidate build commit mismatch"
container_running || fail "production stopped during preflight"
log "PREFLIGHT_OK=true"`,
  `grep -Fq "\\\"commit\\\": \\\"$COMMIT\\\"" "$STAGE/DEPLOYMENT-METADATA.json" || fail "candidate metadata commit mismatch"
grep -Fq "\\\"commit_sha\\\": \\\"$COMMIT\\\"" "$STAGE/dist/build-info.json" || fail "candidate build commit mismatch"

TOKEN_DATA_DIR="$(container_env_value GROUPGUARD_DATA_DIR || true)"
[ -n "$TOKEN_DATA_DIR" ] || TOKEN_DATA_DIR="/app/data"
case "$TOKEN_DATA_DIR" in
  /*) ;;
  *) fail "GROUPGUARD_DATA_DIR must be an absolute container path" ;;
esac
TOKEN_FILE="$TOKEN_DATA_DIR/.groupguard-webui-token"
ENV_TOKEN="$(container_env_value GROUPGUARD_WEBUI_TOKEN || true)"
FILE_TOKEN="$(read_container_token_file || true)"

if [ -n "$ENV_TOKEN" ]; then
  WEBUI_TOKEN="$ENV_TOKEN"
  TOKEN_SOURCE="container_environment"
elif legacy_token_works "$WEBUI_TOKEN_HINT"; then
  WEBUI_TOKEN="$WEBUI_TOKEN_HINT"
  TOKEN_SOURCE="validated_legacy_token"
  docker exec "$CONTAINER" node -e '
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(process.argv[1]), { recursive: true });
  ' "$TOKEN_FILE" >>"$REPORT" 2>&1
  if docker exec "$CONTAINER" node -e 'process.exit(require("fs").existsSync(process.argv[1]) ? 0 : 1)' "$TOKEN_FILE"; then
    TOKEN_FILE_EXISTED=1
    docker cp "$CONTAINER:$TOKEN_FILE" "$BACKUP/webui-token-before" >>"$REPORT" 2>&1
    chmod 600 "$BACKUP/webui-token-before"
  fi
  printf '%s\\n' "$WEBUI_TOKEN" >"$STAGE/webui-token-next"
  chmod 600 "$STAGE/webui-token-next"
elif [ -n "$FILE_TOKEN" ]; then
  WEBUI_TOKEN="$FILE_TOKEN"
  TOKEN_SOURCE="persistent_token_file"
else
  fail "unable to resolve a WebUI token for the new runtime"
fi

[ -n "$WEBUI_TOKEN" ] || fail "resolved WebUI token is empty"
container_running || fail "production stopped during preflight"
log "TOKEN_COMPATIBILITY_OK=true"
log "TOKEN_SOURCE=$TOKEN_SOURCE"
log "PREFLIGHT_OK=true"`,
  'preflight token resolution'
);

remote = replaceOnce(
  remote,
  `chown -R "$OWNER_UID:$OWNER_GID" "$APP/dist"
chmod "$ROOT_MODE" "$APP/dist"
docker start "$CONTAINER" >>"$REPORT" 2>&1
log "SWITCH_OK=true"`,
  `chown -R "$OWNER_UID:$OWNER_GID" "$APP/dist"
chmod "$ROOT_MODE" "$APP/dist"
if [ "$TOKEN_SOURCE" = "validated_legacy_token" ]; then
  docker cp "$STAGE/webui-token-next" "$CONTAINER:$TOKEN_FILE" >>"$REPORT" 2>&1
  TOKEN_FILE_CHANGED=1
  EXPECTED_TOKEN_SHA="$(sha256sum "$STAGE/webui-token-next" | awk '{print $1}')"
  ACTUAL_TOKEN_SHA="$(docker run --rm --volumes-from "$CONTAINER" --entrypoint node "$IMAGE" -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$TOKEN_FILE")"
  [ "$ACTUAL_TOKEN_SHA" = "$EXPECTED_TOKEN_SHA" ] || fail "persisted WebUI token verification failed"
  log "TOKEN_MIGRATION_OK=true"
fi
docker start "$CONTAINER" >>"$REPORT" 2>&1
log "SWITCH_OK=true"`,
  'token migration during switch'
);

for (const marker of [
  'TOKEN_COMPATIBILITY_OK=true',
  'TOKEN_MIGRATION_OK=true',
  'restore_token_file',
  'validated_legacy_token',
  'persistent_token_file',
  'docker restart -t 20 "$CONTAINER"'
]) {
  if (!remote.includes(marker)) throw new Error(`v3 remote marker is missing: ${marker}`);
}

const remoteBase64 = Buffer.from(remote, 'utf8').toString('base64');
launcher = launcher.replace(payloadMatch[1], remoteBase64);
launcher = launcher.replace(
  "Write-Host 'GroupGuard immutable production deployment package'",
  "Write-Host 'GroupGuard immutable production deployment package v3'"
);
launcher = launcher.replace(
  "Write-Host 'Any failure after the switch invokes automatic rollback.'",
  "Write-Host 'Any failure after the switch invokes automatic rollback.'\nWrite-Host 'WebUI token compatibility is resolved automatically before the switch.'"
);
fs.writeFileSync(launcherPath, launcher, 'utf8');

let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme
  .replace('package v2', 'package v3')
  .replace('Package fix   : v2 - corrected Windows local candidate paths', 'Package fix   : v3 - automatic production WebUI token compatibility')
  .replace('Default WebUI token is gg6108. To override it, run PowerShell manually:\n  .\\deploy-groupguard-d0b79b6e.ps1 -WebUiToken \'YOUR_TOKEN\'\n', `V3 resolves the token used by the new runtime before production is stopped:\n  1. GROUPGUARD_WEBUI_TOKEN from the production container environment;\n  2. the legacy token parameter after validating it against the running service;\n  3. the persistent <GROUPGUARD_DATA_DIR>/.groupguard-webui-token file.\n\nWhen the legacy runtime uses gg6108 but the new runtime has a generated token file,\nv3 backs up that file and writes the validated legacy token before startup. A failed\nswitch restores both the previous dist and the previous token file. Token values are\nnever printed to the console or deployment report.\n`);
fs.writeFileSync(readmePath, readme, 'utf8');

let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest
  .replace('package_name=groupguard-production-safe-deployment-d0b79b6e-v2', 'package_name=groupguard-production-safe-deployment-d0b79b6e-v3')
  .replace('package_revision=2', 'package_revision=3')
  .replace('local_path_fix=dist-child-join', 'local_path_fix=dist-child-join\ntoken_compatibility=auto-env-legacy-file\nautomatic_token_rollback=true');
fs.writeFileSync(manifestPath, manifest, 'utf8');

for (const [name, bytes] of [
  ['launcher', fs.readFileSync(launcherPath)],
  ['remote', Buffer.from(remote, 'utf8')]
]) {
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) {
      throw new Error(`${name} contains illegal control byte 0x${value.toString(16).padStart(2, '0')} at offset ${index}`);
    }
  }
}

console.log(`corrected generated v3 launcher: ${launcherPath}`);
