import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import {
  compactNewInheritedValues,
  deleteGroupOverridePath,
  getGroupConfigSourceMap,
  isGroupFullyInherited,
  normalizeGroupOverride,
  setGroupOverridePath,
  type GroupSettingsOverride,
} from '../../config_effective';
import { storageAdapter } from '../../storage_adapter';
import type { GroupGuardSettings } from '../../types';
import { applyPatch } from './object_patch';
import type { JsonRecord, SnowLumaAdminServerOptions } from './types';

const QUERY_GROUP_PATCH_KEYS = new Set([
  'queryEnabled',
  'disableLolQuery',
  'lolQueryOutputFormat',
  'shardQueryOutputFormat',
  'lolQueryRequestTimeoutSeconds',
  'lolQueryGroupMinIntervalSeconds',
  'lolQueryGroupRateLimitPerMinute',
  'lolQueryDailyLimit'
]);

function cleanGroupId(groupId: string): string {
  const normalized = String(groupId || '').trim();
  if (!/^\d{4,20}$/.test(normalized)) throw new Error('群号格式不正确');
  return normalized;
}

function hasQueryGroupPatch(patch: JsonRecord): boolean {
  return Object.keys(patch || {}).some(key => (
    QUERY_GROUP_PATCH_KEYS.has(key)
    || key.startsWith('featureSwitches.query.')
    || key.startsWith('lolQueryCommandSwitch.')
    || (key === 'featureSwitches' && Object.keys(patch.featureSwitches || {}).some(item => item.startsWith('query.')))
    || (key === 'lolQueryCommandSwitch' && patch.lolQueryCommandSwitch && typeof patch.lolQueryCommandSwitch === 'object')
  ));
}

function cloneGroups(): Record<string, GroupGuardSettings> {
  return JSON.parse(JSON.stringify(configStateService.getGroups() || {}));
}

function allKnownGroupIds(): string[] {
  const groups = configStateService.getGroups() || {};
  const licenses = configStateService.getLicenses() || {};
  return Array.from(new Set([...Object.keys(groups), ...Object.keys(licenses)]))
    .filter(id => /^\d{4,20}$/.test(id))
    .sort((a, b) => Number(a) - Number(b));
}

function resolveTargetGroupIds(groupIds?: unknown): string[] {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return allKnownGroupIds();
  return Array.from(new Set(groupIds.map(id => cleanGroupId(String(id))))).sort((a, b) => Number(a) - Number(b));
}

function persistGroupMutation<T>(options: SnowLumaAdminServerOptions, mutate: () => T): T {
  const previous = cloneGroups();
  try {
    const result = mutate();
    const current = configStateService.getGroups() || {};
    // Normal config saves intentionally treat an empty runtime group map as
    // ambiguous. Here the map is the direct result of an explicit group
    // mutation, so if a previously non-empty snapshot became empty we must
    // persist that intentional delete-all-of-overrides result to SQLite.
    const explicitlyBecameEmpty = Object.keys(previous).length > 0 && Object.keys(current).length === 0;
    saveConfigStrict(options.ctx, { allowEmptyGroupPersistence: explicitlyBecameEmpty });
    return result;
  } catch (error) {
    configStateService.getConfig().groups = previous;
    throw error;
  }
}

function hasDormantOverrides(settings: GroupSettingsOverride): boolean {
  return Object.keys(settings).some(key => key !== 'useGlobal');
}

function isEmptyActiveOverlay(settings: GroupSettingsOverride): boolean {
  return settings.useGlobal !== true && !hasDormantOverrides(settings);
}

function storeGroupOverride(groupId: string, settings: GroupSettingsOverride): void {
  if (isEmptyActiveOverlay(settings)) configStateService.deleteGroupSettings(groupId);
  else configStateService.setGroupSettings(groupId, settings as GroupGuardSettings);
}

function sameOverride(left: GroupSettingsOverride, right: GroupSettingsOverride): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function listGroups() {
  const config = configStateService.getConfig();
  const groups = configStateService.getGroups() || {};
  const licenses = configStateService.getLicenses() || {};
  const groupIds = Array.from(new Set([...Object.keys(licenses), ...Object.keys(groups)])).sort((a, b) => Number(a) - Number(b));
  return groupIds.map(groupId => {
    const stored = groups[groupId];
    const sources = getGroupConfigSourceMap(config.global, stored);
    return {
      groupId,
      configured: Boolean(stored),
      licensed: Boolean(licenses[groupId]),
      license: licenses[groupId] || null,
      useGlobal: isGroupFullyInherited(stored),
      overrideFieldCount: Object.values(sources).filter(source => source === 'group').length,
      name: (config as any).groupNames?.[groupId] || ''
    };
  });
}

export function getGroupConfig(groupId: string) {
  const id = cleanGroupId(groupId);
  const global = configStateService.getGlobalSettings();
  const stored = configStateService.getGroupSettings(id);
  const group = normalizeGroupOverride(stored);
  const effective = configStateService.resolveGroupSettings(id);
  const sources = getGroupConfigSourceMap(global, stored);
  return {
    groupId: id,
    global,
    group,
    effective,
    sources,
    configured: Boolean(stored),
    useGlobal: isGroupFullyInherited(stored),
    license: configStateService.getLicenses()?.[id] || null
  };
}

export function saveGroupConfig(options: SnowLumaAdminServerOptions, groupId: string, groupSettings: JsonRecord): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  const normalized = normalizeGroupOverride(groupSettings);
  return persistGroupMutation(options, () => {
    storeGroupOverride(id, normalized);
    return getGroupConfig(id);
  });
}

export function patchGroupConfig(options: SnowLumaAdminServerOptions, groupId: string, patch: JsonRecord): any {
  // The existing HTTP router treats every /api/groups/:id POST uniformly.
  // Reserve the non-numeric "batch" pseudo-id so bulk operations remain
  // backward-compatible without adding a second routing surface.
  if (String(groupId) === 'batch') {
    const operation = String(patch?.__operation || '').trim();
    if (operation === 'set-path') {
      return batchPatchGroupConfigPath(options, {
        path: String(patch?.path || ''),
        value: patch?.value,
        groupIds: patch?.groupIds,
      });
    }
    if (operation === 'restore-path') {
      return batchRestoreGroupConfigPath(options, {
        path: String(patch?.path || ''),
        groupIds: patch?.groupIds,
      });
    }
    if (operation === 'set-inheritance') {
      return batchSetGroupInheritance(options, {
        useGlobal: patch?.useGlobal === true,
        groupIds: patch?.groupIds,
      });
    }
    throw new Error('不支持的批量配置操作');
  }

  const id = cleanGroupId(groupId);
  if (typeof patch?.__restorePath === 'string' && patch.__restorePath.trim()) {
    return restoreGroupConfigPath(options, id, patch.__restorePath);
  }

  const current = normalizeGroupOverride(configStateService.getGroupSettings(id));
  const normalizedPatch: JsonRecord = { ...(patch || {}) };
  delete normalizedPatch.__restorePath;
  if (hasQueryGroupPatch(normalizedPatch)) normalizedPatch.useGlobal = false;
  const candidate = applyPatch(current as JsonRecord, normalizedPatch);
  const next = compactNewInheritedValues(configStateService.getGlobalSettings(), current, candidate);
  return persistGroupMutation(options, () => {
    storeGroupOverride(id, next);
    return getGroupConfig(id);
  });
}

export function restoreGroupConfigPath(
  options: SnowLumaAdminServerOptions,
  groupId: string,
  path: string
): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  const current = configStateService.getGroupSettings(id);
  const next = deleteGroupOverridePath(current, path);
  return persistGroupMutation(options, () => {
    storeGroupOverride(id, next);
    return getGroupConfig(id);
  });
}

export function batchPatchGroupConfigPath(
  options: SnowLumaAdminServerOptions,
  input: { path: string; value: unknown; groupIds?: unknown; }
) {
  const path = String(input?.path || '').trim();
  if (!path || path === 'useGlobal') throw new Error('请选择可覆盖的配置字段');
  const ids = resolveTargetGroupIds(input?.groupIds);
  if (!ids.length) throw new Error('没有可应用的群');

  const result = persistGroupMutation(options, () => {
    const updated: string[] = [];
    const skippedDormant: string[] = [];
    for (const id of ids) {
      const raw = configStateService.getGroupSettings(id);
      const stored = normalizeGroupOverride(raw);
      // An explicit useGlobal=true row may contain old dormant overrides. Never
      // delete or reactivate those unknown historical values as a side effect of
      // setting one field. Rows with no dormant data can safely enter override mode.
      if (raw && stored.useGlobal === true && hasDormantOverrides(stored)) {
        skippedDormant.push(id);
        continue;
      }
      const next = setGroupOverridePath({ ...stored, useGlobal: false }, path, input.value);
      configStateService.setGroupSettings(id, next as GroupGuardSettings);
      updated.push(id);
    }
    return { updated, skippedDormant };
  });

  return {
    ok: true,
    operation: 'set-path',
    path,
    value: input.value,
    updated: result.updated.length,
    groupIds: result.updated,
    skippedDormant: result.skippedDormant.length,
    skippedDormantGroupIds: result.skippedDormant,
    targetCount: ids.length
  };
}

export function batchRestoreGroupConfigPath(
  options: SnowLumaAdminServerOptions,
  input: { path: string; groupIds?: unknown; }
) {
  const path = String(input?.path || '').trim();
  if (!path || path === 'useGlobal') throw new Error('请选择可恢复继承的配置字段');
  const ids = resolveTargetGroupIds(input?.groupIds);
  if (!ids.length) throw new Error('没有可处理的群');

  const changed = persistGroupMutation(options, () => {
    const updated: string[] = [];
    for (const id of ids) {
      const raw = configStateService.getGroupSettings(id);
      if (!raw) continue;
      const current = normalizeGroupOverride(raw);
      const next = deleteGroupOverridePath(current, path);
      if (sameOverride(current, next)) continue;
      storeGroupOverride(id, next);
      updated.push(id);
    }
    return updated;
  });

  return {
    ok: true,
    operation: 'restore-path',
    path,
    updated: changed.length,
    groupIds: changed,
    targetCount: ids.length
  };
}

export function batchSetGroupInheritance(
  options: SnowLumaAdminServerOptions,
  input: { useGlobal: boolean; groupIds?: unknown; }
) {
  const useGlobal = input?.useGlobal === true;
  const ids = resolveTargetGroupIds(input?.groupIds);
  if (!ids.length) throw new Error('没有可应用的群');

  const changed = persistGroupMutation(options, () => {
    const updated: string[] = [];
    for (const id of ids) {
      const raw = configStateService.getGroupSettings(id);
      const stored = normalizeGroupOverride(raw);
      const currentlyGlobal = isGroupFullyInherited(raw);
      if (currentlyGlobal === useGlobal) continue;
      if (!raw) continue;
      // Turning inheritance off only has meaning when there are dormant values
      // to reactivate. Do not create a {useGlobal:false}-only row that looks like
      // a group override but changes no effective field.
      if (!useGlobal && !hasDormantOverrides(stored)) continue;
      const next = { ...stored, useGlobal } as GroupSettingsOverride;
      storeGroupOverride(id, next);
      updated.push(id);
    }
    return updated;
  });

  return { ok: true, operation: 'set-inheritance', useGlobal, updated: changed.length, groupIds: changed, targetCount: ids.length };
}

export function deleteGroupConfig(options: SnowLumaAdminServerOptions, groupId: string): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  const previous = configStateService.getGroupSettings(id);
  configStateService.deleteGroupSettings(id);
  try {
    // Deletion is intentionally explicit. Generic config saves are not allowed
    // to infer a delete-all operation from an empty runtime group map.
    storageAdapter.deleteGroupConfig(id);
    saveConfigStrict(options.ctx);
  } catch (error) {
    if (previous) {
      configStateService.setGroupSettings(id, previous);
      try { storageAdapter.saveGroupConfig(id, previous); } catch { /* preserve original failure */ }
    }
    throw error;
  }
  return getGroupConfig(id);
}
