import { pluginState } from '../../state';
import type { ReplyPersona } from '../../types';

export class PluginStateCommunicationAdapter {
  async sendGroupText(groupId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; }): Promise<void> {
    await pluginState.sendGroupText(groupId, content, options);
  }

  async sendGroupMsg(groupId: string, message: any[], options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; }): Promise<void> {
    await pluginState.sendGroupMsg(groupId, message, options);
  }

  async sendPrivateMsg(userId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; }): Promise<void> {
    await pluginState.sendPrivateMsg(userId, content, options);
  }

  async callApi(action: string, params: any): Promise<any> {
    return pluginState.callApi(action, params);
  }
}

export const pluginStateCommunicationAdapter = new PluginStateCommunicationAdapter();
