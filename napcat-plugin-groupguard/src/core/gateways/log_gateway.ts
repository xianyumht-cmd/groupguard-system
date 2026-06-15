import { loggingStateService } from '../state-services/logging_state_service';

export class LogGateway {
  info(message: string): void {
    loggingStateService.info(message);
  }

  warn(message: string): void {
    loggingStateService.warn(message);
  }

  error(message: string): void {
    loggingStateService.error(message);
  }

  debug(message: string): void {
    loggingStateService.debug(message);
  }

  getLogBuffer() {
    return loggingStateService.getLogBuffer();
  }
}

export const logGateway = new LogGateway();
