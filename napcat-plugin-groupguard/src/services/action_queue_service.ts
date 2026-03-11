import { pluginState } from '../state';
import { safeBan, safeKick, safeRecall, type GuardResult } from './action_guard_service';
import { groupguardRepository } from '../repositories/groupguard_repository';

type ActionType = 'recall' | 'self_recall' | 'ban' | 'kick' | 'misc';

interface QueueCounters {
  queueDropped: number;
  queueRateLimited: number;
  queueExecuted: number;
  queueRetried: number;
  timeoutCount: number;
}

interface QueueLogItem {
  ts: number;
  line: string;
}

interface BaseTask<T> {
  actionId: string;
  type: ActionType;
  groupId: string;
  createdAt: number;
  retries: number;
  maxRetries: number;
  dedupKey?: string;
  targetUserId?: string;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

interface RecallTask extends BaseTask<GuardResult> {
  type: 'recall';
  payload: {
    taskId: string;
    messageId: string;
    targetUserId?: string;
    reason: string;
    automatic?: boolean;
    allowSelfTarget?: boolean;
  };
}

interface SelfRecallTask extends BaseTask<GuardResult> {
  type: 'self_recall';
  payload: {
    taskId: string;
    messageId: string;
    reason: string;
    source: 'send_group_msg' | 'message_event' | 'recovery';
    automatic?: boolean;
    allowSelfTarget?: boolean;
  };
}

interface BanTask extends BaseTask<GuardResult> {
  type: 'ban';
  payload: {
    userId: string;
    durationSeconds: number;
    reason: string;
    automatic?: boolean;
    ignoreTargetProtection?: boolean;
  };
}

interface KickTask extends BaseTask<GuardResult> {
  type: 'kick';
  payload: {
    userId: string;
    reason: string;
    rejectAddRequest?: boolean;
    automatic?: boolean;
  };
}

interface MiscTask extends BaseTask<{ ok: boolean; code: string; }> {
  type: 'misc';
  payload: {
    action: string;
    params: any;
    reason: string;
    automatic?: boolean;
  };
}

type QueueTask = RecallTask | SelfRecallTask | BanTask | KickTask | MiscTask;

const queue: QueueTask[] = [];
const groupPending = new Map<string, number>();
const dedupMap = new Map<string, number>();
const actionHistoryGlobal = new Map<string, number[]>();
const actionHistoryGroup = new Map<string, number[]>();
const activeByType = new Map<ActionType, number>();
const minuteWindows = new Map<'executed' | 'dropped' | 'rate_limited' | 'retried' | 'timeout', number[]>();
const stats: QueueCounters = {
  queueDropped: 0,
  queueRateLimited: 0,
  queueExecuted: 0,
  queueRetried: 0,
  timeoutCount: 0
};
let activeWorkers = 0;
let actionSeq = 0;
const recentLogs: QueueLogItem[] = [];
let selfRecallRecoveryStarted = false;
let selfRecallRecoveryTicking = false;
let selfRecallRecoveryTimer: NodeJS.Timeout | null = null;
let selfRecallCleanupTimer: NodeJS.Timeout | null = null;
let recallRecoveryTicking = false;

const DEFAULT_ACTION_PRIORITY: Record<ActionType, number> = {
  ban: 4,
  kick: 3,
  recall: 2,
  self_recall: 1,
  misc: 0
};

function nextActionId(): string {
  actionSeq += 1;
  return `${Date.now().toString(36)}-${actionSeq.toString(36)}`;
}

function appendQueueLog(line: string): void {
  recentLogs.push({ ts: Date.now(), line });
  if (recentLogs.length > 100) recentLogs.splice(0, recentLogs.length - 100);
  pluginState.debug(`[ActionQueue] ${line}`);
}

function shouldRetrySelfRecallCode(code: string): boolean {
  return code === 'fail_api'
    || code === 'action_failed_timeout'
    || code === 'skip_risk_protect'
    || code === 'skip_bot_not_admin'
    || code === 'skip_rate_limited'
    || code === 'skip_queue_overflow';
}

function shouldRetryRecallCode(code: string): boolean {
  return code === 'fail_api'
    || code === 'action_failed_timeout'
    || code === 'skip_risk_protect'
    || code === 'skip_bot_not_admin'
    || code === 'skip_rate_limited'
    || code === 'skip_queue_overflow';
}

function computeSelfRecallRetryDelayMs(attempt: number): number {
  const level = Math.max(1, Math.floor(attempt));
  const base = 15000;
  return Math.min(5 * 60 * 1000, base * Math.pow(2, Math.min(6, level - 1)));
}

function computeRecallRetryDelayMs(attempt: number): number {
  const level = Math.max(1, Math.floor(attempt));
  const base = 5000;
  return Math.min(60 * 1000, base * Math.pow(2, Math.min(4, level - 1)));
}

function taskSubject(task: QueueTask): string {
  if (task.type === 'kick' || task.type === 'ban') return `group=${task.groupId} user=${task.payload.userId}`;
  if (task.type === 'recall' || task.type === 'self_recall') return `group=${task.groupId} msg=${task.payload.messageId}`;
  return `group=${task.groupId} action=${task.payload.action}`;
}

function getConcurrency(groupId: string): number {
  const settings = pluginState.getGroupSettings(groupId);
  const n = Number(settings.actionQueueConcurrency ?? settings.queueConcurrency ?? 2);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(20, n));
}

function getActionPriority(groupId: string, type: ActionType): number {
  const settings = pluginState.getGroupSettings(groupId);
  const configured = settings.actionPriority;
  if (!configured) return DEFAULT_ACTION_PRIORITY[type] ?? 0;
  if (type === 'ban') return Number.isFinite(Number(configured.ban)) ? Number(configured.ban) : DEFAULT_ACTION_PRIORITY.ban;
  if (type === 'kick') return Number.isFinite(Number(configured.kick)) ? Number(configured.kick) : DEFAULT_ACTION_PRIORITY.kick;
  if (type === 'recall') return Number.isFinite(Number(configured.recall)) ? Number(configured.recall) : DEFAULT_ACTION_PRIORITY.recall;
  if (type === 'self_recall') return Number.isFinite(Number(configured.self_recall)) ? Number(configured.self_recall) : DEFAULT_ACTION_PRIORITY.self_recall;
  return DEFAULT_ACTION_PRIORITY.misc;
}

function getGroupQueueLimit(groupId: string): number {
  const settings = pluginState.getGroupSettings(groupId);
  const n = Number(settings.maxActionQueueSizePerGroup ?? 200);
  if (!Number.isFinite(n)) return 200;
  return Math.max(20, n);
}

function getGlobalQueueLimit(groupId: string): number {
  const settings = pluginState.getGroupSettings(groupId);
  const n = Number(settings.maxActionQueueSizeGlobal ?? 5000);
  if (!Number.isFinite(n)) return 5000;
  return Math.max(200, n);
}

function getDelayRange(groupId: string, type: ActionType): { min: number; max: number; } {
  const s = pluginState.getGroupSettings(groupId);
  if (type === 'kick') {
    const min = Number(s.kickDelayMinSeconds ?? 5) * 1000;
    const max = Number(s.kickDelayMaxSeconds ?? 20) * 1000;
    return { min: Math.max(0, min), max: Math.max(min, max) };
  }
  if (type === 'ban') {
    const min = Number(s.banDelayMinSeconds ?? 3) * 1000;
    const max = Number(s.banDelayMaxSeconds ?? 8) * 1000;
    return { min: Math.max(0, min), max: Math.max(min, max) };
  }
  if (type === 'recall' || type === 'self_recall') {
    const min = Number(s.recallDelayMinSeconds ?? 1) * 1000;
    const max = Number(s.recallDelayMaxSeconds ?? 3) * 1000;
    return { min: Math.max(0, min), max: Math.max(min, max) };
  }
  const min = Number(s.miscDelayMinSeconds ?? 0.3) * 1000;
  const max = Number(s.miscDelayMaxSeconds ?? 1.2) * 1000;
  return { min: Math.max(0, min), max: Math.max(min, max) };
}

function getMaxPerMinute(groupId: string, type: ActionType): number {
  const s = pluginState.getGroupSettings(groupId);
  if (type === 'kick') return Math.max(1, Number(s.maxKickPerMinute ?? 3));
  if (type === 'ban') return Math.max(1, Number(s.maxBanPerMinute ?? 5));
  if (type === 'recall' || type === 'self_recall') return Math.max(1, Number(s.maxRecallPerMinute ?? 60));
  return Math.max(1, Number(s.maxMiscPerMinute ?? 120));
}

function getDedupSeconds(groupId: string): number {
  const s = pluginState.getGroupSettings(groupId);
  const n = Number(s.actionDedupSeconds ?? 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, n);
}

function randomDelay(min: number, max: number): Promise<void> {
  if (max <= min) return new Promise(resolve => setTimeout(resolve, Math.max(0, min)));
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildHistoryKey(type: ActionType, groupId?: string): string {
  return groupId ? `${type}:${groupId}` : type;
}

function hitRateLimit(groupId: string, type: ActionType): boolean {
  const now = Date.now();
  const max = getMaxPerMinute(groupId, type);
  const winMs = 60000;
  const gk = buildHistoryKey(type);
  const lk = buildHistoryKey(type, groupId);
  const gl = (actionHistoryGlobal.get(gk) || []).filter(ts => now - ts < winMs);
  const ll = (actionHistoryGroup.get(lk) || []).filter(ts => now - ts < winMs);
  if (gl.length >= max || ll.length >= max) {
    actionHistoryGlobal.set(gk, gl);
    actionHistoryGroup.set(lk, ll);
    return true;
  }
  gl.push(now);
  ll.push(now);
  actionHistoryGlobal.set(gk, gl);
  actionHistoryGroup.set(lk, ll);
  return false;
}

function isDedupHit(groupId: string, key?: string): boolean {
  if (!key) return false;
  const now = Date.now();
  const dedupMs = getDedupSeconds(groupId) * 1000;
  for (const [k, ts] of dedupMap.entries()) {
    if (now - ts > dedupMs) dedupMap.delete(k);
  }
  if (dedupMap.has(key)) return true;
  dedupMap.set(key, now);
  return false;
}

function getTimeoutMs(groupId: string): number {
  const s = pluginState.getGroupSettings(groupId);
  const n = Number((s as any).actionTimeoutMs ?? 8000);
  if (!Number.isFinite(n)) return 8000;
  return Math.max(1000, n);
}

function recordMinuteMetric(key: 'executed' | 'dropped' | 'rate_limited' | 'retried' | 'timeout'): void {
  const now = Date.now();
  const arr = minuteWindows.get(key) || [];
  arr.push(now);
  minuteWindows.set(key, arr.filter(ts => now - ts < 60000));
}

function getMinuteMetricCount(key: 'executed' | 'dropped' | 'rate_limited' | 'retried' | 'timeout'): number {
  const now = Date.now();
  const arr = (minuteWindows.get(key) || []).filter(ts => now - ts < 60000);
  minuteWindows.set(key, arr);
  return arr.length;
}

function incGroupPending(groupId: string): void {
  groupPending.set(groupId, (groupPending.get(groupId) || 0) + 1);
}

function decGroupPending(groupId: string): void {
  const n = (groupPending.get(groupId) || 0) - 1;
  if (n <= 0) groupPending.delete(groupId);
  else groupPending.set(groupId, n);
}

function replaceWeakerPenaltyTask(task: QueueTask): void {
  if (!task.targetUserId) return;
  if (!(task.type === 'ban' || task.type === 'kick' || task.type === 'recall')) return;
  const incomingPriority = getActionPriority(task.groupId, task.type);
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const current = queue[i];
    if (!current.targetUserId) continue;
    if (current.groupId !== task.groupId || current.targetUserId !== task.targetUserId) continue;
    const currentPriority = getActionPriority(current.groupId, current.type);
    if (currentPriority >= incomingPriority) {
      stats.queueDropped += 1;
      recordMinuteMetric('dropped');
      appendQueueLog(`${task.type} ${taskSubject(task)} dropped_duplicate_or_weaker`);
      task.resolve({ ok: false, code: 'skip_duplicate' } as any);
      throw new Error('__queue_skip_enqueue__');
    }
    appendQueueLog(`${current.type} ${taskSubject(current)} replaced`);
    queue.splice(i, 1);
    decGroupPending(current.groupId);
    if (current.type === 'misc') current.resolve({ ok: false, code: 'skip_replaced' });
    else current.resolve({ ok: false, code: 'skip_replaced' });
  }
}

function enqueueTask(task: QueueTask): boolean {
  const groupCount = groupPending.get(task.groupId) || 0;
  if (groupCount >= getGroupQueueLimit(task.groupId) || queue.length >= getGlobalQueueLimit(task.groupId)) {
    stats.queueDropped += 1;
    recordMinuteMetric('dropped');
    appendQueueLog(`${task.type} ${taskSubject(task)} dropped_queue_overflow`);
    return false;
  }
  try {
    replaceWeakerPenaltyTask(task);
    queue.push(task);
    incGroupPending(task.groupId);
    appendQueueLog(`${task.type} ${taskSubject(task)} queued`);
    kickWorkers();
    return true;
  } catch (e) {
    if (String(e).includes('__queue_skip_enqueue__')) return false;
    throw e;
  }
}

function pickTask(): QueueTask | null {
  if (!queue.length) return null;
  let bestIndex = 0;
  let bestScore = getActionPriority(queue[0].groupId, queue[0].type);
  for (let i = 1; i < queue.length; i += 1) {
    const task = queue[i];
    const score = getActionPriority(task.groupId, task.type);
    if (score > bestScore || (score === bestScore && task.createdAt < queue[bestIndex].createdAt)) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const [picked] = queue.splice(bestIndex, 1);
  return picked || null;
}

async function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timeout: boolean; value?: T; }> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<{ timeout: boolean; value?: T; }>((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    });
    const valuePromise = promise.then((value) => ({ timeout: false, value }));
    return await Promise.race([valuePromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function incActiveType(type: ActionType): void {
  activeByType.set(type, (activeByType.get(type) || 0) + 1);
}

function decActiveType(type: ActionType): void {
  const n = (activeByType.get(type) || 0) - 1;
  if (n <= 0) activeByType.delete(type);
  else activeByType.set(type, n);
}

async function executeTask(task: QueueTask): Promise<void> {
  const timeoutMs = getTimeoutMs(task.groupId);
  pluginState.debug(`[ActionQueue] exec actionId=${task.actionId} type=${task.type} group=${task.groupId}${task.targetUserId ? ` user=${task.targetUserId}` : ''}`);
  appendQueueLog(`${task.type} ${taskSubject(task)} executing`);
  incActiveType(task.type);
  try {
    if (task.retries <= 0 && isDedupHit(task.groupId, task.dedupKey)) {
      if (task.type === 'misc') task.resolve({ ok: false, code: 'skip_duplicate' });
      else task.resolve({ ok: false, code: 'skip_duplicate' });
      if (task.type === 'recall') {
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'skip_duplicate', true, 0);
      }
      stats.queueDropped += 1;
      recordMinuteMetric('dropped');
      appendQueueLog(`${task.type} ${taskSubject(task)} dropped_duplicate`);
      return;
    }
    if (hitRateLimit(task.groupId, task.type)) {
      if (task.type === 'recall') {
        task.retries += 1;
        const retryAfter = task.retries <= task.maxRetries ? computeRecallRetryDelayMs(task.retries) : 0;
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'skip_rate_limited', false, retryAfter);
      }
      if (task.type === 'misc') task.resolve({ ok: false, code: 'skip_rate_limited' });
      else task.resolve({ ok: false, code: 'skip_rate_limited' });
      stats.queueRateLimited += 1;
      recordMinuteMetric('rate_limited');
      appendQueueLog(`${task.type} ${taskSubject(task)} dropped_rate_limited`);
      return;
    }
    const delay = getDelayRange(task.groupId, task.type);
    await randomDelay(delay.min, delay.max);
    if (task.type === 'recall') {
      await groupguardRepository.markRecallTaskQueued(task.payload.taskId);
      const call = safeRecall({
        groupId: task.groupId,
        messageId: task.payload.messageId,
        targetUserId: task.payload.targetUserId,
        reason: task.payload.reason,
        automatic: task.payload.automatic,
        allowSelfTarget: task.payload.allowSelfTarget
      });
      const wrapped = await executeWithTimeout(call, timeoutMs);
      if (wrapped.timeout) {
        stats.timeoutCount += 1;
        recordMinuteMetric('timeout');
        appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
        const nextRetries = task.retries + 1;
        const retryAfter = nextRetries <= task.maxRetries ? computeRecallRetryDelayMs(nextRetries) : 0;
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'action_failed_timeout', false, retryAfter);
        if (task.retries < task.maxRetries) {
          task.retries += 1;
          stats.queueRetried += 1;
          recordMinuteMetric('retried');
          appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries}`);
          queue.push(task);
          incGroupPending(task.groupId);
          return;
        }
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      const code = String(result.code || '');
      const success = result.ok || code === 'ok' || code === 'skip_duplicate';
      const nextRetries = task.retries + 1;
      const retryAfter = !success && shouldRetryRecallCode(code) && nextRetries <= task.maxRetries
        ? computeRecallRetryDelayMs(nextRetries)
        : 0;
      await groupguardRepository.resolveRecallTask(task.payload.taskId, code, success, retryAfter);
      if (!result.ok && task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code}`);
        queue.push(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
      }
      return;
    }
    if (task.type === 'self_recall') {
      await groupguardRepository.markSelfRecallTaskQueued(task.payload.taskId);
      const call = safeRecall({
        groupId: task.groupId,
        messageId: task.payload.messageId,
        reason: task.payload.reason,
        automatic: false,
        allowSelfTarget: task.payload.allowSelfTarget
      });
      const wrapped = await executeWithTimeout(call, timeoutMs);
      if (wrapped.timeout) {
        stats.timeoutCount += 1;
        recordMinuteMetric('timeout');
        appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
        task.retries += 1;
        const retryAfter = task.retries < task.maxRetries ? computeSelfRecallRetryDelayMs(task.retries) : 0;
        await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, 'action_failed_timeout', false, retryAfter);
        if (retryAfter > 0) {
          stats.queueRetried += 1;
          recordMinuteMetric('retried');
          appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} after=${retryAfter}`);
          task.resolve({ ok: false, code: 'action_failed_timeout' });
          return;
        }
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      const code = String(result.code || '');
      const success = result.ok || code === 'ok' || code === 'skip_duplicate';
      task.retries += 1;
      const retryAfter = !success && shouldRetrySelfRecallCode(code) && task.retries < task.maxRetries
        ? computeSelfRecallRetryDelayMs(task.retries)
        : 0;
      await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, code, success, retryAfter);
      if (retryAfter > 0) {
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code} after=${retryAfter}`);
        task.resolve(result);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
      }
      return;
    }
    if (task.type === 'ban') {
      const call = safeBan({
        groupId: task.groupId,
        userId: task.payload.userId,
        durationSeconds: task.payload.durationSeconds,
        reason: task.payload.reason,
        automatic: task.payload.automatic,
        ignoreTargetProtection: task.payload.ignoreTargetProtection
      });
      const wrapped = await executeWithTimeout(call, timeoutMs);
      if (wrapped.timeout) {
        stats.timeoutCount += 1;
        recordMinuteMetric('timeout');
        appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
        if (task.retries < task.maxRetries) {
          task.retries += 1;
          stats.queueRetried += 1;
          recordMinuteMetric('retried');
          appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries}`);
          queue.push(task);
          incGroupPending(task.groupId);
          return;
        }
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      if (!result.ok && task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code}`);
        queue.push(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
      }
      return;
    }
    if (task.type === 'kick') {
      const call = safeKick({
        groupId: task.groupId,
        userId: task.payload.userId,
        reason: task.payload.reason,
        rejectAddRequest: task.payload.rejectAddRequest,
        automatic: task.payload.automatic
      });
      const wrapped = await executeWithTimeout(call, timeoutMs);
      if (wrapped.timeout) {
        stats.timeoutCount += 1;
        recordMinuteMetric('timeout');
        appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
        if (task.retries < task.maxRetries) {
          task.retries += 1;
          stats.queueRetried += 1;
          recordMinuteMetric('retried');
          appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries}`);
          queue.push(task);
          incGroupPending(task.groupId);
          return;
        }
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      if (!result.ok && task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code}`);
        queue.push(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
      }
      return;
    }
    const wrapped = await executeWithTimeout(pluginState.callApi(task.payload.action, task.payload.params), timeoutMs);
    if (wrapped.timeout) {
      stats.timeoutCount += 1;
      recordMinuteMetric('timeout');
      appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
      if (task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries}`);
        queue.push(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve({ ok: false, code: 'action_failed_timeout' });
      return;
    }
    const res = wrapped.value;
    const ok = res !== null && res !== undefined;
    if (!ok && task.retries < task.maxRetries) {
      task.retries += 1;
      stats.queueRetried += 1;
      recordMinuteMetric('retried');
      appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries}`);
      queue.push(task);
      incGroupPending(task.groupId);
      return;
    }
    task.resolve({ ok, code: ok ? 'ok' : 'fail_api' });
    if (ok) {
      stats.queueExecuted += 1;
      recordMinuteMetric('executed');
      appendQueueLog(`${task.type} ${taskSubject(task)} success`);
    } else {
      appendQueueLog(`${task.type} ${taskSubject(task)} fail code=fail_api`);
    }
  } catch (e) {
    if (task.type === 'recall') {
      await groupguardRepository.resolveRecallTask(task.payload.taskId, 'exception', false, 0);
    }
    appendQueueLog(`${task.type} ${taskSubject(task)} exception`);
    task.reject(e);
  } finally {
    decActiveType(task.type);
    decGroupPending(task.groupId);
  }
}

function kickWorkers(): void {
  const cap = Math.max(1, Math.min(20, getConcurrency(queue[0]?.groupId || '0')));
  while (activeWorkers < cap) {
    const task = pickTask();
    if (!task) return;
    activeWorkers += 1;
    executeTask(task)
      .catch(() => {})
      .finally(() => {
        activeWorkers = Math.max(0, activeWorkers - 1);
        kickWorkers();
      });
  }
}

export async function enqueueRecallAction(opts: {
  taskId?: string;
  groupId: string;
  messageId: string;
  targetUserId?: string;
  reason: string;
  automatic?: boolean;
  allowSelfTarget?: boolean;
  dedupKey?: string;
  maxRetries?: number;
}): Promise<GuardResult> {
  const taskId = String(opts.taskId || `${opts.groupId}:${opts.messageId}:recall`);
  const now = Date.now();
  try {
    await groupguardRepository.scheduleRecallTask({
      taskId,
      groupId: String(opts.groupId),
      messageId: String(opts.messageId),
      targetUserId: opts.targetUserId ? String(opts.targetUserId) : '',
      reason: String(opts.reason || 'recall_action'),
      dueAt: now,
      maxAttempts: Math.max(1, Number(opts.maxRetries ?? 1) + 1)
    });
  } catch (e) {
    pluginState.log('warn', `撤回持久化写入失败: ${String(e)}`);
  }
  return new Promise<GuardResult>((resolve, reject) => {
    const task: RecallTask = {
      actionId: nextActionId(),
      type: 'recall',
      groupId: opts.groupId,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      targetUserId: opts.targetUserId ? String(opts.targetUserId) : undefined,
      dedupKey: opts.dedupKey || `${opts.groupId}:recall:${opts.messageId}`,
      payload: {
        taskId,
        messageId: String(opts.messageId),
        targetUserId: opts.targetUserId ? String(opts.targetUserId) : undefined,
        reason: opts.reason,
        automatic: opts.automatic,
        allowSelfTarget: opts.allowSelfTarget
      },
      resolve,
      reject
    };
    if (!enqueueTask(task)) resolve({ ok: false, code: 'skip_queue_overflow' });
  });
}

export async function enqueueSelfRecallAction(opts: {
  taskId?: string;
  groupId: string;
  messageId: string;
  reason?: string;
  source?: 'send_group_msg' | 'message_event' | 'recovery';
  automatic?: boolean;
  allowSelfTarget?: boolean;
  maxRetries?: number;
  dedupKey?: string;
}): Promise<GuardResult> {
  return new Promise<GuardResult>((resolve, reject) => {
    const taskId = String(opts.taskId || `${opts.groupId}:${opts.messageId}`);
    const task: SelfRecallTask = {
      actionId: nextActionId(),
      type: 'self_recall',
      groupId: opts.groupId,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(1, Number(opts.maxRetries ?? 6)),
      dedupKey: opts.dedupKey || `self_recall_task:${taskId}`,
      payload: {
        taskId,
        messageId: String(opts.messageId),
        reason: opts.reason || 'self_recall_event',
        source: opts.source || 'message_event',
        automatic: opts.automatic === true,
        allowSelfTarget: opts.allowSelfTarget !== false
      },
      resolve,
      reject
    };
    if (!enqueueTask(task)) resolve({ ok: false, code: 'skip_queue_overflow' });
  });
}

export async function enqueueBanAction(opts: {
  groupId: string;
  userId: string;
  durationSeconds: number;
  reason: string;
  automatic?: boolean;
  ignoreTargetProtection?: boolean;
  dedupKey?: string;
  maxRetries?: number;
}): Promise<GuardResult> {
  const uid = String(opts.userId);
  return new Promise<GuardResult>((resolve, reject) => {
    const task: BanTask = {
      actionId: nextActionId(),
      type: 'ban',
      groupId: opts.groupId,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      targetUserId: uid,
      dedupKey: opts.dedupKey || `${opts.groupId}:ban:${uid}`,
      payload: {
        userId: uid,
        durationSeconds: opts.durationSeconds,
        reason: opts.reason,
        automatic: opts.automatic,
        ignoreTargetProtection: opts.ignoreTargetProtection
      },
      resolve,
      reject
    };
    if (!enqueueTask(task)) resolve({ ok: false, code: 'skip_rate_limited' });
  });
}

export async function enqueueKickAction(opts: {
  groupId: string;
  userId: string;
  reason: string;
  rejectAddRequest?: boolean;
  automatic?: boolean;
  dedupKey?: string;
  maxRetries?: number;
}): Promise<GuardResult> {
  const uid = String(opts.userId);
  return new Promise<GuardResult>((resolve, reject) => {
    const task: KickTask = {
      actionId: nextActionId(),
      type: 'kick',
      groupId: opts.groupId,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      targetUserId: uid,
      dedupKey: opts.dedupKey || `${opts.groupId}:kick:${uid}`,
      payload: {
        userId: uid,
        reason: opts.reason,
        rejectAddRequest: opts.rejectAddRequest,
        automatic: opts.automatic
      },
      resolve,
      reject
    };
    if (!enqueueTask(task)) resolve({ ok: false, code: 'skip_rate_limited' });
  });
}

export async function enqueueMiscAction(opts: {
  groupId: string;
  action: string;
  params: any;
  reason: string;
  automatic?: boolean;
  dedupKey?: string;
  maxRetries?: number;
}): Promise<{ ok: boolean; code: string; }> {
  return new Promise<{ ok: boolean; code: string; }>((resolve, reject) => {
    const task: MiscTask = {
      actionId: nextActionId(),
      type: 'misc',
      groupId: opts.groupId,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      dedupKey: opts.dedupKey,
      payload: {
        action: opts.action,
        params: opts.params,
        reason: opts.reason,
        automatic: opts.automatic
      },
      resolve,
      reject
    };
    if (!enqueueTask(task)) resolve({ ok: false, code: 'skip_queue_overflow' });
  });
}

export function getActionQueueSnapshot() {
  const typeDistribution = queue.reduce((acc, task) => {
    acc[task.type] = (acc[task.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const activeTypeDistribution = Array.from(activeByType.entries()).reduce((acc, [type, n]) => {
    acc[type] = n;
    return acc;
  }, {} as Record<string, number>);
  const groups = Array.from(groupPending.entries()).map(([groupId, pending]) => ({ groupId, pending })).sort((a, b) => b.pending - a.pending);
  return {
    totalPending: queue.length,
    activeWorkers,
    stats: { ...stats },
    lastMinute: {
      executed: getMinuteMetricCount('executed'),
      dropped: getMinuteMetricCount('dropped'),
      rateLimited: getMinuteMetricCount('rate_limited'),
      retried: getMinuteMetricCount('retried'),
      timeout: getMinuteMetricCount('timeout')
    },
    typeDistribution,
    activeTypeDistribution,
    groups: groups.slice(0, 50)
  };
}

export function resetActionQueueRuntime(): { cleared: number; activeWorkers: number; } {
  const cleared = queue.length;
  queue.length = 0;
  groupPending.clear();
  dedupMap.clear();
  actionHistoryGlobal.clear();
  actionHistoryGroup.clear();
  activeByType.clear();
  minuteWindows.clear();
  recentLogs.length = 0;
  stats.queueDropped = 0;
  stats.queueRateLimited = 0;
  stats.queueExecuted = 0;
  stats.queueRetried = 0;
  stats.timeoutCount = 0;
  return { cleared, activeWorkers };
}

export function getActionQueueRecentLogs(limit = 10): string[] {
  const safe = Math.max(1, Math.min(100, Number(limit) || 10));
  return recentLogs.slice(-safe).reverse().map(item => {
    const t = new Date(item.ts).toLocaleTimeString('zh-CN', { hour12: false });
    return `[${t}] ${item.line}`;
  });
}

async function runSelfRecallRecoveryBatch(limit = 200): Promise<void> {
  if (selfRecallRecoveryTicking) return;
  selfRecallRecoveryTicking = true;
  try {
    const rows = await groupguardRepository.getDueSelfRecallTasks(Date.now(), limit);
    for (const row of rows) {
      await enqueueSelfRecallAction({
        taskId: row.taskId,
        groupId: row.groupId,
        messageId: row.messageId,
        reason: row.reason || 'self_recall_recovery',
        source: 'recovery',
        automatic: false,
        allowSelfTarget: true,
        maxRetries: Math.max(1, Number(row.maxAttempts || 6))
      });
    }
  } catch (e) {
    pluginState.log('warn', `自撤回补偿调度失败: ${String(e)}`);
  } finally {
    selfRecallRecoveryTicking = false;
  }
}

async function runRecallRecoveryBatch(limit = 200): Promise<void> {
  if (recallRecoveryTicking) return;
  recallRecoveryTicking = true;
  try {
    const rows = await groupguardRepository.getDueRecallTasks(Date.now(), limit);
    for (const row of rows) {
      await enqueueRecallAction({
        taskId: row.taskId,
        groupId: row.groupId,
        messageId: row.messageId,
        targetUserId: row.targetUserId || undefined,
        reason: row.reason || 'recall_recovery',
        automatic: true,
        allowSelfTarget: true,
        maxRetries: Math.max(0, Number(row.maxAttempts || 2) - 1)
      });
    }
  } catch (e) {
    pluginState.log('warn', `撤回补偿调度失败: ${String(e)}`);
  } finally {
    recallRecoveryTicking = false;
  }
}

export function startSelfRecallRecovery(): void {
  if (selfRecallRecoveryStarted) return;
  selfRecallRecoveryStarted = true;
  void runSelfRecallRecoveryBatch();
  void runRecallRecoveryBatch();
  selfRecallRecoveryTimer = setInterval(() => {
    void runSelfRecallRecoveryBatch();
    void runRecallRecoveryBatch();
  }, 2000);
  selfRecallCleanupTimer = setInterval(() => {
    void groupguardRepository.cleanupSelfRecallTasks(7 * 24 * 60 * 60 * 1000);
    void groupguardRepository.cleanupRecallTasks(7 * 24 * 60 * 60 * 1000);
  }, 60 * 60 * 1000);
}

export function stopSelfRecallRecovery(): void {
  if (selfRecallRecoveryTimer) {
    clearInterval(selfRecallRecoveryTimer);
    selfRecallRecoveryTimer = null;
  }
  if (selfRecallCleanupTimer) {
    clearInterval(selfRecallCleanupTimer);
    selfRecallCleanupTimer = null;
  }
  selfRecallRecoveryStarted = false;
}
