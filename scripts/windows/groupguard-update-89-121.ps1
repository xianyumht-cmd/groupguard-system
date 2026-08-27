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

if (-not (Test-Path -LiteralPath $singleHostScript -PathType Leaf)) {
  Write-Host "Single-host deploy script not found: $singleHostScript" -ForegroundColor Red
  exit 1
}

Write-Host 'GroupGuard one-click dual-host production deployment' -ForegroundColor Green
Write-Host 'Targets: 192.168.3.89, 192.168.3.121'
Write-Host 'Each host uses the existing backup-first, code-only deploy and automatic rollback checks.'

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
    if ($completed.Count -gt 0) {
      Write-Host "Already completed successfully: $($completed -join ', ')" -ForegroundColor Yellow
      Write-Host 'The failed host uses the single-host deploy script automatic restoration path if the switch had already happened.' -ForegroundColor Yellow
    }
    exit $code
  }
  $completed += $target
  Write-Host "Deployment verified on $target." -ForegroundColor Green
}

Write-Host "`nDual-host deployment completed and verified on: $($completed -join ', ')" -ForegroundColor Green
exit 0
