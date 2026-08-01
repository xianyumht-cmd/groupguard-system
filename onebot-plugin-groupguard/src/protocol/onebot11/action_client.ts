export interface OneBotActionClient {
  call(action: string, params?: unknown): Promise<unknown>;
}

export type OneBotRawActionCall = (action: string, params?: unknown) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeCoreOneBotParams(action: string, params: unknown): Record<string, unknown> {
  const out = isRecord(params) ? { ...params } : {};
  if (out.groupId !== undefined && out.group_id === undefined) out.group_id = out.groupId;
  if (out.userId !== undefined && out.user_id === undefined) out.user_id = out.userId;
  if (out.messageId !== undefined && out.message_id === undefined) out.message_id = out.messageId;

  if (action === 'delete_msg' && out.message_id !== undefined) {
    out.message_id = String(out.message_id);
  }

  if (out.group_id !== undefined) {
    const numeric = Number(out.group_id);
    out.group_id = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : String(out.group_id);
  }

  if (out.user_id !== undefined && ['set_group_ban', 'set_group_kick', 'get_group_member_info'].includes(action)) {
    const numeric = Number(out.user_id);
    out.user_id = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : String(out.user_id);
  }

  return out;
}

export class NormalizingOneBotActionClient implements OneBotActionClient {
  private readonly rawCall: OneBotRawActionCall;

  constructor(rawCall: OneBotRawActionCall) {
    this.rawCall = rawCall;
  }

  call(action: string, params: unknown = {}): Promise<unknown> {
    return this.rawCall(action, normalizeCoreOneBotParams(action, params));
  }
}
