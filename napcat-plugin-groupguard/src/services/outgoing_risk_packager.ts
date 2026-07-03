import type { GroupGuardSettings, OutgoingRiskPackagingSettings } from '../types';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`，。！？、；：）)\]}]+/gi;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSegment(segment: any): any {
  if (!isRecord(segment)) return segment;
  const data = isRecord(segment.data) ? { ...segment.data } : segment.data;
  return { ...segment, data };
}

function normalizeScene(scene: string): string {
  return String(scene || 'raw_text').trim().toLowerCase();
}

function shouldApplyToScene(policy: OutgoingRiskPackagingSettings, scene: string): boolean {
  const allow = Array.isArray(policy.highRiskScenes) ? policy.highRiskScenes.map(normalizeScene).filter(Boolean) : [];
  if (!allow.length) return true;
  const key = normalizeScene(scene);
  return allow.some(item => key === item || key.startsWith(`${item}_`) || item === '*');
}

function buildNotice(policy: OutgoingRiskPackagingSettings, count: number): string {
  const notice = String(policy.urlNotice || '').trim();
  if (!notice) return '';
  return `${notice}（${count} 个）`;
}

export function countUrlsInText(text: string): number {
  return (String(text || '').match(URL_PATTERN) || []).length;
}

export function packageOutgoingText(text: string, policy: OutgoingRiskPackagingSettings): { text: string; urlCount: number; changed: boolean } {
  const source = String(text || '');
  if (!source || policy.urlMode === 'off') return { text: source, urlCount: 0, changed: false };
  let count = 0;
  const max = Math.max(1, Math.floor(Number(policy.urlMaxPerMessage || 20)));
  const replaced = source.replace(URL_PATTERN, () => {
    count += 1;
    if (policy.urlMode === 'drop') return '';
    if (policy.urlMode === 'mask') return '[链接已隐藏]';
    return `[链接#${Math.min(count, max)}]`;
  });
  if (!count) return { text: source, urlCount: 0, changed: false };
  if (policy.urlMode === 'drop') {
    return { text: buildNotice(policy, count) || '链接内容已拦截，机器人不直接发送。', urlCount: count, changed: true };
  }
  const notice = buildNotice(policy, count);
  const next = notice && !replaced.includes(notice) ? `${replaced}\n${notice}` : replaced;
  return { text: next, urlCount: count, changed: next !== source };
}

export function packageOutgoingSegments(
  message: any[],
  settings: GroupGuardSettings,
  scene: string,
  channel: 'group' | 'private' | 'forward' = 'group'
): { message: any[]; urlCount: number; changed: boolean } {
  const policy = settings.outgoingRisk;
  const list = Array.isArray(message) ? message.map(cloneSegment) : [];
  if (!policy?.enabled || policy.logOnly || policy.urlMode === 'off') {
    return { message: list, urlCount: 0, changed: false };
  }
  if (channel === 'private' && policy.applyToPrivate === false) return { message: list, urlCount: 0, changed: false };
  if (channel === 'forward' && policy.applyToForward === false) return { message: list, urlCount: 0, changed: false };
  if (!shouldApplyToScene(policy, scene)) return { message: list, urlCount: 0, changed: false };

  let total = 0;
  let changed = false;
  for (const segment of list) {
    if (!isRecord(segment) || segment.type !== 'text' || !isRecord(segment.data)) continue;
    const packed = packageOutgoingText(String(segment.data.text || ''), policy);
    if (packed.urlCount > 0) {
      total += packed.urlCount;
      changed = changed || packed.changed;
      segment.data.text = packed.text;
    }
  }
  return { message: list, urlCount: total, changed };
}

export function packageForwardMessages(messages: any[], settings: GroupGuardSettings, scene = 'raw_text'): { messages: any[]; urlCount: number; changed: boolean } {
  const list = Array.isArray(messages) ? messages.map((node) => isRecord(node) ? { ...node, data: isRecord(node.data) ? { ...node.data } : node.data } : node) : [];
  let total = 0;
  let changed = false;
  for (const node of list) {
    const data = isRecord(node?.data) ? node.data : null;
    const content = data?.content;
    if (Array.isArray(content)) {
      const packed = packageOutgoingSegments(content, settings, scene, 'forward');
      data.content = packed.message;
      total += packed.urlCount;
      changed = changed || packed.changed;
    } else if (typeof content === 'string') {
      const policy = settings.outgoingRisk;
      if (policy?.enabled && !policy.logOnly && policy.applyToForward !== false && shouldApplyToScene(policy, scene)) {
        const packedText = packageOutgoingText(content, policy);
        data.content = packedText.text;
        total += packedText.urlCount;
        changed = changed || packedText.changed;
      }
    }
  }
  return { messages: list, urlCount: total, changed };
}
