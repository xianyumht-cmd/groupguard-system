param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = "$RemoteAppDir/backups/manual-$stamp.tgz"
$target = "${User}@${HostName}"

Write-Host "Creating remote backup: $archive"
ssh $target "set -e; cd '$RemoteAppDir'; mkdir -p backups; tar -czf '$archive' config data dist package.json 2>/dev/null || tar -czf '$archive' dist"
Write-Host "Backup complete: $archive"
