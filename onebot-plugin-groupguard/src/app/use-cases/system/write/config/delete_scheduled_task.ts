import { configDomainService } from '../../../../../domain/config/config_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function deleteScheduledTaskUseCase(
  command: Extract<SystemWriteCommand, { action: 'delete_scheduled_task'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  const plan = configDomainService.planScheduledTaskDeletion(context.configPort.getStoredScheduledTasks(command.groupId), command.taskId);
  if (!plan.ok) {
    return {
      success: false,
      error: plan.message,
      data: {
        message: plan.message,
        scene: plan.status
      }
    };
  }
  context.configPort.replaceScheduledTasks(command.groupId, plan.data.tasks);
  context.configPort.saveConfig();
  return {
    success: true,
    data: {
      message: plan.data.successMessage,
      scene: 'action_success'
    }
  };
}
