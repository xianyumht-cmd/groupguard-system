param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app",
  [string]$ContainerName = "groupguard-snowluma",
  [switch]$SkipBuild,
  [switch]$PrepareOnly,
  [ValidateRange(10, 120)][int]$HealthTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$DistPath = [IO.Path]::GetFullPath((Join-Path $RepoRoot "dist"))
$releaseId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$archivePath = Join-Path ([IO.Path]::GetTempPath()) "groupguard-dist-$releaseId.tgz"
$remoteArchive = ".groupguard-upload-$releaseId.tgz"
$remoteNext = "dist.release-$releaseId"
$remoteBackup = "dist.backup-$releaseId"
$remoteFailed = "dist.failed-$releaseId"
$target = "${User}@${HostName}"

function Assert-SafeParameters {
  if ($HostName -notmatch "^[A-Za-z0-9.-]+$" -or $User -notmatch "^[A-Za-z0-9._-]+$") {
    throw "Unsafe SSH target."
  }
  if (
    $RemoteAppDir -notmatch "^/[A-Za-z0-9._/-]+$" -or
    $RemoteAppDir -eq "/" -or
    $RemoteAppDir.Contains("..") -or
    -not $RemoteAppDir.StartsWith("/mnt/sda1/groupguard/", [StringComparison]::Ordinal)
  ) {
    throw "RemoteAppDir must be a safe path below /mnt/sda1/groupguard/."
  }
  if ($ContainerName -notmatch "^[A-Za-z0-9_.-]+$") {
    throw "Unsafe container name."
  }
  $expectedDist = [IO.Path]::GetFullPath((Join-Path $RepoRoot "dist"))
  if ($DistPath -ne $expectedDist -or -not $DistPath.StartsWith("$RepoRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean an unexpected dist path."
  }
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function ConvertTo-Base64Utf8 {
  param([Parameter(Mandatory = $true)][string]$Text)
  $normalized = $Text.Replace("`r`n", "`n")
  return [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($normalized))
}

function Quote-RemoteArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -notmatch "^[A-Za-z0-9_./:=+-]+$") {
    throw "Unsafe remote command argument."
  }
  return "'$Value'"
}

function Invoke-RemoteShell {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description
  )
  $encodedScript = ConvertTo-Base64Utf8 -Text $Script
  $quotedArguments = @($Arguments | ForEach-Object { Quote-RemoteArgument -Value $_ })
  $command = "printf '%s' '$encodedScript' | base64 -d | sh -s -- $($quotedArguments -join ' ')"
  Invoke-NativeChecked -FilePath "ssh" -Arguments @($target, $command) -Description $Description
}

$preflightScript = @'
set -eu
app="$1"
container="$2"
archive="$3"
next="$4"
case "$app" in
  /mnt/sda1/groupguard/*) ;;
  *) echo "unsafe remote app path" >&2; exit 20 ;;
esac
test -d "$app"
cd "$app"
test -f config/config.json
test -d config
test -d data
test -d dist
command -v base64 >/dev/null
command -v jq >/dev/null
command -v sha256sum >/dev/null
command -v tar >/dev/null
command -v docker >/dev/null
docker inspect --type container "$container" >/dev/null
test ! -e "$archive"
test ! -e "$next"
'@

$deployScript = @'
set -eu
app="$1"
container="$2"
archive="$3"
next="$4"
backup="$5"
failed="$6"
archive_sha="$7"
expected_commit="$8"
expected_artifact_sha="$9"
health_verifier="${10}"
health_timeout="${11}"
cd "$app"

switched=0
cleanup_and_restore() {
  rc=$?
  rm -f -- "$archive"
  if [ "$switched" -eq 0 ]; then
    if [ -d "$next" ]; then rm -rf -- "$next"; fi
  elif [ "$rc" -ne 0 ] && [ -d dist.previous ]; then
    echo "release verification failed; restoring dist.previous" >&2
    if [ -d dist ]; then mv -- dist "$failed"; fi
    mv -- dist.previous dist
    docker restart "$container" >/dev/null 2>&1 || true
    i=0
    while [ "$i" -lt 15 ]; do
      if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
        echo "previous release restored and container is running" >&2
        break
      fi
      i=$((i + 1))
      sleep 2
    done
  fi
  exit "$rc"
}
trap cleanup_and_restore EXIT

printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c - >/dev/null
mkdir "$next"
tar -xzf "$archive" -C "$next"
info="$next/build-info.json"
test -f "$info"
test "$(jq -er '.commit_sha' "$info")" = "$expected_commit"
test "$(jq -r 'if has("dirty") and (.dirty | type) == "boolean" then (.dirty | tostring) else "invalid" end' "$info")" = "false"
test "$(jq -er '.service' "$info")" = "groupguard"
artifact="$(jq -er '.artifact' "$info")"
test "$artifact" = "snowluma-service.mjs"
test "$(jq -er '.artifact_sha256' "$info")" = "$expected_artifact_sha"
test -f "$next/$artifact"
actual_artifact_sha="$(sha256sum "$next/$artifact" | awk '{print $1}')"
test "$actual_artifact_sha" = "$expected_artifact_sha"
printf 'artifact_verified commit=%s artifact_sha256=%s\n' "$expected_commit" "$actual_artifact_sha"

test ! -e "$backup"
cp -a -- dist "$backup"
rm -rf -- dist.previous
mv -- dist dist.previous
switched=1
mv -- "$next" dist
docker restart "$container" >/dev/null

attempts=$(( (health_timeout + 1) / 2 ))
i=0
while [ "$i" -lt "$attempts" ]; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" = "true" ]; then
    if docker exec "$container" node -e \
      "eval(Buffer.from(process.argv[1],'base64').toString('utf8'))" \
      "$health_verifier" "$expected_commit"; then
      rm -f -- "$archive"
      trap - EXIT
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep 2
done
echo "release health verification timed out" >&2
exit 30
'@

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
  if (health.ready !== true || health.build?.commit_sha !== expectedCommit) throw new Error('running service is not ready');
  console.log(`release_health_ok commit=${expectedCommit} ready=true`);
})().catch((error) => {
  console.error(`release_health_failed: ${String(error.message || error).slice(0, 240)}`);
  process.exit(1);
});
'@

Assert-SafeParameters
if ($SkipBuild) {
  throw "-SkipBuild is disabled for production deployment; build a fresh dist from the selected commit."
}

Push-Location $RepoRoot
try {
  if (Test-Path -LiteralPath $DistPath) {
    Remove-Item -LiteralPath $DistPath -Recurse -Force
  }

  Write-Host "Building a clean SnowLuma dist..."
  Invoke-NativeChecked -FilePath "npm" -Arguments @("run", "build:snowluma") -Description "SnowLuma build"

  $buildInfoPath = Join-Path $DistPath "build-info.json"
  $entryPath = Join-Path $DistPath "snowluma-service.mjs"
  if (-not (Test-Path -LiteralPath $buildInfoPath -PathType Leaf) -or -not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
    throw "SnowLuma build output or build-info.json is missing."
  }

  $headCommit = (& git -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $headCommit -notmatch "^[0-9a-f]{40}$") {
    throw "A full Git commit is required for deployment."
  }
  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw -Encoding utf8 | ConvertFrom-Json
  if ("$($buildInfo.commit_sha)".ToLowerInvariant() -ne $headCommit -or $buildInfo.dirty -ne $false) {
    throw "The clean build metadata does not match current HEAD."
  }
  if ("$($buildInfo.service)" -ne "groupguard" -or "$($buildInfo.artifact)" -ne "snowluma-service.mjs") {
    throw "The build metadata identifies the wrong service or entry artifact."
  }

  $artifactSha256 = (Get-FileHash -LiteralPath $entryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $buildInfo | Add-Member -NotePropertyName artifact_sha256 -NotePropertyValue $artifactSha256 -Force
  $buildInfo | Add-Member -NotePropertyName packaged_at_utc -NotePropertyValue ([DateTime]::UtcNow.ToString("o")) -Force
  [IO.File]::WriteAllText(
    $buildInfoPath,
    (($buildInfo | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false)
  )

  Invoke-NativeChecked `
    -FilePath "tar" `
    -Arguments @("-czf", $archivePath, "-C", $DistPath, ".") `
    -Description "Release archive creation"
  $archiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Prepared release commit=$headCommit artifact_sha256=$artifactSha256 archive_sha256=$archiveSha256"

  if ($PrepareOnly) {
    Write-Host "Prepare-only validation complete; no remote state was changed."
    return
  }

  Invoke-RemoteShell `
    -Script $preflightScript `
    -Arguments @($RemoteAppDir, $ContainerName, $remoteArchive, $remoteNext) `
    -Description "Remote deployment preflight"

  Write-Host "Uploading one verified release archive..."
  Invoke-NativeChecked `
    -FilePath "scp" `
    -Arguments @($archivePath, "${target}:$RemoteAppDir/$remoteArchive") `
    -Description "Release archive upload"

  Write-Host "Verifying, switching, restarting, and checking the running commit..."
  Invoke-RemoteShell `
    -Script $deployScript `
    -Arguments @(
      $RemoteAppDir,
      $ContainerName,
      $remoteArchive,
      $remoteNext,
      $remoteBackup,
      $remoteFailed,
      $archiveSha256,
      $headCommit,
      $artifactSha256,
      (ConvertTo-Base64Utf8 -Text $healthVerifier),
      "$HealthTimeoutSeconds"
    ) `
    -Description "Verified SnowLuma release deployment"

  Write-Host "Deploy complete. commit=$headCommit artifact_sha256=$artifactSha256 archive_sha256=$archiveSha256 backup=$remoteBackup"
}
finally {
  if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  Pop-Location
}
