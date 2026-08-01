import type { GroupGuardRuntimeContext } from '../../runtime/runtime_context';
import type { OneBotMessageEvent } from '../../protocol/onebot11/types';
import type { AuthCommand } from '../../app/use-cases/auth/types';
import { executeAuthCommand } from '../../services/auth_service';

export const AUTH_PREFIXES = [
  '授权 ',
  '回收授权 ',
  '查询授权 ',
  '激活 '
];

export const AUTH_EXACT = [
  '查询授权',
  '授权状态',
  '授权查询'
];

function toAuthCommand(text: string, userId: string, groupId: string): AuthCommand | null {
  if (text.startsWith('授权 ')) {
    const parts = text.split(' ');
    return {
      channel: 'private',
      action: 'grant',
      actorUserId: userId,
      originalText: text,
      targetGroupId: parts[1] || '',
      durationToken: parts[2] || ''
    };
  }
  if (text.startsWith('回收授权 ')) {
    return {
      channel: 'private',
      action: 'revoke',
      actorUserId: userId,
      originalText: text,
      targetGroupId: text.split(' ')[1] || ''
    };
  }
  if (text.startsWith('查询授权 ')) {
    return {
      channel: 'private',
      action: 'query_private',
      actorUserId: userId,
      originalText: text,
      targetGroupId: text.split(' ')[1] || ''
    };
  }
  if (text === '查询授权' || text === '授权状态' || text === '授权查询') {
    return {
      channel: 'group',
      action: 'query_group',
      actorUserId: userId,
      originalText: text,
      groupId
    };
  }
  if (text.startsWith('激活 ')) {
    return {
      channel: 'group',
      action: 'activate',
      actorUserId: userId,
      originalText: text,
      groupId,
      activationKey: text.slice(3).trim()
    };
  }
  return null;
}

export async function handleAuthCommand(event: OneBotMessageEvent, ctx: GroupGuardRuntimeContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  const command = toAuthCommand(text, userId, groupId);
  if (!command) return false;
  return executeAuthCommand(command, ctx);
}
