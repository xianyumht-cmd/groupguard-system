import fs from 'node:fs';
import path from 'node:path';

export interface TargetFilePushConfig {
  enabled: boolean;
  sourceUrl: string;
  targetGroupId: string;
  apiBaseUrl: string;
  callbackBaseUrl: string;
  checkIntervalSeconds: number;
  maxFileSizeMb: number;
  targetFolderId: string;
}

export const DEFAULT_TARGET_FILE_PUSH_CONFIG: TargetFilePushConfig = {
  enabled: false,
  sourceUrl: '',
  targetGroupId: '',
  apiBaseUrl: '',
  callbackBaseUrl: '',
  checkIntervalSeconds: 300,
  maxFileSizeMb: 512,
  targetFolderId: '/',
};

const LANZOU_ROOT_HOSTS = new Set([
  'lanzou.com',
  'lanzoub.com',
  'lanzouf.com',
  'lanzouh.com',
  'lanzoui.com',
  'lanzouj.com',
  'lanzoul.com',
  'lanzoum.com',
  'lanzouo.com',
  'lanzoup.com',
  'lanzouq.com',
  'lanzout.com',
  'lanzouu.com',
  'lanzouv.com',
  'lanzouw.com',
  'lanzoux.com',
  'lanzouy.com',
  'lanzn.com',
  'lanwp.com',
]);

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeUrl(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isHostOrSubdomain(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

function isLanzouUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return [...LANZOU_ROOT_HOSTS].some((root) => isHostOrSubdomain(host, root));
  } catch {
    return false;
  }
}

export function normalizeTargetFilePushConfig(value: unknown): TargetFilePushConfig {
  const raw = isRecord(value) && isRecord(value.config) ? value.config : isRecord(value) ? value : {};
  const config: TargetFilePushConfig = {
    enabled: raw.enabled === true,
    sourceUrl: normalizeUrl(raw.sourceUrl ?? raw.source_url ?? DEFAULT_TARGET_FILE_PUSH_CONFIG.sourceUrl),
    targetGroupId: String(raw.targetGroupId ?? raw.target_group_id ?? DEFAULT_TARGET_FILE_PUSH_CONFIG.targetGroupId).trim(),
    apiBaseUrl: normalizeUrl(raw.apiBaseUrl ?? raw.api_base_url),
    callbackBaseUrl: normalizeUrl(raw.callbackBaseUrl ?? raw.callback_base_url ?? DEFAULT_TARGET_FILE_PUSH_CONFIG.callbackBaseUrl),
    checkIntervalSeconds: clampInteger(raw.checkIntervalSeconds ?? raw.check_interval_seconds, 300, 30, 86_400),
    maxFileSizeMb: clampInteger(raw.maxFileSizeMb ?? raw.max_file_size_mb, 2048, 1, 4096),
    targetFolderId: String(raw.targetFolderId ?? raw.target_folder_id ?? '/').trim() || '/',
  };
  if (config.sourceUrl && !isLanzouUrl(config.sourceUrl)) throw new Error('指定链接必须是有效的蓝奏网盘链接');
  if (config.apiBaseUrl && !isHttpUrl(config.apiBaseUrl)) throw new Error('接口端地址必须是有效的 http/https 地址');
  if (config.callbackBaseUrl && !isHttpUrl(config.callbackBaseUrl)) throw new Error('回调地址必须是有效的 http/https 地址');
  if (config.targetGroupId && !/^\d+$/.test(config.targetGroupId)) throw new Error('目标群号只能填写数字');
  if (config.enabled) {
    if (!config.sourceUrl) throw new Error('开启功能前必须填写蓝奏网盘链接');
    if (!config.targetGroupId) throw new Error('开启功能前必须填写目标群号');
    if (!config.apiBaseUrl) throw new Error('开启功能前必须填写接口端地址');
    if (!config.callbackBaseUrl) throw new Error('开启功能前必须填写 GroupGuard 回调地址');
  }
  return config;
}

export function resolveTargetFilePushConfigDir(configPath: string): string {
  const base = path.dirname(configPath);
  return path.basename(base).toLowerCase() === 'config' ? base : path.join(base, 'config');
}

export function atomicWriteTargetFilePushJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* non-posix */ }
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
  }
}
