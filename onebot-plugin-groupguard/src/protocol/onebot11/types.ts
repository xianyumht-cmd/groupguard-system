export type OneBotId = string | number;
export type OneBotGroupRole = 'member' | 'admin' | 'owner';

export interface OneBotMessageSegment {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OneBotSender {
  user_id?: OneBotId;
  nickname?: string;
  card?: string;
  role?: OneBotGroupRole;
  [key: string]: unknown;
}

export interface OneBotEventEnvelope {
  time?: number;
  self_id?: OneBotId;
  post_type?: string;
  raw?: unknown;
  [key: string]: unknown;
}

export interface OneBotMessageEvent extends OneBotEventEnvelope {
  post_type: 'message' | 'message_sent';
  message_type?: 'group' | 'private' | string;
  sub_type?: string;
  message_id?: OneBotId;
  user_id?: OneBotId;
  group_id?: OneBotId;
  message?: OneBotMessageSegment[] | string;
  raw_message?: string;
  sender?: OneBotSender;
}

export interface OneBotNoticeEvent extends OneBotEventEnvelope {
  post_type: 'notice';
  notice_type?: string;
  sub_type?: string;
  group_id?: OneBotId;
  user_id?: OneBotId;
  operator_id?: OneBotId;
  message_id?: OneBotId;
}

export interface OneBotRequestEvent extends OneBotEventEnvelope {
  post_type: 'request';
  request_type?: string;
  sub_type?: string;
  group_id?: OneBotId;
  user_id?: OneBotId;
  flag?: string;
  comment?: string;
}

export interface OneBotMetaEvent extends OneBotEventEnvelope {
  post_type: 'meta_event';
  meta_event_type?: string;
  sub_type?: string;
}

export type OneBotEvent =
  | OneBotMessageEvent
  | OneBotNoticeEvent
  | OneBotRequestEvent
  | OneBotMetaEvent
  | OneBotEventEnvelope;

const GROUP_NOTICE_TYPES_REQUIRING_USER = new Set([
  'group_increase',
  'group_decrease',
  'group_recall',
  'group_card',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOneBotId(value: unknown): OneBotId | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

export function oneBotIdToString(value: unknown): string {
  const normalized = normalizeOneBotId(value);
  return normalized === undefined ? '' : String(normalized);
}

function copyNormalizedId(target: Record<string, unknown>, source: Record<string, unknown>, key: string): OneBotId | undefined {
  const normalized = normalizeOneBotId(source[key]);
  if (normalized === undefined) delete target[key];
  else target[key] = normalized;
  return normalized;
}

function copyOptionalString(target: Record<string, unknown>, source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') {
    delete target[key];
    return undefined;
  }
  target[key] = value;
  return value;
}

function normalizeSender(value: unknown): OneBotSender | undefined {
  if (!isRecord(value)) return undefined;
  const sender: Record<string, unknown> = { ...value };
  copyNormalizedId(sender, value, 'user_id');
  copyOptionalString(sender, value, 'nickname');
  copyOptionalString(sender, value, 'card');
  const role = value.role;
  if (role === 'member' || role === 'admin' || role === 'owner') sender.role = role;
  else delete sender.role;
  return sender as OneBotSender;
}

export function isOneBotMessageEvent(event: OneBotEvent): event is OneBotMessageEvent {
  if (event?.post_type !== 'message' && event?.post_type !== 'message_sent') return false;
  if (event.message_type !== 'group' && event.message_type !== 'private') return false;
  if (normalizeOneBotId(event.user_id) === undefined) return false;
  if (event.message_type === 'group' && normalizeOneBotId(event.group_id) === undefined) return false;
  return true;
}

export function normalizeOneBotEvent(value: unknown): OneBotEvent | null {
  if (!isRecord(value)) return null;
  const postType = typeof value.post_type === 'string' ? value.post_type.trim() : '';
  if (!postType) return null;

  const normalized: Record<string, unknown> = { ...value, post_type: postType, raw: value };
  copyNormalizedId(normalized, value, 'self_id');
  const userId = copyNormalizedId(normalized, value, 'user_id');
  const groupId = copyNormalizedId(normalized, value, 'group_id');
  const operatorId = copyNormalizedId(normalized, value, 'operator_id');
  const messageId = copyNormalizedId(normalized, value, 'message_id');
  copyOptionalString(normalized, value, 'sub_type');

  if (postType === 'message' || postType === 'message_sent') {
    const messageType = copyOptionalString(normalized, value, 'message_type');
    if (messageType !== 'group' && messageType !== 'private') return null;
    if (userId === undefined) return null;
    if (messageType === 'group' && groupId === undefined) return null;

    if (typeof value.raw_message === 'string') normalized.raw_message = value.raw_message;
    else delete normalized.raw_message;
    if (typeof value.message === 'string' || Array.isArray(value.message)) normalized.message = value.message;
    else delete normalized.message;
    const sender = normalizeSender(value.sender);
    if (sender) normalized.sender = sender;
    else delete normalized.sender;
    return normalized as unknown as OneBotMessageEvent;
  }

  if (postType === 'notice') {
    const noticeType = copyOptionalString(normalized, value, 'notice_type');
    if (!noticeType) return null;
    if (noticeType.startsWith('group_') && groupId === undefined) return null;
    if (GROUP_NOTICE_TYPES_REQUIRING_USER.has(noticeType) && userId === undefined) return null;
    if (noticeType === 'group_recall' && messageId === undefined) return null;
    if (noticeType === 'group_upload' && userId === undefined && operatorId === undefined) return null;
    return normalized as unknown as OneBotNoticeEvent;
  }

  if (postType === 'request') {
    const requestType = copyOptionalString(normalized, value, 'request_type');
    if (!requestType) return null;
    copyOptionalString(normalized, value, 'flag');
    copyOptionalString(normalized, value, 'comment');
    if (requestType === 'group' && (groupId === undefined || userId === undefined)) return null;
    if (requestType === 'friend' && userId === undefined) return null;
    return normalized as unknown as OneBotRequestEvent;
  }

  if (postType === 'meta_event') {
    copyOptionalString(normalized, value, 'meta_event_type');
    return normalized as unknown as OneBotMetaEvent;
  }

  return normalized as OneBotEventEnvelope;
}
