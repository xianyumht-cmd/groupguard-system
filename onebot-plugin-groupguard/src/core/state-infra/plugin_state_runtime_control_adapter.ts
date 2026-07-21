import { pluginState } from '../../state';

export class PluginStateRuntimeControlAdapter {
  clearLogs(): void {
    pluginState.clearLogs();
  }

  scheduleSelfRecall(groupId: string, messageId: string, source: 'send_group_msg' | 'message_event' = 'send_group_msg'): void {
    pluginState.scheduleSelfRecall(groupId, messageId, source);
  }
}

export const pluginStateRuntimeControlAdapter = new PluginStateRuntimeControlAdapter();
