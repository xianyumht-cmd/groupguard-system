import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRawConfig } from './config_api';
import type { SnowLumaAdminServerOptions } from './types';
import { targetFilePushService } from '../../services/target_file_push_service';

let runtimeBound = false;

function ensureRuntime(options: SnowLumaAdminServerOptions): void {
  if (runtimeBound) return;
  targetFilePushService.bindRuntime({
    hostProfile: options.ctx.hostProfile,
    workDir: options.workDir,
    dataDir: options.dataDir,
    configPath: options.configPath,
    log: (level, message) => {
      if (level === 'error') options.ctx.logger.error(message);
      else if (level === 'warn') options.ctx.logger.warn(message);
      else if (level === 'debug') options.ctx.logger.debug(message);
      else options.ctx.logger.info(message);
    },
  });
  runtimeBound = true;
}

function safeError(error: unknown): string {
  return String((error as Error)?.message || error || 'unknown_error').slice(0, 300);
}

function derivedApiBaseUrl(options: SnowLumaAdminServerOptions): string {
  try {
    const raw = getRawConfig(options) as Record<string, any>;
    return String(raw.lolApiBaseUrl || raw.lol_api_base_url || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function privateIpv4Rank(address: string): number {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  const match = address.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return 2;
  }
  return 99;
}

function derivedCallbackBaseUrl(options: SnowLumaAdminServerOptions): string {
  const parsedPort = Number(options.port || process.env.GROUPGUARD_WEBUI_PORT || 6108);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? Math.floor(parsedPort) : 6108;
  const configuredHost = String(options.host || process.env.GROUPGUARD_WEBUI_HOST || '').trim();
  if (configuredHost && !['0.0.0.0', '127.0.0.1', 'localhost', '::', '::1'].includes(configuredHost)) {
    return `http://${configuredHost}:${port}`;
  }

  const candidates: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
      if (entry.internal || (family !== 'IPv4' && family !== '4')) continue;
      const address = String(entry.address || '').trim();
      if (privateIpv4Rank(address) < 99) candidates.push(address);
    }
  }
  candidates.sort((a, b) => privateIpv4Rank(a) - privateIpv4Rank(b) || a.localeCompare(b));
  return candidates[0] ? `http://${candidates[0]}:${port}` : '';
}

function recoverLocalStateAfterRemoteRebaseline(): string {
  const status = targetFilePushService.getLocalStatus();
  if (status.stateHealthy !== false) return '';
  const statePath = targetFilePushService.getStateFilePath();
  if (!fs.existsSync(statePath)) {
    targetFilePushService.getLocalStatus();
    return '';
  }
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const quarantinePath = `${statePath}.corrupt-${stamp}-${process.pid}`;
  fs.renameSync(statePath, quarantinePath);
  const recovered = targetFilePushService.getLocalStatus();
  if (recovered.stateHealthy !== true) throw new Error('本地状态隔离后仍无法恢复');
  return path.basename(quarantinePath);
}

export async function getTargetFilePushOverview(options: SnowLumaAdminServerOptions) {
  ensureRuntime(options);
  const local = targetFilePushService.getLocalStatus();
  const editor = { ...local.config } as Record<string, any>;
  if (!editor.apiBaseUrl) editor.apiBaseUrl = derivedApiBaseUrl(options);
  if (!editor.callbackBaseUrl) editor.callbackBaseUrl = derivedCallbackBaseUrl(options);
  let remote: Record<string, any> | null = null;
  let remoteError = '';
  if (editor.apiBaseUrl && local.apiTokenConfigured) {
    try {
      remote = await targetFilePushService.getInterfaceStatus();
    } catch (error) {
      remoteError = safeError(error);
    }
  }
  return {
    ok: true,
    editor,
    apiTokenConfigured: local.apiTokenConfigured,
    callbackTokenConfigured: local.callbackTokenConfigured,
    tempDir: local.tempDir,
    local: {
      stateHealthy: local.stateHealthy,
      current: local.current,
      completedCount: local.completedCount,
      lastSuccessAt: local.lastSuccessAt,
      lastErrorAt: local.lastErrorAt,
      lastError: local.stateHealthy === false
        ? '本地状态文件损坏，已停止自动上传；请点击“重新建立基线”安全恢复。'
        : local.lastError,
    },
    remote,
    remoteError,
  };
}

export async function saveTargetFilePushFromWeb(options: SnowLumaAdminServerOptions, value: unknown) {
  ensureRuntime(options);
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  const configInput = raw.config && typeof raw.config === 'object' ? raw.config : raw;
  const apiToken = String(raw.apiToken || raw.api_token || '').trim();
  const previous = targetFilePushService.getConfig();
  if (apiToken) targetFilePushService.setApiToken(apiToken);
  const next = targetFilePushService.saveConfig(configInput);
  const newlyActivated = next.enabled && (!previous.enabled || previous.sourceUrl !== next.sourceUrl);

  let sync: Record<string, any> | null = null;
  let activation: Record<string, any> | null = null;
  let syncError = '';
  try {
    if (newlyActivated) await targetFilePushService.requestRebaseline();
    sync = await targetFilePushService.syncInterfaceConfig();
    if (newlyActivated) activation = await targetFilePushService.requestImmediateCheck();
  } catch (error) {
    syncError = safeError(error);
  }
  const overview = await getTargetFilePushOverview(options);
  return {
    ...overview,
    saved: true,
    sync,
    activation,
    syncError,
    message: syncError
      ? `本地设置已保存，但接口端同步/建立基线失败：${syncError}`
      : next.enabled && activation
        ? '定向文件推送已开启，当前蓝奏目录已建立基线；后续新增或替换文件才会上传。'
        : '定向文件推送设置已保存，并已同步到接口端。',
  };
}

export async function checkTargetFilePushNow(options: SnowLumaAdminServerOptions) {
  ensureRuntime(options);
  const result = await targetFilePushService.requestImmediateCheck();
  return { ...(await getTargetFilePushOverview(options)), check: result };
}

export async function rebaselineTargetFilePush(options: SnowLumaAdminServerOptions) {
  ensureRuntime(options);
  const remoteReset = await targetFilePushService.requestRebaseline();
  const localQuarantineFile = recoverLocalStateAfterRemoteRebaseline();
  const config = targetFilePushService.getConfig();
  const baseline = config.enabled
    ? await targetFilePushService.requestImmediateCheck()
    : null;
  return {
    ...(await getTargetFilePushOverview(options)),
    rebaseline: remoteReset,
    baseline,
    localQuarantineFile,
  };
}

export async function handleTargetFilePushEvent(
  options: SnowLumaAdminServerOptions,
  payload: unknown,
  presentedToken: string,
) {
  ensureRuntime(options);
  return targetFilePushService.handleEvent(payload, presentedToken);
}
