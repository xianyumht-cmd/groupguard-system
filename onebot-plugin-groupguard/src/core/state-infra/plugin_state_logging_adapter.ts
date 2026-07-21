import { pluginState } from '../../state';

export class PluginStateLoggingAdapter {
  info(message: string): void {
    pluginState.log('info', message);
  }

  warn(message: string): void {
    pluginState.log('warn', message);
  }

  error(message: string): void {
    pluginState.log('error', message);
  }

  debug(message: string): void {
    pluginState.debug(message);
  }

  getLogBuffer() {
    return pluginState.logBuffer;
  }

  clearLogs(): void {
    pluginState.clearLogs();
  }
}

export const pluginStateLoggingAdapter = new PluginStateLoggingAdapter();
