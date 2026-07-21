import { normalizePluginConfig } from '../../config';
import { send } from '../../dynamic-commands/response_capture_runtime';
import type { LanzouUpdatePushSettings, LanzouUpdatePushTarget } from '../../types';
import { getRawConfig } from './config_api';
import type { SnowLumaAdminServerOptions } from './types';

type DeliveryTarget = Required<Pick<LanzouUpdatePushTarget, 'type' | 'enabled'>> & {
  groupId?: string;
  userId?: string;
};

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
  const template = String(settings.messageTemplate || '{message}').trim() || '{message}';
  const base = renderTemplate(template, event).trim() || String(event.message || '').trim();
  const summary = settings.includeDiffSummary === false ? '' : summarizeDiff(event);
  if (!summary || base.includes(summary)) return base;
  return `${base}\n${summary}`;
}

async function sendTarget(target: DeliveryTarget, message: string): Promise<Record<string, any>> {
  const targetId = target.type === 'private' ? target.userId : target.groupId;
  await send({
    channel: target.type,
    targetId: String(targetId || ''),
    scene: 'lanzou_update_push',
    message,
    force: false,
    applyTemplate: false
  });
  return target.type === 'private'
    ? { ok: true, type: 'private', userId: target.userId }
    : { ok: true, type: 'group', groupId: target.groupId };
}

export async function handleLanzouUpdateEvent(options: SnowLumaAdminServerOptions, payload: any): Promise<Record<string, any>> {
  const event = asObject(payload);
  const type = String(event.type || '');
  if (!type.startsWith('lanzou_update')) {
    return { ok: false, error: 'invalid_lanzou_event_type' };
  }

  const config = normalizePluginConfig(getRawConfig(options) as any);
  const settings = config.lanzouUpdatePush || {};
  if (!settings.enabled) {
    return { ok: false, error: 'lanzou_update_push_disabled' };
  }

  const targets = normalizeTargets(settings);
  if (!targets.length) {
    return { ok: false, error: 'lanzou_update_push_no_targets' };
  }

  const message = buildMessage(settings, event);
  if (!message) {
    return { ok: false, error: 'lanzou_update_push_empty_message' };
  }

  const deliveries: Record<string, any>[] = [];
  for (const target of targets) {
    try {
      deliveries.push(await sendTarget(target, message));
    } catch (error) {
      deliveries.push({
        ok: false,
        type: target.type,
        groupId: target.groupId,
        userId: target.userId,
        error: String((error as Error)?.message || error)
      });
    }
  }

  return {
    ok: deliveries.some((item) => item.ok),
    message,
    deliveries
  };
}
