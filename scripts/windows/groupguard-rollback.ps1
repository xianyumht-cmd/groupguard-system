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
    throw "缺少命令：$Name。请先安装或加入 PATH。"
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
    throw "命令失败（exit=$code）：$File $($Arguments -join ' ')"
  }
  return $code
}

function Quote-Remote([string]$Value) {
  if ($Value -match "'") { throw "远端参数不能包含单引号：$Value" }
  return "'$Value'"
}

function Assert-SafeParameters {
  if ($RemoteHost -notmatch '^[A-Za-z0-9.-]+$') { throw 'RemoteHost 格式不安全。' }
  if ($RemoteUser -notmatch '^[A-Za-z0-9._-]+$') { throw 'RemoteUser 格式不安全。' }
  if ($RemotePort -lt 1 -or $RemotePort -gt 65535) { throw 'RemotePort 必须在 1-65535。' }
  foreach ($item in @(
    @{ Name = 'RemoteAppDir'; Value = $RemoteAppDir },
    @{ Name = 'RemoteBackupRoot'; Value = $RemoteBackupRoot }
  )) {
    $value = [string]$item.Value
    if ($value -notmatch '^/mnt/sda1/groupguard/[A-Za-z0-9._/-]+$' -or $value.Contains('..') -or $value.EndsWith('/.')) {
      throw "$($item.Name) 必须是 /mnt/sda1/groupguard/ 下的安全绝对路径。"
    }
  }
  if ($RemoteAppDir.TrimEnd('/') -eq $RemoteBackupRoot.TrimEnd('/')) { throw '应用目录和备份目录不能相同。' }
  if ($RemoteContainer -notmatch '^[A-Za-z0-9_.-]+$') { throw 'RemoteContainer 格式不安全。' }
}

try {
  Write-Host 'GroupGuard 一键生产代码回滚' -ForegroundColor Yellow
  Write-Host '回滚只恢复最近一次部署前的 dist 代码，不覆盖 config.json、SQLite/data、日志或密钥。'
  Assert-SafeParameters
  foreach ($cmd in @('ssh', 'scp')) { Require-Command $cmd }

  $helper = Join-Path $RepoPath 'scripts\windows\groupguard-remote-rollback.sh'
  if (-not (Test-Path -LiteralPath $helper)) {
    throw "缺少回滚 helper：$helper。请确认本地仓库已经包含本次发布脚本。"
  }

  $sshTarget = "$RemoteUser@$RemoteHost"
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $remoteHelper = "/tmp/groupguard-rollback-$stamp.sh"

  Write-Step '连接生产主机'
  Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, 'true') | Out-Null

  Write-Step '上传受审回滚 helper'
  Invoke-Native 'scp' @('-P', "$RemotePort", $helper, "${sshTarget}:$remoteHelper") | Out-Null

  Write-Step '恢复最近一次部署前代码并检查 readiness'
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

  Write-Step '拉回回滚记录'
  $localStateDir = Join-Path $env:LOCALAPPDATA 'GroupGuard\deployment-state'
  New-Item -ItemType Directory -Path $localStateDir -Force | Out-Null
  $localRollback = Join-Path $localStateDir "rollback-$stamp.json"
  $remoteRollback = "$RemoteAppDir/deployment-state/last-code-rollback.json"
  $copyCode = Invoke-Native 'scp' @('-P', "$RemotePort", "${sshTarget}:$remoteRollback", $localRollback) -AllowFailure
  if ($copyCode -eq 0) {
    Copy-Item -LiteralPath $localRollback -Destination (Join-Path $localStateDir 'last-code-rollback.json') -Force
    Write-Host "回滚记录：$localRollback"
  } else {
    Write-Host '远端没有新的 rollback JSON（可能目标版本本来就已经处于回滚版本），但回滚 helper 已成功退出。' -ForegroundColor Yellow
  }

  Write-Host "`n回滚完成，readiness 已通过。" -ForegroundColor Green
  exit 0
} catch {
  Write-Host "`n回滚失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '回滚 helper 会在回滚版本健康失败时尝试恢复回滚前 preimage，避免把服务停在更差状态。' -ForegroundColor Yellow
  exit 1
}
