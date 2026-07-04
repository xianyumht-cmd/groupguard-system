import { configStateService } from '../core/state-services/config_state_service';

interface RateCounterBucket {
  windowStart: number;
  count: number;
}

const QUERY_RATE_WINDOW_MS = 60_000;
const QUERY_RATE_MAP_LIMIT = 500;

const globalRateBucket: RateCounterBucket = { windowStart: 0, count: 0 };
const groupRateBuckets = new Map<string, RateCounterBucket>();
let globalLastQueryAt = 0;
const groupLastQueryAt = new Map<string, number>();
const groupDailyBuckets = new Map<string, { day: string; count: number }>();

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

export function checkAndConsumeQueryRate(groupId: string, label = '\u67e5\u8be2'): { ok: true } | { ok: false; reason: string } {
  const normalizedGroupId = String(groupId || 'private').trim() || 'private';
  const settings = resolveSettings(groupId);
  if (settings.disableLolQuery) return { ok: false, reason: `\u672c\u7fa4${label}\u529f\u80fd\u5df2\u5173\u95ed` };

  const globalLimit = normalizePositiveInt(Number(settings.lolQueryGlobalRateLimitPerMinute), 120, 5000);
  const groupLimit = normalizePositiveInt(Number(settings.lolQueryGroupRateLimitPerMinute), 20, 1000);
  const globalMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGlobalMinIntervalSeconds ?? 1)));
  const groupMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGroupMinIntervalSeconds ?? 2)));
  const groupDailyLimit = normalizePositiveInt(Number(settings.lolQueryDailyLimit), 200, 100000);
  const now = Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);

  ensureRateWindow(globalRateBucket, now);
  let groupBucket = groupRateBuckets.get(normalizedGroupId);
  if (!groupBucket) {
    groupBucket = { windowStart: now, count: 0 };
    groupRateBuckets.set(normalizedGroupId, groupBucket);
  }
  ensureRateWindow(groupBucket, now);

  if (globalRateBucket.count >= globalLimit) {
    return { ok: false, reason: `${label}\u8fc7\u4e8e\u9891\u7e41\uff08\u5168\u5c40\u6bcf\u5206\u949f\u4e0a\u9650 ${globalLimit} \u6b21\uff09` };
  }
  if (groupBucket.count >= groupLimit) {
    return { ok: false, reason: `${label}\u8fc7\u4e8e\u9891\u7e41\uff08\u672c\u7fa4\u6bcf\u5206\u949f\u4e0a\u9650 ${groupLimit} \u6b21\uff09` };
  }

  const dailyBucketRaw = groupDailyBuckets.get(normalizedGroupId);
  const dailyBucket = (!dailyBucketRaw || dailyBucketRaw.day !== dayKey) ? { day: dayKey, count: 0 } : dailyBucketRaw;
  if (dailyBucket.count >= groupDailyLimit) {
    return { ok: false, reason: `${label}\u5df2\u8fbe\u672c\u7fa4\u5f53\u65e5\u4e0a\u9650\uff08${groupDailyLimit} \u6b21\uff09` };
  }
  if (globalMinIntervalSec > 0 && globalLastQueryAt > 0 && now - globalLastQueryAt < globalMinIntervalSec * 1000) {
    return { ok: false, reason: `${label}\u8fc7\u4e8e\u9891\u7e41\uff08\u5168\u5c40\u6700\u5c0f\u95f4\u9694 ${globalMinIntervalSec} \u79d2\uff09` };
  }

  const groupLastAt = groupLastQueryAt.get(normalizedGroupId) || 0;
  if (groupMinIntervalSec > 0 && groupLastAt > 0 && now - groupLastAt < groupMinIntervalSec * 1000) {
    return { ok: false, reason: `${label}\u8fc7\u4e8e\u9891\u7e41\uff08\u672c\u7fa4\u6700\u5c0f\u95f4\u9694 ${groupMinIntervalSec} \u79d2\uff09` };
  }

  globalRateBucket.count += 1;
  groupBucket.count += 1;
  dailyBucket.count += 1;
  groupDailyBuckets.set(normalizedGroupId, dailyBucket);
  globalLastQueryAt = now;
  groupLastQueryAt.set(normalizedGroupId, now);

  if (groupRateBuckets.size > QUERY_RATE_MAP_LIMIT) {
    const keys = Array.from(groupRateBuckets.keys());
    for (let i = 0; i < keys.length - QUERY_RATE_MAP_LIMIT; i += 1) {
      const staleKey = keys[i];
      groupRateBuckets.delete(staleKey);
      groupLastQueryAt.delete(staleKey);
      groupDailyBuckets.delete(staleKey);
    }
  }

  return { ok: true };
}
