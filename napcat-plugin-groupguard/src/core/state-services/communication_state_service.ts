import type { ReplyPersona } from '../../types';
import { pluginStateCommunicationAdapter } from '../state-infra/plugin_state_communication_adapter';

export class CommunicationStateService {
  async sendGroupText(groupId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; }): Promise<void> {
    await pluginStateCommunicationAdapter.sendGroupText(groupId, content, options);
  }

  async sendGroupMsg(groupId: string, message: any[], options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; }): Promise<void> {
    await pluginStateCommunicationAdapter.sendGroupMsg(groupId, message, options);
  }

  async sendPrivateMsg(userId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; }): Promise<void> {
    await pluginStateCommunicationAdapter.sendPrivateMsg(userId, content, options);
  }

  async callApi(action: string, params: any): Promise<any> {
    return pluginStateCommunicationAdapter.callApi(action, params);
  }
}

export const communicationStateService = new CommunicationStateService();
