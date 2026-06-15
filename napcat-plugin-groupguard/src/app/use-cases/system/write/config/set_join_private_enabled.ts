import { configDomainService } from '../../../../../domain/config/config_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function setJoinPrivateEnabledUseCase(
  command: Extract<SystemWriteCommand, { action: 'set_join_private_enabled'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  const plan = configDomainService.planJoinPrivateEnabled(command.enabled);
  context.configPort.setJoinPrivateEnabled(command.groupId, plan.data.enabled);
  context.configPort.saveConfig();
  return {
    success: true,
    data: {
      message: plan.data.successMessage,
      scene: 'action_success'
    }
  };
}
