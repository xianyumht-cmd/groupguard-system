import { pluginStateIdentityAdapter } from '../state-infra/plugin_state_identity_adapter';

export class IdentityStateService {
  getBotId(): string {
    return pluginStateIdentityAdapter.getBotId();
  }

  getVersion(): string {
    return pluginStateIdentityAdapter.getVersion();
  }
}

export const identityStateService = new IdentityStateService();
