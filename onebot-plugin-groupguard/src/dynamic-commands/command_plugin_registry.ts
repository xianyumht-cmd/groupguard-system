import { loadDynamicCommands } from './command_loader';
import {
  getCommandPluginMetadata,
  getCommandPluginRuntimeConfig,
  getCommandPluginStoreVersion,
  getCommandPluginRuntimeState,
  getMergedCommandPluginConfig,
  getRegisteredCommandPlugins,
  isCommandPluginEnabled
} from './command_plugin_store';
import { createIntranetDynamicCommandPlugin } from './intranet_dynamic_command_plugin';
import { assertCommandPluginContract } from './command_runtime_plugin';
import type { CommandPlugin } from './command_runtime_plugin';
import type { CommandRuntimeSchemaModule, DynamicCommandDefinition } from './types';

let cachedDefinitionsRef: DynamicCommandDefinition[] | null = null;
let cachedStoreVersion = -1;
let cachedPluginList: CommandPlugin[] = [];
let cachedAllPluginList: CommandPlugin[] = [];
let cachedPluginMap = new Map<string, CommandPlugin>();
let cachedAllPluginMap = new Map<string, CommandPlugin>();
let cachedSchemaModules: CommandRuntimeSchemaModule[] = [];
let lastRegistryBootError: Error | null = null;

function rebuildPluginCaches(): void {
  const definitions = loadDynamicCommands();
  const storeVersion = getCommandPluginStoreVersion();
  if (cachedDefinitionsRef === definitions && cachedStoreVersion === storeVersion) return;
  try {
    const nextMap = new Map<string, CommandPlugin>();
    for (const definition of definitions) {
      if (definition.provider.type !== 'intranet') continue;
      const plugin = createIntranetDynamicCommandPlugin(definition, 'json');
      assertCommandPluginContract(plugin);
      nextMap.set(definition.id, plugin);
    }
    const registered = getRegisteredCommandPlugins();
    for (const plugin of registered) {
      assertCommandPluginContract(plugin);
    }
    const overrideIds = new Set(registered.map((plugin) => plugin.definition.id));
    const generated = Array.from(nextMap.values()).filter((plugin) => !overrideIds.has(plugin.definition.id));
    const allPlugins = [...generated, ...registered].sort((left, right) => {
      const priorityDiff = (right.definition.priority || 0) - (left.definition.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return left.definition.id.localeCompare(right.definition.id);
    });
    const pluginList = allPlugins.filter((plugin) => isCommandPluginEnabled(plugin));
    const pluginMap = new Map<string, CommandPlugin>();
    const allPluginMap = new Map<string, CommandPlugin>();
    for (const plugin of allPlugins) {
      if (allPluginMap.has(plugin.definition.id)) {
        throw new Error(`command_plugin_duplicate:${plugin.definition.id}`);
      }
      allPluginMap.set(plugin.definition.id, plugin);
    }
    for (const plugin of pluginList) {
      if (pluginMap.has(plugin.definition.id)) {
        throw new Error(`command_plugin_duplicate:${plugin.definition.id}`);
      }
      pluginMap.set(plugin.definition.id, plugin);
    }
    cachedDefinitionsRef = definitions;
    cachedStoreVersion = storeVersion;
    cachedPluginList = pluginList;
    cachedAllPluginList = allPlugins;
    cachedPluginMap = pluginMap;
    cachedAllPluginMap = allPluginMap;
    cachedSchemaModules = [
      {
        id: 'dynamic',
        name: '动态命令',
        items: allPlugins.map((plugin) => ({
          ...plugin.schema,
          enabled: getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false).enabled
        }))
      }
    ];
    lastRegistryBootError = null;
  } catch (error) {
    lastRegistryBootError = error as Error;
    throw error;
  }
}

export function refreshCommandPluginRegistry(): void {
  rebuildPluginCaches();
}

export function assertCommandPluginRegistryReady(): void {
  rebuildPluginCaches();
  if (lastRegistryBootError) {
    throw lastRegistryBootError;
  }
}

export function getCommandPlugin(commandId: string): CommandPlugin | null {
  rebuildPluginCaches();
  return cachedPluginMap.get(commandId) || null;
}

export function getCommandPluginRecord(commandId: string): {
  plugin: CommandPlugin;
  metadata: ReturnType<typeof getCommandPluginMetadata>;
  enabled: boolean;
  runtimeConfig: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
  schema: CommandPlugin['schema'];
} | null {
  rebuildPluginCaches();
  const plugin = cachedAllPluginMap.get(commandId);
  if (!plugin) return null;
  const enabled = getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false).enabled;
  return {
    plugin,
    metadata: getCommandPluginMetadata(plugin),
    enabled,
    runtimeConfig: getCommandPluginRuntimeConfig(plugin.definition.id, plugin.definition.enabled !== false),
    effectiveConfig: getMergedCommandPluginConfig(plugin),
    schema: {
      ...plugin.schema,
      enabled
    }
  };
}

export function listCommandPlugins(): CommandPlugin[] {
  rebuildPluginCaches();
  return cachedPluginList;
}

export function listAllCommandPlugins(): CommandPlugin[] {
  rebuildPluginCaches();
  return cachedAllPluginList;
}

export function listCommandPluginDefinitions(): DynamicCommandDefinition[] {
  rebuildPluginCaches();
  return cachedAllPluginList.map((plugin) => plugin.definition);
}

export function getCommandRuntimeSchemaModules(): CommandRuntimeSchemaModule[] {
  rebuildPluginCaches();
  return cachedSchemaModules;
}

export function listCommandPluginManagementRecords() {
  rebuildPluginCaches();
  return cachedAllPluginList.map((plugin) => ({
    id: plugin.definition.id,
    source: plugin.source,
    metadata: getCommandPluginMetadata(plugin),
    enabled: getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false).enabled,
    runtimeConfig: getCommandPluginRuntimeConfig(plugin.definition.id, plugin.definition.enabled !== false),
    effectiveConfig: getMergedCommandPluginConfig(plugin),
    schema: {
      ...plugin.schema,
      enabled: getCommandPluginRuntimeState(plugin.definition.id, plugin.definition.enabled !== false).enabled
    },
    trigger: plugin.definition.trigger,
    priority: plugin.definition.priority || 0
  }));
}
