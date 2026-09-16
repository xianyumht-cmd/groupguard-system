import type { GroupGuardSettings, GroupSettingsOverride, PluginConfig } from '../types';
import { configStateService } from '../core/state-services/config_state_service';

export class ConfigGateway {
  getConfig(): PluginConfig {
    return configStateService.getConfig();
  }

  setConfig(config: PluginConfig): void {
    configStateService.setConfig(config);
  }

  getGlobalSettings(): GroupGuardSettings {
    return configStateService.getGlobalSettings();
  }

  setGlobalSettings(settings: GroupGuardSettings): void {
    configStateService.setGlobalSettings(settings);
  }

  getGroups(): Record<string, GroupSettingsOverride> {
    return configStateService.getGroups();
  }

  getGroupSettings(groupId: string): GroupSettingsOverride | undefined {
    return configStateService.getGroupSettings(groupId);
  }

  setGroupSettings(groupId: string, settings: GroupSettingsOverride): void {
    configStateService.setGroupSettings(groupId, settings);
  }

  deleteGroupSettings(groupId: string): void {
    configStateService.deleteGroupSettings(groupId);
  }

  resolveGroupSettings(groupId: string): GroupGuardSettings {
    return configStateService.resolveGroupSettings(groupId);
  }

  getLicenses(): Record<string, any> {
    return configStateService.getLicenses();
  }

  getBlacklist(): string[] {
    return configStateService.getBlacklist();
  }

  setBlacklist(list: string[]): void {
    configStateService.setBlacklist(list);
  }

  getWhitelist(): string[] {
    return configStateService.getWhitelist();
  }

  setWhitelist(list: string[]): void {
    configStateService.setWhitelist(list);
  }

  getPresets(): any[] {
    return configStateService.getPresets();
  }

  setPresets(presets: any[]): void {
    configStateService.setPresets(presets);
  }
}

export const configGateway = new ConfigGateway();
