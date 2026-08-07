import { getRawConfig } from './config_api';
import type { SnowLumaAdminServerOptions } from './types';
import { targetFilePushService } from '../../services/target_file_push_service';

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
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  const configInput = raw.config && typeof raw.config === 'object' ? raw.config : raw;
  const apiToken = String(raw.apiToken || raw.api_token || '').trim();
  if (apiToken) targetFilePushService.setApiToken(apiToken);
  targetFilePushService.saveConfig(configInput);

  let sync: Record<string, any> | null = null;
  let syncError = '';
  try {
    sync = await targetFilePushService.syncInterfaceConfig();
  } catch (error) {
    syncError = safeError(error);
  }
  const overview = await getTargetFilePushOverview(options);
  return {
    ...overview,
    saved: true,
    sync,
    syncError,
    message: syncError
      ? `本地设置已保存，但同步到接口端失败：${syncError}`
      : '定向文件推送设置已保存，并已同步到接口端。',
  };
}

export async function checkTargetFilePushNow(options: SnowLumaAdminServerOptions) {
  const result = await targetFilePushService.requestImmediateCheck();
  return { ...(await getTargetFilePushOverview(options)), check: result };
}

export async function rebaselineTargetFilePush(options: SnowLumaAdminServerOptions) {
  const result = await targetFilePushService.requestRebaseline();
  return { ...(await getTargetFilePushOverview(options)), rebaseline: result };
}

export async function handleTargetFilePushEvent(payload: unknown, presentedToken: string) {
  return targetFilePushService.handleEvent(payload, presentedToken);
}
