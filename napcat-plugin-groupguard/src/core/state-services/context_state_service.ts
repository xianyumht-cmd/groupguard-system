import { pluginStateContextAdapter } from '../state-infra/plugin_state_context_adapter';

export class ContextStateService {
  getActions() {
    return pluginStateContextAdapter.getActions();
  }

  setActions(actions: any): void {
    pluginStateContextAdapter.setActions(actions);
  }

  getLogger() {
    return pluginStateContextAdapter.getLogger();
  }

  setLogger(logger: any): void {
    pluginStateContextAdapter.setLogger(logger);
  }

  getAdapterName(): string {
    return pluginStateContextAdapter.getAdapterName();
  }

  setAdapterName(adapterName: string): void {
    pluginStateContextAdapter.setAdapterName(adapterName);
  }

  getNetworkConfig() {
    return pluginStateContextAdapter.getNetworkConfig();
  }

  setNetworkConfig(networkConfig: any): void {
    pluginStateContextAdapter.setNetworkConfig(networkConfig);
  }

  getConfigDir(): string {
    return pluginStateContextAdapter.getConfigDir();
  }

  setConfigDir(configDir: string): void {
    pluginStateContextAdapter.setConfigDir(configDir);
  }

  getConfigSchemaHtml(): string {
    return pluginStateContextAdapter.getConfigSchemaHtml();
  }

  setConfigSchemaHtml(configSchemaHtml: string): void {
    pluginStateContextAdapter.setConfigSchemaHtml(configSchemaHtml);
  }

  setBotId(botId: string): void {
    pluginStateContextAdapter.setBotId(botId);
  }

  getStartTime(): number {
    return pluginStateContextAdapter.getStartTime();
  }

  getMsgCount(): number {
    return pluginStateContextAdapter.getMsgCount();
  }

  cleanCache(): void {
    pluginStateContextAdapter.cleanCache();
  }
}

export const contextStateService = new ContextStateService();
