import { pluginState } from '../../state';

export class PluginStateAuthAdapter {
  isOwner(userId: string): boolean {
    return pluginState.isOwner(userId);
  }

  isBotAdmin(groupId: string): Promise<boolean> {
    return pluginState.isBotAdmin(groupId);
  }

  isBlacklisted(userId: string): boolean {
    return pluginState.isBlacklisted(userId);
  }

  isWhitelisted(userId: string): boolean {
    return pluginState.isWhitelisted(userId);
  }
}

export const pluginStateAuthAdapter = new PluginStateAuthAdapter();
