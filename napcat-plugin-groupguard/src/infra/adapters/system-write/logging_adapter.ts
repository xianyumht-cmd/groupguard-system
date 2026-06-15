import { loggingStateService } from '../../../core/state-services/logging_state_service';
import type { ISystemWriteLoggingPort } from '../../../app/use-cases/system/write/ports';

export class LoggingAdapter implements ISystemWriteLoggingPort {
  warn(message: string): void {
    loggingStateService.warn(message);
  }
}
