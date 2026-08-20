# ASCII-only on purpose: Windows PowerShell 5.1 does not reliably parse UTF-8 without BOM.
[CmdletBinding()]
param(
  [string]$RepoPath = 'D:\project2\groupguard-system',
  [string]$RemoteHost = '192.168.3.89',
  [string]$RemoteUser = 'root',
  [int]$RemotePort = 22,
  [string]$RemoteAppDir = '/mnt/sda1/groupguard/app',
  [string]$RemoteBackupRoot = '/mnt/sda1/groupguard/backups',
  [string]$RemoteContainer = 'groupguard-snowluma'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name. Install it or add it to PATH."
  }
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $File @Arguments
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "Command failed (exit=$code): $File $($Arguments -join ' ')"
  }
  return $code
}

function Get-NativeOutput([string]$File, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $File @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0) {
    throw "Command failed (exit=$code): $File $($Arguments -join ' ')`n$($out -join "`n")"
  }
  return (($out | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Quote-Remote([string]$Value) {
  if ($Value -match "'") { throw "Remote argument must not contain a single quote: $Value" }
  return "'$Value'"
}

function New-LfHelperCopy([string]$Source, [string]$Destination) {
  $text = [IO.File]::ReadAllText($Source)
  $text = $text.Replace("`r`n", "`n").Replace("`r", "`n")
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Destination, $text, $utf8NoBom)
  $bytes = [IO.File]::ReadAllBytes($Destination)
  if ($bytes -contains 13) {
    throw "LF normalization failed for remote helper: $Source"
  }
}

function Assert-SafeParameters {
  if ($RemoteHost -notmatch '^[A-Za-z0-9.-]+$') { throw 'Unsafe RemoteHost value.' }
  if ($RemoteUser -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unsafe RemoteUser value.' }
  if ($RemotePort -lt 1 -or $RemotePort -gt 65535) { throw 'RemotePort must be between 1 and 65535.' }
  foreach ($item in @(
    @{ Name = 'RemoteAppDir'; Value = $RemoteAppDir },
    @{ Name = 'RemoteBackupRoot'; Value = $RemoteBackupRoot }
  )) {
    $value = [string]$item.Value
    if ($value -notmatch '^/mnt/sda1/groupguard/[A-Za-z0-9._/-]+$' -or $value.Contains('..') -or $value.EndsWith('/.')) {
      throw "$($item.Name) must be a safe absolute path below /mnt/sda1/groupguard/."
    }
  }
  if ($RemoteAppDir.TrimEnd('/') -eq $RemoteBackupRoot.TrimEnd('/')) { throw 'Application and backup directories must be different.' }
  if ($RemoteContainer -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Unsafe RemoteContainer value.' }
}

function Assert-SupportedNode {
  $version = Get-NativeOutput 'node' @('-p', 'process.versions.node')
  if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw "Unable to parse Node.js version: $version" }
  $major = [int]$Matches[1]
  if ($major -lt 22) {
    throw "Node.js is too old: $version. GroupGuard requires Node.js 22 or newer for this release workflow."
  }
  Write-Host "Node.js: $version" -ForegroundColor Green
}

function Assert-CanonicalOrigin([string]$OriginUrl) {
  $value = $OriginUrl.Trim()
  $allowed = @(
    '^https://github\.com/xianyumht-cmd/groupguard-system(?:\.git)?/?$',
    '^git@github\.com:xianyumht-cmd/groupguard-system(?:\.git)?$',
    '^ssh://git@github\.com/xianyumht-cmd/groupguard-system(?:\.git)?/?$'
  )
  if (-not ($allowed | Where-Object { $value -match $_ })) {
    throw "Unexpected origin for xianyumht-cmd/groupguard-system: $value"
  }
}

try {
  Write-Host 'GroupGuard one-click update / production code deploy' -ForegroundColor Green
  Write-Host 'Only the built dist is deployed. config.json, SQLite/data, logs, credentials and secrets are preserved.'

  Assert-SafeParameters
  foreach ($cmd in @('git', 'node', 'npm', 'ssh', 'scp', 'tar')) { Require-Command $cmd }
  Assert-SupportedNode
  if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw "Local repository does not exist: $RepoPath" }
  if (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) { throw "Not a Git repository: $RepoPath" }

  Write-Step 'Verify local repository origin'
  $originUrl = Get-NativeOutput 'git' @('-C', $RepoPath, 'remote', 'get-url', 'origin')
  Assert-CanonicalOrigin $originUrl
  Write-Host "origin: $originUrl" -ForegroundColor Green

  Write-Step 'Verify local worktree is clean'
  $dirty = Get-NativeOutput 'git' @('-C', $RepoPath, 'status', '--porcelain')
  if ($dirty) {
    Write-Host $dirty -ForegroundColor Yellow
    throw 'Local repository has uncommitted changes. Nothing was overwritten. Commit, back up, or handle them manually first.'
  }

  Write-Step 'Update local main using fast-forward only'
  Invoke-Native 'git' @('-C', $RepoPath, 'fetch', '--prune', 'origin') | Out-Null
  Invoke-Native 'git' @('-C', $RepoPath, 'switch', 'main') | Out-Null
  Invoke-Native 'git' @('-C', $RepoPath, 'pull', '--ff-only', 'origin', 'main') | Out-Null
  $commit = Get-NativeOutput 'git' @('-C', $RepoPath, 'rev-parse', 'HEAD')
  $originMain = Get-NativeOutput 'git' @('-C', $RepoPath, 'rev-parse', 'origin/main')
  if ($commit -ne $originMain) { throw "Local main does not match origin/main: local=$commit origin=$originMain" }
  if ($commit -notmatch '^[0-9a-fA-F]{40}$') { throw "Unexpected Git commit format: $commit" }
  Write-Host "Release commit: $commit" -ForegroundColor Green

  $core = Join-Path $RepoPath 'onebot-plugin-groupguard'
  if (-not (Test-Path -LiteralPath (Join-Path $core 'package-lock.json'))) { throw 'package-lock.json is missing; npm ci cannot run safely.' }

  Write-Step 'Install locked dependencies'
  Invoke-Native 'npm' @('--prefix', $core, 'ci') | Out-Null

  Write-Step 'Run full automated test suite'
  Invoke-Native 'npm' @('--prefix', $core, 'test') | Out-Null

  Write-Step 'Build SnowLuma production candidate'
  $oldCommitEnv = $env:GROUPGUARD_COMMIT_SHA
  $oldBuildTimeEnv = $env:GROUPGUARD_BUILD_TIME_UTC
  try {
    $env:GROUPGUARD_COMMIT_SHA = $commit
    $env:GROUPGUARD_BUILD_TIME_UTC = [DateTime]::UtcNow.ToString('o')
    Invoke-Native 'npm' @('--prefix', $core, 'run', 'build:snowluma') | Out-Null
  } finally {
    $env:GROUPGUARD_COMMIT_SHA = $oldCommitEnv
    $env:GROUPGUARD_BUILD_TIME_UTC = $oldBuildTimeEnv
  }

  $dist = Join-Path $core 'dist'
  $buildInfoPath = Join-Path $dist 'build-info.json'
  $entryPath = Join-Path $dist 'snowluma-service.mjs'
  if (-not (Test-Path -LiteralPath $buildInfoPath)) { throw 'Build output is missing dist/build-info.json.' }
  if (-not (Test-Path -LiteralPath $entryPath)) { throw 'Build output is missing dist/snowluma-service.mjs.' }
  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
  if ([string]$buildInfo.commit_sha -ne $commit) { throw "Build commit mismatch: $($buildInfo.commit_sha) != $commit" }
  if ($buildInfo.dirty -eq $true) { throw 'Production candidate is marked dirty; refusing to deploy.' }

  Write-Step 'Create immutable dist candidate package'
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $shortCommit = $commit.Substring(0, 12)
  $releaseId = "config-maturity-$stamp-$shortCommit"
  if ($releaseId -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unexpected releaseId format.' }
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "groupguard-$releaseId"
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $archive = Join-Path $tempRoot "$releaseId.tar.gz"
  Invoke-Native 'tar' @('-C', $core, '-czf', $archive, 'dist') | Out-Null
  $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "candidate sha256: $archiveSha"

  $remoteDeployLocal = Join-Path $RepoPath 'scripts\windows\groupguard-remote-deploy.sh'
  if (-not (Test-Path -LiteralPath $remoteDeployLocal)) { throw "Remote deploy helper is missing: $remoteDeployLocal" }
  $remoteDeployUpload = Join-Path $tempRoot 'groupguard-remote-deploy.sh'
  New-LfHelperCopy $remoteDeployLocal $remoteDeployUpload

  $sshTarget = "$RemoteUser@$RemoteHost"
  $remoteArchive = "/tmp/$releaseId.tar.gz"
  $remoteHelper = "/tmp/$releaseId-deploy.sh"

  Write-Step 'SSH production preflight (read-only)'
  Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, 'true') | Out-Null

  Write-Step 'Upload candidate package and audited LF-only remote helper'
  Invoke-Native 'scp' @('-P', "$RemotePort", $archive, "${sshTarget}:$remoteArchive") | Out-Null
  Invoke-Native 'scp' @('-P', "$RemotePort", $remoteDeployUpload, "${sshTarget}:$remoteHelper") | Out-Null

  Write-Step 'Backup production, atomically switch dist, restart, and verify health'
  $remoteCommand = @(
    'sh', (Quote-Remote $remoteHelper),
    (Quote-Remote $RemoteAppDir),
    (Quote-Remote $RemoteBackupRoot),
    (Quote-Remote $RemoteContainer),
    (Quote-Remote $commit),
    (Quote-Remote $remoteArchive),
    (Quote-Remote $releaseId),
    (Quote-Remote $archiveSha)
  ) -join ' '
  try {
    Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $remoteCommand) | Out-Null
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteArchive' '$remoteHelper'") -AllowFailure | Out-Null
  }

  Write-Step 'Copy deployment manifest back to Windows'
  $localStateDir = Join-Path $env:LOCALAPPDATA 'GroupGuard\deployment-state'
  New-Item -ItemType Directory -Path $localStateDir -Force | Out-Null
  $localManifest = Join-Path $localStateDir "$releaseId.json"
  $remoteManifest = "$RemoteAppDir/deployment-state/latest-code-deploy.json"
  Invoke-Native 'scp' @('-P', "$RemotePort", "${sshTarget}:$remoteManifest", $localManifest) | Out-Null
  Copy-Item -LiteralPath $localManifest -Destination (Join-Path $localStateDir 'latest-code-deploy.json') -Force

  Write-Host "`nDeployment completed." -ForegroundColor Green
  Write-Host "commit: $commit"
  Write-Host "local manifest: $localManifest"
  Write-Host 'If business-level testing finds a problem, run ROLLBACK-GROUPGUARD.cmd.' -ForegroundColor Yellow
  exit 0
} catch {
  Write-Host "`nUpdate/deploy failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'If failure occurred after the production switch, the remote helper attempted automatic restoration. ROLLBACK-GROUPGUARD.cmd remains available for the latest recorded rollback point.' -ForegroundColor Yellow
  exit 1
}
