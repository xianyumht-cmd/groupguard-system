import { broadcastLicensedGroups } from '../app/use-cases/system/write/messaging/broadcast_licensed_groups';
import { createScheduledTaskUseCase } from '../app/use-cases/system/write/config/create_scheduled_task';
import { deleteScheduledTaskUseCase } from '../app/use-cases/system/write/config/delete_scheduled_task';
import { setJoinPrivateEnabledUseCase } from '../app/use-cases/system/write/config/set_join_private_enabled';
import { updateJoinPrivateMessageUseCase } from '../app/use-cases/system/write/config/update_join_private_message';
import { updateWelcomeMessageUseCase } from '../app/use-cases/system/write/config/update_welcome_message';
import { buildGroupConfigCleanupWarningUseCase } from '../app/use-cases/system/write/maintenance/build_group_config_cleanup_warning';
import { clearGroupConfigUseCase } from '../app/use-cases/system/write/maintenance/clear_group_config';
import { resetSystemQueue } from '../app/use-cases/system/write/queue/reset_system_queue';
import type { SystemWriteRuntimeContext, SystemWriteUseCaseContext } from '../app/use-cases/system/write/ports';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../app/use-cases/system/write/types';
import { createSystemWriteContext, createSystemWriteMessagingPort } from '../infra/adapters/systemWriteAdapterFactory';
import { presentSystemWriteResult } from './system_write_presenter';
import { evaluateSystemWritePolicy } from './system_write_policy';

const ACTION_EXECUTORS: Record<SystemWriteCommand['action'], (command: SystemWriteCommand, context: SystemWriteUseCaseContext) => Promise<SystemWriteUseCaseResult> | SystemWriteUseCaseResult> = {
  reset_queue: (command, context) => resetSystemQueue(command as Extract<SystemWriteCommand, { action: 'reset_queue'; }>, context),
  broadcast_licensed_groups: (command, context) => broadcastLicensedGroups(command as Extract<SystemWriteCommand, { action: 'broadcast_licensed_groups'; }>, context),
  create_scheduled_task: (command, ctx) => createScheduledTaskUseCase(
    command as Extract<SystemWriteCommand, { action: 'create_scheduled_task'; }>,
    ctx
  ),
  update_welcome_message: (command, ctx) => updateWelcomeMessageUseCase(
    command as Extract<SystemWriteCommand, { action: 'update_welcome_message'; }>,
    ctx
  ),
  set_join_private_enabled: (command, ctx) => setJoinPrivateEnabledUseCase(
    command as Extract<SystemWriteCommand, { action: 'set_join_private_enabled'; }>,
    ctx
  ),
  update_join_private_message: (command, ctx) => updateJoinPrivateMessageUseCase(
    command as Extract<SystemWriteCommand, { action: 'update_join_private_message'; }>,
    ctx
  ),
  delete_scheduled_task: (command, ctx) => deleteScheduledTaskUseCase(
    command as Extract<SystemWriteCommand, { action: 'delete_scheduled_task'; }>,
    ctx
  ),
  build_group_config_cleanup_warning: (command) => buildGroupConfigCleanupWarningUseCase(command as Extract<SystemWriteCommand, { action: 'build_group_config_cleanup_warning'; }>),
  clear_group_config: (command, ctx) => clearGroupConfigUseCase(
    command as Extract<SystemWriteCommand, { action: 'clear_group_config'; }>,
    ctx
  )
};

export async function executeSystemWriteCommand(command: SystemWriteCommand, ctx: SystemWriteRuntimeContext): Promise<SystemWriteUseCaseResult> {
  const useCaseContext = createSystemWriteContext(ctx);
  const policy = evaluateSystemWritePolicy(command, {
    isOwner: useCaseContext.authPort.isOwner(command.actorUserId),
    isAdminOrOwner: command.channel === 'group' ? await useCaseContext.authPort.isAdminOrOwner(command.groupId, command.actorUserId) : false
  });
  if (!policy.allowed) {
    return {
      success: false,
      error: policy.response?.message || '权限不足',
      data: {
        message: policy.response?.message || '权限不足',
        scene: policy.response?.scene || 'permission_denied'
      }
    };
  }
  return ACTION_EXECUTORS[command.action](command, useCaseContext);
}

export async function sendSystemWriteResult(command: SystemWriteCommand, result: SystemWriteUseCaseResult): Promise<void> {
  const messagingPort = createSystemWriteMessagingPort();
  const channel = command.channel;
  const targetId = channel === 'private' ? command.actorUserId : command.groupId;
  const presentation = presentSystemWriteResult(result);
  for (const notice of presentation.notices) {
    if (channel === 'private') {
      await messagingPort.sendPrivateScene(targetId, notice.scene || 'raw_text', notice.message, notice.vars);
    } else {
      await messagingPort.sendGroupScene(targetId, notice.scene || 'raw_text', notice.message, notice.vars);
    }
  }
  if (channel === 'private') {
    await messagingPort.sendPrivateScene(targetId, presentation.response.scene, presentation.response.message, presentation.response.vars);
    return;
  }
  await messagingPort.sendGroupScene(targetId, presentation.response.scene, presentation.response.message, presentation.response.vars);
}
