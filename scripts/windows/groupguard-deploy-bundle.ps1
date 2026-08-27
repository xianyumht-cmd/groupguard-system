# ASCII-only on purpose: Windows PowerShell 5.1 does not reliably parse UTF-8 without BOM.
[CmdletBinding()]
param(
  [string]$PackageDir = '',
  [string[]]$RemoteHosts = @('192.168.3.89', '192.168.3.121'),
  [string]$RemoteUser = 'root',
  [int]$RemotePort = 22,
  [string]$RemoteAppDir = '/mnt/sda1/groupguard/app',
  [string]$RemoteBackupRoot = '/mnt/sda1/groupguard/backups',
  [string]$RemoteContainer = 'groupguard-snowluma',
  [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$completedHosts = New-Object System.Collections.Generic.List[string]
$hostProfiles = @{}
$rollbackHelperUpload = ''
$topologyHelperUpload = ''
$deploymentStarted = $false

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

function Invoke-NativeCapture([string]$File, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $File @Arguments)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  foreach ($line in $output) {
    Write-Host ([string]$line)
  }
  if ($code -ne 0) {
    throw "Command failed (exit=$code): $File $($Arguments -join ' ')"
  }
  return ,$output
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
  if ($bytes -contains 13) { throw "LF normalization failed for remote helper: $Source" }
}

function Assert-SafePathValue([string]$Name, [string]$Value) {
  if ($Value -notmatch '^/mnt/sda1/groupguard/[A-Za-z0-9._/-]+$' -or $Value.Contains('..') -or $Value.EndsWith('/.')) {
    throw "$Name must be a safe absolute path below /mnt/sda1/groupguard/."
  }
}

function Assert-SafeParameters {
  if ($RemoteUser -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unsafe RemoteUser value.' }
  if ($RemotePort -lt 1 -or $RemotePort -gt 65535) { throw 'RemotePort must be between 1 and 65535.' }
  if ($RemoteContainer -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Unsafe RemoteContainer value.' }
  Assert-SafePathValue 'RemoteAppDir' $RemoteAppDir
  Assert-SafePathValue 'RemoteBackupRoot' $RemoteBackupRoot
  if ($RemoteAppDir.TrimEnd('/') -eq $RemoteBackupRoot.TrimEnd('/')) { throw 'Application and backup directories must be different.' }
  if (-not $RemoteHosts -or $RemoteHosts.Count -lt 1) { throw 'At least one RemoteHost is required.' }
  foreach ($hostName in $RemoteHosts) {
    if ([string]$hostName -notmatch '^[A-Za-z0-9.-]+$') { throw "Unsafe RemoteHost value: $hostName" }
  }
}

function Get-TopologyValue([object[]]$Lines, [string]$Key) {
  $prefix = "$Key="
  $value = ''
  foreach ($item in $Lines) {
    $line = [string]$item
    if ($line.StartsWith($prefix)) {
      $value = $line.Substring($prefix.Length)
    }
  }
  return $value
}

function Resolve-HostTopology([string]$HostName) {
  if (-not $topologyHelperUpload -or -not (Test-Path -LiteralPath $topologyHelperUpload -PathType Leaf)) {
    throw 'Bundle topology helper transport copy is unavailable.'
  }
  $sshTarget = "$RemoteUser@$HostName"
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $remoteTopologyHelper = "/tmp/groupguard-bundle-topology-$stamp.sh"

  Write-Host "Topology preflight: $sshTarget"
  Invoke-Native 'scp' @('-P', "$RemotePort", $topologyHelperUpload, "${sshTarget}:$remoteTopologyHelper") | Out-Null
  $topologyCommand = @(
    'sh', (Quote-Remote $remoteTopologyHelper),
    (Quote-Remote $RemoteAppDir),
    (Quote-Remote $RemoteBackupRoot),
    (Quote-Remote $RemoteContainer)
  ) -join ' '
  try {
    $output = @(Invoke-NativeCapture 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $topologyCommand))
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteTopologyHelper'") -AllowFailure | Out-Null
  }

  if ((Get-TopologyValue $output 'TOPOLOGY_OK') -ne 'true') {
    throw "Topology helper did not confirm the target on $HostName."
  }
  $appDir = Get-TopologyValue $output 'TOPOLOGY_APP_DIR'
  $backupRoot = Get-TopologyValue $output 'TOPOLOGY_BACKUP_ROOT'
  $container = Get-TopologyValue $output 'TOPOLOGY_CONTAINER'
  $appSource = Get-TopologyValue $output 'TOPOLOGY_APP_SOURCE'
  $containerSource = Get-TopologyValue $output 'TOPOLOGY_CONTAINER_SOURCE'

  Assert-SafePathValue 'Resolved app directory' $appDir
  Assert-SafePathValue 'Resolved backup root' $backupRoot
  if ($appDir.TrimEnd('/') -eq $backupRoot.TrimEnd('/')) { throw "Resolved roots overlap on $HostName." }
  if ($container -notmatch '^[A-Za-z0-9_.-]+$') { throw "Resolved container is unsafe on ${HostName}: $container" }

  Write-Host "Topology verified on ${HostName}: app=$appDir backup=$backupRoot container=$container appSource=$appSource containerSource=$containerSource" -ForegroundColor Green
  return [PSCustomObject]@{
    HostName = $HostName
    AppDir = $appDir
    BackupRoot = $backupRoot
    Container = $container
  }
}

function Invoke-HostRollback([string]$HostName) {
  if (-not $rollbackHelperUpload -or -not (Test-Path -LiteralPath $rollbackHelperUpload -PathType Leaf)) {
    throw 'Bundle rollback helper transport copy is unavailable.'
  }
  if (-not $hostProfiles.ContainsKey($HostName)) {
    throw "No verified topology profile is available for rollback on $HostName."
  }
  $profile = $hostProfiles[$HostName]
  $sshTarget = "$RemoteUser@$HostName"
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $remoteRollbackHelper = "/tmp/groupguard-bundle-rollback-$stamp.sh"
  Invoke-Native 'scp' @('-P', "$RemotePort", $rollbackHelperUpload, "${sshTarget}:$remoteRollbackHelper") | Out-Null
  $rollbackCommand = @(
    'sh', (Quote-Remote $remoteRollbackHelper),
    (Quote-Remote ([string]$profile.AppDir)),
    (Quote-Remote ([string]$profile.BackupRoot)),
    (Quote-Remote ([string]$profile.Container))
  ) -join ' '
  try {
    Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $rollbackCommand) | Out-Null
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteRollbackHelper'") -AllowFailure | Out-Null
  }
}

try {
  Write-Host 'GroupGuard immutable deployment bundle' -ForegroundColor Green
  Write-Host 'Deploys only the prebuilt dist. Runtime config, SQLite/data, logs, credentials and secrets are preserved.'
  Write-Host 'Fleet rule: both hosts finish on the new commit, or already-completed hosts are rolled back.'

  $resolvedPackageDir = ([string]$PackageDir).Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($resolvedPackageDir)) {
    $resolvedPackageDir = ([string]$PSScriptRoot).Trim().Trim('"')
  }
  if ([string]::IsNullOrWhiteSpace($resolvedPackageDir)) {
    throw 'Package directory could not be resolved from PackageDir or PSScriptRoot.'
  }
  $PackageDir = [IO.Path]::GetFullPath($resolvedPackageDir)
  Write-Host "Package root: $PackageDir"

  $manifestPath = Join-Path $PackageDir 'manifest.json'
  $archivePath = Join-Path $PackageDir 'groupguard-dist.tar.gz'
  $helperPath = Join-Path $PackageDir 'groupguard-remote-deploy.sh'
  $rollbackHelperPath = Join-Path $PackageDir 'groupguard-remote-rollback.sh'
  $topologyHelperPath = Join-Path $PackageDir 'groupguard-remote-topology.sh'
  foreach ($required in @($manifestPath, $archivePath, $helperPath, $rollbackHelperPath, $topologyHelperPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Deployment bundle file is missing: $required" }
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $commit = [string]$manifest.commit_sha
  $releaseId = [string]$manifest.release_id
  $expectedSha = ([string]$manifest.archive_sha256).ToLowerInvariant()
  if ($commit -notmatch '^[0-9a-fA-F]{40}$') { throw "Invalid manifest commit_sha: $commit" }
  if ($releaseId -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid manifest release_id: $releaseId" }
  if ($expectedSha -notmatch '^[0-9a-f]{64}$') { throw "Invalid manifest archive_sha256: $expectedSha" }

  $actualSha = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha -ne $expectedSha) { throw "Deployment bundle hash mismatch: expected=$expectedSha actual=$actualSha" }
  Write-Host "Bundle commit: $commit" -ForegroundColor Green
  Write-Host "Bundle sha256: $actualSha" -ForegroundColor Green

  if ($PreflightOnly) {
    Write-Host 'Bundle preflight completed successfully.' -ForegroundColor Green
    exit 0
  }

  Assert-SafeParameters
  foreach ($cmd in @('ssh', 'scp')) { Require-Command $cmd }

  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "groupguard-bundle-$releaseId"
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $helperUpload = Join-Path $tempRoot 'groupguard-remote-deploy.sh'
  $rollbackHelperUpload = Join-Path $tempRoot 'groupguard-remote-rollback.sh'
  $topologyHelperUpload = Join-Path $tempRoot 'groupguard-remote-topology.sh'
  New-LfHelperCopy $helperPath $helperUpload
  New-LfHelperCopy $rollbackHelperPath $rollbackHelperUpload
  New-LfHelperCopy $topologyHelperPath $topologyHelperUpload

  Write-Step 'Fleet topology preflight (read-only)'
  foreach ($hostName in $RemoteHosts) {
    $profile = Resolve-HostTopology $hostName
    $hostProfiles[$hostName] = $profile
  }
  Write-Host 'Fleet topology preflight completed on all hosts. No production code has been switched yet.' -ForegroundColor Green

  $deploymentStarted = $true
  foreach ($hostName in $RemoteHosts) {
    $profile = $hostProfiles[$hostName]
    $resolvedAppDir = [string]$profile.AppDir
    $resolvedBackupRoot = [string]$profile.BackupRoot
    $resolvedContainer = [string]$profile.Container

    Write-Step "Deploy $hostName"
    $sshTarget = "$RemoteUser@$hostName"
    $remoteArchive = "/tmp/$releaseId.tar.gz"
    $remoteHelper = "/tmp/$releaseId-deploy.sh"

    Write-Host "Using verified topology: app=$resolvedAppDir backup=$resolvedBackupRoot container=$resolvedContainer"
    Write-Host 'Upload immutable candidate and LF-only remote helper'
    Invoke-Native 'scp' @('-P', "$RemotePort", $archivePath, "${sshTarget}:$remoteArchive") | Out-Null
    Invoke-Native 'scp' @('-P', "$RemotePort", $helperUpload, "${sshTarget}:$remoteHelper") | Out-Null

    $remoteCommand = @(
      'sh', (Quote-Remote $remoteHelper),
      (Quote-Remote $resolvedAppDir),
      (Quote-Remote $resolvedBackupRoot),
      (Quote-Remote $resolvedContainer),
      (Quote-Remote $commit),
      (Quote-Remote $remoteArchive),
      (Quote-Remote $releaseId),
      (Quote-Remote $expectedSha)
    ) -join ' '

    try {
      Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $remoteCommand) | Out-Null
    } finally {
      Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteArchive' '$remoteHelper'") -AllowFailure | Out-Null
    }

    $stateBase = [string]$env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($stateBase)) {
      $stateBase = [IO.Path]::GetTempPath()
    }
    $stateRoot = Join-Path $stateBase 'GroupGuard\deployment-state'
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    $safeHost = $hostName.Replace('.', '-')
    $localManifest = Join-Path $stateRoot "$safeHost-$releaseId.json"
    $remoteManifest = "$resolvedAppDir/deployment-state/latest-code-deploy.json"
    Invoke-Native 'scp' @('-P', "$RemotePort", "${sshTarget}:$remoteManifest", $localManifest) | Out-Null
    $completedHosts.Add([string]$hostName) | Out-Null
    Write-Host "Deployment verified on $hostName" -ForegroundColor Green
  }

  Write-Host "`nDeployment completed on all hosts: $($completedHosts -join ', ')" -ForegroundColor Green
  exit 0
} catch {
  $failureMessage = $_.Exception.Message
  Write-Host "`nDeployment bundle failed: $failureMessage" -ForegroundColor Red
  if (-not $deploymentStarted) {
    Write-Host 'Fleet topology preflight did not complete. No host code switch was attempted.' -ForegroundColor Yellow
  } else {
    Write-Host 'The currently failing host uses the deploy helper automatic restoration path after a failed post-switch health check.' -ForegroundColor Yellow
  }
  $rollbackFailures = New-Object System.Collections.Generic.List[string]
  if ($completedHosts.Count -gt 0) {
    Write-Host "Reconciling previously completed hosts: $($completedHosts -join ', ')" -ForegroundColor Yellow
    for ($index = $completedHosts.Count - 1; $index -ge 0; $index--) {
      $completedHost = [string]$completedHosts[$index]
      try {
        Invoke-HostRollback $completedHost
        Write-Host "Fleet reconciliation rollback verified on $completedHost" -ForegroundColor Green
      } catch {
        Write-Host "Fleet reconciliation rollback FAILED on ${completedHost}: $($_.Exception.Message)" -ForegroundColor Red
        $rollbackFailures.Add($completedHost) | Out-Null
      }
    }
  }
  if ($rollbackFailures.Count -gt 0) {
    Write-Host "Fleet reconciliation is incomplete. Manual attention required on: $($rollbackFailures -join ', ')" -ForegroundColor Red
    exit 90
  }
  if ($completedHosts.Count -gt 0) {
    Write-Host 'Fleet reconciliation completed: earlier hosts were returned to their recorded pre-deployment code.' -ForegroundColor Green
  }
  exit 1
}
