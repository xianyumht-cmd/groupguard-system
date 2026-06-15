import { pluginState } from '../../state';

export class PluginStateContextAdapter {
  getActions() {
    return pluginState.actions;
  }

  setActions(actions: any): void {
    pluginState.actions = actions;
  }

  getLogger() {
    return pluginState.logger;
  }

  setLogger(logger: any): void {
    pluginState.logger = logger;
  }

  getAdapterName(): string {
    return pluginState.adapterName;
  }

  setAdapterName(adapterName: string): void {
    pluginState.adapterName = adapterName;
  }

  getNetworkConfig() {
    return pluginState.networkConfig;
  }

  setNetworkConfig(networkConfig: any): void {
    pluginState.networkConfig = networkConfig;
  }

  getConfigDir(): string {
    return pluginState.configDir;
  }

  setConfigDir(configDir: string): void {
    pluginState.configDir = configDir;
  }

  getConfigSchemaHtml(): string {
    return pluginState.configSchemaHtml;
  }

  setConfigSchemaHtml(configSchemaHtml: string): void {
    pluginState.configSchemaHtml = configSchemaHtml;
  }

  setBotId(botId: string): void {
    pluginState.botId = botId;
  }

  getStartTime(): number {
    return pluginState.startTime;
  }

  getMsgCount(): number {
    return pluginState.msgCount;
  }

  cleanCache(): void {
    pluginState.cleanCache();
  }
}

export const pluginStateContextAdapter = new PluginStateContextAdapter();
