param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$RemoteAppDir = "/mnt/sda1/groupguard/app",
  [string]$ContainerName = "groupguard-snowluma",
  [Parameter(Mandatory = $true)][string]$SourceGroupId,
  [Parameter(Mandatory = $true)][string]$TargetGroupId,
  [string]$SourceUploaderId = "",
  [string]$FileNamePattern = "\.7z$",
  [ValidateRange(1, 4096)][int]$MaxFileSizeMb = 512,
  [switch]$Enable,
  [switch]$RestartContainer
)

$ErrorActionPreference = "Stop"

function Assert-SafeInput {
  if ($HostName -notmatch "^[A-Za-z0-9.-]+$" -or $User -notmatch "^[A-Za-z0-9._-]+$") {
    throw "SSH target contains unsafe characters."
  }
  if (
    $RemoteAppDir -notmatch "^/[A-Za-z0-9._/-]+$" -or
    $RemoteAppDir -eq "/" -or
    $RemoteAppDir.Contains("..") -or
    -not $RemoteAppDir.StartsWith("/mnt/sda1/groupguard/", [StringComparison]::Ordinal)
  ) {
    throw "RemoteAppDir must be a safe path below /mnt/sda1/groupguard/."
  }
  if ($ContainerName -notmatch "^[A-Za-z0-9_.-]+$") {
    throw "ContainerName contains unsafe characters."
  }
  if ($SourceGroupId -notmatch "^\d+$" -or $TargetGroupId -notmatch "^\d+$") {
    throw "SourceGroupId and TargetGroupId must be numeric QQ group IDs."
  }
  if ($SourceGroupId -eq $TargetGroupId) {
    throw "SourceGroupId and TargetGroupId must be different."
  }
  if ($SourceUploaderId -and $SourceUploaderId -notmatch "^\d+$") {
    throw "SourceUploaderId must be a numeric QQ ID or empty."
  }
  try {
    [void][regex]::new($FileNamePattern)
  } catch {
    throw "FileNamePattern is not a valid regular expression: $($_.Exception.Message)"
  }
}

function ConvertTo-Base64Utf8 {
  param([Parameter(Mandatory = $true)][string]$Text)
  $normalized = $Text.Replace("`r`n", "`n")
  return [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($normalized))
}

function Quote-RemoteArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -notmatch "^[A-Za-z0-9_./:=+-]+$") {
    throw "Unsafe remote command argument: $Value"
  }
  return "'$Value'"
}

Assert-SafeInput

$uploaderIds = @()
if ($SourceUploaderId) { $uploaderIds = @($SourceUploaderId) }

$config = [ordered]@{
  enabled = [bool]$Enable
  rules = @(
    [ordered]@{
      id = "mirror-$SourceGroupId-to-$TargetGroupId"
      enabled = $true
      sourceGroupId = $SourceGroupId
      targetGroupId = $TargetGroupId
      sourceUploaderIds = $uploaderIds
      fileNamePattern = $FileNamePattern
      maxFileSizeMb = $MaxFileSizeMb
      targetFolderId = "/"
      keepLatestOnly = $true
      deletePreviousTargetFile = $true
      recallPreviousTargetMessage = $true
      syncSourceRecall = $true
      retryCount = 2
      retryDelayMs = 1500
      messageLookupAttempts = 6
      messageLookupDelayMs = 1000
    }
  )
}

$json = ($config | ConvertTo-Json -Depth 8)
$configBase64 = ConvertTo-Base64Utf8 -Text ($json + [Environment]::NewLine)
$target = "${User}@${HostName}"
$restartFlag = if ($RestartContainer) { "1" } else { "0" }

$remoteScript = @'
set -eu
app="$1"
container="$2"
config_b64="$3"
restart="$4"
case "$app" in
  /mnt/sda1/groupguard/*) ;;
  *) echo "unsafe remote app path" >&2; exit 20 ;;
esac
case "$container" in
  *[!A-Za-z0-9_.-]*|'') echo "unsafe container name" >&2; exit 21 ;;
esac
command -v base64 >/dev/null
command -v jq >/dev/null
mkdir -p "$app/config" "$app/backups"
file="$app/config/group-file-mirror.json"
tmp="$app/config/.group-file-mirror.json.tmp.$$"
stamp="$(date +%Y%m%d-%H%M%S)"
umask 077
printf '%s' "$config_b64" | base64 -d > "$tmp"
jq -e '(.enabled | type == "boolean") and (.rules | type == "array") and (.rules | length >= 1)' "$tmp" >/dev/null
if [ -f "$file" ]; then
  cp -a -- "$file" "$app/backups/group-file-mirror.json.pre-$stamp"
  chmod 600 "$app/backups/group-file-mirror.json.pre-$stamp"
fi
chmod 600 "$tmp"
mv -- "$tmp" "$file"
printf 'config_path=%s\n' "$file"
printf 'enabled=%s\n' "$(jq -r '.enabled' "$file")"
printf 'source_group=%s\n' "$(jq -r '.rules[0].sourceGroupId' "$file")"
printf 'target_group=%s\n' "$(jq -r '.rules[0].targetGroupId' "$file")"
printf 'uploader_filter=%s\n' "$(jq -r '.rules[0].sourceUploaderIds | join(",")' "$file")"
printf 'file_pattern=%s\n' "$(jq -r '.rules[0].fileNamePattern' "$file")"
if [ "$restart" = "1" ]; then
  command -v docker >/dev/null
  docker inspect --type container "$container" >/dev/null
  docker restart "$container" >/dev/null
  printf 'container_restarted=%s\n' "$container"
else
  printf 'container_restart=skipped (the service reloads this config on the next event)\n'
fi
'@

$scriptBase64 = ConvertTo-Base64Utf8 -Text $remoteScript
$quotedApp = Quote-RemoteArgument -Value $RemoteAppDir
$quotedContainer = Quote-RemoteArgument -Value $ContainerName
$quotedRestart = Quote-RemoteArgument -Value $restartFlag
$command = "printf '%s' '$scriptBase64' | base64 -d | sh -s -- $quotedApp $quotedContainer '$configBase64' $quotedRestart"

Write-Host "Writing verified group-file mirror config to $target..."
& ssh $target $command
if ($LASTEXITCODE -ne 0) {
  throw "Remote group-file mirror configuration failed with exit code $LASTEXITCODE."
}

if ($Enable) {
  Write-Host "Group-file mirror is ENABLED. Wait for the next matching source upload and inspect GroupGuard logs."
} else {
  Write-Host "Configuration was saved with the total switch DISABLED. Re-run with -Enable after checking the group IDs."
}
