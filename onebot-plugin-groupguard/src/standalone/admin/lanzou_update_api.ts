import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LANZOU_MESSAGE_TEMPLATE, normalizePluginConfig } from '../../config';
import { send } from '../../dynamic-commands/response_capture_runtime';
import type { LanzouUpdatePushSettings, LanzouUpdatePushTarget } from '../../types';
import { getRawConfig } from './config_api';
import type { SnowLumaAdminServerOptions } from './types';

type DeliveryTarget = Required<Pick<LanzouUpdatePushTarget, 'type' | 'enabled'>> & {
  groupId?: string;
  userId?: string;
};

type DeliveryStore = {
  version: 1;
  events: Record<string, {
    eventId: string;
    createdAt: number;
    updatedAt: number;
    payloadHash?: string;
    targets: Record<string, Record<string, any>>;
  }>;
};

export type LanzouDeliveryStoreStatus = {
  ok: boolean;
  status: 'healthy' | 'empty' | 'degraded';
  error?: string;
  eventCount?: number;
  quarantineFile?: string;
  quarantineCount?: number;
  requiresOperatorAction?: boolean;
};

class DeliveryStoreStateError extends Error {
  readonly code: string;
  readonly quarantineFile: string;

  constructor(code: string, quarantineFile = '') {
    super(code);
    this.name = 'DeliveryStoreStateError';
    this.code = code;
    this.quarantineFile = quarantineFile;
  }
}

const eventLocks = new Map<string, Promise<Record<string, any>>>();
const deliveryStoreLocks = new Map<string, Promise<void>>();
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DELIVERY_MAX_EVENTS = 500;

function asObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function countDiffItems(event: Record<string, any>, key: 'added' | 'removed' | 'changed'): number {
  const items = event.diff && Array.isArray(event.diff[key]) ? event.diff[key] : [];
  return items.length;
}

function fileNameFromDiffItem(item: any): string {
  const source = item && typeof item === 'object' && item.after && typeof item.after === 'object'
    ? item.after
    : item;
  return String(source?.name || source?.id || '').trim();
}

function summarizeDiff(event: Record<string, any>): string {
  const diff = asObject(event.diff);
  const parts: string[] = [];
  const added = Array.isArray(diff.added) ? diff.added : [];
  const removed = Array.isArray(diff.removed) ? diff.removed : [];
  const changed = Array.isArray(diff.changed) ? diff.changed : [];
  if (added.length) parts.push(`新增 ${added.length}`);
  if (removed.length) parts.push(`删除 ${removed.length}`);
  if (changed.length) parts.push(`变化 ${changed.length}`);
  const names = [...added, ...removed, ...changed]
    .map(fileNameFromDiffItem)
    .filter(Boolean)
    .slice(0, 5);
  if (!parts.length) return '';
  return names.length ? `${parts.join('，')}：${names.join('、')}` : parts.join('，');
}

function renderTemplate(template: string, event: Record<string, any>): string {
  const values: Record<string, string> = {
    message: String(event.message || ''),
    title: String(event.title || event.name || ''),
    name: String(event.name || event.title || ''),
    watcher_id: String(event.watcher_id || ''),
    url: String(event.url || ''),
    type: String(event.type || ''),
    added_count: String(countDiffItems(event, 'added')),
    removed_count: String(countDiffItems(event, 'removed')),
    changed_count: String(countDiffItems(event, 'changed')),
    diff_summary: summarizeDiff(event)
  };
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => values[key] ?? '');
}

function normalizeTargets(settings: LanzouUpdatePushSettings): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];
  for (const groupId of settings.groupIds || []) {
    targets.push({ type: 'group', groupId: String(groupId), enabled: true });
  }
  for (const userId of settings.privateUserIds || []) {
    targets.push({ type: 'private', userId: String(userId), enabled: true });
  }
  for (const target of settings.targets || []) {
    if (!target || target.enabled === false) continue;
    if (target.type === 'private' && target.userId) {
      targets.push({ type: 'private', userId: String(target.userId), enabled: true });
    } else if (target.groupId) {
      targets.push({ type: 'group', groupId: String(target.groupId), enabled: true });
    }
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.type === 'private'
      ? `private:${target.userId || ''}`
      : `group:${target.groupId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return target.type === 'private' ? Boolean(target.userId) : Boolean(target.groupId);
  });
}

function buildMessage(settings: LanzouUpdatePushSettings, event: Record<string, any>): string {
  const template = String(settings.messageTemplate || DEFAULT_LANZOU_MESSAGE_TEMPLATE).trim() || DEFAULT_LANZOU_MESSAGE_TEMPLATE;
  const base = renderTemplate(template, event).trim() || String(event.message || '').trim();
  const summary = settings.includeDiffSummary === false ? '' : summarizeDiff(event);
  if (!summary || base.includes(summary)) return base;
  return `${base}\n${summary}`;
}

function hasInvalidMessageTemplate(template: string): boolean {
  if (template.includes('\uFFFD') || /\?{3,}/.test(template)) return true;
  if (/(锛|銆|鈥|娴嬪|缃戠|鏇存柊)/.test(template)) return true;
  const allowed = new Set([
    'message', 'title', 'name', 'watcher_id', 'url', 'type',
    'added_count', 'removed_count', 'changed_count', 'diff_summary'
  ]);
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].some((match) => !allowed.has(match[1]));
}

function eventPayloadHash(event: Record<string, any>): string {
  const semanticPayload = {
    type: event.type || '',
    watcher_id: event.watcher_id || '',
    previous_signature: event.previous_signature || '',
    current_signature: event.current_signature || '',
    title: event.title || event.name || '',
    url: event.url || '',
    message: event.message || '',
    diff: event.diff || {}
  };
  return crypto.createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
}

function deliveryTargetKey(target: DeliveryTarget): string {
  return target.type === 'private'
    ? `private:${target.userId || ''}`
    : `group:${target.groupId || ''}`;
}

function deliveryStorePath(options: SnowLumaAdminServerOptions): string {
  return path.join(options.dataDir, 'lanzou-update-deliveries.json');
}

function deliveryStoreLockKey(options: SnowLumaAdminServerOptions): string {
  const resolvedPath = path.resolve(deliveryStorePath(options));
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function deliveryStoreQuarantineFiles(file: string): string[] {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.corrupt-`;
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function isDeliveryStore(value: any): value is DeliveryStore {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.version === 1
    && value.events
    && typeof value.events === 'object'
    && !Array.isArray(value.events)
  );
}

function nextDeliveryStoreQuarantinePath(file: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const base = `${file}.corrupt-${timestamp}`;
  let candidate = base;
  let suffix = 0;
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function quarantineDeliveryStore(file: string): string {
  const quarantinePath = nextDeliveryStoreQuarantinePath(file);
  try {
    fs.renameSync(file, quarantinePath);
    return path.basename(quarantinePath);
  } catch {
    throw new DeliveryStoreStateError('lanzou_delivery_store_quarantine_failed');
  }
}

export function getLanzouDeliveryStoreStatus(options: SnowLumaAdminServerOptions): LanzouDeliveryStoreStatus {
  const file = deliveryStorePath(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isDeliveryStore(parsed)) {
      return {
        ok: false,
        status: 'degraded',
        error: 'lanzou_delivery_store_corrupt',
        requiresOperatorAction: true
      };
    }
    return {
      ok: true,
      status: 'healthy',
      eventCount: Object.keys(parsed.events).length
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      return {
        ok: false,
        status: 'degraded',
        error: error instanceof SyntaxError
          ? 'lanzou_delivery_store_corrupt'
          : 'lanzou_delivery_store_unreadable',
        requiresOperatorAction: true
      };
    }
  }

  const quarantines = deliveryStoreQuarantineFiles(file);
  if (quarantines.length) {
    return {
      ok: false,
      status: 'degraded',
      error: 'lanzou_delivery_store_quarantined',
      quarantineFile: quarantines[0],
      quarantineCount: quarantines.length,
      requiresOperatorAction: true
    };
  }
  return { ok: true, status: 'empty', eventCount: 0 };
}

async function withDeliveryStoreLock<T>(
  options: SnowLumaAdminServerOptions,
  operation: () => Promise<T>
): Promise<T> {
  const key = deliveryStoreLockKey(options);
  const predecessor = deliveryStoreLocks.get(key) || Promise.resolve();
  const ready = predecessor.catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = ready.then(() => gate);
  deliveryStoreLocks.set(key, tail);
  await ready;
  try {
    return await operation();
  } finally {
    release();
    if (deliveryStoreLocks.get(key) === tail) deliveryStoreLocks.delete(key);
  }
}

function loadDeliveryStore(options: SnowLumaAdminServerOptions): DeliveryStore {
  const file = deliveryStorePath(options);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw new DeliveryStoreStateError('lanzou_delivery_store_unreadable');
    }
    const quarantines = deliveryStoreQuarantineFiles(file);
    if (quarantines.length) {
      throw new DeliveryStoreStateError('lanzou_delivery_store_quarantined', quarantines[0]);
    }
    return { version: 1, events: {} };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const quarantineFile = quarantineDeliveryStore(file);
    throw new DeliveryStoreStateError('lanzou_delivery_store_corrupt', quarantineFile);
  }
  if (!isDeliveryStore(parsed)) {
    const quarantineFile = quarantineDeliveryStore(file);
    throw new DeliveryStoreStateError('lanzou_delivery_store_corrupt', quarantineFile);
  }
  return parsed;
}

function saveDeliveryStore(options: SnowLumaAdminServerOptions, store: DeliveryStore): void {
  const now = Date.now();
  const retained = Object.values(store.events)
    .filter((item) => item && now - Number(item.updatedAt || 0) <= DELIVERY_RETENTION_MS)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, DELIVERY_MAX_EVENTS);
  store.events = Object.fromEntries(retained.map((item) => [item.eventId, item]));

  const file = deliveryStorePath(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    fs.renameSync(tempFile, file);
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function resolveEventId(event: Record<string, any>): string {
  const supplied = String(event.event_id || event.id || '').trim();
  if (supplied) return supplied.slice(0, 160);
  const fingerprint = [
    event.type,
    event.watcher_id,
    event.previous_signature,
    event.current_signature,
    event.created_at
  ].map((value) => String(value || '')).join('\n');
  return `legacy-${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}

function classifyDeliveryError(error: unknown): { error: string; errorCode: string; errorClass: string } {
  const raw = String((error as Error)?.message || error || '').toLowerCase();
  let errorCode = 'delivery_failed';
  if (/send_rate_limited|queue_(?:overflow|force_evicted)/.test(raw)) {
    errorCode = 'delivery_queue_rejected';
  } else if (/transport_unavailable|ws_not_connected|ws_closed|client_closed/.test(raw)) {
    errorCode = 'delivery_transport_unavailable';
  } else if (/action_timeout|request_timeout|timed?\s*out|请求超时/.test(raw)) {
    errorCode = 'delivery_timeout';
  } else if (/onebot_action_failed/.test(raw)) {
    errorCode = 'delivery_rejected';
  }
  const candidateClass = error instanceof Error ? error.name : '';
  const errorClass = ['Error', 'TypeError', 'RangeError', 'AbortError'].includes(candidateClass)
    ? candidateClass
    : 'Error';
  return { error: errorCode, errorCode, errorClass };
}

async function sendTarget(target: DeliveryTarget, message: string): Promise<Record<string, any>> {
  const targetId = target.type === 'private' ? target.userId : target.groupId;
  await send({
    channel: target.type,
    targetId: String(targetId || ''),
    scene: 'lanzou_update_push',
    message,
    force: true,
    applyTemplate: false,
    requireDelivery: true
  });
  return target.type === 'private'
    ? { ok: true, type: 'private', userId: target.userId }
    : { ok: true, type: 'group', groupId: target.groupId };
}

async function deliverLanzouUpdateEvent(
  options: SnowLumaAdminServerOptions,
  event: Record<string, any>,
  eventId: string
): Promise<Record<string, any>> {
  const config = normalizePluginConfig(getRawConfig(options) as any);
  const settings = config.lanzouUpdatePush || {};
  if (!settings.enabled) {
    return { ok: false, eventId, deliveryState: 'skipped', retryable: false, error: 'lanzou_update_push_disabled' };
  }
  const messageTemplate = String(settings.messageTemplate || DEFAULT_LANZOU_MESSAGE_TEMPLATE);
  if (hasInvalidMessageTemplate(messageTemplate)) {
    return {
      ok: false,
      eventId,
      deliveryState: 'skipped',
      retryable: false,
      error: 'lanzou_update_push_invalid_message_template'
    };
  }

  const targets = normalizeTargets(settings);
  if (!targets.length) {
    return { ok: false, eventId, deliveryState: 'skipped', retryable: false, error: 'lanzou_update_push_no_targets' };
  }

  const message = buildMessage(settings, event);
  if (!message) {
    return { ok: false, eventId, deliveryState: 'skipped', retryable: false, error: 'lanzou_update_push_empty_message' };
  }

  const store = loadDeliveryStore(options);
  const payloadHash = eventPayloadHash(event);
  const existingRecord = store.events[eventId];
  if (existingRecord?.payloadHash && existingRecord.payloadHash !== payloadHash) {
    return {
      ok: false,
      eventId,
      deliveryState: 'skipped',
      retryable: false,
      error: 'lanzou_update_event_id_conflict'
    };
  }
  const eventRecord = existingRecord || {
    eventId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payloadHash,
    targets: {}
  };
  eventRecord.payloadHash = payloadHash;
  store.events[eventId] = eventRecord;

  const deliveries: Record<string, any>[] = [];
  for (const target of targets) {
    const key = deliveryTargetKey(target);
    const previous = eventRecord.targets[key];
    if (previous?.ok === true) {
      deliveries.push({ ...previous, deduplicated: true });
      continue;
    }
    try {
      const result = { ...(await sendTarget(target, message)), targetKey: key, deduplicated: false };
      deliveries.push(result);
      eventRecord.targets[key] = { ...result, updatedAt: Date.now() };
    } catch (error) {
      const result = {
        ok: false,
        type: target.type,
        groupId: target.groupId,
        userId: target.userId,
        targetKey: key,
        deduplicated: false,
        ...classifyDeliveryError(error)
      };
      deliveries.push(result);
      eventRecord.targets[key] = { ...result, updatedAt: Date.now() };
    }
    eventRecord.updatedAt = Date.now();
    saveDeliveryStore(options, store);
  }

  eventRecord.updatedAt = Date.now();
  saveDeliveryStore(options, store);
  const successful = deliveries.filter((item) => item.ok === true).length;
  const deliveryState = successful === deliveries.length
    ? 'complete'
    : successful > 0
      ? 'partial'
      : 'failed';
  return {
    ok: deliveryState === 'complete',
    eventId,
    deliveryState,
    retryable: deliveryState !== 'complete',
    message,
    deduplicatedCount: deliveries.filter((item) => item.deduplicated === true).length,
    deliveries
  };
}

export async function handleLanzouUpdateEvent(options: SnowLumaAdminServerOptions, payload: any): Promise<Record<string, any>> {
  const event = asObject(payload);
  const type = String(event.type || '');
  if (!type.startsWith('lanzou_update')) {
    return { ok: false, error: 'invalid_lanzou_event_type' };
  }
  const eventId = resolveEventId(event);
  const eventLockKey = `${deliveryStoreLockKey(options)}\u0000${eventId}`;
  const existing = eventLocks.get(eventLockKey);
  if (existing) return await existing;
  const task = withDeliveryStoreLock(
    options,
    () => deliverLanzouUpdateEvent(options, event, eventId)
  ).catch((error) => {
    if (!(error instanceof DeliveryStoreStateError)) throw error;
    return {
      ok: false,
      eventId,
      deliveryState: 'failed',
      retryable: false,
      degraded: true,
      requiresOperatorAction: true,
      error: error.code,
      store: {
        status: 'degraded',
        error: error.code,
        quarantineFile: error.quarantineFile || undefined
      }
    };
  });
  eventLocks.set(eventLockKey, task);
  try {
    return await task;
  } finally {
    if (eventLocks.get(eventLockKey) === task) eventLocks.delete(eventLockKey);
  }
}
