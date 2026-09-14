import type { FeaturePermission } from '../types';

export type LegacyPermission = FeaturePermission | 'owner/admin';

export function toFeaturePermission(permission: LegacyPermission): FeaturePermission {
  if (permission === 'owner/admin') return 'admin';
  return permission;
}
