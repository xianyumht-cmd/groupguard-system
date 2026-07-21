import fs from 'fs';
import path from 'path';
import { contextStateService } from '../../core/state-services/context_state_service';
import { identityStateService } from '../../core/state-services/identity_state_service';
import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { groupguardRepository } from '../../repositories/groupguard_repository';
import { applyPatch } from './object_patch';
import type { RiskPresetLevel } from '../../types';
import type { SnowLumaAdminServerOptions } from './types';

function sinceFromHours(hours: any): number {
  const n = Number(hours);
  const h = Number.isFinite(n) ? Math.max(1, Math.min(720, n)) : 24;
  return Date.now() - h * 60 * 60 * 1000;
}

export async function getRiskDashboard(hours?: any) {
  const sinceMs = sinceFromHours(hours);
  const [botSend, audit, actionQueue] = await Promise.all([
    groupguardRepository.getBotSendStats({ sinceMs, limit: 20 }),
    groupguardRepository.getAuditStats({ sinceMs, limit: 20 }),
    groupguardRepository.getActionQueueEventStats({ sinceMs, limit: 20 })
  ]);
  return {
    ok: true,
    sinceMs,
    hours: Math.round((Date.now() - sinceMs) / 3600000),
    botSend,
    audit,
    actionQueue,
    highRiskSummary: {
      topGroups: botSend.topGroups,
      topScenes: botSend.byScene,
      topRiskUsers: audit.topUsers,
      topActionUsers: actionQueue.topUsers,
      droppedOrFailed: botSend.dropped + botSend.failed,
      selfRecallFailed: botSend.selfRecallFailed,
      messageIdMissing: botSend.messageIdMissing
    }
  };
}

function readHealthState(dataDir: string): any {
  const file = path.join(dataDir, 'webui-health-state.json');
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
  } catch {
    return {};
  }
}

function writeHealthState(dataDir: string, state: any): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'webui-health-state.json'), JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Health snapshots must not break the WebUI.
  }
}

function getLanzouMonitorSettings(): Record<string, any> {
  const config = configStateService.getConfig() as any;
  return config?.lanzouUpdatePush || {};
}

function getLanzouMonitorBaseUrl(settings: Record<string, any>): string {
  return String(settings.monitorBaseUrl || settings.monitor_base_url || 'http://192.168.3.100:6178').trim().replace(/\/+$/, '') || 'http://192.168.3.100:6178';
}

export function getLatestLanzouScanAt(lastScan: any): string {
  const candidates: string[] = [];
  const collect = (value: any): void => {
    if (!value) return;
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(value)) candidates.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value !== 'object') return;
    const timestamp = value.at
      || value.checked_at
      || value.checkedAt
      || value.last_checked_at
      || value.lastCheckedAt
      || value.captured_at
      || value.capturedAt
      || value.last_scan
      || value.lastScan;
    if (typeof timestamp === 'string' && timestamp) candidates.push(timestamp);
    else Object.values(value).forEach(collect);
  };
  collect(lastScan);
  return candidates
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.value || '';
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 3000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal } as any);
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) throw new Error(data.error || data.detail || text || response.statusText);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLanzouMonitorStatus() {
  const settings = getLanzouMonitorSettings();
  const baseUrl = getLanzouMonitorBaseUrl(settings);
  const checkedAt = Date.now();
  if (settings.enabled !== true) {
    return {
      baseUrl,
      enabled: false,
      applicable: false,
      status: 'not_applicable',
      ok: true,
      running: false,
      checkedAt
    };
  }
  try {
    const health = await fetchJsonWithTimeout(`${baseUrl}/health`);
    let watchersData: any = {};
    try {
      watchersData = await fetchJsonWithTimeout(`${baseUrl}/watchers`);
    } catch {
      // /health is authoritative; watcher details are optional dashboard data.
    }
    const watchers = Array.isArray(watchersData?.watchers) ? watchersData.watchers : Array.isArray(watchersData) ? watchersData : [];
    const healthOk = health?.ok === true;
    const running = health?.running === true;
    const ok = healthOk && running;
    const lastScan = getLatestLanzouScanAt(health?.last_scan || health?.lastScan)
      || getLatestLanzouScanAt(watchers);
    return {
      baseUrl,
      enabled: true,
      applicable: true,
      connected: true,
      status: ok ? 'healthy' : healthOk ? 'stopped' : 'unhealthy',
      ok,
      running,
      checkedAt,
      health,
      watcherCount: Number.isFinite(Number(health?.watcher_count)) ? Number(health.watcher_count) : watchers.length,
      enabledWatcherCount: Number.isFinite(Number(health?.enabled_watcher_count))
        ? Number(health.enabled_watcher_count)
        : watchers.filter((item: any) => item?.enabled !== false).length,
      lastScan,
      error: ok ? '' : healthOk ? 'monitor_not_running' : 'monitor_health_check_failed'
    };
  } catch (error: any) {
    return {
      baseUrl,
      enabled: true,
      applicable: true,
      connected: false,
      status: 'disconnected',
      ok: false,
      running: false,
      checkedAt,
      error: error?.name === 'AbortError' ? 'connect timeout' : String(error?.message || error)
    };
  }
}

export async function getHealthDashboard(options: SnowLumaAdminServerOptions) {
  const now = Date.now();
  const botId = identityStateService.getBotId() || '';
  const adapterName = contextStateService.getAdapterName() || '';
  const previous = readHealthState(options.dataDir);
  const botChanged = Boolean(previous.botId && botId && previous.botId !== botId);
  const [botSend, lanzouMonitor] = await Promise.all([
    groupguardRepository.getBotSendStats({ sinceMs: now - 10 * 60 * 1000, limit: 10 }),
    getLanzouMonitorStatus()
  ]);
  const warnings: string[] = [];
  if (!botId) warnings.push('未检测到当前账号，可能尚未连接或账号已掉线。');
  if (!adapterName) warnings.push('适配器为空，OneBot/SnowLuma 连接可能未初始化。');
  if (botChanged) warnings.push(`账号发生切换：${previous.botId} -> ${botId}`);
  if (botSend.failed > 0) warnings.push(`最近10分钟发送失败 ${botSend.failed} 次。`);
  if (botSend.dropped > 0) warnings.push(`最近10分钟发送丢弃 ${botSend.dropped} 次。`);
  if (lanzouMonitor.applicable && !lanzouMonitor.ok) {
    warnings.push(`Lanzou monitor unhealthy: ${lanzouMonitor.error || lanzouMonitor.baseUrl}`);
  }
  writeHealthState(options.dataDir, { botId, adapterName, wsUrl: options.wsUrl, checkedAt: now });
  return {
    ok: true,
    healthy: warnings.length === 0,
    checkedAt: now,
    warnings,
    runtime: {
      uptimeSeconds: Math.floor(process.uptime()),
      botId,
      previousBotId: previous.botId || '',
      botChanged,
      adapterName,
      wsUrl: options.wsUrl,
      processCwd: process.cwd()
    },
    recentSend: botSend,
    lanzouMonitor
  };
}

function presetPatch(level: RiskPresetLevel): Record<string, any> {
  if (level === 'conservative') {
    return {
      'global.riskPresetLevel': 'conservative',
      'global.outgoingRisk.enabled': true,
      'global.outgoingRisk.urlMode': 'number',
      'global.outgoingRisk.applyToPrivate': true,
      'global.outgoingRisk.applyToForward': true,
      'global.qaLinkDelivery.enabled': true,
      'global.qaLinkDelivery.delayMinMs': 2000,
      'global.qaLinkDelivery.delayMaxMs': 6000,
      'global.qaLinkDelivery.wrapInCodeBlock': true,
      'global.banQueryResultMode': 'short',
      'global.lolQueryGlobalRateLimitPerMinute': 30,
      'global.lolQueryGroupRateLimitPerMinute': 6,
      'global.lolQueryGlobalMinIntervalSeconds': 3,
      'global.lolQueryGroupMinIntervalSeconds': 10,
      'global.lolQueryDailyLimit': 100,
      'global.replyProbability': 60,
      'global.randomDelayMin': 1500,
      'global.randomDelayMax': 5000,
      'global.globalMaxPerMinute': 45,
      'global.groupFuseThreshold': 12,
      'global.groupFuseCooldownSeconds': 180,
      'global.selfRecall.probability': 30,
      'global.botSendWrapperEnabled': true,
      'global.botSendWrapperMode': 'forward',
      'global.botSendWrapperQaEnabled': true,
      'global.botSendWrapperQueryEnabled': true
    };
  }
  if (level === 'aggressive') {
    return {
      'global.riskPresetLevel': 'aggressive',
      'global.outgoingRisk.enabled': false,
      'global.qaLinkDelivery.enabled': false,
      'global.banQueryResultMode': 'text',
      'global.lolQueryGlobalRateLimitPerMinute': 120,
      'global.lolQueryGroupRateLimitPerMinute': 30,
      'global.lolQueryGlobalMinIntervalSeconds': 1,
      'global.lolQueryGroupMinIntervalSeconds': 2,
      'global.lolQueryDailyLimit': 500,
      'global.replyProbability': 100,
      'global.randomDelayMin': 300,
      'global.randomDelayMax': 1200,
      'global.globalMaxPerMinute': 160,
      'global.groupFuseThreshold': 45,
      'global.groupFuseCooldownSeconds': 90,
      'global.selfRecall.probability': 80
    };
  }
  return {
    'global.riskPresetLevel': 'balanced',
    'global.outgoingRisk.enabled': true,
    'global.outgoingRisk.urlMode': 'number',
    'global.outgoingRisk.applyToPrivate': true,
    'global.outgoingRisk.applyToForward': true,
    'global.qaLinkDelivery.enabled': true,
    'global.qaLinkDelivery.delayMinMs': 1000,
    'global.qaLinkDelivery.delayMaxMs': 3000,
    'global.qaLinkDelivery.wrapInCodeBlock': false,
    'global.banQueryResultMode': 'short',
    'global.lolQueryGlobalRateLimitPerMinute': 60,
    'global.lolQueryGroupRateLimitPerMinute': 12,
    'global.lolQueryGlobalMinIntervalSeconds': 2,
    'global.lolQueryGroupMinIntervalSeconds': 5,
    'global.lolQueryDailyLimit': 200,
    'global.replyProbability': 80,
    'global.randomDelayMin': 800,
    'global.randomDelayMax': 2500,
    'global.globalMaxPerMinute': 90,
    'global.groupFuseThreshold': 24,
    'global.groupFuseCooldownSeconds': 120,
    'global.selfRecall.probability': 50,
    'global.botSendWrapperEnabled': true,
    'global.botSendWrapperMode': 'forward',
    'global.botSendWrapperQaEnabled': true,
    'global.botSendWrapperQueryEnabled': true
  };
}

export function applyRiskPreset(options: SnowLumaAdminServerOptions, level: any) {
  const normalized: RiskPresetLevel = level === 'conservative' || level === 'aggressive' ? level : 'balanced';
  const next = applyPatch(configStateService.getConfig(), presetPatch(normalized));
  configStateService.setConfig(next);
  saveConfigStrict(options.ctx);
  return { ok: true, level: normalized, patch: presetPatch(normalized), config: configStateService.getConfig() };
}
