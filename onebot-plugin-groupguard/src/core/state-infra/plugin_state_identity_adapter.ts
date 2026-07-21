import { pluginState } from '../../state';

export class PluginStateIdentityAdapter {
  getBotId(): string {
    return pluginState.botId;
  }

  getVersion(): string {
    return pluginState.version;
  }
}

export const pluginStateIdentityAdapter = new PluginStateIdentityAdapter();
