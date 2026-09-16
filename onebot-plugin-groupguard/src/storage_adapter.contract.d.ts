import type { GroupSettingsOverride } from './types';

declare module './storage_adapter' {
  interface StorageAdapter {
    /** SQLite persists raw per-group overlays; callers do not need complete effective settings. */
    saveGroupConfig(groupId: string, cfg: GroupSettingsOverride): void;
    replaceAllGroupConfigs(
      groups: Record<string, GroupSettingsOverride>,
      beforeCommit?: () => void
    ): void;
    saveGroupConfigs(groups: Record<string, GroupSettingsOverride>): void;
    migrateFromJson(configDir: string, groupsFromConfig: Record<string, GroupSettingsOverride>): void;
  }
}

export {};
