import type { OneBotWsClient } from './onebot_ws_client';

type ActionAliasMap = Record<string, string>;

const ACTION_ALIASES: ActionAliasMap = {
  // Keep this map explicit so future host-specific aliases can be added without touching business code.
};

function normalizeActionName(action: string): string {
  return ACTION_ALIASES[action] || action;
}

function normalizeParams(action: string, params: any): any {
  const out = params && typeof params === 'object' && !Array.isArray(params) ? { ...params } : {};

  if (out.groupId !== undefined && out.group_id === undefined) out.group_id = out.groupId;
  if (out.userId !== undefined && out.user_id === undefined) out.user_id = out.userId;
  if (out.messageId !== undefined && out.message_id === undefined) out.message_id = out.messageId;

  if (action === 'delete_msg' && out.message_id !== undefined) {
    out.message_id = String(out.message_id);
  }

  if ((action === 'set_group_ban' || action === 'set_group_kick' || action === 'get_group_member_info') && out.user_id !== undefined) {
    out.user_id = Number.isFinite(Number(out.user_id)) ? Number(out.user_id) : String(out.user_id);
  }

  if (out.group_id !== undefined) {
    out.group_id = Number.isFinite(Number(out.group_id)) ? Number(out.group_id) : String(out.group_id);
  }

  return out;
}

export class OneBotActionCaller {
  constructor(private readonly client: OneBotWsClient) {}

  async call(actionName: string, params: unknown = {}): Promise<any> {
    const action = normalizeActionName(actionName);
    const normalizedParams = normalizeParams(action, params);
    return this.client.call(action, normalizedParams);
  }
}
