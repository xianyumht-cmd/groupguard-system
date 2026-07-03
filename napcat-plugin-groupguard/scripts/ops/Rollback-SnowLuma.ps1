param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app",
  [string]$ContainerName = "groupguard-snowluma",
  [string]$BackupName = ""
)

$ErrorActionPreference = "Stop"
$target = "${User}@${HostName}"

if ([string]::IsNullOrWhiteSpace($BackupName)) {
  $BackupName = (ssh $target "cd '$RemoteAppDir'; ls -1dt dist.backup-* 2>/dev/null | head -n 1").Trim()
}

if ([string]::IsNullOrWhiteSpace($BackupName)) {
  throw "No dist.backup-* directory found on remote."
}

Write-Host "Rolling back to $BackupName"
ssh $target "set -e; cd '$RemoteAppDir'; test -d '$BackupName'; rm -rf dist.failed-rollback; if [ -d dist ]; then mv dist dist.failed-rollback; fi; cp -a '$BackupName' dist; docker restart '$ContainerName'; docker ps --filter name='$ContainerName'"
Write-Host "Rollback complete: $BackupName"
