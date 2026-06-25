import { authStateService } from '../core/state-services/auth_state_service';
import { cacheStateService } from '../core/state-services/cache_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { pluginState } from '../state';
import type { GroupGuardSettings } from '../types';

type GuardAction = 'recall' | 'ban' | 'kick';
type RiskLevel = 'normal' | 'warn' | 'protect';

export interface GuardResult {
  ok: boolean;
  code: 'ok' | 'unknown_timeout' | 'skip_bot_not_admin' | 'skip_target_protected' | 'skip_duplicate' | 'skip_rate_limited' | 'skip_risk_protect' | 'skip_replaced' | 'skip_queue_overflow' | 'action_failed_timeout' | 'fail_api' | 'backpressure_reject';
  role?: 'member' | 'admin' | 'owner' | 'unknown';
}

interface RiskState {
  score: number;
  updatedAt: number;
}

interface GroupGuardStats {
  total: number;
  ok: number;
  skip: number;
  fail: number;
  actions: Record<GuardAction, number>;
  resultCodes: Record<string, number>;
  reasons: Record<string, number>;
  updatedAt: number;
  events: Array<{ ts: number; action: GuardAction; code: string; reason: string; ok: boolean; }>;
}

const recallDedup = new Map<string, number>();
const actionHistory = new Map<string, number[]>();
const riskStates = new Map<string, RiskState>();
const guardStats = new Map<string, GroupGuardStats>();

function getSettings(groupId: string): GroupGuardSettings {
  return configStateService.resolveGroupSettings(groupId);
}

function now(): number {
  return Date.now();
}

function historyKey(groupId: string, action: GuardAction): string {
  return `${groupId}:${action}`;
}

function getRoleCacheSeconds(groupId: string): number {
  const s = getSettings(groupId);
  const n = Number(s.adminCacheSeconds ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

async function getTargetRole(groupId: string, userId?: string): Promise<'member' | 'admin' | 'owner' | 'unknown'> {
  if (!userId) return 'unknown';
  const key = `${groupId}:${userId}`;
  const cacheSeconds = getRoleCacheSeconds(groupId);
  if (cacheSeconds > 0) {
    const cached = cacheStateService.getAdminCacheEntry(key);
    if (cached && Date.now() < cached.expire) {
      const role = String(cached.role || 'member');
      if (role === 'owner' || role === 'admin' || role === 'member') return role;
      return 'unknown';
    }
  }
  const info = await communicationStateService.callApi('get_group_member_info', { group_id: groupId, user_id: userId }) as any;
  const role = String(info?.role || 'member');
  if (cacheSeconds > 0) {
    cacheStateService.setAdminCacheEntry(key, { role, expire: Date.now() + cacheSeconds * 1000 });
  }
  if (role === 'owner' || role === 'admin' || role === 'member') return role;
  return 'unknown';
}

function pruneRecallDedup(groupId: string): void {
  const s = getSettings(groupId);
  const ttlSec = Math.max(5, Number(s.recallDedupSeconds ?? 20));
  const ts = now();
  for (const [k, t] of recallDedup.entries()) {
    if (ts - t > ttlSec * 1000) recallDedup.delete(k);
  }
}

function hitRecallDuplicate(groupId: string, messageId: string): boolean {
  pruneRecallDedup(groupId);
  return recallDedup.has(messageId);
}

function markRecall(messageId: string): void {
  recallDedup.set(messageId, now());
}

function hitRateLimit(groupId: string, action: GuardAction): boolean {
  const s = getSettings(groupId);
  const windowSec = Math.max(10, Number(s.actionRateWindowSeconds ?? 60));
  const limit = Math.max(5, Number(s.actionRateLimit ?? 30));
  const key = historyKey(groupId, action);
  const ts = now();
  const list = (actionHistory.get(key) || []).filter(t => ts - t < windowSec * 1000);
  const hit = list.length >= limit;
  if (!hit) {
    list.push(ts);
    actionHistory.set(key, list);
  } else {
    actionHistory.set(key, list);
  }
  return hit;
}

function getRiskThresholdWarn(s: GroupGuardSettings): number {
  return Math.max(1, Number(s.riskWarnScore ?? 3));
}

function getRiskThresholdProtect(s: GroupGuardSettings): number {
  return Math.max(getRiskThresholdWarn(s) + 1, Number(s.riskProtectScore ?? 8));
}

function decayRisk(groupId: string, s: GroupGuardSettings): RiskState {
  const decaySec = Math.max(30, Number(s.riskDecaySeconds ?? 300));
  const current = riskStates.get(groupId) || { score: 0, updatedAt: now() };
  const ts = now();
  const elapsed = Math.max(0, ts - current.updatedAt);
  if (elapsed > 0) {
    const decay = elapsed / (decaySec * 1000);
    current.score = Math.max(0, current.score - decay);
    current.updatedAt = ts;
    riskStates.set(groupId, current);
  }
  return current;
}

function getRiskLevel(groupId: string): RiskLevel {
  const s = getSettings(groupId);
  if (s.autoRiskControl === false) return 'normal';
  const st = decayRisk(groupId, s);
  const protect = getRiskThresholdProtect(s);
  const warn = getRiskThresholdWarn(s);
  if (st.score >= protect) return 'protect';
  if (st.score >= warn) return 'warn';
  return 'normal';
}

function recordRisk(groupId: string, ok: boolean, automatic: boolean): void {
  const s = getSettings(groupId);
  if (s.autoRiskControl === false || !automatic) return;
  const st = decayRisk(groupId, s);
  st.score = Math.max(0, Math.min(100, ok ? st.score - 0.4 : st.score + 1.2));
  st.updatedAt = now();
  riskStates.set(groupId, st);
}

function protectedByRole(role: string, s: GroupGuardSettings, type: GuardAction): boolean {
  if (type === 'recall') {
    if (role === 'owner' && !s.allowRecallOwnerMessage) return true;
    if (role === 'admin' && !s.allowRecallAdminMessage) return true;
    return false;
  }
  const protectOwner = s.protectOwnerActions !== false;
  const protectAdmin = s.protectAdminActions !== false;
  if (role === 'owner' && protectOwner) return true;
  if (role === 'admin' && protectAdmin) return true;
  return false;
}

function logAction(groupId: string, action: GuardAction, result: GuardResult, detail: Record<string, any>): void {
  const ts = now();
  const stat = guardStats.get(groupId) || {
    total: 0,
    ok: 0,
    skip: 0,
    fail: 0,
    actions: { recall: 0, ban: 0, kick: 0 },
    resultCodes: {},
    reasons: {},
    updatedAt: ts,
    events: []
  };
  stat.total += 1;
  stat.actions[action] = (stat.actions[action] || 0) + 1;
  stat.resultCodes[result.code] = (stat.resultCodes[result.code] || 0) + 1;
  if (result.ok) stat.ok += 1;
  else if (result.code.startsWith('skip_')) stat.skip += 1;
  else stat.fail += 1;
  const reason = String(detail?.reason || 'unknown');
  stat.reasons[reason] = (stat.reasons[reason] || 0) + 1;
  stat.updatedAt = ts;
  stat.events.push({ ts, action, code: result.code, reason, ok: result.ok });
  const keepMs = 24 * 60 * 60 * 1000;
  const cutoff = ts - keepMs;
  if (stat.events.length > 2000) {
    stat.events = stat.events.filter(e => e.ts >= cutoff).slice(-2000);
  }
  guardStats.set(groupId, stat);
  const payload = {
    event: 'guard_action',
    groupId,
    action,
    result: result.code,
    role: result.role || 'unknown',
    ...detail
  };
  const text = JSON.stringify(payload);
  if (result.ok) loggingStateService.info(text);
  else loggingStateService.warn(text);
}

function isDeleteMsgCallbackTimeout(error: unknown): boolean {
  const text = String(error || '');
  return text.includes('Timeout')
    || text.includes('No data returned')
    || text.includes('decode failed')
    || text.includes('NodeIKernelMsgService/recallMsg');
}

async function callDeleteMsgOnce(messageId: string): Promise<'ok' | 'unknown_timeout' | 'fail_api'> {
  if (!pluginState.actions || !pluginState.networkConfig) return 'fail_api';
  try {
    const res = await pluginState.actions.call('delete_msg', {
      message_id: String(messageId)
    } as never, pluginState.adapterName, pluginState.networkConfig);
    return res === null ? 'fail_api' : 'ok';
  } catch (error) {
    if (isDeleteMsgCallbackTimeout(error)) {
      loggingStateService.debug(`[Recall] delete_msg callback timeout treated as unknown_timeout messageId=${messageId}`);
      return 'unknown_timeout';
    }
    loggingStateService.debug(`[Recall] delete_msg failed messageId=${messageId} error=${String(error)}`);
    return 'fail_api';
  }
}

export async function safeRecall(opts: { groupId: string; messageId: string; targetUserId?: string; reason: string; automatic?: boolean; allowSelfTarget?: boolean; }): Promise<GuardResult> {
  const groupId = opts.groupId;
  const s = getSettings(groupId);
  const automatic = opts.automatic !== false;
  if (automatic && getRiskLevel(groupId) === 'protect') {
    const r: GuardResult = { ok: false, code: 'skip_risk_protect' };
    logAction(groupId, 'recall', r, { reason: opts.reason });
    return r;
  }
  if (hitRecallDuplicate(groupId, String(opts.messageId))) {
    const r: GuardResult = { ok: false, code: 'skip_duplicate' };
    logAction(groupId, 'recall', r, { reason: opts.reason });
    return r;
  }
  if (automatic && hitRateLimit(groupId, 'recall')) {
    const r: GuardResult = { ok: false, code: 'skip_rate_limited' };
    logAction(groupId, 'recall', r, { reason: opts.reason });
    return r;
  }
  if (!await authStateService.isBotAdmin(groupId)) {
    const r: GuardResult = { ok: false, code: 'skip_bot_not_admin' };
    logAction(groupId, 'recall', r, { reason: opts.reason });
    recordRisk(groupId, false, automatic);
    return r;
  }
  const targetUserId = opts.targetUserId ? String(opts.targetUserId) : '';
  const allowSelfTarget = opts.allowSelfTarget !== false;
  let role: GuardResult['role'] = 'unknown';
  if (targetUserId && !(allowSelfTarget && targetUserId === identityStateService.getBotId())) {
    role = await getTargetRole(groupId, targetUserId);
    if (protectedByRole(role, s, 'recall')) {
      const r: GuardResult = { ok: false, code: 'skip_target_protected', role };
      logAction(groupId, 'recall', r, { reason: opts.reason, targetUserId });
      return r;
    }
  }
  const deleteResult = await callDeleteMsgOnce(String(opts.messageId));
  if (deleteResult === 'fail_api') {
    const r: GuardResult = { ok: false, code: 'fail_api', role };
    logAction(groupId, 'recall', r, { reason: opts.reason, targetUserId });
    recordRisk(groupId, false, automatic);
    return r;
  }
  markRecall(String(opts.messageId));
  const r: GuardResult = { ok: true, code: deleteResult === 'unknown_timeout' ? 'unknown_timeout' : 'ok', role };
  logAction(groupId, 'recall', r, { reason: opts.reason, targetUserId });
  recordRisk(groupId, true, automatic);
  return r;
}

export async function safeBan(opts: { groupId: string; userId: string; durationSeconds: number; reason: string; automatic?: boolean; ignoreTargetProtection?: boolean; }): Promise<GuardResult> {
  const groupId = opts.groupId;
  const s = getSettings(groupId);
  const automatic = opts.automatic !== false;
  if (automatic && getRiskLevel(groupId) === 'protect') {
    const r: GuardResult = { ok: false, code: 'skip_risk_protect' };
    logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  if (automatic && hitRateLimit(groupId, 'ban')) {
    const r: GuardResult = { ok: false, code: 'skip_rate_limited' };
    logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  if (!await authStateService.isBotAdmin(groupId)) {
    const r: GuardResult = { ok: false, code: 'skip_bot_not_admin' };
    logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
    recordRisk(groupId, false, automatic);
    return r;
  }
  const role = await getTargetRole(groupId, String(opts.userId));
  if (!opts.ignoreTargetProtection && protectedByRole(role, s, 'ban')) {
    const r: GuardResult = { ok: false, code: 'skip_target_protected', role };
    logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  const res = await communicationStateService.callApi('set_group_ban', { group_id: groupId, user_id: String(opts.userId), duration: Math.max(0, Math.floor(opts.durationSeconds)) });
  if (res === null) {
    const r: GuardResult = { ok: false, code: 'fail_api', role };
    logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
    recordRisk(groupId, false, automatic);
    return r;
  }
  const r: GuardResult = { ok: true, code: 'ok', role };
  logAction(groupId, 'ban', r, { reason: opts.reason, targetUserId: opts.userId });
  recordRisk(groupId, true, automatic);
  return r;
}

export async function safeKick(opts: { groupId: string; userId: string; reason: string; rejectAddRequest?: boolean; automatic?: boolean; }): Promise<GuardResult> {
  const groupId = opts.groupId;
  const s = getSettings(groupId);
  const automatic = opts.automatic !== false;
  if (automatic && getRiskLevel(groupId) === 'protect') {
    const r: GuardResult = { ok: false, code: 'skip_risk_protect' };
    logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  if (automatic && hitRateLimit(groupId, 'kick')) {
    const r: GuardResult = { ok: false, code: 'skip_rate_limited' };
    logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  if (!await authStateService.isBotAdmin(groupId)) {
    const r: GuardResult = { ok: false, code: 'skip_bot_not_admin' };
    logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
    recordRisk(groupId, false, automatic);
    return r;
  }
  const role = await getTargetRole(groupId, String(opts.userId));
  if (protectedByRole(role, s, 'kick')) {
    const r: GuardResult = { ok: false, code: 'skip_target_protected', role };
    logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
    return r;
  }
  const res = await communicationStateService.callApi('set_group_kick', { group_id: groupId, user_id: String(opts.userId), reject_add_request: opts.rejectAddRequest === true });
  if (res === null) {
    const r: GuardResult = { ok: false, code: 'fail_api', role };
    logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
    recordRisk(groupId, false, automatic);
    return r;
  }
  const r: GuardResult = { ok: true, code: 'ok', role };
  logAction(groupId, 'kick', r, { reason: opts.reason, targetUserId: opts.userId });
  recordRisk(groupId, true, automatic);
  return r;
}

export function getGuardRuntimeSnapshot() {
  const aggregateWindow = (stat: GroupGuardStats, windowMs: number) => {
    const ts = now();
    const events = windowMs > 0 ? stat.events.filter(e => ts - e.ts <= windowMs) : stat.events.slice();
    const out = {
      total: 0,
      ok: 0,
      skip: 0,
      fail: 0,
      actions: { recall: 0, ban: 0, kick: 0 } as Record<GuardAction, number>,
      resultCodes: {} as Record<string, number>,
      reasons: {} as Record<string, number>,
      topReasons: [] as Array<{ reason: string; count: number; }>
    };
    for (const e of events) {
      out.total += 1;
      out.actions[e.action] = (out.actions[e.action] || 0) + 1;
      out.resultCodes[e.code] = (out.resultCodes[e.code] || 0) + 1;
      if (e.ok) out.ok += 1;
      else if (String(e.code).startsWith('skip_')) out.skip += 1;
      else out.fail += 1;
      out.reasons[e.reason] = (out.reasons[e.reason] || 0) + 1;
    }
    out.topReasons = Object.entries(out.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));
    return out;
  };
  const nowTs = now();
  const groupIds = new Set<string>([...riskStates.keys(), ...guardStats.keys()]);
  const groups = Array.from(groupIds).map(groupId => {
    const risk = riskStates.get(groupId);
    const stats = guardStats.get(groupId) || {
      total: 0,
      ok: 0,
      skip: 0,
      fail: 0,
      actions: { recall: 0, ban: 0, kick: 0 },
      resultCodes: {},
      reasons: {},
      updatedAt: nowTs,
      events: []
    };
    const win10m = aggregateWindow(stats, 10 * 60 * 1000);
    const win60m = aggregateWindow(stats, 60 * 60 * 1000);
    const winAll = aggregateWindow(stats, 0);
    return {
      groupId,
      score: Number((risk?.score || 0).toFixed(2)),
      total: winAll.total,
      ok: winAll.ok,
      skip: winAll.skip,
      fail: winAll.fail,
      actions: winAll.actions,
      resultCodes: winAll.resultCodes,
      topReasons: winAll.topReasons,
      updatedAt: stats.updatedAt,
      windows: {
        all: winAll,
        m10: win10m,
        h1: win60m
      }
    };
  }).sort((a, b) => b.total - a.total || b.skip - a.skip || b.fail - a.fail);
  const summary = groups.reduce((acc, g) => {
    acc.total += g.total;
    acc.ok += g.ok;
    acc.skip += g.skip;
    acc.fail += g.fail;
    return acc;
  }, { total: 0, ok: 0, skip: 0, fail: 0 });
  return { summary, groups };
}
