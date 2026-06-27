import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import type { GroupLicense } from '../../types';
import type { SnowLumaAdminServerOptions } from './types';

function cleanGroupId(groupId: string): string {
  const normalized = String(groupId || '').trim();
  if (!/^\d{4,20}$/.test(normalized)) throw new Error('群号格式不正确');
  return normalized;
}

function normalizeLevel(level: any): GroupLicense['level'] {
  return level === 'free' || level === 'enterprise' ? level : 'pro';
}

function normalizeExpireTime(input: any): number {
  const value = Number(input || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function daysToExpireTime(days: any): number {
  const value = Number(days || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Date.now() + Math.floor(value * 24 * 60 * 60 * 1000);
}

function formatLicense(groupId: string, license: GroupLicense | undefined) {
  const expireTime = normalizeExpireTime(license?.expireTime || 0);
  const now = Date.now();
  return {
    groupId,
    level: normalizeLevel(license?.level),
    expireTime,
    permanent: expireTime === 0,
    expired: expireTime > 0 && expireTime <= now,
    remainingDays: expireTime === 0 ? null : Math.max(0, Math.ceil((expireTime - now) / 86400000)),
    expireAt: expireTime === 0 ? '永久' : new Date(expireTime).toLocaleString('zh-CN')
  };
}

export function listLicenses() {
  const licenses = configStateService.getLicenses() || {};
  const groups = configStateService.getGroups() || {};
  const groupIds = Array.from(new Set([...Object.keys(licenses), ...Object.keys(groups)])).sort((a, b) => Number(a) - Number(b));
  return groupIds.map(groupId => formatLicense(groupId, licenses[groupId]));
}

export function getLicense(groupId: string) {
  const id = cleanGroupId(groupId);
  return formatLicense(id, configStateService.getLicenses()?.[id]);
}

export function saveLicense(options: SnowLumaAdminServerOptions, groupId: string, payload: any) {
  const id = cleanGroupId(groupId);
  const config = configStateService.getConfig();
  const expireTime = payload?.permanent ? 0 : (payload?.days ? daysToExpireTime(payload.days) : normalizeExpireTime(payload?.expireTime));
  config.licenses[id] = {
    level: normalizeLevel(payload?.level),
    expireTime
  };
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return getLicense(id);
}

export function deleteLicense(options: SnowLumaAdminServerOptions, groupId: string) {
  const id = cleanGroupId(groupId);
  const config = configStateService.getConfig();
  delete config.licenses[id];
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return getLicense(id);
}
