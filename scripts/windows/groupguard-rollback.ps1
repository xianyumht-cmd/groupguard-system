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

function Quote-Remote([string]$Value) {
  if ($Value -match "'") { throw "Remote argument must not contain a single quote: $Value" }
  return "'$Value'"
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

try {
  Write-Host 'GroupGuard one-click production code rollback' -ForegroundColor Yellow
  Write-Host 'Rollback restores only the recorded pre-deployment dist. config.json, SQLite/data, logs, credentials and secrets are preserved.'
  Assert-SafeParameters
  foreach ($cmd in @('ssh', 'scp')) { Require-Command $cmd }

  $helper = Join-Path $RepoPath 'scripts\windows\groupguard-remote-rollback.sh'
  if (-not (Test-Path -LiteralPath $helper)) {
    throw "Rollback helper is missing: $helper. Update the local GroupGuard repository first."
  }

  $sshTarget = "$RemoteUser@$RemoteHost"
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $remoteHelper = "/tmp/groupguard-rollback-$stamp.sh"

  Write-Step 'Connect to production host'
  Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, 'true') | Out-Null

  Write-Step 'Upload audited rollback helper'
  Invoke-Native 'scp' @('-P', "$RemotePort", $helper, "${sshTarget}:$remoteHelper") | Out-Null

  Write-Step 'Restore recorded pre-deployment code and verify health'
  $remoteCommand = @(
    'sh', (Quote-Remote $remoteHelper),
    (Quote-Remote $RemoteAppDir),
    (Quote-Remote $RemoteBackupRoot),
    (Quote-Remote $RemoteContainer)
  ) -join ' '
  try {
    Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $remoteCommand) | Out-Null
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteHelper'") -AllowFailure | Out-Null
  }

  Write-Step 'Copy rollback record back to Windows'
  $localStateDir = Join-Path $env:LOCALAPPDATA 'GroupGuard\deployment-state'
  New-Item -ItemType Directory -Path $localStateDir -Force | Out-Null
  $localRollback = Join-Path $localStateDir "rollback-$stamp.json"
  $remoteRollback = "$RemoteAppDir/deployment-state/last-code-rollback.json"
  $copyCode = Invoke-Native 'scp' @('-P', "$RemotePort", "${sshTarget}:$remoteRollback", $localRollback) -AllowFailure
  if ($copyCode -eq 0) {
    Copy-Item -LiteralPath $localRollback -Destination (Join-Path $localStateDir 'last-code-rollback.json') -Force
    Write-Host "rollback record: $localRollback"
  } else {
    Write-Host 'No new rollback JSON was available, but the remote rollback helper completed successfully.' -ForegroundColor Yellow
  }

  Write-Host "`nRollback completed and health verification passed." -ForegroundColor Green
  exit 0
} catch {
  Write-Host "`nRollback failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'If the rollback target failed health verification, the remote helper attempted to restore the pre-rollback code image.' -ForegroundColor Yellow
  exit 1
}
