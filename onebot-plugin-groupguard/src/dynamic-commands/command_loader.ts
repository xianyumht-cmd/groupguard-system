import fsSync, { promises as fs } from 'fs';
import path from 'path';
import { contextStateService } from '../core/state-services/context_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { getRegisteredCommandPluginDefinitions } from './command_plugin_store';
import { validateDynamicCommandDefinition } from './command_validator';
import type { DynamicCommandDefinition, DynamicCommandsConfigFile } from './types';

const LEGACY_DYNAMIC_COMMANDS_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'dynamic-commands', 'commands.json');
const DYNAMIC_COMMAND_DEBUG = process.env.DYNAMIC_COMMAND_DEBUG === '1';
const DYNAMIC_COMMAND_RELOAD_DEBOUNCE_MS = 500;

let initialized = false;
let cachedMtimeMs = -1;
let cachedConfigPath = '';
let cachedCommands: DynamicCommandDefinition[] = [];
let loadPromise: Promise<DynamicCommandDefinition[]> | null = null;
let reloadDebouncePromise: Promise<DynamicCommandDefinition[]> | null = null;
let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let resolveReloadDebouncePromise: ((value: DynamicCommandDefinition[]) => void) | null = null;
let fallbackWarningAccountPath = '';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue;
    const normalizedKey = String(key || '').trim();
    const normalizedValue = rawValue.trim();
    if (!normalizedKey || !normalizedValue) continue;
    output[normalizedKey] = normalizedValue;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeFeatureType(value: unknown): DynamicCommandDefinition['featureType'] {
  return value === 'query'
    || value === 'qa'
    || value === 'dynamic'
    || value === 'system'
    || value === 'risk'
    || value === 'activity'
    || value === 'moderation'
    ? value
    : 'dynamic';
}

function normalizeScope(value: unknown): DynamicCommandDefinition['scope'] {
  return value === 'global' || value === 'private' || value === 'both' || value === 'group' ? value : 'group';
}

function normalizePermission(value: unknown): DynamicCommandDefinition['permission'] {
  return value === 'admin' || value === 'owner' || value === 'all' ? value : 'all';
}

export function getDynamicCommandsConfigPath(): string {
  const explicitPath = process.env.DYNAMIC_COMMANDS_CONFIG_PATH || contextStateService.getDynamicCommandsConfigPath();
  if (explicitPath) return path.resolve(explicitPath);

  const configDir = contextStateService.getConfigDir();
  const accountPath = configDir ? path.resolve(configDir, 'dynamic-commands', 'commands.json') : '';
  try {
    if (accountPath) {
      fsSync.accessSync(accountPath);
      return accountPath;
    }
  } catch {
    // Fall back to legacy shared commands.json for compatibility.
  }
  if (accountPath && fallbackWarningAccountPath !== accountPath) {
    fallbackWarningAccountPath = accountPath;
    loggingStateService.warn(`[DynamicCommandLoader] 当前账号未找到账号级 dynamic-commands，已回退旧路径，建议迁移。 accountPath=${accountPath} legacyPath=${LEGACY_DYNAMIC_COMMANDS_CONFIG_PATH}`);
  }
  return LEGACY_DYNAMIC_COMMANDS_CONFIG_PATH;
}

export function getAccountDynamicCommandsConfigPath(): string {
  const explicitPath = process.env.DYNAMIC_COMMANDS_CONFIG_PATH || contextStateService.getDynamicCommandsConfigPath();
  if (explicitPath) return path.resolve(explicitPath);
  const configDir = contextStateService.getConfigDir();
  return configDir ? path.resolve(configDir, 'dynamic-commands', 'commands.json') : '';
}

function normalizeParameters(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue;
    const normalizedSource = rawValue.trim();
    if (!/^\$([a-zA-Z_]\w*|\d+)$/.test(normalizedSource)) continue;
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    output[normalizedKey] = normalizedSource;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeParameterSchema(value: unknown, parameters: Record<string, string> | undefined) {
  const fallbackRequired = Object.keys(parameters || {});
  if (!isRecord(value)) {
    return { required: fallbackRequired, optional: [] };
  }
  const toNameList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  };
  const required = Array.from(new Set(toNameList(value.required)));
  const optional = Array.from(new Set(toNameList(value.optional).filter((name) => !required.includes(name))));
  return {
    required: required.length ? required : fallbackRequired,
    optional
  };
}

function getCommandPriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.floor(value);
}

function getMatchWeight(command: DynamicCommandDefinition): number {
  const baseWeight = command.trigger.type === 'exact' ? 1000 : 0;
  return baseWeight + (command.priority || 0);
}

function sortCommands(commands: DynamicCommandDefinition[]): DynamicCommandDefinition[] {
  return [...commands].sort((left, right) => {
    const weightDiff = getMatchWeight(right) - getMatchWeight(left);
    if (weightDiff !== 0) return weightDiff;
    const typeDiff = (right.trigger.type === 'exact' ? 1 : 0) - (left.trigger.type === 'exact' ? 1 : 0);
    if (typeDiff !== 0) return typeDiff;
    const triggerLengthDiff = right.trigger.value.length - left.trigger.value.length;
    if (triggerLengthDiff !== 0) return triggerLengthDiff;
    return left.id.localeCompare(right.id);
  });
}

function normalizeCommandDefinition(value: unknown): DynamicCommandDefinition | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const enabled = value.enabled !== false;
  const trigger = isRecord(value.trigger) ? value.trigger : null;
  const provider = isRecord(value.provider) ? value.provider : null;
  const response = isRecord(value.response) ? value.response : null;
  const fallbackText = typeof value.fallbackText === 'string' ? value.fallbackText.trim() : undefined;

  const triggerType = trigger && (trigger.type === 'exact' || trigger.type === 'prefix') ? trigger.type : null;
  const triggerValue = trigger && typeof trigger.value === 'string' ? trigger.value.trim() : '';
  const providerType = provider?.type === 'intranet' || provider?.type === 'http' ? provider.type : null;
  const responseType = response && ['text', 'link', 'media', 'structured'].includes(String(response.type || ''))
    ? response.type as DynamicCommandDefinition['response']['type']
    : null;
  const normalizedParameters = normalizeParameters(value.parameters);

  if (!id || !triggerType || !triggerValue || !provider || !providerType || !responseType) {
    loggingStateService.warn(`[DynamicCommandLoader] 忽略无效命令定义: ${JSON.stringify(value)}`);
    return null;
  }

  let normalizedProvider: DynamicCommandDefinition['provider'];
  if (providerType === 'intranet') {
    normalizedProvider = { type: 'intranet' };
  } else {
    const providerMethod = provider.method === 'GET' || provider.method === 'POST' ? provider.method : null;
    const providerUrl = typeof provider.url === 'string' ? provider.url.trim() : '';
    if (!providerMethod || !providerUrl) {
      loggingStateService.warn(`[DynamicCommandLoader] 忽略缺少 HTTP Provider 配置的命令: ${id}`);
      return null;
    }
    normalizedProvider = {
      type: 'http',
      method: providerMethod,
      url: providerUrl,
      headers: normalizeStringMap(provider.headers),
      query: normalizeStringMap(provider.query),
      body: normalizeStringMap(provider.body),
      timeoutMs: typeof provider.timeoutMs === 'number' && Number.isFinite(provider.timeoutMs) ? provider.timeoutMs : undefined
    };
  }

  const template = response && typeof response.template === 'string' ? response.template.trim() : undefined;
  const textPath = response && typeof response.textPath === 'string' ? response.textPath.trim() : undefined;
  return {
    id,
    enabled,
    priority: getCommandPriority(value.priority),
    featureType: normalizeFeatureType(value.featureType),
    featureKey: typeof value.featureKey === 'string' && value.featureKey.trim()
      ? value.featureKey.trim()
      : `dynamic.${id}`,
    scope: normalizeScope(value.scope),
    allowedGroups: normalizeStringList(value.allowedGroups),
    blockedGroups: normalizeStringList(value.blockedGroups),
    requiresLicense: value.requiresLicense !== false,
    permission: normalizePermission(value.permission),
    trigger: { type: triggerType, value: triggerValue },
    parameters: normalizedParameters,
    parameterSchema: normalizeParameterSchema(value.parameterSchema, normalizedParameters),
    provider: normalizedProvider,
    response: { type: responseType, textPath, template },
    fallbackText
  };
}

function normalizeConfigFile(value: unknown): DynamicCommandsConfigFile {
  if (!isRecord(value)) return { version: '1', commands: [] };
  const version = typeof value.version === 'string' ? value.version.trim() || '1' : '1';
  const commands = Array.isArray(value.commands)
    ? value.commands.map(normalizeCommandDefinition).filter((item): item is DynamicCommandDefinition => Boolean(item))
    : [];
  return { version, commands };
}

async function readCommandsFromDisk(): Promise<DynamicCommandDefinition[]> {
  const configPath = getDynamicCommandsConfigPath();
  if (configPath !== cachedConfigPath) {
    loggingStateService.info(`[DynamicCommandLoader] using commands path: ${configPath}`);
  }
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const config = normalizeConfigFile(parsed);
  const mergedCommands = [
    ...config.commands,
    ...getRegisteredCommandPluginDefinitions()
  ];
  const validatedCommands = mergedCommands.filter((command) => {
    const validationErrors = validateDynamicCommandDefinition(command);
    if (!validationErrors.length) return true;
    for (const error of validationErrors) {
      loggingStateService.warn(`[DynamicCommandLoader] validation_error code=${error.code} message=${error.message}`);
    }
    return false;
  });
  const commands = sortCommands(validatedCommands.filter((command) => command.enabled));
  if (DYNAMIC_COMMAND_DEBUG) {
    loggingStateService.debug(`[DynamicCommandLoader] 已加载 ${commands.length} 个动态命令`);
  }
  return commands;
}

async function performLoad(forceReload: boolean): Promise<DynamicCommandDefinition[]> {
  try {
    const configPath = getDynamicCommandsConfigPath();
    const stats = await fs.stat(configPath);
    if (!forceReload && initialized && configPath === cachedConfigPath && stats.mtimeMs === cachedMtimeMs) {
      return cachedCommands;
    }
    cachedCommands = await readCommandsFromDisk();
    cachedConfigPath = configPath;
    cachedMtimeMs = stats.mtimeMs;
    initialized = true;
    return cachedCommands;
  } catch (error: any) {
    const code = error?.code;
    if (code === 'ENOENT') {
      cachedCommands = [];
      cachedMtimeMs = -1;
      initialized = true;
      return [];
    }
    loggingStateService.error(`动态命令加载失败: ${error}`);
    if (!initialized) {
      cachedCommands = [];
      cachedMtimeMs = -1;
      initialized = true;
    }
    return cachedCommands;
  } finally {
    loadPromise = null;
  }
}

function scheduleDebouncedReload(): Promise<DynamicCommandDefinition[]> {
  if (!reloadDebouncePromise) {
    reloadDebouncePromise = new Promise((resolve) => {
      resolveReloadDebouncePromise = resolve;
      reloadDebounceTimer = setTimeout(async () => {
        reloadDebounceTimer = null;
        const result = await forceReloadDynamicCommands();
        reloadDebouncePromise = null;
        resolveReloadDebouncePromise?.(result);
        resolveReloadDebouncePromise = null;
      }, DYNAMIC_COMMAND_RELOAD_DEBOUNCE_MS);
    });
    return reloadDebouncePromise;
  }

  if (reloadDebounceTimer) {
    clearTimeout(reloadDebounceTimer);
    reloadDebounceTimer = setTimeout(async () => {
      reloadDebounceTimer = null;
      const result = await forceReloadDynamicCommands();
      reloadDebouncePromise = null;
      resolveReloadDebouncePromise?.(result);
      resolveReloadDebouncePromise = null;
    }, DYNAMIC_COMMAND_RELOAD_DEBOUNCE_MS);
  }

  return reloadDebouncePromise;
}

export async function forceReloadDynamicCommands(): Promise<DynamicCommandDefinition[]> {
  if (loadPromise) return loadPromise;
  loadPromise = performLoad(true);
  return loadPromise;
}

export async function initializeDynamicCommands(): Promise<DynamicCommandDefinition[]> {
  if (initialized) return cachedCommands;
  if (loadPromise) return loadPromise;
  loadPromise = performLoad(false);
  return loadPromise;
}

export async function reloadDynamicCommandsIfChanged(): Promise<DynamicCommandDefinition[]> {
  try {
    const configPath = getDynamicCommandsConfigPath();
    const stats = await fs.stat(configPath);
    if (initialized && configPath === cachedConfigPath && stats.mtimeMs === cachedMtimeMs) {
      return cachedCommands;
    }
    return scheduleDebouncedReload();
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      cachedCommands = [];
      cachedMtimeMs = -1;
      initialized = true;
      return [];
    }
    loggingStateService.warn(`[DynamicCommandLoader] debounce reload failed: ${error}`);
    return cachedCommands;
  }
}

export function loadDynamicCommands(): DynamicCommandDefinition[] {
  return cachedCommands;
}
