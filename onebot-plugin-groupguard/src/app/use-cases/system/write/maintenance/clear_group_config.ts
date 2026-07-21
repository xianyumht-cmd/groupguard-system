import { maintenanceDomainService } from '../../../../../domain/maintenance/maintenance_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function clearGroupConfigUseCase(
  command: Extract<SystemWriteCommand, { action: 'clear_group_config'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  try {
    context.configPort.removeGroupConfig(command.groupId);
    context.configPort.saveConfig();
    context.maintenancePort.clearGroupData(command.groupId);
    context.loggingPort.warn(`主人 ${command.actorUserId} 清空了群 ${command.groupId} 的所有数据`);
    return {
      success: true,
      data: {
        message: maintenanceDomainService.buildGroupConfigCleanupSuccess(),
        scene: 'action_success'
      }
    };
  } catch (e) {
    return {
      success: false,
      error: maintenanceDomainService.buildGroupConfigCleanupFailure(String(e)),
      data: {
        message: maintenanceDomainService.buildGroupConfigCleanupFailure(String(e)),
        scene: 'raw_text'
      }
    };
  }
}
