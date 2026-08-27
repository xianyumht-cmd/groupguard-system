# ASCII-only on purpose: Windows PowerShell 5.1 does not reliably parse UTF-8 without BOM.
[CmdletBinding()]
param(
  [string]$RepoPath = 'D:\project2\groupguard-system',
  [string]$RemoteUser = 'root',
  [int]$RemotePort = 22,
  [string]$RemoteAppDir = '/mnt/sda1/groupguard/app',
  [string]$RemoteBackupRoot = '/mnt/sda1/groupguard/backups',
  [string]$RemoteContainer = 'groupguard-snowluma'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$targets = @('192.168.3.89', '192.168.3.121')
$singleHostScript = Join-Path $RepoPath 'scripts\windows\groupguard-update.ps1'
$rollbackScript = Join-Path $RepoPath 'scripts\windows\groupguard-rollback.ps1'
$topologyScript = Join-Path $RepoPath 'scripts\windows\groupguard-remote-topology.sh'
$hostProfiles = @{}

foreach ($required in @($singleHostScript, $rollbackScript, $topologyScript)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    Write-Host "Required deployment script not found: $required" -ForegroundColor Red
    exit 1
  }
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
  foreach ($line in $output) { Write-Host ([string]$line) }
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

function Get-TopologyValue([object[]]$Lines, [string]$Key) {
  $prefix = "$Key="
  $value = ''
  foreach ($item in $Lines) {
    $line = [string]$item
    if ($line.StartsWith($prefix)) { $value = $line.Substring($prefix.Length) }
  }
  return $value
}

function Resolve-HostTopology([string]$HostName, [string]$TopologyHelperUpload) {
  $sshTarget = "$RemoteUser@$HostName"
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $remoteTopologyHelper = "/tmp/groupguard-repo-topology-$stamp.sh"
  Write-Host "Topology preflight: $sshTarget"
  Invoke-Native 'scp' @('-P', "$RemotePort", $TopologyHelperUpload, "${sshTarget}:$remoteTopologyHelper") | Out-Null
  $remoteCommand = @(
    'sh', (Quote-Remote $remoteTopologyHelper),
    (Quote-Remote $RemoteAppDir),
    (Quote-Remote $RemoteBackupRoot),
    (Quote-Remote $RemoteContainer)
  ) -join ' '
  try {
    $output = @(Invoke-NativeCapture 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $remoteCommand))
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteTopologyHelper'") -AllowFailure | Out-Null
  }

  if ((Get-TopologyValue $output 'TOPOLOGY_OK') -ne 'true') { throw "Topology helper did not confirm the target on $HostName." }
  $appDir = Get-TopologyValue $output 'TOPOLOGY_APP_DIR'
  $backupRoot = Get-TopologyValue $output 'TOPOLOGY_BACKUP_ROOT'
  $container = Get-TopologyValue $output 'TOPOLOGY_CONTAINER'
  Assert-SafePathValue 'Resolved app directory' $appDir
  Assert-SafePathValue 'Resolved backup root' $backupRoot
  if ($appDir.TrimEnd('/') -eq $backupRoot.TrimEnd('/')) { throw "Resolved roots overlap on $HostName." }
  if ($container -notmatch '^[A-Za-z0-9_.-]+$') { throw "Resolved container is unsafe on ${HostName}: $container" }
  Write-Host "Topology verified on ${HostName}: app=$appDir backup=$backupRoot container=$container" -ForegroundColor Green
  return [PSCustomObject]@{ HostName = $HostName; AppDir = $appDir; BackupRoot = $backupRoot; Container = $container }
}

function Invoke-CompletedHostRollback([string[]]$Hosts) {
  $failed = @()
  for ($index = $Hosts.Count - 1; $index -ge 0; $index--) {
    $hostName = [string]$Hosts[$index]
    if (-not $hostProfiles.ContainsKey($hostName)) {
      Write-Host "No verified topology profile exists for rollback on $hostName." -ForegroundColor Red
      $failed += $hostName
      continue
    }
    $profile = $hostProfiles[$hostName]
    Write-Host "`nRolling back previously completed host $hostName to its recorded pre-deployment code..." -ForegroundColor Yellow
    $rollbackArguments = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $rollbackScript,
      '-RepoPath', $RepoPath,
      '-RemoteHost', $hostName,
      '-RemoteUser', $RemoteUser,
      '-RemotePort', [string]$RemotePort,
      '-RemoteAppDir', [string]$profile.AppDir,
      '-RemoteBackupRoot', [string]$profile.BackupRoot,
      '-RemoteContainer', [string]$profile.Container
    )
    & powershell.exe @rollbackArguments
    $rollbackCode = $LASTEXITCODE
    if ($rollbackCode -ne 0) {
      Write-Host "Fleet reconciliation rollback FAILED on $hostName (exit=$rollbackCode)." -ForegroundColor Red
      $failed += $hostName
    } else {
      Write-Host "Fleet reconciliation rollback verified on $hostName." -ForegroundColor Green
    }
  }
  return ,$failed
}

Write-Host 'GroupGuard one-click dual-host production deployment' -ForegroundColor Green
Write-Host 'Targets: 192.168.3.89, 192.168.3.121'
Write-Host 'Fleet rule: both hosts finish on the new commit, or already-completed hosts are rolled back.'

try {
  if ($RemoteUser -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unsafe RemoteUser value.' }
  if ($RemotePort -lt 1 -or $RemotePort -gt 65535) { throw 'RemotePort must be between 1 and 65535.' }
  if ($RemoteContainer -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Unsafe RemoteContainer value.' }
  Assert-SafePathValue 'RemoteAppDir' $RemoteAppDir
  Assert-SafePathValue 'RemoteBackupRoot' $RemoteBackupRoot
  foreach ($cmd in @('ssh', 'scp')) { Require-Command $cmd }

  $topologyTemp = Join-Path ([IO.Path]::GetTempPath()) ("groupguard-topology-{0}.sh" -f [Guid]::NewGuid().ToString('N'))
  try {
    New-LfHelperCopy $topologyScript $topologyTemp
    Write-Host "`nPreflighting both host topologies before any code deployment..." -ForegroundColor Cyan
    foreach ($target in $targets) {
      $hostProfiles[$target] = Resolve-HostTopology $target $topologyTemp
    }
  } finally {
    Remove-Item -LiteralPath $topologyTemp -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Fleet topology preflight completed. No production code has been switched yet.' -ForegroundColor Green
} catch {
  Write-Host "`nFleet topology preflight failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'No host code deployment was started.' -ForegroundColor Yellow
  exit 1
}

$completed = @()
foreach ($target in $targets) {
  $profile = $hostProfiles[$target]
  Write-Host "`n============================================================" -ForegroundColor DarkGray
  Write-Host "Deploying GroupGuard to $target" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor DarkGray
  Write-Host "Using verified topology: app=$($profile.AppDir) backup=$($profile.BackupRoot) container=$($profile.Container)"

  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $singleHostScript,
    '-RepoPath', $RepoPath,
    '-RemoteHost', $target,
    '-RemoteUser', $RemoteUser,
    '-RemotePort', [string]$RemotePort,
    '-RemoteAppDir', [string]$profile.AppDir,
    '-RemoteBackupRoot', [string]$profile.BackupRoot,
    '-RemoteContainer', [string]$profile.Container
  )

  & powershell.exe @arguments
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host "`nDeployment failed on $target (exit=$code)." -ForegroundColor Red
    Write-Host 'The failing host uses the single-host automatic restoration path if its code switch had already happened.' -ForegroundColor Yellow
    if ($completed.Count -gt 0) {
      Write-Host "Reconciling already-completed hosts back to their recorded pre-deployment code: $($completed -join ', ')" -ForegroundColor Yellow
      $rollbackFailures = @(Invoke-CompletedHostRollback $completed)
      if ($rollbackFailures.Count -gt 0) {
        Write-Host "Fleet reconciliation is incomplete. Manual attention required on: $($rollbackFailures -join ', ')" -ForegroundColor Red
        exit 90
      }
      Write-Host 'Fleet reconciliation completed: no earlier host is intentionally left on the failed release.' -ForegroundColor Green
    }
    exit $code
  }
  $completed += $target
  Write-Host "Deployment verified on $target." -ForegroundColor Green
}

Write-Host "`nDual-host deployment completed and verified on: $($completed -join ', ')" -ForegroundColor Green
exit 0
