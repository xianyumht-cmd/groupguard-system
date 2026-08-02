export type OneBotId = string | number;

export interface OneBotMessageSegment {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OneBotSender {
  user_id?: OneBotId;
  nickname?: string;
  card?: string;
  role?: string;
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

export function isOneBotMessageEvent(event: OneBotEvent): event is OneBotMessageEvent {
  return event?.post_type === 'message' || event?.post_type === 'message_sent';
}

export function normalizeOneBotEvent(value: unknown): OneBotEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const normalized: OneBotEventEnvelope = { ...raw, raw: value };
  if (raw.post_type !== undefined) normalized.post_type = String(raw.post_type);
  return normalized as OneBotEvent;
}
