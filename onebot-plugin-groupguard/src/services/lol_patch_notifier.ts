import { authManager } from '../auth';
import { getGroupGuardBotRole, type GroupGuardBotRole } from '../core/bot_role';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import { LolPatchNotificationStateStore } from './lol_patch_notification_state';

const PATCH_STATUS_PATH = '/lol/patch-status';
const DEFAULT_NOTIFICATION_TIME = '12:00';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_INTERVAL_MS = 60_000;

export type LolPatchNotifierSenderRole = GroupGuardBotRole | 'any' | 'off';

export interface LolPatchStatus {
  date: string;
  patch: string | null;
  is_update_today: boolean;
  next_update_date: string | null;
  next_patch: string | null;
  source: string;
  source_url: string;
  checked_at: string;
  event_id: string | null;
  schedule_timezone: 'Asia/Shanghai';
}

export interface LolPatchReconcileResult {
  status:
    | 'disabled'
    | 'role_inactive'
    | 'before_time'
    | 'misconfigured'
    | 'provider_error'
    | 'not_patch_day'
    | 'completed';
  eventId?: string;
  attempted: number;
  succeeded: number;
  failed: number;
  deduplicated: number;
}

export interface LolPatchReconcileOptions {
  now: Date;
  enabled: boolean;
  currentRole: GroupGuardBotRole;
  senderRole: LolPatchNotifierSenderRole;
  notificationTime: string;
  baseUrl: string;
  timeoutMs: number;
  groupIds: string[];
  fetchStatus?: (baseUrl: string, date: string, timeoutMs: number) => Promise<LolPatchStatus>;
  hasDelivered: (eventId: string, groupId: string) => boolean;
  markDelivered: (eventId: string, groupId: string, sentAt: string) => void;
  sendNotice?: (groupId: string, status: LolPatchStatus) => Promise<void>;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

interface ShanghaiClock {
  date: string;
  minutes: number;
  isoNow: string;
}

function envText(name: string, fallback = ''): string {
  const value = String(process.env[name] ?? '').trim();
  return value || fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function envPositiveNumber(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

export function normalizeLolPatchSenderRole(value: unknown): LolPatchNotifierSenderRole {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'full' || normalized === 'qa' || normalized === 'query' || normalized === 'any' || normalized === 'off') {
    return normalized;
  }
  return 'query';
}

export function isLolPatchNotifierRoleActive(
  currentRole: GroupGuardBotRole,
  senderRole: LolPatchNotifierSenderRole,
): boolean {
  if (senderRole === 'off') return false;
  if (senderRole === 'any') return true;
  return currentRole === senderRole;
}

function parseNotificationMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return 12 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getShanghaiClock(now: Date): ShanghaiClock {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const offsetNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const isoNow = `${offsetNow.toISOString().slice(0, 19)}+08:00`;
  return {
    date,
    minutes: hour * 60 + minute + second / 60,
    isoNow,
  };
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : null;
}

export function validateLolPatchStatus(value: unknown): LolPatchStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('lol_patch_status_invalid_payload');
  }
  const raw = value as Record<string, unknown>;
  const date = typeof raw.date === 'string' ? raw.date : '';
  const source = typeof raw.source === 'string' ? raw.source : '';
  const sourceUrl = typeof raw.source_url === 'string' ? raw.source_url : '';
  const checkedAt = typeof raw.checked_at === 'string' ? raw.checked_at : '';
  const timezone = raw.schedule_timezone;
  const patch = nullableString(raw.patch);
  const eventId = nullableString(raw.event_id);
  const nextDate = nullableString(raw.next_update_date);
  const nextPatch = nullableString(raw.next_patch);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('lol_patch_status_invalid_date');
  if (typeof raw.is_update_today !== 'boolean') throw new Error('lol_patch_status_invalid_flag');
  if (!source || !sourceUrl || !checkedAt) throw new Error('lol_patch_status_missing_metadata');
  if (timezone !== 'Asia/Shanghai') throw new Error('lol_patch_status_timezone_mismatch');
  if (nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) throw new Error('lol_patch_status_invalid_next_date');
  if (raw.is_update_today && (!patch || !eventId)) throw new Error('lol_patch_status_incomplete_event');
  if (!raw.is_update_today && eventId) throw new Error('lol_patch_status_unexpected_event_id');
  return {
    date,
    patch,
    is_update_today: raw.is_update_today,
    next_update_date: nextDate,
    next_patch: nextPatch,
    source,
    source_url: sourceUrl,
    checked_at: checkedAt,
    event_id: eventId,
    schedule_timezone: 'Asia/Shanghai',
  };
}

export async function fetchLolPatchStatus(
  baseUrl: string,
  date: string,
  timeoutMs: number,
): Promise<LolPatchStatus> {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalizedBase)) throw new Error('lol_patch_api_base_url_invalid');
  const url = new URL(`${normalizedBase}${PATCH_STATUS_PATH}`);
  url.searchParams.set('date', date);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`lol_patch_status_http_${response.status}`);
    return validateLolPatchStatus(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export function buildLolPatchNoticeSegments(status: LolPatchStatus): Array<Record<string, unknown>> {
  const patch = String(status.patch || '').trim();
  if (!patch) throw new Error('lol_patch_notice_patch_required');
  return [
    { type: 'at', data: { qq: 'all' } },
    {
      type: 'text',
      data: {
        text: `\n今日为 LOL 版本更新日，将更新至 ${patch} 版本。更新期间游戏及部分查询功能可能暂时异常，更新完成后恢复。`,
      },
    },
  ];
}

async function sendLolPatchNotice(groupId: string, status: LolPatchStatus): Promise<void> {
  await send({
    channel: 'group',
    targetId: groupId,
    scene: 'lol_patch_notice',
    segments: buildLolPatchNoticeSegments(status),
    force: true,
    applyTemplate: false,
    skipProbability: true,
    requireDelivery: true,
  });
}

function emptyResult(status: LolPatchReconcileResult['status']): LolPatchReconcileResult {
  return { status, attempted: 0, succeeded: 0, failed: 0, deduplicated: 0 };
}

export async function reconcileLolPatchNotifications(
  options: LolPatchReconcileOptions,
): Promise<LolPatchReconcileResult> {
  const log = options.log || (() => undefined);
  if (!options.enabled) return emptyResult('disabled');
  if (!isLolPatchNotifierRoleActive(options.currentRole, options.senderRole)) {
    return emptyResult('role_inactive');
  }
  const clock = getShanghaiClock(options.now);
  if (clock.minutes < parseNotificationMinutes(options.notificationTime)) {
    return emptyResult('before_time');
  }
  if (!String(options.baseUrl || '').trim()) {
    log('warn', 'lol_patch_notify skipped: lolApiBaseUrl is empty');
    return emptyResult('misconfigured');
  }

  let status: LolPatchStatus;
  try {
    const request = options.fetchStatus || fetchLolPatchStatus;
    status = await request(options.baseUrl, clock.date, options.timeoutMs);
    status = validateLolPatchStatus(status);
    if (status.date !== clock.date) throw new Error('lol_patch_status_date_mismatch');
  } catch (error) {
    log('warn', `lol_patch_notify provider_error: ${String((error as Error)?.message || error)}`);
    return emptyResult('provider_error');
  }

  if (!status.is_update_today) return emptyResult('not_patch_day');
  if (!status.event_id || !status.patch) {
    log('warn', 'lol_patch_notify provider_error: incomplete patch event');
    return emptyResult('provider_error');
  }

  const result: LolPatchReconcileResult = {
    status: 'completed',
    eventId: status.event_id,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    deduplicated: 0,
  };
  const deliver = options.sendNotice || sendLolPatchNotice;
  const uniqueGroups = [...new Set(options.groupIds.map((value) => String(value || '').trim()).filter(Boolean))];

  for (const groupId of uniqueGroups) {
    let delivered = false;
    try {
      delivered = options.hasDelivered(status.event_id, groupId);
    } catch (error) {
      log('error', `lol_patch_notify state_read_failed group=${groupId}: ${String((error as Error)?.message || error)}`);
      result.failed += 1;
      continue;
    }
    if (delivered) {
      result.deduplicated += 1;
      continue;
    }

    result.attempted += 1;
    try {
      await deliver(groupId, status);
      options.markDelivered(status.event_id, groupId, clock.isoNow);
      result.succeeded += 1;
      log('info', `lol_patch_notify delivered event=${status.event_id} group=${groupId}`);
    } catch (error) {
      result.failed += 1;
      log('warn', `lol_patch_notify delivery_failed event=${status.event_id} group=${groupId}: ${String((error as Error)?.message || error)}`);
    }
  }
  return result;
}

let startupTimer: NodeJS.Timeout | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileRunning = false;
let stateStore: LolPatchNotificationStateStore | null = null;

function runtimeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  loggingStateService[level](message);
}

export function resolveLolPatchNotificationGroupIds(configured: unknown, authorized: string[]): string[] {
  const allowed = new Set(authorized.map((value) => String(value || '').trim()).filter(Boolean));
  const selected = Array.isArray(configured) ? configured : [];
  return [...new Set(selected.map((value) => String(value || '').trim()).filter(Boolean))].filter((groupId) => allowed.has(groupId));
}

function configuredAuthorizedGroupIds(): string[] {
  const config = configStateService.getConfig();
  const licenses = config.licenses || {};
  const authorized = Object.keys(licenses).filter((groupId) => Boolean(authManager.getGroupLicense(groupId)));
  return resolveLolPatchNotificationGroupIds(config.lolPatchNotifyGroupIds, authorized);
}

async function runRuntimeReconcile(): Promise<void> {
  if (reconcileRunning || !stateStore) return;
  reconcileRunning = true;
  try {
    const config = configStateService.getConfig();
    const baseUrl = envText('LOL_PATCH_NOTIFY_API_BASE_URL', String(config.lolApiBaseUrl || ''));
    const senderRole = normalizeLolPatchSenderRole(envText('LOL_PATCH_NOTIFY_ROLE', 'query'));
    const result = await reconcileLolPatchNotifications({
      now: new Date(),
      enabled: envBoolean('LOL_PATCH_NOTIFY_ENABLED', true),
      currentRole: getGroupGuardBotRole(),
      senderRole,
      notificationTime: envText('LOL_PATCH_NOTIFY_TIME', DEFAULT_NOTIFICATION_TIME),
      baseUrl,
      timeoutMs: envPositiveNumber('LOL_PATCH_NOTIFY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 500),
      groupIds: configuredAuthorizedGroupIds(),
      hasDelivered: (eventId, groupId) => stateStore!.has(eventId, groupId),
      markDelivered: (eventId, groupId, sentAt) => stateStore!.mark(eventId, groupId, sentAt),
      log: runtimeLog,
    });
    if (result.status === 'completed' && (result.attempted || result.deduplicated)) {
      runtimeLog('info', `lol_patch_notify reconcile event=${result.eventId || ''} attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} deduplicated=${result.deduplicated}`);
    }
  } catch (error) {
    runtimeLog('error', `lol_patch_notify reconcile_failed: ${String((error as Error)?.message || error)}`);
  } finally {
    reconcileRunning = false;
  }
}

export function startLolPatchNotifier(ctx: GroupGuardRuntimeContext): void {
  stopLolPatchNotifier();
  try {
    stateStore = new LolPatchNotificationStateStore(ctx.dataDir);
  } catch (error) {
    stateStore = null;
    runtimeLog('error', `lol_patch_notify disabled because state cannot be loaded: ${String((error as Error)?.message || error)}`);
    return;
  }
  const intervalMs = envPositiveNumber('LOL_PATCH_NOTIFY_INTERVAL_MS', DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runRuntimeReconcile();
  }, 2_000);
  reconcileTimer = setInterval(() => void runRuntimeReconcile(), intervalMs);
  runtimeLog('info', `lol_patch_notify scheduler started intervalMs=${intervalMs} defaultSenderRole=query time=${envText('LOL_PATCH_NOTIFY_TIME', DEFAULT_NOTIFICATION_TIME)}`);
}

export function stopLolPatchNotifier(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  reconcileRunning = false;
  stateStore = null;
}
