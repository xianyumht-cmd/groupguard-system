import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import type { GroupGuardSettings } from '../../types';
import { applyPatch } from './object_patch';
import type { JsonRecord, SnowLumaAdminServerOptions } from './types';

function cleanGroupId(groupId: string): string {
  const normalized = String(groupId || '').trim();
  if (!/^\d{4,20}$/.test(normalized)) throw new Error('群号格式不正确');
  return normalized;
}

export function listGroups() {
  const config = configStateService.getConfig();
  const groups = configStateService.getGroups() || {};
  const licenses = configStateService.getLicenses() || {};
  const groupIds = Array.from(new Set([...Object.keys(licenses), ...Object.keys(groups)])).sort((a, b) => Number(a) - Number(b));
  return groupIds.map(groupId => ({
    groupId,
    configured: Boolean(groups[groupId]),
    licensed: Boolean(licenses[groupId]),
    license: licenses[groupId] || null,
    useGlobal: groups[groupId]?.useGlobal ?? true,
    name: (config as any).groupNames?.[groupId] || ''
  }));
}

export function getGroupConfig(groupId: string) {
  const id = cleanGroupId(groupId);
  const global = configStateService.getGlobalSettings();
  const group = configStateService.getGroupSettings(id) || {} as Partial<GroupGuardSettings>;
  const effective = configStateService.resolveGroupSettings(id);
  return {
    groupId: id,
    global,
    group,
    effective,
    configured: Boolean(configStateService.getGroupSettings(id)),
    license: configStateService.getLicenses()?.[id] || null
  };
}

export function saveGroupConfig(options: SnowLumaAdminServerOptions, groupId: string, groupSettings: JsonRecord): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  configStateService.setGroupSettings(id, groupSettings as GroupGuardSettings);
  saveConfigStrict(options.ctx);
  return getGroupConfig(id);
}

export function patchGroupConfig(options: SnowLumaAdminServerOptions, groupId: string, patch: JsonRecord): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  const current = configStateService.getGroupSettings(id) || {} as JsonRecord;
  const next = applyPatch(current as JsonRecord, patch || {});
  return saveGroupConfig(options, id, next);
}

export function deleteGroupConfig(options: SnowLumaAdminServerOptions, groupId: string): ReturnType<typeof getGroupConfig> {
  const id = cleanGroupId(groupId);
  configStateService.deleteGroupSettings(id);
  saveConfigStrict(options.ctx);
  return getGroupConfig(id);
}
