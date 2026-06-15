import { pluginStateAuthAdapter } from '../state-infra/plugin_state_auth_adapter';

export class AuthStateService {
  isOwner(userId: string): boolean {
    return pluginStateAuthAdapter.isOwner(userId);
  }

  isBotAdmin(groupId: string): Promise<boolean> {
    return pluginStateAuthAdapter.isBotAdmin(groupId);
  }

  isBlacklisted(userId: string): boolean {
    return pluginStateAuthAdapter.isBlacklisted(userId);
  }

  isWhitelisted(userId: string): boolean {
    return pluginStateAuthAdapter.isWhitelisted(userId);
  }
}

export const authStateService = new AuthStateService();
