import type { GroupGuardSettings, PluginConfig } from '../../types';
import { pluginState } from '../../state';

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
    return pluginState.getGroupSettings(groupId);
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
