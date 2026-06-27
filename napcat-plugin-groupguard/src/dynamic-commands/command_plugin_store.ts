import fs from 'fs';
import path from 'path';
import { contextStateService } from '../core/state-services/context_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { assertCommandPluginContract } from './command_runtime_plugin';
import type { CommandPlugin } from './command_runtime_plugin';
import type { CommandPluginMetadata, CommandPluginRuntimeState, DynamicCommandDefinition } from './types';

const registeredCommandPlugins = new Map<string, CommandPlugin>();
const pluginRuntimeStates = new Map<string, CommandPluginRuntimeState>();
function getPluginRuntimeStorePath(): string {
  const configDir = contextStateService.getConfigDir();
  return configDir
    ? path.resolve(configDir, 'command-plugin-state.json')
    : path.resolve(process.cwd(), 'data', 'command-plugin-state.json');
}
let pluginRuntimeStoreInitialized = false;
let commandPluginStoreVersion = 0;

function normalizeRuntimeState(input: unknown): CommandPluginRuntimeState {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const runtimeConfig = source.runtimeConfig && typeof source.runtimeConfig === 'object' && !Array.isArray(source.runtimeConfig)
    ? source.runtimeConfig as Record<string, unknown>
    : source.config && typeof source.config === 'object' && !Array.isArray(source.config)
      ? source.config as Record<string, unknown>
    : {};
  return {
    enabled: source.enabled !== false,
    runtimeConfig: { ...runtimeConfig }
  };
}

function ensurePluginRuntimeStoreLoaded(): void {
  if (pluginRuntimeStoreInitialized) return;
  pluginRuntimeStoreInitialized = true;
  try {
    const storePath = getPluginRuntimeStorePath();
    if (!fs.existsSync(storePath)) return;
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as { plugins?: Record<string, unknown>; };
    for (const [pluginId, state] of Object.entries(parsed.plugins || {})) {
      pluginRuntimeStates.set(pluginId, normalizeRuntimeState(state));
    }
  } catch (error) {
    loggingStateService.warn(`[CommandPluginStore] runtime state load failed: ${error}`);
  }
}

function savePluginRuntimeStore(): void {
  ensurePluginRuntimeStoreLoaded();
  try {
    const storePath = getPluginRuntimeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      plugins: Object.fromEntries(pluginRuntimeStates.entries())
    }, null, 2), 'utf8');
  } catch (error) {
    loggingStateService.warn(`[CommandPluginStore] runtime state save failed: ${error}`);
  }
}

function ensurePluginRuntimeState(plugin: CommandPlugin): CommandPluginRuntimeState {
  ensurePluginRuntimeStoreLoaded();
  if (!pluginRuntimeStates.has(plugin.definition.id)) {
    pluginRuntimeStates.set(plugin.definition.id, {
      enabled: plugin.definition.enabled !== false,
      runtimeConfig: {}
    });
  }
  return pluginRuntimeStates.get(plugin.definition.id)!;
}

export function registerCommandPlugin(plugin: CommandPlugin): void {
  registerCommandPluginBatch([plugin]);
}

export function registerCommandPluginBatch(plugins: CommandPlugin[]): void {
  ensurePluginRuntimeStoreLoaded();
  const nextEntries = new Map<string, CommandPlugin>();
  for (const plugin of plugins) {
    assertCommandPluginContract(plugin);
    if (nextEntries.has(plugin.definition.id) || registeredCommandPlugins.has(plugin.definition.id)) {
      throw new Error(`command_plugin_duplicate:${plugin.definition.id}`);
    }
    nextEntries.set(plugin.definition.id, plugin);
  }
  for (const [commandId, plugin] of nextEntries.entries()) {
    registeredCommandPlugins.set(commandId, plugin);
    ensurePluginRuntimeState(plugin);
  }
  if (nextEntries.size > 0) {
    commandPluginStoreVersion += 1;
  }
}

export function getRegisteredCommandPlugins(): CommandPlugin[] {
  return Array.from(registeredCommandPlugins.values());
}

export function getRegisteredCommandPluginDefinitions(): DynamicCommandDefinition[] {
  return getRegisteredCommandPlugins().map((plugin) => plugin.definition);
}

export function getCommandPluginMetadata(plugin: CommandPlugin): CommandPluginMetadata {
  return plugin.metadata;
}

export function getCommandPluginRuntimeState(pluginId: string, fallbackEnabled = true): CommandPluginRuntimeState {
  ensurePluginRuntimeStoreLoaded();
  return pluginRuntimeStates.get(pluginId) || {
    enabled: fallbackEnabled,
    runtimeConfig: {}
  };
}

export function getMergedCommandPluginConfig(plugin: CommandPlugin): Record<string, unknown> {
  const runtimeState = getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false);
  return {
    ...(plugin.defaultConfig || {}),
    ...(runtimeState.runtimeConfig || {})
  };
}

export function getCommandPluginRuntimeConfig(pluginId: string, fallbackEnabled = true): Record<string, unknown> {
  return {
    ...getCommandPluginRuntimeState(pluginId, fallbackEnabled).runtimeConfig
  };
}

export function isCommandPluginEnabled(plugin: CommandPlugin): boolean {
  return getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false).enabled;
}

export function setCommandPluginEnabled(pluginId: string, enabled: boolean): void {
  ensurePluginRuntimeStoreLoaded();
  const current = getCommandPluginRuntimeState(pluginId);
  pluginRuntimeStates.set(pluginId, {
    enabled,
    runtimeConfig: { ...(current.runtimeConfig || {}) }
  });
  savePluginRuntimeStore();
  commandPluginStoreVersion += 1;
}

export function setCommandPluginRuntimeConfig(pluginId: string, runtimeConfig: Record<string, unknown>): void {
  ensurePluginRuntimeStoreLoaded();
  const current = getCommandPluginRuntimeState(pluginId);
  pluginRuntimeStates.set(pluginId, {
    enabled: current.enabled,
    runtimeConfig: { ...(runtimeConfig || {}) }
  });
  savePluginRuntimeStore();
  commandPluginStoreVersion += 1;
}

export function getCommandPluginStoreVersion(): number {
  ensurePluginRuntimeStoreLoaded();
  return commandPluginStoreVersion;
}
