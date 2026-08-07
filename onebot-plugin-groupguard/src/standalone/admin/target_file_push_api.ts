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

export async function getTargetFilePushOverview(options: SnowLumaAdminServerOptions) {
  ensureRuntime(options);
  const local = targetFilePushService.getLocalStatus();
  const editor = { ...local.config } as Record<string, any>;
  if (!editor.apiBaseUrl) editor.apiBaseUrl = derivedApiBaseUrl(options);
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
      lastError: local.lastError,
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
        ? '定向文件推送已开启，当前文件已建立基线；后续变化才会上传。'
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
  const result = await targetFilePushService.requestRebaseline();
  return { ...(await getTargetFilePushOverview(options)), rebaseline: result };
}

export async function handleTargetFilePushEvent(
  options: SnowLumaAdminServerOptions,
  payload: unknown,
  presentedToken: string,
) {
  ensureRuntime(options);
  return targetFilePushService.handleEvent(payload, presentedToken);
}
