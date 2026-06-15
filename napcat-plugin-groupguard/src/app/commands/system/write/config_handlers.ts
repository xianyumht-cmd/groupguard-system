import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { createScheduledTaskUseCase } from '../../../use-cases/system/write/config/create_scheduled_task';
import { deleteScheduledTaskUseCase } from '../../../use-cases/system/write/config/delete_scheduled_task';
import { setJoinPrivateEnabledUseCase } from '../../../use-cases/system/write/config/set_join_private_enabled';
import { updateJoinPrivateMessageUseCase } from '../../../use-cases/system/write/config/update_join_private_message';
import { updateWelcomeMessageUseCase } from '../../../use-cases/system/write/config/update_welcome_message';
import type { SystemWriteCommandResult } from './types';

export function createScheduledTask(groupId: string, time: string, content: string, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return createScheduledTaskUseCase(groupId, time, content, ctx);
}

export function updateWelcomeMessage(groupId: string, message: string, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return updateWelcomeMessageUseCase(groupId, message, ctx);
}

export function setJoinPrivateEnabled(groupId: string, enabled: boolean, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return setJoinPrivateEnabledUseCase(groupId, enabled, ctx);
}

export function updateJoinPrivateMessage(groupId: string, message: string, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return updateJoinPrivateMessageUseCase(groupId, message, ctx);
}

export function deleteScheduledTask(groupId: string, id: string, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return deleteScheduledTaskUseCase(groupId, id, ctx);
}
