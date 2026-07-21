import { pluginStateRuntimeControlAdapter } from '../state-infra/plugin_state_runtime_control_adapter';
import { pluginStateLoggingAdapter } from '../state-infra/plugin_state_logging_adapter';

export class RuntimeControlService {
  clearLogs(): void {
    pluginStateRuntimeControlAdapter.clearLogs();
  }

  scheduleSelfRecall(groupId: string, messageId: string, source: 'send_group_msg' | 'message_event' = 'send_group_msg'): void {
    pluginStateRuntimeControlAdapter.scheduleSelfRecall(groupId, messageId, source);
  }

  getLogBuffer() {
    return pluginStateLoggingAdapter.getLogBuffer();
  }
}

export const runtimeControlService = new RuntimeControlService();
