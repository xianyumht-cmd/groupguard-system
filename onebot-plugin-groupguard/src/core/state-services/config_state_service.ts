import type { GroupGuardSettings, GroupSettingsOverride, PluginConfig } from '../../types';
import { pluginStateConfigAdapter } from '../state-infra/plugin_state_config_adapter';

export class ConfigStateService {
  getConfig(): PluginConfig {
    return pluginStateConfigAdapter.getConfig();
  }

  setConfig(config: PluginConfig): void {
    pluginStateConfigAdapter.setConfig(config);
  }

  getGlobalSettings(): GroupGuardSettings {
    return pluginStateConfigAdapter.getGlobalSettings();
  }

  setGlobalSettings(settings: GroupGuardSettings): void {
    pluginStateConfigAdapter.setGlobalSettings(settings);
  }

  getGroups(): Record<string, GroupSettingsOverride> {
    return pluginStateConfigAdapter.getGroups();
  }

  getGroupSettings(groupId: string): GroupSettingsOverride | undefined {
    return pluginStateConfigAdapter.getGroupSettings(groupId);
  }

  setGroupSettings(groupId: string, settings: GroupSettingsOverride): void {
    pluginStateConfigAdapter.setGroupSettings(groupId, settings);
  }

  deleteGroupSettings(groupId: string): void {
    pluginStateConfigAdapter.deleteGroupSettings(groupId);
  }

  resolveGroupSettings(groupId: string): GroupGuardSettings {
    return pluginStateConfigAdapter.resolveGroupSettings(groupId);
  }

  getLicenses(): Record<string, any> {
    return pluginStateConfigAdapter.getLicenses();
  }

  getBlacklist(): string[] {
    return pluginStateConfigAdapter.getBlacklist();
  }

  setBlacklist(list: string[]): void {
    pluginStateConfigAdapter.setBlacklist(list);
  }

  getWhitelist(): string[] {
    return pluginStateConfigAdapter.getWhitelist();
  }

  setWhitelist(list: string[]): void {
    pluginStateConfigAdapter.setWhitelist(list);
  }

  getPresets(): any[] {
    return pluginStateConfigAdapter.getPresets();
  }

  setPresets(presets: any[]): void {
    pluginStateConfigAdapter.setPresets(presets);
  }
}

export const configStateService = new ConfigStateService();
