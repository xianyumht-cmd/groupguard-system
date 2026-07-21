import type {
  DynamicCommandErrorType,
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult
} from './types';

interface PluginAccessPolicy {
  daily_limit?: number;
  allowed_groups?: string[];
  allowed_users?: string[];
}

interface PluginQuotaState {
  dayKey: string;
  count: number;
}

const pluginDailyQuotaStates = new Map<string, PluginQuotaState>();

type UnifiedCommandFailure = Extract<UnifiedCommandExecutionResult, { ok: false }>;

function buildDeniedResult(errorType: Extract<DynamicCommandErrorType, 'plugin_disabled' | 'permission_denied' | 'quota_exceeded'>): UnifiedCommandFailure {
  return {
    ok: false,
    errorType,
    message: errorType
  };
}

function toDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizePolicy(config: Record<string, unknown>): PluginAccessPolicy {
  return {
    daily_limit: Number.isFinite(config.daily_limit) ? Math.max(0, Number(config.daily_limit)) : undefined,
    allowed_groups: Array.isArray(config.allowed_groups)
      ? config.allowed_groups.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    allowed_users: Array.isArray(config.allowed_users)
      ? config.allowed_users.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined
  };
}

function isUserAllowed(policy: PluginAccessPolicy, userId: string): boolean {
  if (!policy.allowed_users?.length) return true;
  return policy.allowed_users.includes(userId);
}

function isGroupAllowed(policy: PluginAccessPolicy, groupId?: string): boolean {
  if (!policy.allowed_groups?.length) return true;
  if (!groupId) return false;
  return policy.allowed_groups.includes(groupId);
}

function consumePluginQuota(pluginId: string, dailyLimit: number): boolean {
  const dayKey = toDayKey();
  const current = pluginDailyQuotaStates.get(pluginId);
  if (!current || current.dayKey !== dayKey) {
    pluginDailyQuotaStates.set(pluginId, { dayKey, count: 1 });
    return true;
  }
  if (current.count >= dailyLimit) {
    return false;
  }
  current.count += 1;
  return true;
}

export function resetPluginQuotaState(): void {
  pluginDailyQuotaStates.clear();
}

export function getPluginQuotaSnapshot(pluginId: string) {
  return pluginDailyQuotaStates.get(pluginId) || null;
}

export function enforcePluginAccessPolicy(context: UnifiedCommandExecutionContext): UnifiedCommandFailure | null {
  if (!context.plugin.enabled) {
    return buildDeniedResult('plugin_disabled');
  }
  const policy = normalizePolicy(context.plugin.effectiveConfig || {});
  const userId = String(context.event.user_id || '');
  const groupId = context.event.group_id ? String(context.event.group_id) : undefined;
  if (!isUserAllowed(policy, userId) || !isGroupAllowed(policy, groupId)) {
    return buildDeniedResult('permission_denied');
  }
  if (policy.daily_limit !== undefined && policy.daily_limit >= 0) {
    if (!consumePluginQuota(context.plugin.metadata.id, policy.daily_limit)) {
      return buildDeniedResult('quota_exceeded');
    }
  }
  return null;
}
