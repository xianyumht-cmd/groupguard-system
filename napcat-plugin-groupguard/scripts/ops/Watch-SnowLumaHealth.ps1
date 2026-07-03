param(
  [string]$HostName = "192.168.3.89",
  [string]$User = "root",
  [string]$ContainerName = "groupguard-snowluma",
  [string]$WebUiBase = "http://192.168.3.89:6108",
  [string]$Token = "",
  [int]$IntervalSeconds = 0
)

$ErrorActionPreference = "Stop"
$target = "${User}@${HostName}"

function Check-Once {
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Checking container..."
  $docker = ssh $target "docker inspect -f '{{.State.Status}} {{.RestartCount}}' '$ContainerName' 2>/dev/null || echo missing"
  Write-Host "container: $docker"
  if ($docker -match "missing|exited|dead") {
    Write-Warning "Container is not healthy: $docker"
  }

  $log = ssh $target "docker logs --since 10m '$ContainerName' 2>&1 | grep -Ei 'session closed|websocket|error|限制|风控|OutgoingRisk' | tail -n 30 || true"
  if (-not [string]::IsNullOrWhiteSpace($log)) {
    Write-Warning "Recent risk/error log lines:"
    Write-Host $log
  }

  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    try {
      $health = Invoke-RestMethod -Uri "$WebUiBase/api/health" -Headers @{ "x-groupguard-token" = $Token } -TimeoutSec 10
      Write-Host "webui healthy: $($health.healthy), bot: $($health.runtime.botId), ws: $($health.runtime.wsUrl)"
      if ($health.warnings -and $health.warnings.Count -gt 0) {
        Write-Warning ($health.warnings -join "`n")
      }
    } catch {
      Write-Warning "WebUI health request failed: $($_.Exception.Message)"
    }
  } else {
    Write-Host "Token not provided, skipped WebUI /api/health."
  }
}

do {
  Check-Once
  if ($IntervalSeconds -gt 0) { Start-Sleep -Seconds $IntervalSeconds }
} while ($IntervalSeconds -gt 0)
