import { QUN_GUANJIA_UIN, qunGuanjiaService } from './qun_guanjia_service';

const CAPTURE_TTL_MS = 90_000;

type CapturedRealtimeEvent = {
  event: any;
  capturedAt: number;
  expiresAt: number;
  senderId: string;
  tokenLength: number;
};

const capturedByGroup = new Map<string, CapturedRealtimeEvent>();
let installed = false;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getGroupId(event: any): string {
  const value = event?.group_id
    ?? event?.groupId
    ?? event?.group?.group_id
    ?? event?.group?.groupId
    ?? event?.target_id
    ?? event?.targetId;
  return value === undefined || value === null ? '' : String(value).trim();
}

function getSenderId(event: any): string {
  const value = event?.user_id
    ?? event?.userId
    ?? event?.sender?.user_id
    ?? event?.sender?.userId
    ?? event?.sender?.uin
    ?? event?.sender_uin;
  return value === undefined || value === null ? '' : String(value).trim();
}

function decodeCqEscapes(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/gi, '&');
}

function parseJsonCandidates(value: string): unknown[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const variants = new Set<string>([raw, decodeCqEscapes(raw)]);
  for (const candidate of Array.from(variants)) {
    if (/%(?:7b|7d|5b|5d|22|3a|2c)/i.test(candidate)) {
      try {
        variants.add(decodeURIComponent(candidate));
      } catch {
        // Not a valid URI-encoded string.
      }
    }
  }

  const parsed: unknown[] = [];
  for (const candidate of variants) {
    const attempts = new Set<string>([candidate.trim()]);
    const firstObject = candidate.indexOf('{');
    const lastObject = candidate.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      attempts.add(candidate.slice(firstObject, lastObject + 1));
    }
    const firstArray = candidate.indexOf('[');
    const lastArray = candidate.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
      attempts.add(candidate.slice(firstArray, lastArray + 1));
    }

    for (const attempt of attempts) {
      try {
        parsed.push(JSON.parse(attempt));
      } catch {
        // Keep trying other representations.
      }
    }
  }
  return parsed;
}

function extractAutoreplyToken(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  insideAutoreply = false
): string {
  if (depth > 14 || value === null || value === undefined) return '';

  if (typeof value === 'string') {
    for (const parsed of parseJsonCandidates(value)) {
      const token = extractAutoreplyToken(parsed, depth + 1, seen, insideAutoreply);
      if (token) return token;
    }
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = extractAutoreplyToken(item, depth + 1, seen, insideAutoreply);
      if (token) return token;
    }
    return '';
  }

  if (!isRecord(value)) return '';
  if (seen.has(value)) return '';
  seen.add(value);

  const app = String(value.app ?? value.application ?? value.app_id ?? '').trim();
  const isAutoreply = insideAutoreply || app === 'com.tencent.autoreply';

  if (isAutoreply) {
    const candidates = [
      value.token,
      value.meta?.metadata?.token,
      value.meta?.detail?.token,
      value.meta?.autoreply?.token,
      value.metadata?.token,
      value.data?.token
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }

  for (const item of Object.values(value)) {
    const token = extractAutoreplyToken(item, depth + 1, seen, isAutoreply);
    if (token) return token;
  }
  return '';
}

function pruneExpired(now = Date.now()): void {
  for (const [groupId, captured] of capturedByGroup.entries()) {
    if (captured.expiresAt <= now) capturedByGroup.delete(groupId);
  }
}

function normalizeForExistingParser(event: any, groupId: string): any {
  const sender = isRecord(event?.sender) ? { ...event.sender } : {};
  sender.user_id = QUN_GUANJIA_UIN;
  sender.userId = QUN_GUANJIA_UIN;
  sender.uin = QUN_GUANJIA_UIN;
  return {
    ...event,
    group_id: event?.group_id ?? Number(groupId),
    user_id: QUN_GUANJIA_UIN,
    sender
  };
}

/**
 * Observe the untouched OneBot message event before normal plugin dispatch.
 * Returns true only when a com.tencent.autoreply token was found.
 */
export function observeQunGuanjiaRealtimeMessage(event: any): boolean {
  try {
    const groupId = getGroupId(event);
    if (!/^\d+$/.test(groupId)) return false;

    const token = extractAutoreplyToken(event);
    if (!token) return false;

    pruneExpired();
    const senderId = getSenderId(event);
    capturedByGroup.set(groupId, {
      event: normalizeForExistingParser(event, groupId),
      capturedAt: Date.now(),
      expiresAt: Date.now() + CAPTURE_TTL_MS,
      senderId,
      tokenLength: token.length
    });

    const senderNote = senderId && senderId !== String(QUN_GUANJIA_UIN)
      ? ` sender=${senderId} expected=${QUN_GUANJIA_UIN}`
      : '';
    console.info(`[GroupGuard:SnowLuma] [QunGuanjia] realtime token metadata captured group=${groupId} length=${token.length}${senderNote}`);
    return true;
  } catch (error) {
    console.warn(`[GroupGuard:SnowLuma] [QunGuanjia] realtime token observer failed: ${String(error)}`);
    return false;
  }
}

/**
 * Keep the existing history parser and cache writer intact. We only intercept
 * getHistory: a raw realtime event wins; otherwise the original history action
 * remains the compatibility fallback.
 */
export function installQunGuanjiaRealtimeCapture(): void {
  if (installed) return;

  const service = qunGuanjiaService as any;
  const originalGetHistory = service.getHistory;
  if (typeof originalGetHistory !== 'function') {
    console.warn('[GroupGuard:SnowLuma] [QunGuanjia] realtime capture not installed: getHistory unavailable');
    return;
  }

  service.getHistory = async function getHistoryWithRealtimePriority(groupId: string): Promise<any[]> {
    const gid = String(groupId || '').trim();
    pruneExpired();
    const captured = capturedByGroup.get(gid);
    if (captured && captured.expiresAt > Date.now()) {
      capturedByGroup.delete(gid);
      console.info(`[GroupGuard:SnowLuma] [QunGuanjia] using realtime token metadata group=${gid} ageMs=${Date.now() - captured.capturedAt}`);
      return [captured.event];
    }
    return originalGetHistory.call(service, groupId);
  };

  installed = true;
  console.info('[GroupGuard:SnowLuma] [QunGuanjia] realtime token capture installed; history remains fallback');
}
