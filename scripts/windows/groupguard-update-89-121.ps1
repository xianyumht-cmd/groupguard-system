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

foreach ($required in @($singleHostScript, $rollbackScript)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    Write-Host "Required deployment script not found: $required" -ForegroundColor Red
    exit 1
  }
}

function Invoke-CompletedHostRollback([string[]]$Hosts) {
  $failed = @()
  for ($index = $Hosts.Count - 1; $index -ge 0; $index--) {
    $hostName = [string]$Hosts[$index]
    Write-Host "`nRolling back previously completed host $hostName to its recorded pre-deployment code..." -ForegroundColor Yellow
    $rollbackArguments = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $rollbackScript,
      '-RepoPath', $RepoPath,
      '-RemoteHost', $hostName,
      '-RemoteUser', $RemoteUser,
      '-RemotePort', [string]$RemotePort,
      '-RemoteAppDir', $RemoteAppDir,
      '-RemoteBackupRoot', $RemoteBackupRoot,
      '-RemoteContainer', $RemoteContainer
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

$completed = @()
foreach ($target in $targets) {
  Write-Host "`n============================================================" -ForegroundColor DarkGray
  Write-Host "Deploying GroupGuard to $target" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor DarkGray

  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $singleHostScript,
    '-RepoPath', $RepoPath,
    '-RemoteHost', $target,
    '-RemoteUser', $RemoteUser,
    '-RemotePort', [string]$RemotePort,
    '-RemoteAppDir', $RemoteAppDir,
    '-RemoteBackupRoot', $RemoteBackupRoot,
    '-RemoteContainer', $RemoteContainer
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
