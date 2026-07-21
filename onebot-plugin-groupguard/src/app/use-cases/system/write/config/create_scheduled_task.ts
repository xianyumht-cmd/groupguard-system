import { configDomainService } from '../../../../../domain/config/config_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function createScheduledTaskUseCase(
  command: Extract<SystemWriteCommand, { action: 'create_scheduled_task'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  const plan = configDomainService.planScheduledTaskCreation({ time: command.time, content: command.content, now: Date.now() });
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
  context.configPort.appendScheduledTask(command.groupId, plan.data.task);
  context.configPort.saveConfig();
  return {
    success: true,
    data: {
      message: plan.data.successMessage,
      scene: 'action_success'
    }
  };
}
