import { communicationStateService } from '../core/state-services/communication_state_service';
import { shouldBlockByBotRole } from '../core/bot_role';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { safeBan, safeKick, safeRecall, type GuardResult } from './action_guard_service';
import { groupguardRepository } from '../repositories/groupguard_repository';
import type {
  ActionQueueTaskLookupResult,
  ActionQueueTaskTraceView,
  ActionQueueTraceItem,
  ActionQueueEventRecord,
  AuditEventRecord,
  RecallTaskRecord,
  SelfRecallTaskRecord,
  StandardAuditPayload
} from '../types';

type ActionType = 'recall' | 'self_recall' | 'ban' | 'kick' | 'misc';
export type QueueLinkedGuardResult = GuardResult & { taskId?: string; actionId?: string; };

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
  priorityScore: number;
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
const MAX_QUEUE_HARD_LIMIT = 2000;
const MAX_GROUP_PENDING_HARD_LIMIT = 500;
const MAX_DEDUP_KEYS = 5000;
const MAX_HISTORY_PER_KEY = 300;
const groupPending = new Map<string, number>();
const dedupMap = new Map<string, number>();
const dedupOrder: string[] = [];
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
let retryBudgetWindowStart = 0;
let retryBudgetCount = 0;
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
  loggingStateService.debug(`[ActionQueue] ${line}`);
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

function taskQueueTaskId(task: QueueTask): string {
  if (task.type === 'recall' || task.type === 'self_recall') return String(task.payload.taskId || task.dedupKey || task.actionId);
  return String(task.dedupKey || task.actionId);
}

function taskMessageId(task: QueueTask): string {
  if (task.type === 'recall' || task.type === 'self_recall') return String(task.payload.messageId || '');
  return '';
}

function taskReason(task: QueueTask): string {
  return String((task.payload as any)?.reason || '');
}

function recordActionQueueEvent(task: QueueTask, event: string, extra: Partial<ActionQueueEventRecord> = {}): void {
  const entry: ActionQueueEventRecord = {
    taskId: extra.taskId || taskQueueTaskId(task),
    actionId: extra.actionId || task.actionId,
    taskType: extra.taskType || task.type,
    groupId: extra.groupId || task.groupId,
    userId: extra.userId || task.targetUserId || (task.type === 'ban' || task.type === 'kick' ? task.payload.userId : ''),
    messageId: extra.messageId || taskMessageId(task),
    event,
    code: extra.code || '',
    ok: extra.ok === true,
    reason: extra.reason || taskReason(task),
    attemptCount: extra.attemptCount ?? task.retries,
    payload: extra.payload || JSON.stringify({
      dedupKey: task.dedupKey || '',
      priorityScore: task.priorityScore,
      maxRetries: task.maxRetries
    }),
    createdAt: extra.createdAt || Date.now()
  };
  void groupguardRepository.insertActionQueueEvent(entry).catch((error) => {
    loggingStateService.debug(`[ActionQueue] history_write_failed ${String(error)}`);
  });
}

function getConcurrency(groupId: string): number {
  const settings = configStateService.resolveGroupSettings(groupId);
  const n = Number(settings.actionQueueConcurrency ?? settings.queueConcurrency ?? 2);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(20, n));
}

function getActionPriority(groupId: string, type: ActionType): number {
  const settings = configStateService.resolveGroupSettings(groupId);
  const configured = settings.actionPriority;
  if (!configured) return DEFAULT_ACTION_PRIORITY[type] ?? 0;
  if (type === 'ban') return Number.isFinite(Number(configured.ban)) ? Number(configured.ban) : DEFAULT_ACTION_PRIORITY.ban;
  if (type === 'kick') return Number.isFinite(Number(configured.kick)) ? Number(configured.kick) : DEFAULT_ACTION_PRIORITY.kick;
  if (type === 'recall') return Number.isFinite(Number(configured.recall)) ? Number(configured.recall) : DEFAULT_ACTION_PRIORITY.recall;
  if (type === 'self_recall') return Number.isFinite(Number(configured.self_recall)) ? Number(configured.self_recall) : DEFAULT_ACTION_PRIORITY.self_recall;
  return DEFAULT_ACTION_PRIORITY.misc;
}

function getGroupQueueLimit(groupId: string): number {
  const settings = configStateService.resolveGroupSettings(groupId);
  const n = Number(settings.maxActionQueueSizePerGroup ?? 200);
  if (!Number.isFinite(n)) return 200;
  return Math.max(20, n);
}

function getGlobalQueueLimit(groupId: string): number {
  const settings = configStateService.resolveGroupSettings(groupId);
  const n = Number(settings.maxActionQueueSizeGlobal ?? 5000);
  if (!Number.isFinite(n)) return 5000;
  return Math.max(200, n);
}

function getDelayRange(groupId: string, type: ActionType): { min: number; max: number; } {
  const s = configStateService.resolveGroupSettings(groupId);
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
  const s = configStateService.resolveGroupSettings(groupId);
  if (type === 'kick') return Math.max(1, Number(s.maxKickPerMinute ?? 3));
  if (type === 'ban') return Math.max(1, Number(s.maxBanPerMinute ?? 5));
  if (type === 'recall' || type === 'self_recall') return Math.max(1, Number(s.maxRecallPerMinute ?? 60));
  return Math.max(1, Number(s.maxMiscPerMinute ?? 120));
}

function getDedupSeconds(groupId: string): number {
  const s = configStateService.resolveGroupSettings(groupId);
  const n = Number(s.actionDedupSeconds ?? 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, n);
}

function randomDelay(min: number, max: number): Promise<void> {
  if (max <= min) return new Promise(resolve => setTimeout(resolve, Math.max(0, min)));
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBackpressureActive(): boolean {
  if (queue.length >= MAX_QUEUE_HARD_LIMIT) return true;
  if (activeWorkers >= 20 && queue.length >= Math.floor(MAX_QUEUE_HARD_LIMIT * 0.5)) return true;
  if (dedupMap.size >= MAX_DEDUP_KEYS) return true;
  return false;
}

function consumeRetryBudget(): boolean {
  const now = Date.now();
  if (!retryBudgetWindowStart || now - retryBudgetWindowStart >= 60000) {
    retryBudgetWindowStart = now;
    retryBudgetCount = 0;
  }
  const maxRetryPerMinute = 300;
  if (retryBudgetCount >= maxRetryPerMinute) return false;
  retryBudgetCount += 1;
  return true;
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
  const gl = actionHistoryGlobal.get(gk) || [];
  const ll = actionHistoryGroup.get(lk) || [];
  while (gl.length && now - gl[0] >= winMs) gl.shift();
  while (ll.length && now - ll[0] >= winMs) ll.shift();
  if (gl.length >= max || ll.length >= max) {
    actionHistoryGlobal.set(gk, gl);
    actionHistoryGroup.set(lk, ll);
    return true;
  }
  gl.push(now);
  ll.push(now);
  while (gl.length > MAX_HISTORY_PER_KEY) gl.shift();
  while (ll.length > MAX_HISTORY_PER_KEY) ll.shift();
  actionHistoryGlobal.set(gk, gl);
  actionHistoryGroup.set(lk, ll);
  return false;
}

function isDedupHit(groupId: string, key?: string): boolean {
  if (!key) return false;
  const now = Date.now();
  const dedupMs = getDedupSeconds(groupId) * 1000;
  const existing = dedupMap.get(key);
  if (existing && now - existing <= dedupMs) return true;
  dedupMap.set(key, now);
  dedupOrder.push(key);
  while (dedupOrder.length > MAX_DEDUP_KEYS) {
    const oldKey = dedupOrder.shift();
    if (!oldKey) break;
    const ts = dedupMap.get(oldKey);
    if (ts === undefined) continue;
    if (now - ts > dedupMs || oldKey !== key) {
      dedupMap.delete(oldKey);
    }
  }
  return false;
}

function getTimeoutMs(groupId: string): number {
  const s = configStateService.resolveGroupSettings(groupId);
  const n = Number((s as any).actionTimeoutMs ?? 8000);
  if (!Number.isFinite(n)) return 8000;
  return Math.max(1000, n);
}

function recordMinuteMetric(key: 'executed' | 'dropped' | 'rate_limited' | 'retried' | 'timeout'): void {
  const now = Date.now();
  const arr = minuteWindows.get(key) || [];
  while (arr.length && now - arr[0] >= 60000) arr.shift();
  arr.push(now);
  if (arr.length > 600) arr.shift();
  minuteWindows.set(key, arr);
}

function getMinuteMetricCount(key: 'executed' | 'dropped' | 'rate_limited' | 'retried' | 'timeout'): number {
  const now = Date.now();
  const arr = minuteWindows.get(key) || [];
  while (arr.length && now - arr[0] >= 60000) arr.shift();
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
      recordActionQueueEvent(task, 'dropped', { code: 'skip_duplicate_or_weaker', ok: false });
      task.resolve({ ok: false, code: 'skip_duplicate' } as any);
      throw new Error('__queue_skip_enqueue__');
    }
    appendQueueLog(`${current.type} ${taskSubject(current)} replaced`);
    recordActionQueueEvent(current, 'replaced', { code: 'skip_replaced', ok: false });
    queue.splice(i, 1);
    decGroupPending(current.groupId);
    if (current.type === 'misc') current.resolve({ ok: false, code: 'skip_replaced' });
    else current.resolve({ ok: false, code: 'skip_replaced' });
  }
}

function compareTaskOrder(left: QueueTask, right: QueueTask): number {
  const priorityDiff = right.priorityScore - left.priorityScore;
  if (priorityDiff !== 0) return priorityDiff;
  return left.createdAt - right.createdAt;
}

function insertTaskSorted(task: QueueTask): void {
  if (!queue.length) {
    queue.push(task);
    return;
  }
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (compareTaskOrder(task, queue[mid]) < 0) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, task);
}

function enqueueTask(task: QueueTask): 'ok' | 'queue_overflow' | 'backpressure_reject' | 'skip_duplicate' | 'bot_role_blocked' {
  const intent = task.type === 'self_recall' ? 'self_recall_like' : 'moderation_like';
  const roleBlock = shouldBlockByBotRole({ source: 'action_queue', rawMessage: taskSubject(task), intent, actionType: task.type });
  if (roleBlock.blocked) {
    stats.queueDropped += 1;
    recordMinuteMetric('dropped');
    loggingStateService.info(roleBlock.logLine || `bot_role_blocked role=${roleBlock.role} intent=${intent} rawMessage=${taskSubject(task)} source=action_queue`);
    appendQueueLog(`${task.type} ${taskSubject(task)} dropped_bot_role`);
    recordActionQueueEvent(task, 'dropped', { code: 'bot_role_blocked', ok: false });
    return 'bot_role_blocked';
  }
  if (isBackpressureActive()) {
    stats.queueDropped += 1;
    recordMinuteMetric('dropped');
    appendQueueLog(`${task.type} ${taskSubject(task)} dropped_backpressure`);
    recordActionQueueEvent(task, 'dropped', { code: 'backpressure_reject', ok: false });
    return 'backpressure_reject';
  }
  const groupCount = groupPending.get(task.groupId) || 0;
  if (groupCount >= Math.min(MAX_GROUP_PENDING_HARD_LIMIT, getGroupQueueLimit(task.groupId)) || queue.length >= Math.min(MAX_QUEUE_HARD_LIMIT, getGlobalQueueLimit(task.groupId))) {
    stats.queueDropped += 1;
    recordMinuteMetric('dropped');
    appendQueueLog(`${task.type} ${taskSubject(task)} dropped_queue_overflow`);
    recordActionQueueEvent(task, 'dropped', { code: 'queue_overflow', ok: false });
    return 'queue_overflow';
  }
  try {
    replaceWeakerPenaltyTask(task);
    insertTaskSorted(task);
    incGroupPending(task.groupId);
    appendQueueLog(`${task.type} ${taskSubject(task)} queued`);
    recordActionQueueEvent(task, 'queued');
    kickWorkers();
    return 'ok';
  } catch (e) {
    if (String(e).includes('__queue_skip_enqueue__')) return 'skip_duplicate';
    throw e;
  }
}

function pickTask(): QueueTask | null {
  return queue.shift() || null;
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
  loggingStateService.debug(`[ActionQueue] exec actionId=${task.actionId} type=${task.type} group=${task.groupId}${task.targetUserId ? ` user=${task.targetUserId}` : ''}`);
  appendQueueLog(`${task.type} ${taskSubject(task)} executing`);
  recordActionQueueEvent(task, 'executing');
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
      recordActionQueueEvent(task, 'dropped', { code: 'skip_duplicate', ok: false });
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
      recordActionQueueEvent(task, 'rate_limited', { code: 'skip_rate_limited', ok: false });
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
        recordActionQueueEvent(task, 'timeout', { code: 'action_failed_timeout', ok: false });
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'action_failed_timeout', false, 0);
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
        recordActionQueueEvent(task, 'retry', { code: result.code, ok: false, attemptCount: task.retries });
        if (!consumeRetryBudget()) {
          task.resolve({ ok: false, code: 'backpressure_reject' });
          return;
        }
        insertTaskSorted(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
        recordActionQueueEvent(task, 'success', { code: result.code || 'ok', ok: true });
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
        recordActionQueueEvent(task, 'fail', { code: result.code, ok: false });
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
        recordActionQueueEvent(task, 'timeout', { code: 'action_failed_timeout', ok: false });
        await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, 'action_failed_timeout', false, 0);
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
        recordActionQueueEvent(task, 'retry', { code: result.code, ok: false, attemptCount: task.retries });
        task.resolve(result);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
        recordActionQueueEvent(task, 'success', { code: result.code || 'ok', ok: true });
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
        recordActionQueueEvent(task, 'fail', { code: result.code, ok: false });
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
        recordActionQueueEvent(task, 'timeout', { code: 'action_failed_timeout', ok: false });
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      if (!result.ok && task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code}`);
        recordActionQueueEvent(task, 'retry', { code: result.code, ok: false, attemptCount: task.retries });
        if (!consumeRetryBudget()) {
          task.resolve({ ok: false, code: 'backpressure_reject' });
          return;
        }
        insertTaskSorted(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
        recordActionQueueEvent(task, 'success', { code: result.code || 'ok', ok: true });
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
        recordActionQueueEvent(task, 'fail', { code: result.code, ok: false });
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
        recordActionQueueEvent(task, 'timeout', { code: 'action_failed_timeout', ok: false });
        task.resolve({ ok: false, code: 'action_failed_timeout' });
        return;
      }
      const result = wrapped.value as GuardResult;
      if (!result.ok && task.retries < task.maxRetries) {
        task.retries += 1;
        stats.queueRetried += 1;
        recordMinuteMetric('retried');
        appendQueueLog(`${task.type} ${taskSubject(task)} retry_${task.retries} code=${result.code}`);
        recordActionQueueEvent(task, 'retry', { code: result.code, ok: false, attemptCount: task.retries });
        if (!consumeRetryBudget()) {
          task.resolve({ ok: false, code: 'backpressure_reject' });
          return;
        }
        insertTaskSorted(task);
        incGroupPending(task.groupId);
        return;
      }
      task.resolve(result);
      if (result.ok) {
        stats.queueExecuted += 1;
        recordMinuteMetric('executed');
        appendQueueLog(`${task.type} ${taskSubject(task)} success`);
        recordActionQueueEvent(task, 'success', { code: result.code || 'ok', ok: true });
      } else {
        appendQueueLog(`${task.type} ${taskSubject(task)} fail code=${result.code}`);
        recordActionQueueEvent(task, 'fail', { code: result.code, ok: false });
      }
      return;
    }
    const wrapped = await executeWithTimeout(communicationStateService.callApi(task.payload.action, task.payload.params), timeoutMs);
    if (wrapped.timeout) {
      stats.timeoutCount += 1;
      recordMinuteMetric('timeout');
      appendQueueLog(`${task.type} ${taskSubject(task)} timeout`);
      recordActionQueueEvent(task, 'timeout', { code: 'action_failed_timeout', ok: false });
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
      recordActionQueueEvent(task, 'retry', { code: 'fail_api', ok: false, attemptCount: task.retries });
      if (!consumeRetryBudget()) {
        task.resolve({ ok: false, code: 'backpressure_reject' });
        return;
      }
      insertTaskSorted(task);
      incGroupPending(task.groupId);
      return;
    }
    task.resolve({ ok, code: ok ? 'ok' : 'fail_api' });
    if (ok) {
      stats.queueExecuted += 1;
      recordMinuteMetric('executed');
      appendQueueLog(`${task.type} ${taskSubject(task)} success`);
      recordActionQueueEvent(task, 'success', { code: 'ok', ok: true });
    } else {
      appendQueueLog(`${task.type} ${taskSubject(task)} fail code=fail_api`);
      recordActionQueueEvent(task, 'fail', { code: 'fail_api', ok: false });
    }
  } catch (e) {
    if (task.type === 'recall') {
      await groupguardRepository.resolveRecallTask(task.payload.taskId, 'exception', false, 0);
    }
    appendQueueLog(`${task.type} ${taskSubject(task)} exception`);
    recordActionQueueEvent(task, 'exception', { code: 'exception', ok: false, payload: JSON.stringify({ error: String(e) }) });
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
}): Promise<QueueLinkedGuardResult> {
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
    loggingStateService.warn(`撤回持久化写入失败: ${String(e)}`);
  }
  return new Promise<QueueLinkedGuardResult>((resolve, reject) => {
    const actionId = nextActionId();
    const task: RecallTask = {
      actionId,
      type: 'recall',
      groupId: opts.groupId,
      priorityScore: getActionPriority(opts.groupId, 'recall'),
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
      resolve: (value) => resolve({ ...value, taskId, actionId }),
      reject
    };
    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: enqueueResult === 'backpressure_reject' ? 'backpressure_reject' : 'skip_queue_overflow', taskId, actionId });
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
      priorityScore: getActionPriority(opts.groupId, 'self_recall'),
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
    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: enqueueResult === 'backpressure_reject' ? 'backpressure_reject' : 'skip_queue_overflow' });
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
}): Promise<QueueLinkedGuardResult> {
  const uid = String(opts.userId);
  const taskId = String(opts.dedupKey || `${opts.groupId}:ban:${uid}`);
  return new Promise<QueueLinkedGuardResult>((resolve, reject) => {
    const actionId = nextActionId();
    const task: BanTask = {
      actionId,
      type: 'ban',
      groupId: opts.groupId,
      priorityScore: getActionPriority(opts.groupId, 'ban'),
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      targetUserId: uid,
      dedupKey: taskId,
      payload: {
        userId: uid,
        durationSeconds: opts.durationSeconds,
        reason: opts.reason,
        automatic: opts.automatic,
        ignoreTargetProtection: opts.ignoreTargetProtection
      },
      resolve: (value) => resolve({ ...value, taskId, actionId }),
      reject
    };
    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: enqueueResult === 'backpressure_reject' ? 'backpressure_reject' : 'skip_rate_limited', taskId, actionId });
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
}): Promise<QueueLinkedGuardResult> {
  const uid = String(opts.userId);
  const taskId = String(opts.dedupKey || `${opts.groupId}:kick:${uid}`);
  return new Promise<QueueLinkedGuardResult>((resolve, reject) => {
    const actionId = nextActionId();
    const task: KickTask = {
      actionId,
      type: 'kick',
      groupId: opts.groupId,
      priorityScore: getActionPriority(opts.groupId, 'kick'),
      createdAt: Date.now(),
      retries: 0,
      maxRetries: Math.max(0, Number(opts.maxRetries ?? 1)),
      targetUserId: uid,
      dedupKey: taskId,
      payload: {
        userId: uid,
        reason: opts.reason,
        rejectAddRequest: opts.rejectAddRequest,
        automatic: opts.automatic
      },
      resolve: (value) => resolve({ ...value, taskId, actionId }),
      reject
    };
    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: enqueueResult === 'backpressure_reject' ? 'backpressure_reject' : 'skip_rate_limited', taskId, actionId });
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
      priorityScore: getActionPriority(opts.groupId, 'misc'),
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
    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: enqueueResult === 'backpressure_reject' ? 'backpressure_reject' : 'skip_queue_overflow' });
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

function buildRecentLogHits(taskId: string, limit = 5): string[] {
  const safe = Math.max(1, Math.min(20, Number(limit) || 5));
  return getActionQueueRecentLogs(100).filter(line => line.includes(taskId)).slice(0, safe);
}

function parseAuditPayload(row: AuditEventRecord): StandardAuditPayload | Record<string, any> | null {
  try {
    return JSON.parse(String(row.payload || '{}'));
  } catch {
    return null;
  }
}

function normalizeAuditSource(value: unknown): string {
  return String(value || '').trim();
}

function buildLookupFromRecallTask(taskId: string, row: RecallTaskRecord): ActionQueueTaskLookupResult {
  return {
    taskId,
    found: true,
    source: 'recall_tasks',
    taskType: 'recall',
    status: row.status,
    groupId: row.groupId,
    userId: row.targetUserId || '',
    messageId: row.messageId,
    reason: row.reason,
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    nextRetryAt: row.nextRetryAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastCode: row.lastCode,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
    recentLogs: buildRecentLogHits(taskId),
    raw: row
  };
}

function buildLookupFromSelfRecallTask(taskId: string, row: SelfRecallTaskRecord): ActionQueueTaskLookupResult {
  return {
    taskId,
    found: true,
    source: 'self_recall_tasks',
    taskType: 'self_recall',
    status: row.status,
    groupId: row.groupId,
    messageId: row.messageId,
    reason: row.reason,
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    nextRetryAt: row.nextRetryAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastCode: row.lastCode,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
    recentLogs: buildRecentLogHits(taskId),
    raw: row
  };
}

export async function getActionQueueTaskSnapshot(taskId: string): Promise<ActionQueueTaskLookupResult | null> {
  const normalized = String(taskId || '').trim();
  if (!normalized) return null;
  const queueIndex = queue.findIndex(task => {
    if (task.type === 'recall' || task.type === 'self_recall') {
      return String(task.payload.taskId || '') === normalized;
    }
    return String(task.dedupKey || '') === normalized;
  });
  if (queueIndex >= 0) {
    const task = queue[queueIndex];
    const result: ActionQueueTaskLookupResult = {
      taskId: normalized,
      found: true,
      source: 'memory_queue',
      taskType: task.type,
      status: 'pending',
      groupId: task.groupId,
      userId: task.targetUserId || (task.type === 'ban' || task.type === 'kick' ? (task.payload as any).userId : undefined),
      messageId: task.type === 'recall' || task.type === 'self_recall' ? task.payload.messageId : undefined,
      reason: task.type === 'recall' || task.type === 'self_recall' ? task.payload.reason : (task.payload as any).reason,
      actionId: task.actionId,
      queuePosition: queueIndex + 1,
      recentLogs: buildRecentLogHits(normalized),
      raw: {
        actionId: task.actionId,
        type: task.type,
        groupId: task.groupId,
        dedupKey: task.dedupKey,
        payload: task.payload,
        createdAt: task.createdAt,
        retries: task.retries,
        maxRetries: task.maxRetries
      }
    };
    return result;
  }
  const recallTask = await groupguardRepository.getRecallTask(normalized);
  if (recallTask) return buildLookupFromRecallTask(normalized, recallTask);
  const selfRecallTask = await groupguardRepository.getSelfRecallTask(normalized);
  if (selfRecallTask) return buildLookupFromSelfRecallTask(normalized, selfRecallTask);
  const logs = buildRecentLogHits(normalized);
  return {
    taskId: normalized,
    found: false,
    source: logs.length ? 'memory_log' : 'not_found',
    recentLogs: logs.length ? logs : undefined
  };
}

function buildTraceTimelineItemFromAudit(row: AuditEventRecord, payload: any): ActionQueueTraceItem {
  const standard = payload && typeof payload === 'object' && payload.schemaVersion === 1 ? payload as StandardAuditPayload : null;
  const queueTaskId = String(standard?.queueTaskId || payload?.queueTaskId || '');
  const correlationId = String(standard?.correlationId || payload?.correlationId || payload?.context?.correlationId || '');
  const actions = Array.isArray(standard?.actions) ? standard.actions : Array.isArray(payload?.actions) ? payload.actions : [];
  const action = actions[0] || {};
  const title = standard
    ? `${standard.eventType} · ${standard.decision}`
    : `${row.eventType} · ${row.kind || '-'}`;
  const detailBits = [
    standard?.source || payload?.source || '',
    standard?.actionType || payload?.actionType || action?.type || '',
    standard?.reason || payload?.reason || row.reason || '',
    queueTaskId ? `task=${queueTaskId}` : '',
    action?.code ? `code=${String(action.code)}` : '',
    action?.ok !== undefined ? `ok=${action.ok === true ? 'true' : 'false'}` : ''
  ].filter(Boolean);
  return {
    ts: row.createdAt,
    stage: row.eventType,
    title,
    detail: detailBits.join(' · '),
    auditEventId: row.id,
    eventType: row.eventType,
    correlationId: correlationId || undefined,
    queueTaskId: queueTaskId || undefined,
    actionId: String(action?.actionId || standard?.legacy?.actionId || payload?.actionId || ''),
    code: String(action?.code || standard?.legacy?.code || payload?.code || ''),
    ok: action?.ok !== undefined ? action.ok === true : undefined,
    source: normalizeAuditSource(standard?.source || payload?.source),
    raw: row
  };
}

function buildQueueSnapshotTimelineItem(snapshot: ActionQueueTaskLookupResult): ActionQueueTraceItem {
  return {
    ts: snapshot.updatedAt || snapshot.createdAt || Date.now(),
    stage: 'queue_snapshot',
    title: `队列状态 · ${snapshot.source}`,
    detail: [
      snapshot.found ? 'found' : 'missing',
      snapshot.status ? `status=${snapshot.status}` : '',
      snapshot.groupId ? `group=${snapshot.groupId}` : '',
      snapshot.userId ? `user=${snapshot.userId}` : '',
      snapshot.messageId ? `msg=${snapshot.messageId}` : '',
      snapshot.actionId ? `action=${snapshot.actionId}` : ''
    ].filter(Boolean).join(' · '),
    queueTaskId: snapshot.taskId,
    actionId: snapshot.actionId,
    source: snapshot.source,
    raw: snapshot
  };
}

function buildTraceTimelineItemFromActionEvent(row: ActionQueueEventRecord): ActionQueueTraceItem {
  return {
    ts: row.createdAt,
    stage: 'action_queue_event',
    title: `动作队列 · ${row.event}`,
    detail: [
      row.taskType ? `type=${row.taskType}` : '',
      row.code ? `code=${row.code}` : '',
      row.reason ? `reason=${row.reason}` : '',
      row.groupId ? `group=${row.groupId}` : '',
      row.userId ? `user=${row.userId}` : '',
      row.messageId ? `msg=${row.messageId}` : ''
    ].filter(Boolean).join(' · '),
    queueTaskId: row.taskId,
    actionId: row.actionId,
    code: row.code,
    ok: row.ok,
    source: 'action_queue_events',
    raw: row
  };
}

export async function getActionQueueTaskTrace(taskId: string): Promise<ActionQueueTaskTraceView | null> {
  const normalized = String(taskId || '').trim();
  if (!normalized) return null;
  const snapshot = await getActionQueueTaskSnapshot(normalized);
  const relatedAuditEvents = await groupguardRepository.getAuditEventsByQueueTaskId(normalized, 50);
  const actionEvents = await groupguardRepository.getActionQueueEventsByTaskId(normalized, 100);
  const relatedTimeline: ActionQueueTraceItem[] = [];
  if (snapshot) relatedTimeline.push(buildQueueSnapshotTimelineItem(snapshot));
  for (const event of actionEvents) relatedTimeline.push(buildTraceTimelineItemFromActionEvent(event));
  const parsedEvents = relatedAuditEvents.map(row => ({ row, payload: parseAuditPayload(row) }));
  const queueTaskIds = new Set<string>();
  const correlationIds = new Set<string>();
  for (const { row, payload } of parsedEvents) {
    const standard = payload && typeof payload === 'object' && payload.schemaVersion === 1 ? payload as StandardAuditPayload : null;
    const correlationId = String(standard?.correlationId || payload?.correlationId || payload?.context?.correlationId || '').trim();
    if (correlationId) correlationIds.add(correlationId);
    const ids = [
      String(standard?.queueTaskId || payload?.queueTaskId || ''),
      ...(Array.isArray(standard?.actions) ? standard.actions.map(action => String(action?.queueTaskId || '')) : []),
      ...(Array.isArray(payload?.actions) ? payload.actions.map((action: any) => String(action?.queueTaskId || '')) : [])
    ].map(item => item.trim()).filter(Boolean);
    for (const id of ids) queueTaskIds.add(id);
    relatedTimeline.push(buildTraceTimelineItemFromAudit(row, payload));
  }
  let anchorEventType: ActionQueueTraceItem['eventType'] | undefined;
  let anchorCreatedAt: number | undefined;
  let source: string = snapshot?.source || 'not_found';
  if (relatedAuditEvents.length) {
    const anchor = relatedAuditEvents.find(row => row.eventType === 'manual_policy_action') || relatedAuditEvents.find(row => row.eventType === 'policy_decision') || relatedAuditEvents[0];
    anchorEventType = anchor.eventType;
    anchorCreatedAt = anchor.createdAt;
    const anchorPayload = parseAuditPayload(anchor);
    const standard = anchorPayload && typeof anchorPayload === 'object' && anchorPayload.schemaVersion === 1 ? anchorPayload as StandardAuditPayload : null;
    const anchorCorrelationId = String(standard?.correlationId || anchorPayload?.correlationId || anchorPayload?.context?.correlationId || '').trim();
    if (anchorCorrelationId) correlationIds.add(anchorCorrelationId);
    source = standard?.source || normalizeAuditSource(anchorPayload?.source) || source;
    if (standard?.eventType === 'manual_policy_action' || anchor.eventType === 'manual_policy_action') {
      source = 'manual_policy_channel';
    } else if (standard?.eventType === 'policy_decision' || anchor.eventType === 'policy_decision') {
      source = 'policy_engine';
    }
    if (anchor.groupId && anchor.userId) {
      const contextual = anchorCorrelationId
        ? await groupguardRepository.queryAuditEvents({ correlationId: anchorCorrelationId, limit: 80, offset: 0 })
        : await groupguardRepository.queryAuditEvents({
          groupId: anchor.groupId,
          userId: anchor.userId,
          limit: 80,
          offset: 0
        });
      const windowStart = Math.max(0, anchor.createdAt - 10 * 60 * 1000);
      const windowEnd = anchor.createdAt + 10 * 60 * 1000;
      for (const row of contextual.rows.reverse()) {
        if (!anchorCorrelationId && (row.createdAt < windowStart || row.createdAt > windowEnd)) continue;
        if (row.eventType === 'risk_signal' || row.eventType === 'risk_assessment') {
          const payload = parseAuditPayload(row);
          relatedTimeline.push(buildTraceTimelineItemFromAudit(row, payload));
        }
      }
    }
  }
  relatedTimeline.sort((a, b) => a.ts - b.ts || String(a.stage).localeCompare(String(b.stage)));
  const timeline = Array.from(new Map(relatedTimeline.map(item => [`${item.stage}:${item.ts}:${item.title}:${item.detail}`, item])).values());
  const summary = snapshot
    ? snapshot.found
      ? `${snapshot.source === 'memory_queue' ? '任务仍在队列中等待执行' : '任务已落在持久化状态中'}，关联审计 ${relatedAuditEvents.length} 条`
      : `任务未在队列或任务表中找到，关联审计 ${relatedAuditEvents.length} 条`
    : `任务未找到，关联审计 ${relatedAuditEvents.length} 条`;
  return {
    taskId: normalized,
    snapshot,
    attribution: {
      summary,
      source,
      correlationId: Array.from(correlationIds)[0],
      matchedAuditEvents: relatedAuditEvents.length,
      matchedQueueTaskIds: Array.from(queueTaskIds),
      anchorEventType,
      anchorCreatedAt
    },
    timeline,
    relatedAuditEvents,
    actionEvents
  };
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
    loggingStateService.warn(`自撤回补偿调度失败: ${String(e)}`);
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
    loggingStateService.warn(`撤回补偿调度失败: ${String(e)}`);
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
