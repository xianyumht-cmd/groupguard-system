import { configDomainService } from '../../../../../domain/config/config_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function updateJoinPrivateMessageUseCase(
  command: Extract<SystemWriteCommand, { action: 'update_join_private_message'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  const plan = configDomainService.planJoinPrivateMessageUpdate(command.message);
  if (!plan.ok) {
    return {
      success: false,
      error: plan.message,
      data: {
        message: plan.message,
        scene: plan.status,
        vars: plan.vars
      }
    };
  }
  context.configPort.setJoinPrivateMessage(command.groupId, plan.data.message);
  context.configPort.saveConfig();
  return {
    success: true,
    data: {
      message: plan.data.successMessage,
      scene: 'action_success'
    }
  };
}
