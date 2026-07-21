import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';

export interface SnowLumaAdminServerOptions {
  ctx: NapCatPluginContext;
  workDir: string;
  dataDir: string;
  configPath: string;
  backupDir: string;
  dynamicCommandsConfigPath: string;
  wsUrl: string;
  host?: string;
  port?: number;
  token?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SnowLumaAdminServerRuntime {
  close: () => Promise<void>;
  host: string;
  port: number;
  token: string;
  url: string;
}

export type JsonRecord = Record<string, any>;
