import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [archivePath, outputDir, targetCommit] = process.argv.slice(2);
if (!archivePath || !outputDir || !targetCommit) {
  throw new Error('usage: node build-immutable-d0b79b6e.mjs <archive> <output-dir> <commit>');
}

const archive = fs.readFileSync(archivePath);
const archiveBase64 = archive.toString('base64');
const archiveSha256 = crypto.createHash('sha256').update(archive).digest('hex');
const shortCommit = targetCommit.slice(0, 8);
const packageName = `groupguard-production-safe-deployment-${shortCommit}`;
fs.mkdirSync(outputDir, { recursive: true });

const remoteScript = String.raw`#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="$1"
APP="$2"
CONTAINER="$3"
COMMIT="$4"
EXPECTED_SHA="$5"
WEBUI_PORT="$6"
WEBUI_TOKEN="$7"
HEALTH_TIMEOUT="$8"

SHORT="${'${'}COMMIT:0:8}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
APP_PARENT="$(dirname "$APP")"
BACKUP_ROOT="$APP_PARENT/backups"
BACKUP="$BACKUP_ROOT/project-wide-bugfix-$SHORT-$STAMP"
STAGE="$APP/.deploy-stage-$SHORT-$STAMP"
REPORT="$BACKUP/deployment-report.txt"
STOPPED=0
OLD_MOVED=0
NEW_MOVED=0
ROLLBACK_STARTED=0

mkdir -p "$BACKUP"
touch "$REPORT"

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

fail() {
  log "ERROR: $*"
  return 1
}

container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" = "true" ]
}

check_http_health() {
  curl -fsS --max-time 5 -H "x-groupguard-token: $WEBUI_TOKEN" "http://127.0.0.1:$WEBUI_PORT/api/livez" >/tmp/groupguard-livez-$SHORT.json &&
  curl -fsS --max-time 8 -H "x-groupguard-token: $WEBUI_TOKEN" "http://127.0.0.1:$WEBUI_PORT/api/readyz" >/tmp/groupguard-readyz-$SHORT.json &&
  curl -fsS --max-time 5 -H "x-groupguard-token: $WEBUI_TOKEN" "http://127.0.0.1:$WEBUI_PORT/api/build-info" >/tmp/groupguard-build-$SHORT.json &&
  grep -Fq "\"commit_sha\":\"$COMMIT\"" /tmp/groupguard-build-$SHORT.json
}

rollback() {
  local rc=$?
  if [ "$ROLLBACK_STARTED" -eq 1 ]; then
    exit "$rc"
  fi
  ROLLBACK_STARTED=1
  trap - ERR INT TERM
  set +e
  log ""
  log "========================================================================"
  log "Automatic rollback started"
  log "========================================================================"

  if container_running; then
    docker stop -t 20 "$CONTAINER" >>"$REPORT" 2>&1
  fi

  if [ "$NEW_MOVED" -eq 1 ] && [ -d "$APP/dist" ]; then
    mv "$APP/dist" "$BACKUP/dist-failed-$STAMP" >>"$REPORT" 2>&1
  fi

  if [ "$OLD_MOVED" -eq 1 ] && [ -d "$BACKUP/dist-live" ]; then
    mv "$BACKUP/dist-live" "$APP/dist" >>"$REPORT" 2>&1
  fi

  if [ "$STOPPED" -eq 1 ]; then
    docker start "$CONTAINER" >>"$REPORT" 2>&1
  fi

  sleep 8
  if container_running; then
    log "ROLLBACK_OK=true"
  else
    log "ROLLBACK_OK=false"
    log "Manual recovery source: $BACKUP/dist-live"
  fi
  docker logs --tail 300 "$CONTAINER" >"$BACKUP/container-logs-after-rollback.txt" 2>&1 || true
  rm -rf "$STAGE"
  rm -f "$ARCHIVE"
  log "Rollback report: $REPORT"
  exit "$rc"
}
trap rollback ERR INT TERM

log "========================================================================"
log "GroupGuard project-wide bugfix production safe deployment"
log "Target commit : $COMMIT"
log "Container     : $CONTAINER"
log "Remote app    : $APP"
log "Backup        : $BACKUP"
log "========================================================================"

log ""
log "1/6 Remote preflight while production stays running"
for command_name in docker tar sha256sum curl stat df du grep awk find mv chown chmod cp sleep; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing remote command: $command_name"
done
[ -d "$APP" ] || fail "remote app directory does not exist: $APP"
[ -d "$APP/dist" ] || fail "current dist directory does not exist: $APP/dist"
[ -f "$APP/dist/snowluma-service.mjs" ] || fail "current SnowLuma entry is missing"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container does not exist: $CONTAINER"
container_running || fail "production container is not running before preflight"
[ -f "$ARCHIVE" ] || fail "candidate archive was not transferred"
ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || fail "candidate SHA-256 mismatch after transfer"

while IFS= read -r archive_path; do
  case "$archive_path" in
    /*|../*|*/../*|*/..|*\\*) fail "unsafe path in candidate archive: $archive_path" ;;
  esac
done < <(tar -tzf "$ARCHIVE")

ARCHIVE_BYTES="$(stat -c %s "$ARCHIVE")"
CURRENT_BYTES="$(du -sb "$APP/dist" | awk '{print $1}')"
FREE_BYTES="$(df -PB1 "$APP" | awk 'NR==2 {print $4}')"
REQUIRED_BYTES=$((ARCHIVE_BYTES * 5 + CURRENT_BYTES * 3 + 104857600))
[ "$FREE_BYTES" -ge "$REQUIRED_BYTES" ] || fail "insufficient free disk space: free=$FREE_BYTES required=$REQUIRED_BYTES"

mkdir -p "$STAGE"
tar -xzf "$ARCHIVE" -C "$STAGE"
[ -f "$STAGE/MANIFEST.sha256" ] || fail "candidate manifest is missing"
[ -f "$STAGE/DEPLOYMENT-METADATA.json" ] || fail "candidate metadata is missing"
[ -f "$STAGE/dist/snowluma-service.mjs" ] || fail "candidate SnowLuma entry is missing"
[ -f "$STAGE/dist/build-info.json" ] || fail "candidate build info is missing"
(
  cd "$STAGE"
  sha256sum -c MANIFEST.sha256
) >>"$REPORT" 2>&1

grep -Fq "\"commit\": \"$COMMIT\"" "$STAGE/DEPLOYMENT-METADATA.json" || fail "candidate metadata commit mismatch"
grep -Fq "\"commit_sha\": \"$COMMIT\"" "$STAGE/dist/build-info.json" || fail "candidate build commit mismatch"
container_running || fail "production stopped during preflight"
log "PREFLIGHT_OK=true"

log ""
log "2/6 Validate candidate with the production container image"
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
docker run --rm --entrypoint node -v "$STAGE:/candidate:ro" "$IMAGE" --check /candidate/dist/snowluma-service.mjs >>"$REPORT" 2>&1
container_running || fail "production stopped during candidate validation"
log "CANDIDATE_VALIDATION_OK=true"

log ""
log "3/6 Capture backup and production evidence"
docker inspect "$CONTAINER" >"$BACKUP/container-inspect-before.json"
docker logs --tail 500 "$CONTAINER" >"$BACKUP/container-logs-before.txt" 2>&1 || true
cp "$STAGE/DEPLOYMENT-METADATA.json" "$BACKUP/candidate-metadata.json"
printf '%s  %s\n' "$EXPECTED_SHA" "candidate-dist-$SHORT.tar.gz" >"$BACKUP/candidate.sha256"
OWNER_UID="$(stat -c %u "$APP/dist")"
OWNER_GID="$(stat -c %g "$APP/dist")"
ROOT_MODE="$(stat -c %a "$APP/dist")"
RESTART_BEFORE="$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")"
log "BACKUP_CAPTURE_OK=true"

log ""
log "4/6 Stop production and atomically switch dist"
docker stop -t 30 "$CONTAINER" >>"$REPORT" 2>&1
STOPPED=1
mv "$APP/dist" "$BACKUP/dist-live"
OLD_MOVED=1
mv "$STAGE/dist" "$APP/dist"
NEW_MOVED=1
chown -R "$OWNER_UID:$OWNER_GID" "$APP/dist"
chmod "$ROOT_MODE" "$APP/dist"
docker start "$CONTAINER" >>"$REPORT" 2>&1
log "SWITCH_OK=true"

log ""
log "5/6 Health and provenance checks"
DEADLINE=$((SECONDS + HEALTH_TIMEOUT))
HEALTH_OK=0
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if container_running && check_http_health; then
    HEALTH_OK=1
    break
  fi
  sleep 3
done
[ "$HEALTH_OK" -eq 1 ] || fail "health endpoints did not become ready before timeout"

sleep 10
container_running || fail "container stopped after initial health success"
check_http_health || fail "health endpoints failed the stability recheck"
RESTART_AFTER="$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")"
[ "$RESTART_AFTER" -eq "$RESTART_BEFORE" ] || fail "container restart count changed: before=$RESTART_BEFORE after=$RESTART_AFTER"
docker logs --tail 500 "$CONTAINER" >"$BACKUP/container-logs-after.txt" 2>&1 || true
cp /tmp/groupguard-livez-$SHORT.json "$BACKUP/livez.json"
cp /tmp/groupguard-readyz-$SHORT.json "$BACKUP/readyz.json"
cp /tmp/groupguard-build-$SHORT.json "$BACKUP/build-info.json"
log "HEALTH_OK=true"
log "PROVENANCE_OK=true"

log ""
log "6/6 Finalize"
rm -rf "$STAGE"
rm -f "$ARCHIVE"
rm -f /tmp/groupguard-livez-$SHORT.json /tmp/groupguard-readyz-$SHORT.json /tmp/groupguard-build-$SHORT.json
trap - ERR INT TERM
log "DEPLOYMENT_OK=true"
log "COMMIT=$COMMIT"
log "BACKUP=$BACKUP"
log "REPORT=$REPORT"
log "Production deployment completed successfully."
`;

function psSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const ps = `#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SshTarget = 'root@192.168.3.89',
    [string]$RemoteApp = '/mnt/sda1/groupguard/app',
    [string]$Container = 'groupguard-snowluma',
    [int]$WebUiPort = 6108,
    [string]$WebUiToken = 'gg6108',
    [int]$HealthTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TargetCommit = ${psSingleQuote(targetCommit)}
$CandidateSha256 = ${psSingleQuote(archiveSha256)}
$CandidateBase64 = @'
${archiveBase64}
'@
$RemoteScriptBase64 = ${psSingleQuote(Buffer.from(remoteScript, 'utf8').toString('base64'))}

function Write-Section([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 72)
    Write-Host $Text
    Write-Host ('=' * 72)
}

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $Name"
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Quote-Posix([string]$Value) {
    $Replacement = "'" + '"' + "'" + '"' + "'"
    return "'" + $Value.Replace("'", $Replacement) + "'"
}

Write-Host 'GroupGuard immutable production deployment package'
Write-Host "Target commit : $TargetCommit"
Write-Host "SSH target    : $SshTarget"
Write-Host "Remote app    : $RemoteApp"
Write-Host "Container     : $Container"
Write-Host 'Candidate is embedded and immutable; no Git checkout is performed.'
Write-Host 'Production remains running throughout preflight and candidate validation.'
Write-Host 'Any failure after the switch invokes automatic rollback.'

Assert-Command 'ssh'
Assert-Command 'scp'
Assert-Command 'tar'
Assert-Command 'node'

$WorkRoot = Join-Path $env:TEMP ("groupguard-deploy-" + [Guid]::NewGuid().ToString('N'))
$CandidatePath = Join-Path $WorkRoot ("candidate-dist-${shortCommit}.tar.gz")
$ExtractPath = Join-Path $WorkRoot 'candidate'
$RemoteArchive = "/tmp/groupguard-candidate-${shortCommit}.tar.gz"

try {
    New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $ExtractPath -Force | Out-Null

    Write-Section '1/4 Verify embedded candidate and provenance locally'
    [IO.File]::WriteAllBytes($CandidatePath, [Convert]::FromBase64String($CandidateBase64.Trim()))
    $ActualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $CandidatePath).Hash.ToLowerInvariant()
    if ($ActualSha -ne $CandidateSha256) {
        throw "Embedded candidate SHA-256 mismatch: $ActualSha"
    }
    Invoke-Native tar -xzf $CandidatePath -C $ExtractPath

    $MetadataPath = Join-Path $ExtractPath 'DEPLOYMENT-METADATA.json'
    $BuildInfoPath = Join-Path $ExtractPath 'dist\build-info.json'
    $EntryPath = Join-Path $ExtractPath 'dist\snowluma-service.mjs'
    $ManifestPath = Join-Path $ExtractPath 'MANIFEST.sha256'
    foreach ($RequiredPath in @($MetadataPath, $BuildInfoPath, $EntryPath, $ManifestPath)) {
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Candidate file is missing: $RequiredPath"
        }
    }

    $Metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
    $BuildInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
    if ([string]$Metadata.commit -ne $TargetCommit) { throw 'Candidate metadata commit mismatch.' }
    if ([string]$BuildInfo.commit_sha -ne $TargetCommit) { throw 'Candidate build-info commit mismatch.' }

    foreach ($Line in Get-Content -LiteralPath $ManifestPath) {
        if ([string]::IsNullOrWhiteSpace($Line)) { continue }
        if ($Line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Invalid manifest line: $Line" }
        $Expected = $Matches[1]
        $Relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
        $File = Join-Path $ExtractPath $Relative
        if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Manifest file missing: $Relative" }
        $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
        if ($Hash -ne $Expected) { throw "Manifest mismatch: $Relative" }
    }
    Invoke-Native node --check $EntryPath
    Write-Host "Candidate SHA-256 verified: $CandidateSha256"
    Write-Host "Candidate commit verified: $TargetCommit"

    Write-Section '2/4 Transfer immutable candidate to production host'
    Invoke-Native scp -- $CandidatePath ("\${SshTarget}:$RemoteArchive")

    Write-Section '3/4 Run remote preflight, backup, switch, health checks and rollback guard'
    $RemoteScript = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RemoteScriptBase64))
    $RemoteArgs = @(
        $RemoteArchive,
        $RemoteApp,
        $Container,
        $TargetCommit,
        $CandidateSha256,
        [string]$WebUiPort,
        $WebUiToken,
        [string]$HealthTimeoutSeconds
    )
    $Quoted = ($RemoteArgs | ForEach-Object { Quote-Posix $_ }) -join ' '
    $RemoteCommand = "printf %s " + (Quote-Posix $RemoteScriptBase64) + " | base64 -d | bash -s -- $Quoted"
    & ssh $SshTarget $RemoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment failed with exit code $LASTEXITCODE. Review the remote rollback report printed above."
    }

    Write-Section '4/4 Deployment result'
    Write-Host 'PRODUCTION DEPLOYMENT SUCCEEDED.' -ForegroundColor Green
    Write-Host "Commit: $TargetCommit"
    Write-Host 'The previous dist remains preserved in the remote backup directory printed above.'
}
finally {
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
}
`;

const readme = `GroupGuard production safe deployment package
=====================================================
Target commit : ${targetCommit}
Candidate SHA : ${archiveSha256}
Remote target : root@192.168.3.89
Remote app    : /mnt/sda1/groupguard/app
Container     : groupguard-snowluma
WebUI health  : http://127.0.0.1:6108/api/livez and /api/readyz

Run:
  Double-click RUN-DEPLOY.cmd

The package embeds the exact built dist from the target commit. It never pulls or
checks out Git on the production server. Production remains running during all
preflight, checksum, extraction and syntax checks. The container is stopped only
for the atomic dist switch. Any switch, startup, readiness, provenance or stability
failure restores the previous dist and restarts the container automatically.

Default WebUI token is gg6108. To override it, run PowerShell manually:
  .\\deploy-groupguard-${shortCommit}.ps1 -WebUiToken 'YOUR_TOKEN'
`;

const cmd = `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-groupguard-${shortCommit}.ps1"\r\nset RC=%ERRORLEVEL%\r\necho.\r\nif not "%RC%"=="0" echo DEPLOYMENT FAILED OR ROLLED BACK.\r\nif "%RC%"=="0" echo DEPLOYMENT COMPLETED SUCCESSFULLY.\r\npause\r\nexit /b %RC%\r\n`;

fs.writeFileSync(path.join(outputDir, `deploy-groupguard-${shortCommit}.ps1`), ps, 'utf8');
fs.writeFileSync(path.join(outputDir, 'RUN-DEPLOY.cmd'), cmd, 'utf8');
fs.writeFileSync(path.join(outputDir, 'README.txt'), readme, 'utf8');
fs.writeFileSync(
  path.join(outputDir, 'PACKAGE-MANIFEST.txt'),
  `target_commit=${targetCommit}\ncandidate_sha256=${archiveSha256}\npackage_name=${packageName}\n`,
  'utf8'
);
console.log(JSON.stringify({ packageName, archiveSha256, targetCommit }, null, 2));
