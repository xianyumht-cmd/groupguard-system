import { resetSystemQueue } from '../../../use-cases/system/write/queue/reset_system_queue';
import type { SystemWriteCommandResult } from './types';

export function resetQueue(): SystemWriteCommandResult {
  return resetSystemQueue();
}
