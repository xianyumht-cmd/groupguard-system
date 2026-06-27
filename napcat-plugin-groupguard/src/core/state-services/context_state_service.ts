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

  getWorkDir(): string {
    return pluginStateContextAdapter.getWorkDir();
  }

  setWorkDir(workDir: string): void {
    pluginStateContextAdapter.setWorkDir(workDir);
  }

  getConfigPath(): string {
    return pluginStateContextAdapter.getConfigPath();
  }

  setConfigPath(configPath: string): void {
    pluginStateContextAdapter.setConfigPath(configPath);
  }

  getConfigDir(): string {
    return pluginStateContextAdapter.getConfigDir();
  }

  setConfigDir(configDir: string): void {
    pluginStateContextAdapter.setConfigDir(configDir);
  }

  getDataDir(): string {
    return pluginStateContextAdapter.getDataDir();
  }

  setDataDir(dataDir: string): void {
    pluginStateContextAdapter.setDataDir(dataDir);
  }

  getBackupDir(): string {
    return pluginStateContextAdapter.getBackupDir();
  }

  setBackupDir(backupDir: string): void {
    pluginStateContextAdapter.setBackupDir(backupDir);
  }

  getDynamicCommandsConfigPath(): string {
    return pluginStateContextAdapter.getDynamicCommandsConfigPath();
  }

  setDynamicCommandsConfigPath(configPath: string): void {
    pluginStateContextAdapter.setDynamicCommandsConfigPath(configPath);
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
