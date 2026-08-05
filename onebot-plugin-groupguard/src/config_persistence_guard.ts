import type { GroupGuardSettings } from './types';

export type GroupConfigMap = Record<string, GroupGuardSettings>;

export interface GroupPersistenceSelection {
  groups: GroupConfigMap;
  preservedPersistedGroups: boolean;
  runtimeCount: number;
  persistedCount: number;
}

function normalizeGroupMap(value: unknown): GroupConfigMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GroupConfigMap
    : {};
}

/**
 * An empty runtime map is ambiguous because config.json intentionally stores
 * `groups: {}` while SQLite is the source of truth for per-group settings.
 * Never interpret that ambiguous empty value as a destructive delete-all.
 * Explicit group deletion must use StorageAdapter.deleteGroupConfig().
 */
export function selectGroupsForPersistence(
  runtimeGroups: unknown,
  persistedGroups: unknown
): GroupPersistenceSelection {
  const runtime = normalizeGroupMap(runtimeGroups);
  const persisted = normalizeGroupMap(persistedGroups);
  const runtimeCount = Object.keys(runtime).length;
  const persistedCount = Object.keys(persisted).length;

  if (runtimeCount === 0 && persistedCount > 0) {
    return {
      groups: persisted,
      preservedPersistedGroups: true,
      runtimeCount,
      persistedCount
    };
  }

  return {
    groups: runtime,
    preservedPersistedGroups: false,
    runtimeCount,
    persistedCount
  };
}
