import type { GroupGuardRuntimeContext } from '../../../runtime/runtime_context';
import type { SystemWriteCommand } from '../../../app/use-cases/system/write/types';

export interface SystemWriteParseContext {
  channel: 'private' | 'group';
  text: string;
  groupId: string;
  userId: string;
  ctx: GroupGuardRuntimeContext;
}

function parsePrivateSystemWriteCommand(context: SystemWriteParseContext): SystemWriteCommand | null {
  if (context.text === '队列重置' || context.text === '/队列重置') {
    return {
      channel: 'private',
      action: 'reset_queue',
      actorUserId: context.userId,
      originalText: context.text
    };
  }
  if (context.text.startsWith('多群广播 ')) {
    return {
      channel: 'private',
      action: 'broadcast_licensed_groups',
      actorUserId: context.userId,
      originalText: context.text,
      content: context.text.slice(5).trim()
    };
  }
  return null;
}

function parseGroupSystemWriteCommand(context: SystemWriteParseContext): SystemWriteCommand | null {
  if (context.text === '开启入群私聊' || context.text === '关闭入群私聊') {
    return {
      channel: 'group',
      action: 'set_join_private_enabled',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId,
      enabled: context.text === '开启入群私聊'
    };
  }
  if (context.text === '清空群配置') {
    return {
      channel: 'group',
      action: 'build_group_config_cleanup_warning',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId
    };
  }
  if (context.text === '确认清空群配置') {
    return {
      channel: 'group',
      action: 'clear_group_config',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId
    };
  }
  if (context.text.startsWith('定时任务 ')) {
    const parts = context.text.split(/\s+/);
    return {
      channel: 'group',
      action: 'create_scheduled_task',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId,
      time: parts[1] || '',
      content: parts.length >= 3 ? parts.slice(2).join(' ') : ''
    };
  }
  if (context.text.startsWith('设置欢迎词 ')) {
    return {
      channel: 'group',
      action: 'update_welcome_message',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId,
      message: context.text.slice(6).trim()
    };
  }
  if (context.text.startsWith('设置入群私聊 ')) {
    return {
      channel: 'group',
      action: 'update_join_private_message',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId,
      message: context.text.slice('设置入群私聊 '.length).trim()
    };
  }
  if (context.text.startsWith('删除定时任务 ')) {
    return {
      channel: 'group',
      action: 'delete_scheduled_task',
      actorUserId: context.userId,
      originalText: context.text,
      groupId: context.groupId,
      taskId: context.text.slice(7).trim()
    };
  }
  return null;
}

export function parseSystemWriteCommand(context: SystemWriteParseContext): SystemWriteCommand | null {
  return context.channel === 'private'
    ? parsePrivateSystemWriteCommand(context)
    : parseGroupSystemWriteCommand(context);
}
