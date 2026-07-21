import { maintenanceDomainService } from '../../../../../domain/maintenance/maintenance_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';

export function buildGroupConfigCleanupWarningUseCase(
  _command: Extract<SystemWriteCommand, { action: 'build_group_config_cleanup_warning'; }>
): SystemWriteUseCaseResult {
  return {
    success: true,
    data: {
      message: maintenanceDomainService.buildGroupConfigCleanupWarning(),
      scene: 'raw_text'
    }
  };
}
