import { authManager } from '../auth';
import { getGroupGuardBotRole, shouldBlockByBotRole } from './bot_role';
import { authStateService } from './state-services/auth_state_service';
import { communicationStateService } from './state-services/communication_state_service';
import { configStateService } from './state-services/config_state_service';
import type { FeaturePermission, FeatureScope, FeatureType, GroupGuardSettings, SilentMode } from '../types';

export interface FeatureGateInput {
  featureType: FeatureType;
  featureKey: string;
  groupId?: string;
  userId?: string;
  messageType?: 'group' | 'private';
  source?: 'json' | 'plugin' | 'builtin' | 'passive';
  scope?: FeatureScope;
  allowedGroups?: string[];
  blockedGroups?: string[];
  requiresLicense?: boolean;
  permission?: FeaturePermission;
  passiveReply?: boolean;
  botSend?: boolean;
  ownerBypass?: boolean;
}

export interface FeatureGateResult {
  allowed: boolean;
  reason: string;
}

const DEFAULT_FEATURE_KEY = 'unknown';

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function getSettings(groupId?: string): GroupGuardSettings {
  if (groupId) return configStateService.resolveGroupSettings(groupId);
  return configStateService.getConfig().global || ({} as GroupGuardSettings);
}

function getSilentMode(settings: GroupGuardSettings): SilentMode {
  return settings.silentMode === 'noPassiveReply' || settings.silentMode === 'noBotSend'
    ? settings.silentMode
    : 'off';
}

function isLolFeatureDisabledByLegacy(settings: GroupGuardSettings, featureKey: string): boolean {
  if (!featureKey.startsWith('query.lol_')) return false;
  if (settings.disableLolQuery === true) return true;
  const switches = settings.lolQueryCommandSwitch || {};
  if (featureKey === 'query.lol_ban') return (switches as any).banQuery === false;
  if (featureKey === 'query.lol_battle') return (switches as any).battleQuery === false;
  if (featureKey === 'query.lol_hidden') return (switches as any).hiddenQuery === false;
  return false;
}

function isFeatureSwitchEnabled(settings: GroupGuardSettings, featureKey: string): boolean {
  const switches = settings.featureSwitches || {};
  if (Object.prototype.hasOwnProperty.call(switches, featureKey)) {
    return switches[featureKey] !== false;
  }
  if (featureKey === 'qa.auto_reply' && settings.disableQA === true) return false;
  if (isLolFeatureDisabledByLegacy(settings, featureKey)) return false;
  return true;
}

function getQueryProfileType(featureKey: string): string {
  const map: Record<string, string> = {
    'query.lol_ban': 'lol_ban',
    'query.lol_battle': 'lol_battle',
    'query.lol_hidden': 'lol_hidden',
    'query.lol_shard': 'lol_shard',
    'query.scammer': 'scammer',
    'query.peer': 'peer'
  };
  return map[featureKey] || '';
}

function isQueryProfileEnabled(featureKey: string): boolean {
  const type = getQueryProfileType(featureKey);
  if (!type) return true;
  const profiles = (configStateService.getConfig() as any).queryCommandProfiles;
  return profiles?.[type]?.enabled !== false;
}

function isFeatureFamilyEnabled(settings: GroupGuardSettings, featureType: FeatureType): boolean {
  if (featureType === 'qa') {
    if (settings.disableQA === true) return false;
    return normalizeBool(settings.qaEnabled, true);
  }
  if (featureType === 'query') {
    return normalizeBool(settings.queryEnabled, true);
  }
  return true;
}

function isScopeAllowed(scope: FeatureScope, messageType: 'group' | 'private'): boolean {
  if (scope === 'global' || scope === 'both') return true;
  if (scope === 'group') return messageType === 'group';
  if (scope === 'private') return messageType === 'private';
  return false;
}

async function hasPermission(permission: FeaturePermission, groupId: string | undefined, userId: string | undefined): Promise<boolean> {
  if (!userId) return permission === 'all';
  if (permission === 'all') return true;
  if (authStateService.isOwner(userId)) return true;
  if (permission === 'owner') return false;
  if (!groupId) return false;
  try {
    const info = await communicationStateService.callApi('get_group_member_info', {
      group_id: groupId,
      user_id: userId
    }) as any;
    return info?.role === 'admin' || info?.role === 'owner';
  } catch {
    return false;
  }
}

export async function checkFeatureGate(input: FeatureGateInput): Promise<FeatureGateResult> {
  const groupId = input.groupId ? String(input.groupId) : '';
  const userId = input.userId ? String(input.userId) : '';
  const messageType = input.messageType || (groupId ? 'group' : 'private');
  const settings = getSettings(groupId || undefined);
  const featureType = input.featureType || 'dynamic';
  const featureKey = input.featureKey || DEFAULT_FEATURE_KEY;
  const botRole = getGroupGuardBotRole();
  const ownerBypass = input.ownerBypass === true && userId && authStateService.isOwner(userId);

  if (ownerBypass && messageType === 'private') {
    return { allowed: true, reason: 'owner_private_bypass' };
  }

  if (settings.masterEnabled === false) {
    return { allowed: false, reason: 'master_disabled' };
  }

  const silentMode = getSilentMode(settings);
  if (silentMode === 'noBotSend' && input.botSend !== false) {
    return { allowed: false, reason: 'silent_no_bot_send' };
  }
  if (silentMode === 'noPassiveReply' && input.passiveReply === true) {
    return { allowed: false, reason: 'silent_no_passive_reply' };
  }

  if (input.source === 'json' && settings.dynamicCommandEnabled === false) {
    return { allowed: false, reason: 'dynamic_command_disabled' };
  }

  if (input.botSend !== false && settings.activeReplyEnabled === false) {
    return { allowed: false, reason: 'active_reply_disabled' };
  }

  const roleBlock = shouldBlockByBotRole({
    source: input.source === 'passive' ? 'passive_service' : 'dynamic_command',
    featureType,
    featureKey,
    rawMessage: featureKey
  });
  if (roleBlock.blocked) {
    return { allowed: false, reason: roleBlock.reason || `bot_role_${botRole}_blocked` };
  }

  if (botRole === 'qa' && featureType === 'query') {
    return { allowed: false, reason: 'bot_role_query_blocked' };
  }
  if (botRole === 'query' && featureType === 'qa') {
    return { allowed: false, reason: 'bot_role_qa_blocked' };
  }

  if (!isFeatureFamilyEnabled(settings, featureType)) {
    return { allowed: false, reason: `${featureType}_disabled` };
  }

  if (!isQueryProfileEnabled(featureKey)) {
    return { allowed: false, reason: 'query_profile_disabled' };
  }

  if (!isFeatureSwitchEnabled(settings, featureKey)) {
    return { allowed: false, reason: 'feature_switch_disabled' };
  }

  const scope = input.scope || 'group';
  if (!isScopeAllowed(scope, messageType)) {
    return { allowed: false, reason: 'scope_mismatch' };
  }

  if (messageType === 'group') {
    if (!groupId) return { allowed: false, reason: 'missing_group' };
    const blocked = (input.blockedGroups || []).map(String);
    const allowed = (input.allowedGroups || []).map(String);
    if (blocked.includes(groupId)) return { allowed: false, reason: 'group_blocked' };
    if (allowed.length && !allowed.includes(groupId)) return { allowed: false, reason: 'group_not_allowed' };
    if (input.requiresLicense !== false && !authManager.getGroupLicense(groupId)) {
      return { allowed: false, reason: 'group_unlicensed' };
    }
  }

  const permission = input.permission || 'all';
  if (!await hasPermission(permission, groupId || undefined, userId || undefined)) {
    return { allowed: false, reason: 'permission_denied' };
  }

  return { allowed: true, reason: 'allowed' };
}

export function getFeatureGateSnapshot(groupId?: string) {
  const settings = getSettings(groupId);
  return {
    masterEnabled: settings.masterEnabled !== false,
    silentMode: getSilentMode(settings),
    activeReplyEnabled: settings.activeReplyEnabled !== false,
    queryEnabled: settings.queryEnabled !== false,
    qaEnabled: settings.disableQA !== true && settings.qaEnabled !== false,
    dynamicCommandEnabled: settings.dynamicCommandEnabled !== false,
    featureSwitches: { ...(settings.featureSwitches || {}) },
    legacy: {
      disableQA: settings.disableQA === true,
      disableLolQuery: settings.disableLolQuery === true,
      lolQueryCommandSwitch: settings.lolQueryCommandSwitch || {}
    }
  };
}
