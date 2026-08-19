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

function Get-NativeOutput([string]$File, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $File @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0) {
    throw "命令失败（exit=$code）：$File $($Arguments -join ' ')`n$($out -join "`n")"
  }
  return (($out | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Quote-Remote([string]$Value) {
  if ($Value -match "'") { throw "远端参数不能包含单引号：$Value" }
  return "'$Value'"
}

try {
  Write-Host 'GroupGuard 一键更新 / 生产代码部署' -ForegroundColor Green
  Write-Host '只发布构建后的 dist；不会覆盖 config.json、SQLite/data、日志或密钥。'

  foreach ($cmd in @('git', 'npm', 'ssh', 'scp', 'tar')) { Require-Command $cmd }
  if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw "本地仓库不存在：$RepoPath" }
  if (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) { throw "不是 Git 仓库：$RepoPath" }

  Write-Step '检查本地仓库是否干净'
  $dirty = Get-NativeOutput 'git' @('-C', $RepoPath, 'status', '--porcelain')
  if ($dirty) {
    Write-Host $dirty -ForegroundColor Yellow
    throw '本地仓库存在未提交修改。为避免覆盖你的文件，脚本已停止；请先提交、备份或手工处理这些修改。'
  }

  Write-Step '更新本地 main（仅允许 fast-forward）'
  Invoke-Native 'git' @('-C', $RepoPath, 'fetch', '--prune', 'origin') | Out-Null
  Invoke-Native 'git' @('-C', $RepoPath, 'switch', 'main') | Out-Null
  Invoke-Native 'git' @('-C', $RepoPath, 'pull', '--ff-only', 'origin', 'main') | Out-Null
  $commit = Get-NativeOutput 'git' @('-C', $RepoPath, 'rev-parse', 'HEAD')
  $originMain = Get-NativeOutput 'git' @('-C', $RepoPath, 'rev-parse', 'origin/main')
  if ($commit -ne $originMain) { throw "本地 main 与 origin/main 不一致：local=$commit origin=$originMain" }
  Write-Host "准备发布 commit：$commit" -ForegroundColor Green

  $core = Join-Path $RepoPath 'onebot-plugin-groupguard'
  if (-not (Test-Path -LiteralPath (Join-Path $core 'package-lock.json'))) { throw '核心目录缺少 package-lock.json，无法 npm ci。' }

  Write-Step '安装锁定依赖'
  Invoke-Native 'npm' @('--prefix', $core, 'ci') | Out-Null

  Write-Step '运行完整自动化测试（本轮不拆阶段让你手工测试）'
  Invoke-Native 'npm' @('--prefix', $core, 'test') | Out-Null

  Write-Step '构建 SnowLuma 生产候选'
  $oldCommitEnv = $env:GROUPGUARD_COMMIT_SHA
  $oldBuildTimeEnv = $env:GROUPGUARD_BUILD_TIME_UTC
  try {
    $env:GROUPGUARD_COMMIT_SHA = $commit
    $env:GROUPGUARD_BUILD_TIME_UTC = [DateTime]::UtcNow.ToString('o')
    Invoke-Native 'npm' @('--prefix', $core, 'run', 'build:snowluma') | Out-Null
  } finally {
    $env:GROUPGUARD_COMMIT_SHA = $oldCommitEnv
    $env:GROUPGUARD_BUILD_TIME_UTC = $oldBuildTimeEnv
  }

  $dist = Join-Path $core 'dist'
  $buildInfoPath = Join-Path $dist 'build-info.json'
  $entryPath = Join-Path $dist 'snowluma-service.mjs'
  if (-not (Test-Path -LiteralPath $buildInfoPath)) { throw '构建结果缺少 dist/build-info.json。' }
  if (-not (Test-Path -LiteralPath $entryPath)) { throw '构建结果缺少 dist/snowluma-service.mjs。' }
  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
  if ([string]$buildInfo.commit_sha -ne $commit) { throw "构建 commit 不匹配：$($buildInfo.commit_sha) != $commit" }
  if ($buildInfo.dirty -eq $true) { throw '生产候选被标记为 dirty，拒绝发布。' }

  Write-Step '生成不可变 dist 候选包'
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $shortCommit = $commit.Substring(0, 12)
  $releaseId = "config-maturity-$stamp-$shortCommit"
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "groupguard-$releaseId"
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $archive = Join-Path $tempRoot "$releaseId.tar.gz"
  Invoke-Native 'tar' @('-C', $core, '-czf', $archive, 'dist') | Out-Null
  $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "candidate sha256：$archiveSha"

  $remoteDeployLocal = Join-Path $RepoPath 'scripts\windows\groupguard-remote-deploy.sh'
  if (-not (Test-Path -LiteralPath $remoteDeployLocal)) { throw "缺少远端部署 helper：$remoteDeployLocal" }
  $sshTarget = "$RemoteUser@$RemoteHost"
  $remoteArchive = "/tmp/$releaseId.tar.gz"
  $remoteHelper = "/tmp/$releaseId-deploy.sh"

  Write-Step 'SSH 生产预连接（不会修改生产）'
  Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, 'true') | Out-Null

  Write-Step '上传候选包和受审部署 helper'
  Invoke-Native 'scp' @('-P', "$RemotePort", $archive, "${sshTarget}:$remoteArchive") | Out-Null
  Invoke-Native 'scp' @('-P', "$RemotePort", $remoteDeployLocal, "${sshTarget}:$remoteHelper") | Out-Null

  Write-Step '生产备份 → 原子切换 dist → 重启 → readiness；失败自动恢复'
  $remoteCommand = @(
    'sh', (Quote-Remote $remoteHelper),
    (Quote-Remote $RemoteAppDir),
    (Quote-Remote $RemoteBackupRoot),
    (Quote-Remote $RemoteContainer),
    (Quote-Remote $commit),
    (Quote-Remote $remoteArchive),
    (Quote-Remote $releaseId),
    (Quote-Remote $archiveSha)
  ) -join ' '
  try {
    Invoke-Native 'ssh' @('-p', "$RemotePort", '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', $sshTarget, $remoteCommand) | Out-Null
  } finally {
    Invoke-Native 'ssh' @('-p', "$RemotePort", $sshTarget, "rm -f '$remoteArchive' '$remoteHelper'") -AllowFailure | Out-Null
  }

  Write-Step '拉回远端部署 manifest 到 Windows'
  $localStateDir = Join-Path $env:LOCALAPPDATA 'GroupGuard\deployment-state'
  New-Item -ItemType Directory -Path $localStateDir -Force | Out-Null
  $localManifest = Join-Path $localStateDir "$releaseId.json"
  $remoteManifest = "$RemoteAppDir/deployment-state/latest-code-deploy.json"
  Invoke-Native 'scp' @('-P', "$RemotePort", "${sshTarget}:$remoteManifest", $localManifest) | Out-Null
  Copy-Item -LiteralPath $localManifest -Destination (Join-Path $localStateDir 'latest-code-deploy.json') -Force

  Write-Host "`n部署完成。" -ForegroundColor Green
  Write-Host "commit：$commit"
  Write-Host "本地 manifest：$localManifest"
  Write-Host '如实际业务测试发现问题，双击 ROLLBACK-GROUPGUARD.cmd。' -ForegroundColor Yellow
  exit 0
} catch {
  Write-Host "`n更新/部署失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '如果失败发生在生产切换后的健康检查，远端 helper 已按设计尝试自动恢复。可再运行 ROLLBACK-GROUPGUARD.cmd 查看/执行最近一次已记录回滚。' -ForegroundColor Yellow
  exit 1
}
