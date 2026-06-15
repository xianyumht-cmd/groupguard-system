import { loggingStateService } from '../../core/state-services/logging_state_service';
import type { ILoggingPort } from '../../interfaces/logging_port';

class LoggingPort implements ILoggingPort {
  warn(message: string): void {
    loggingStateService.warn(message);
  }
}

export function createLoggingPort(): ILoggingPort {
  return new LoggingPort();
}
