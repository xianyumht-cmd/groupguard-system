import { configStateService } from '../core/state-services/config_state_service';

interface RateCounterBucket {
  windowStart: number;
  count: number;
}

export interface QueryRateLimitInput {
  groupId: string;
  userId?: string;
  featureKey?: string;
  commandId?: string;
  label?: string;
  source?: 'dispatcher' | 'legacy' | 'direct';
}

export type QueryRateLimitResult = { ok: true } | { ok: false; reason: string; notify: boolean };

const QUERY_RATE_WINDOW_MS = 60_000;
const QUERY_RATE_MAP_LIMIT = 500;
const DISPATCHER_DEDUP_MS = 1500;
const DEFAULT_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS = 30;

const globalRateBucket: RateCounterBucket = { windowStart: 0, count: 0 };
const groupRateBuckets = new Map<string, RateCounterBucket>();
const commandGroupRateBuckets = new Map<string, RateCounterBucket>();
let globalLastQueryAt = 0;
const groupLastQueryAt = new Map<string, number>();
const commandUserLastQueryAt = new Map<string, number>();
const groupDailyBuckets = new Map<string, { day: string; count: number }>();
const recentDispatcherConsumes = new Map<string, number>();
const rateLimitNoticeLastSentAt = new Map<string, number>();

function normalizePositiveInt(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

function ensureRateWindow(bucket: RateCounterBucket, now: number): void {
  if (!bucket.windowStart || now - bucket.windowStart >= QUERY_RATE_WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
}

function resolveSettings(groupId: string) {
  return groupId ? configStateService.resolveGroupSettings(groupId) : configStateService.getGlobalSettings();
}

function normalizeFeatureKey(value: unknown): string {
  const text = String(value || '').trim();
  return text.startsWith('query.') ? text : '';
}

function inferFeatureKeyFromLabel(label: string): string {
  const text = String(label || '').trim();
  if (text.startsWith('查封号')) return 'query.lol_ban';
  if (text.startsWith('查战绩')) return 'query.lol_battle';
  if (text.startsWith('查隐藏')) return 'query.lol_hidden';
  if (text.startsWith('查合集')) return 'query.lol_shard';
  if (text.startsWith('海符榜')) return 'query.lol_shard';
  if (text.startsWith('查骗子') || text.startsWith('举报骗子')) return 'query.scammer';
  if (text.startsWith('查同行') || text.startsWith('举报同行')) return 'query.peer';
  return 'query.generic';
}

function resolveFeatureKey(input: QueryRateLimitInput): string {
  return normalizeFeatureKey(input.featureKey) || inferFeatureKeyFromLabel(input.label || input.commandId || '');
}

function buildGroupCommandKey(groupId: string, featureKey: string): string {
  return `${featureKey}:${groupId}`;
}

function buildUserCommandKey(groupId: string, userId: string, featureKey: string): string {
  return `${featureKey}:${groupId}:${userId}`;
}

function getCommandGroupLimit(settings: any, featureKey: string, fallback: number): number {
  if (featureKey === 'query.lol_ban') {
    return normalizePositiveInt(Number(settings.banQueryGroupRateLimitPerMinute), 6, 1000);
  }
  if (featureKey === 'query.scammer' || featureKey === 'query.peer') {
    return normalizePositiveInt(Number(settings.scammerQueryGroupRateLimitPerMinute), fallback, 1000);
  }
  return fallback;
}

function getCommandUserCooldownSeconds(settings: any, featureKey: string): number {
  if (featureKey === 'query.lol_ban') {
    return Math.max(0, Math.floor(Number(settings.banQueryUserCooldownSeconds ?? 10)));
  }
  if (featureKey === 'query.scammer' || featureKey === 'query.peer') {
    return Math.max(0, Math.floor(Number(settings.scammerQueryUserCooldownSeconds ?? 10)));
  }
  return 0;
}

function isRecentlyConsumedByDispatcher(groupId: string, featureKey: string, now: number): boolean {
  const key = buildGroupCommandKey(groupId, featureKey);
  const last = recentDispatcherConsumes.get(key) || 0;
  return last > 0 && now - last <= DISPATCHER_DEDUP_MS;
}

function rememberDispatcherConsume(groupId: string, featureKey: string, now: number): void {
  recentDispatcherConsumes.set(buildGroupCommandKey(groupId, featureKey), now);
}

function trimMapByInsertionOrder<T>(map: Map<string, T>, limit: number): void {
  if (map.size <= limit) return;
  const keys = Array.from(map.keys());
  for (let i = 0; i < keys.length - limit; i += 1) {
    map.delete(keys[i]);
  }
}

function getNoticeCooldownMs(settings: any): number {
  const raw = Number(
    settings.lolQueryRateLimitNoticeCooldownSeconds
      ?? settings.queryRateLimitNoticeCooldownSeconds
      ?? DEFAULT_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS
  );
  if (!Number.isFinite(raw)) return DEFAULT_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS * 1000;
  return Math.max(0, Math.min(3600, Math.floor(raw))) * 1000;
}

function buildNoticeKey(groupId: string, featureKey: string, reason: string): string {
  return `${groupId}:${featureKey}:${reason}`;
}

function blockQueryRate(settings: any, groupId: string, featureKey: string, reason: string, now: number): QueryRateLimitResult {
  const cooldownMs = getNoticeCooldownMs(settings);
  if (cooldownMs <= 0) return { ok: false, reason, notify: true };

  const noticeKey = buildNoticeKey(groupId, featureKey, reason);
  const lastSentAt = rateLimitNoticeLastSentAt.get(noticeKey) || 0;
  const notify = !lastSentAt || now - lastSentAt >= cooldownMs;
  if (notify) rateLimitNoticeLastSentAt.set(noticeKey, now);
  return { ok: false, reason, notify };
}

export function checkAndConsumeQueryCommandRate(input: QueryRateLimitInput): QueryRateLimitResult {
  const label = String(input.label || '查询').trim() || '查询';
  const normalizedGroupId = String(input.groupId || 'private').trim() || 'private';
  const normalizedUserId = String(input.userId || '').trim();
  const featureKey = resolveFeatureKey(input);
  const settings = resolveSettings(input.groupId);
  const now = Date.now();

  if (input.source !== 'dispatcher' && isRecentlyConsumedByDispatcher(normalizedGroupId, featureKey, now)) {
    return { ok: true };
  }

  if (settings.disableLolQuery) return blockQueryRate(settings, normalizedGroupId, featureKey, `本群${label}功能已关闭`, now);

  const globalLimit = normalizePositiveInt(Number(settings.lolQueryGlobalRateLimitPerMinute), 120, 5000);
  const groupLimit = normalizePositiveInt(Number(settings.lolQueryGroupRateLimitPerMinute), 20, 1000);
  const commandGroupLimit = getCommandGroupLimit(settings, featureKey, groupLimit);
  const globalMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGlobalMinIntervalSeconds ?? 1)));
  const groupMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGroupMinIntervalSeconds ?? 2)));
  const commandUserCooldownSec = getCommandUserCooldownSeconds(settings, featureKey);
  const groupDailyLimit = normalizePositiveInt(Number(settings.lolQueryDailyLimit), 200, 100000);
  const dayKey = new Date(now).toISOString().slice(0, 10);

  ensureRateWindow(globalRateBucket, now);
  let groupBucket = groupRateBuckets.get(normalizedGroupId);
  if (!groupBucket) {
    groupBucket = { windowStart: now, count: 0 };
    groupRateBuckets.set(normalizedGroupId, groupBucket);
  }
  ensureRateWindow(groupBucket, now);

  const groupCommandKey = buildGroupCommandKey(normalizedGroupId, featureKey);
  let commandGroupBucket = commandGroupRateBuckets.get(groupCommandKey);
  if (!commandGroupBucket) {
    commandGroupBucket = { windowStart: now, count: 0 };
    commandGroupRateBuckets.set(groupCommandKey, commandGroupBucket);
  }
  ensureRateWindow(commandGroupBucket, now);

  if (globalRateBucket.count >= globalLimit) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（全局每分钟上限 ${globalLimit} 次）`, now);
  }
  if (groupBucket.count >= groupLimit) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（本群查询每分钟上限 ${groupLimit} 次）`, now);
  }
  if (commandGroupBucket.count >= commandGroupLimit) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（本群该指令每分钟上限 ${commandGroupLimit} 次）`, now);
  }

  const dailyBucketRaw = groupDailyBuckets.get(normalizedGroupId);
  const dailyBucket = (!dailyBucketRaw || dailyBucketRaw.day !== dayKey) ? { day: dayKey, count: 0 } : dailyBucketRaw;
  if (dailyBucket.count >= groupDailyLimit) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}已达本群当日上限（${groupDailyLimit} 次）`, now);
  }
  if (globalMinIntervalSec > 0 && globalLastQueryAt > 0 && now - globalLastQueryAt < globalMinIntervalSec * 1000) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（全局最小间隔 ${globalMinIntervalSec} 秒）`, now);
  }

  const groupLastAt = groupLastQueryAt.get(normalizedGroupId) || 0;
  if (groupMinIntervalSec > 0 && groupLastAt > 0 && now - groupLastAt < groupMinIntervalSec * 1000) {
    return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（本群最小间隔 ${groupMinIntervalSec} 秒）`, now);
  }

  if (normalizedUserId && commandUserCooldownSec > 0) {
    const userCommandKey = buildUserCommandKey(normalizedGroupId, normalizedUserId, featureKey);
    const userLastAt = commandUserLastQueryAt.get(userCommandKey) || 0;
    if (userLastAt > 0 && now - userLastAt < commandUserCooldownSec * 1000) {
      return blockQueryRate(settings, normalizedGroupId, featureKey, `${label}过于频繁（同用户冷却 ${commandUserCooldownSec} 秒）`, now);
    }
    commandUserLastQueryAt.set(userCommandKey, now);
  }

  globalRateBucket.count += 1;
  groupBucket.count += 1;
  commandGroupBucket.count += 1;
  dailyBucket.count += 1;
  groupDailyBuckets.set(normalizedGroupId, dailyBucket);
  globalLastQueryAt = now;
  groupLastQueryAt.set(normalizedGroupId, now);
  if (input.source === 'dispatcher') rememberDispatcherConsume(normalizedGroupId, featureKey, now);

  trimMapByInsertionOrder(groupRateBuckets, QUERY_RATE_MAP_LIMIT);
  trimMapByInsertionOrder(commandGroupRateBuckets, QUERY_RATE_MAP_LIMIT * 4);
  trimMapByInsertionOrder(groupLastQueryAt, QUERY_RATE_MAP_LIMIT);
  trimMapByInsertionOrder(groupDailyBuckets, QUERY_RATE_MAP_LIMIT);
  trimMapByInsertionOrder(commandUserLastQueryAt, QUERY_RATE_MAP_LIMIT * 10);
  trimMapByInsertionOrder(recentDispatcherConsumes, QUERY_RATE_MAP_LIMIT * 4);
  trimMapByInsertionOrder(rateLimitNoticeLastSentAt, QUERY_RATE_MAP_LIMIT * 10);

  return { ok: true };
}

export function checkAndConsumeQueryRate(groupId: string, label = '查询'): QueryRateLimitResult {
  return checkAndConsumeQueryCommandRate({ groupId, label, source: 'legacy' });
}
