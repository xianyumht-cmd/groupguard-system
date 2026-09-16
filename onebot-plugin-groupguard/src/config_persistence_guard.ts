import type { GroupSettingsOverride } from './types';

export type GroupConfigMap = Record<string, GroupSettingsOverride>;

export interface GroupPersistenceSelection {
  groups: GroupConfigMap;
  preservedPersistedGroups: boolean;
  runtimeCount: number;
  persistedCount: number;
}

export interface GroupPersistencePolicy {
  /**
   * An empty runtime map normally means "do not infer delete-all" because the
   * main JSON intentionally carries groups: {} while SQLite owns group rows.
   * Set this only for an explicit, already-authorized group mutation where an
   * empty result is itself the intended persisted snapshot.
   */
  allowEmptyRuntime?: boolean;
}

function normalizeGroupMap(value: unknown): GroupConfigMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GroupConfigMap
    : {};
}

/**
 * An empty runtime map is ambiguous because config.json intentionally stores
 * `groups: {}` while SQLite is the source of truth for per-group settings.
 * Never interpret that ambiguous empty value as a destructive delete-all
 * unless the caller explicitly marks the runtime snapshot as authoritative.
 */
export function selectGroupsForPersistence(
  runtimeGroups: unknown,
  persistedGroups: unknown,
  policy: GroupPersistencePolicy = {}
): GroupPersistenceSelection {
  const runtime = normalizeGroupMap(runtimeGroups);
  const persisted = normalizeGroupMap(persistedGroups);
  const runtimeCount = Object.keys(runtime).length;
  const persistedCount = Object.keys(persisted).length;

  if (runtimeCount === 0 && persistedCount > 0 && policy.allowEmptyRuntime !== true) {
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
