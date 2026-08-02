import type { GroupGuardRuntimeContext } from '../../../../runtime/runtime_context';
import { createScheduledTaskUseCase } from '../../../use-cases/system/write/config/create_scheduled_task';
import { deleteScheduledTaskUseCase } from '../../../use-cases/system/write/config/delete_scheduled_task';
import { setJoinPrivateEnabledUseCase } from '../../../use-cases/system/write/config/set_join_private_enabled';
import { updateJoinPrivateMessageUseCase } from '../../../use-cases/system/write/config/update_join_private_message';
import { updateWelcomeMessageUseCase } from '../../../use-cases/system/write/config/update_welcome_message';
import { createSystemWriteContext } from '../../../../infra/adapters/systemWriteAdapterFactory';
import type { SystemWriteCommandResult } from './types';

export function createScheduledTask(groupId: string, time: string, content: string, ctx: GroupGuardRuntimeContext, actorUserId = ''): SystemWriteCommandResult {
  return createScheduledTaskUseCase({
    channel: 'group', action: 'create_scheduled_task', actorUserId, originalText: `${time} ${content}`, groupId, time, content
  }, createSystemWriteContext(ctx));
}

export function updateWelcomeMessage(groupId: string, message: string, ctx: GroupGuardRuntimeContext, actorUserId = ''): SystemWriteCommandResult {
  return updateWelcomeMessageUseCase({
    channel: 'group', action: 'update_welcome_message', actorUserId, originalText: message, groupId, message
  }, createSystemWriteContext(ctx));
}

export function setJoinPrivateEnabled(groupId: string, enabled: boolean, ctx: GroupGuardRuntimeContext, actorUserId = ''): SystemWriteCommandResult {
  return setJoinPrivateEnabledUseCase({
    channel: 'group', action: 'set_join_private_enabled', actorUserId, originalText: String(enabled), groupId, enabled
  }, createSystemWriteContext(ctx));
}

export function updateJoinPrivateMessage(groupId: string, message: string, ctx: GroupGuardRuntimeContext, actorUserId = ''): SystemWriteCommandResult {
  return updateJoinPrivateMessageUseCase({
    channel: 'group', action: 'update_join_private_message', actorUserId, originalText: message, groupId, message
  }, createSystemWriteContext(ctx));
}

export function deleteScheduledTask(groupId: string, id: string, ctx: GroupGuardRuntimeContext, actorUserId = ''): SystemWriteCommandResult {
  return deleteScheduledTaskUseCase({
    channel: 'group', action: 'delete_scheduled_task', actorUserId, originalText: id, groupId, taskId: id
  }, createSystemWriteContext(ctx));
}
