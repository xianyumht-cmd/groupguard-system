import { queueDomainService } from '../../../../../domain/queue/queue_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export function resetSystemQueue(
  _command: Extract<SystemWriteCommand, { action: 'reset_queue'; }>,
  context: SystemWriteUseCaseContext
): SystemWriteUseCaseResult {
  const result = context.queuePort.resetRuntime();
  return {
    success: true,
    data: {
      message: queueDomainService.buildResetSummary(result),
      scene: 'action_success'
    }
  };
}
