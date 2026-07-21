param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app",
  [string]$ContainerName = "groupguard-snowluma",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$target = "${User}@${HostName}"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Push-Location $RepoRoot
try {
  if (-not $SkipBuild) {
    Write-Host "Building SnowLuma dist..."
    npm run build:snowluma
  }

  Write-Host "Preparing remote backup and upload directory..."
  ssh $target "set -e; cd '$RemoteAppDir'; rm -rf dist.uploading; mkdir -p backups; if [ -d dist ]; then cp -a dist dist.backup-$stamp; fi"

  Write-Host "Uploading dist..."
  scp -r (Join-Path $RepoRoot "dist") "${target}:$RemoteAppDir/dist.uploading"

  Write-Host "Switching dist and restarting container..."
  ssh $target "set -e; cd '$RemoteAppDir'; rm -rf dist.previous; if [ -d dist ]; then mv dist dist.previous; fi; mv dist.uploading dist; docker restart '$ContainerName'; docker ps --filter name='$ContainerName'"
  Write-Host "Deploy complete. Previous dist: $RemoteAppDir/dist.previous, timestamp backup: dist.backup-$stamp"
}
finally {
  Pop-Location
}
