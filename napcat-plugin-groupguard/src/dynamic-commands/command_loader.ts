import { promises as fs } from 'fs';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { getRegisteredCommandPluginDefinitions } from './command_plugin_store';
import { validateDynamicCommandDefinition } from './command_validator';
import type { DynamicCommandDefinition, DynamicCommandsConfigFile } from './types';

const DYNAMIC_COMMANDS_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'dynamic-commands', 'commands.json');
const DYNAMIC_COMMAND_DEBUG = process.env.DYNAMIC_COMMAND_DEBUG === '1';
const DYNAMIC_COMMAND_RELOAD_DEBOUNCE_MS = 500;

let initialized = false;
let cachedMtimeMs = -1;
let cachedCommands: DynamicCommandDefinition[] = [];
let loadPromise: Promise<DynamicCommandDefinition[]> | null = null;
let reloadDebouncePromise: Promise<DynamicCommandDefinition[]> | null = null;
let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let resolveReloadDebouncePromise: ((value: DynamicCommandDefinition[]) => void) | null = null;

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
    return {
      required: fallbackRequired,
      optional: []
    };
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
  const providerType = provider?.type === 'http' ? provider.type : null;
  const providerMethod = provider && (provider.method === 'GET' || provider.method === 'POST') ? provider.method : null;
  const providerUrl = provider && typeof provider.url === 'string' ? provider.url.trim() : '';
  const responseType = response?.type === 'text' ? response.type : null;
  const textPath = response && typeof response.textPath === 'string' ? response.textPath.trim() : undefined;
  const normalizedParameters = normalizeParameters(value.parameters);

  if (!id || !triggerType || !triggerValue || !providerType || !providerMethod || !providerUrl || !responseType) {
    loggingStateService.warn(`[DynamicCommandLoader] 忽略无效命令定义: ${JSON.stringify(value)}`);
    return null;
  }

  return {
    id,
    enabled,
    priority: getCommandPriority(value.priority),
    trigger: {
      type: triggerType,
      value: triggerValue
    },
    parameters: normalizedParameters,
    parameterSchema: normalizeParameterSchema(value.parameterSchema, normalizedParameters),
    provider: {
      type: providerType,
      method: providerMethod,
      url: providerUrl,
      headers: normalizeStringMap(provider.headers),
      query: normalizeStringMap(provider.query),
      body: normalizeStringMap(provider.body),
      timeoutMs: typeof provider.timeoutMs === 'number' && Number.isFinite(provider.timeoutMs) ? provider.timeoutMs : undefined
    },
    response: {
      type: responseType,
      textPath
    },
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
  const raw = await fs.readFile(DYNAMIC_COMMANDS_CONFIG_PATH, 'utf8');
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
    const stats = await fs.stat(DYNAMIC_COMMANDS_CONFIG_PATH);
    if (!forceReload && initialized && stats.mtimeMs === cachedMtimeMs) {
      return cachedCommands;
    }
    cachedCommands = await readCommandsFromDisk();
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
    const stats = await fs.stat(DYNAMIC_COMMANDS_CONFIG_PATH);
    if (initialized && stats.mtimeMs === cachedMtimeMs) {
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
