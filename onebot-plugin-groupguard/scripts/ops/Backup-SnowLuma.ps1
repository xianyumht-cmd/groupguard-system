param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app"
)

$ErrorActionPreference = "Stop"
if (
  $HostName -notmatch "^[A-Za-z0-9.-]+$" -or
  $User -notmatch "^[A-Za-z0-9._-]+$" -or
  $RemoteAppDir -notmatch "^/[A-Za-z0-9._/-]+$" -or
  $RemoteAppDir -eq "/" -or
  $RemoteAppDir.Contains("..") -or
  -not $RemoteAppDir.StartsWith("/mnt/sda1/groupguard/", [StringComparison]::Ordinal)
) {
  throw "Unsafe SnowLuma backup target."
}

$stamp = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$archiveName = "backups/manual-$stamp.tgz"
$temporaryName = "backups/.manual-$stamp.tgz.tmp"
$target = "${User}@${HostName}"
$script = @'
set -eu
app="$1"
archive_name="$2"
temporary_name="$3"
case "$app" in
  /mnt/sda1/groupguard/*) ;;
  *) echo "unsafe remote app path" >&2; exit 20 ;;
esac
cd "$app"
test -f config/config.json
test -d config
test -d data
test -d dist
command -v sha256sum >/dev/null
command -v tar >/dev/null
mkdir -p backups
umask 077
test ! -e "$archive_name"
rm -f -- "$temporary_name"
set -- config data dist
package_present=false
if [ -f package.json ]; then
  set -- "$@" package.json
  package_present=true
fi
tar -czf "$temporary_name" -- "$@"
tar -tzf "$temporary_name" >/dev/null
tar -tzf "$temporary_name" | grep -q '^config/config.json$'
tar -tzf "$temporary_name" | grep -q '^data/'
tar -tzf "$temporary_name" | grep -q '^dist/'
chmod 600 "$temporary_name"
mv -- "$temporary_name" "$archive_name"
sha256sum "$archive_name" | awk '{print "backup_sha256=" $1}'
printf 'backup_package_json_present=%s\n' "$package_present"
'@
$normalizedScript = $script.Replace("`r`n", "`n")
$scriptBase64 = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($normalizedScript))
$command = "printf '%s' '$scriptBase64' | base64 -d | sh -s -- '$RemoteAppDir' '$archiveName' '$temporaryName'"

Write-Host "Creating verified remote backup: $RemoteAppDir/$archiveName"
& ssh $target $command
if ($LASTEXITCODE -ne 0) {
  throw "SnowLuma backup failed with exit code $LASTEXITCODE."
}
Write-Host "Backup complete: $RemoteAppDir/$archiveName (config, data, dist, and package.json when present; mode 0600)"
