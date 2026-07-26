param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app",
  [string]$ContainerName = "groupguard-snowluma",
  [string]$BackupName = "",
  [string]$ExpectedCommit = "",
  [ValidateRange(10, 120)][int]$HealthTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
if (
  $HostName -notmatch "^[A-Za-z0-9.-]+$" -or
  $User -notmatch "^[A-Za-z0-9._-]+$" -or
  $RemoteAppDir -notmatch "^/[A-Za-z0-9._/-]+$" -or
  $RemoteAppDir -eq "/" -or
  $RemoteAppDir.Contains("..") -or
  -not $RemoteAppDir.StartsWith("/mnt/sda1/groupguard/", [StringComparison]::Ordinal) -or
  $ContainerName -notmatch "^[A-Za-z0-9_.-]+$"
) {
  throw "Unsafe SnowLuma rollback target."
}
if ($ExpectedCommit -and $ExpectedCommit -notmatch "^[0-9a-fA-F]{40}$") {
  throw "ExpectedCommit must be a full 40-character Git SHA."
}

$target = "${User}@${HostName}"
if ([string]::IsNullOrWhiteSpace($BackupName)) {
  $BackupName = (& ssh $target "cd '$RemoteAppDir' && ls -1dt dist.backup-* 2>/dev/null | head -n 1").Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list remote release backups."
  }
}
if ($BackupName -notmatch "^dist\.backup-[A-Za-z0-9._-]+$") {
  throw "BackupName is missing or unsafe."
}

$rollbackId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$candidateName = "dist.rollback-$rollbackId"
$failedName = "dist.failed-rollback-$rollbackId"
$rejectedName = "dist.rejected-rollback-$rollbackId"
$expectedArgument = if ($ExpectedCommit) { $ExpectedCommit.ToLowerInvariant() } else { "auto" }

$healthVerifier = @'
const http = require('http');
const expectedCommit = process.argv[2];
const token = String(process.env.GROUPGUARD_WEBUI_TOKEN || '');
const port = Number(process.env.GROUPGUARD_WEBUI_PORT || 6108);
if (!token) throw new Error('stable WebUI token is not configured');
const get = (pathname) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: pathname,
    method: 'GET',
    headers: { 'x-groupguard-token': token, accept: 'application/json' },
    timeout: 3000
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
(async () => {
  const build = await get('/api/build-info');
  if (build.commit_sha !== expectedCommit || build.dirty !== false) throw new Error('running build commit mismatch');
  const health = await get('/api/health');
  if (health.ready !== true || health.build?.commit_sha !== expectedCommit) throw new Error('running rollback is not ready');
  console.log(`rollback_health_ok commit=${expectedCommit} ready=true`);
})().catch((error) => {
  console.error(`rollback_health_failed: ${String(error.message || error).slice(0, 240)}`);
  process.exit(1);
});
'@
$healthBase64 = [Convert]::ToBase64String(
  [Text.UTF8Encoding]::new($false).GetBytes($healthVerifier.Replace("`r`n", "`n"))
)

$rollbackScript = @'
set -eu
app="$1"
container="$2"
backup="$3"
candidate="$4"
failed="$5"
rejected="$6"
expected="$7"
timeout_seconds="$8"
health_base64="$9"
case "$app" in
  /mnt/sda1/groupguard/*) ;;
  *) echo "unsafe remote app path" >&2; exit 20 ;;
esac
cd "$app"
test -d "$backup"
test -d dist
test ! -e "$candidate"
test ! -e "$failed"
test ! -e "$rejected"
command -v jq >/dev/null
command -v sha256sum >/dev/null
command -v docker >/dev/null
docker inspect --type container "$container" >/dev/null

info="$backup/build-info.json"
test -f "$info"
commit="$(jq -er '.commit_sha' "$info")"
case "$commit" in
  ''|*[!0-9a-fA-F]*) echo "backup commit is not a full Git SHA" >&2; exit 21 ;;
esac
test "${#commit}" -eq 40
commit="$(printf '%s' "$commit" | tr 'A-F' 'a-f')"
if [ "$expected" != "auto" ]; then test "$commit" = "$expected"; fi
test "$(jq -r 'if has("dirty") and (.dirty | type) == "boolean" then (.dirty | tostring) else "invalid" end' "$info")" = "false"
test "$(jq -er '.service' "$info")" = "groupguard"
artifact="$(jq -er '.artifact' "$info")"
test "$artifact" = "snowluma-service.mjs"
artifact_sha="$(jq -er '.artifact_sha256' "$info")"
test "$(sha256sum "$backup/$artifact" | awk '{print $1}')" = "$artifact_sha"

cp -a -- "$backup" "$candidate"
switched=0
restore_current() {
  rc=$?
  if [ "$switched" -eq 0 ]; then
    if [ -d "$candidate" ]; then rm -rf -- "$candidate"; fi
  elif [ "$rc" -ne 0 ] && [ -d "$failed" ]; then
    echo "rollback verification failed; restoring the pre-rollback release" >&2
    if [ -d dist ]; then mv -- dist "$rejected"; fi
    mv -- "$failed" dist
    docker restart "$container" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap restore_current EXIT

mv -- dist "$failed"
switched=1
mv -- "$candidate" dist
docker restart "$container" >/dev/null
attempts=$(( (timeout_seconds + 1) / 2 ))
i=0
while [ "$i" -lt "$attempts" ]; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
    if docker exec "$container" node -e \
      "eval(Buffer.from(process.argv[1],'base64').toString('utf8'))" \
      "$health_base64" "$commit"; then
      trap - EXIT
      printf 'rollback_complete commit=%s previous=%s\n' "$commit" "$failed"
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep 2
done
echo "rollback health verification timed out" >&2
exit 30
'@
$scriptBase64 = [Convert]::ToBase64String(
  [Text.UTF8Encoding]::new($false).GetBytes($rollbackScript.Replace("`r`n", "`n"))
)
$arguments = @(
  $RemoteAppDir,
  $ContainerName,
  $BackupName,
  $candidateName,
  $failedName,
  $rejectedName,
  $expectedArgument,
  "$HealthTimeoutSeconds",
  $healthBase64
)
foreach ($argument in $arguments) {
  if ($argument -notmatch "^[A-Za-z0-9_./:=+-]+$") {
    throw "Unsafe remote rollback argument."
  }
}
$quotedArguments = @($arguments | ForEach-Object { "'$_'" })
$command = "printf '%s' '$scriptBase64' | base64 -d | sh -s -- $($quotedArguments -join ' ')"

Write-Host "Rolling back to verified backup $BackupName"
& ssh $target $command
if ($LASTEXITCODE -ne 0) {
  throw "Verified SnowLuma rollback failed with exit code $LASTEXITCODE."
}
