import { pluginStateLoggingAdapter } from '../state-infra/plugin_state_logging_adapter';

export class LoggingStateService {
  info(message: string): void {
    pluginStateLoggingAdapter.info(message);
  }

  warn(message: string): void {
    pluginStateLoggingAdapter.warn(message);
  }

  error(message: string): void {
    pluginStateLoggingAdapter.error(message);
  }

  debug(message: string): void {
    pluginStateLoggingAdapter.debug(message);
  }

  getLogBuffer() {
    return pluginStateLoggingAdapter.getLogBuffer();
  }
}

export const loggingStateService = new LoggingStateService();
