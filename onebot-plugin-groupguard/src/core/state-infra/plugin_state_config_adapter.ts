import type { GroupGuardSettings, PluginConfig } from '../../types';
import { resolveEffectiveGroupSettings } from '../../config_effective';
import { pluginState } from '../../state';

const RESOLVER_MARK = Symbol.for('groupguard.effective-config-resolver-installed');

type ResolverAwarePluginState = typeof pluginState & { [RESOLVER_MARK]?: boolean };

/**
 * PluginState owns several internal send/risk helpers that call
 * `this.getGroupSettings()` directly. Install the same resolver used by the
 * state-service adapter so every runtime path has identical inheritance
 * semantics. This bridge is intentionally centralized and idempotent until
 * PluginState itself is split into the config domain service.
 */
export function installPluginStateEffectiveConfigResolver(): void {
  const state = pluginState as ResolverAwarePluginState;
  if (state[RESOLVER_MARK]) return;
  state.getGroupSettings = (groupId: string): GroupGuardSettings => (
    resolveEffectiveGroupSettings(state.config.global, state.config.groups[groupId])
  );
  state[RESOLVER_MARK] = true;
}

installPluginStateEffectiveConfigResolver();

export class PluginStateConfigAdapter {
  getConfig(): PluginConfig {
    return pluginState.config;
  }

  setConfig(config: PluginConfig): void {
    pluginState.config = config;
  }

  getGlobalSettings(): GroupGuardSettings {
    return pluginState.config.global;
  }

  setGlobalSettings(settings: GroupGuardSettings): void {
    pluginState.config.global = settings;
  }

  getGroups(): Record<string, GroupGuardSettings> {
    return pluginState.config.groups;
  }

  getGroupSettings(groupId: string): GroupGuardSettings | undefined {
    return pluginState.config.groups[groupId];
  }

  setGroupSettings(groupId: string, settings: GroupGuardSettings): void {
    pluginState.config.groups[groupId] = settings;
  }

  deleteGroupSettings(groupId: string): void {
    delete pluginState.config.groups[groupId];
  }

  resolveGroupSettings(groupId: string): GroupGuardSettings {
    return resolveEffectiveGroupSettings(pluginState.config.global, pluginState.config.groups[groupId]);
  }

  getLicenses(): Record<string, any> {
    return pluginState.config.licenses;
  }

  getBlacklist(): string[] {
    return pluginState.config.blacklist;
  }

  setBlacklist(list: string[]): void {
    pluginState.config.blacklist = list;
  }

  getWhitelist(): string[] {
    return pluginState.config.whitelist;
  }

  setWhitelist(list: string[]): void {
    pluginState.config.whitelist = list;
  }

  getPresets(): any[] {
    return pluginState.config.presets;
  }

  setPresets(presets: any[]): void {
    pluginState.config.presets = presets;
  }
}

export const pluginStateConfigAdapter = new PluginStateConfigAdapter();
