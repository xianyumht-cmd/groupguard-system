import { resetActionQueueRuntime } from '../../../services/action_queue_service';
import type { ISystemWriteQueuePort } from '../../../app/use-cases/system/write/ports';

export class QueueAdapter implements ISystemWriteQueuePort {
  resetRuntime(): { cleared: number; activeWorkers: number; } {
    return resetActionQueueRuntime();
  }
}
