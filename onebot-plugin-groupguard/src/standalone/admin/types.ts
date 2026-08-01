
import type { GroupGuardRuntimeContext } from '../../runtime/runtime_context';
export interface SnowLumaAdminServerOptions {
  ctx: GroupGuardRuntimeContext;
  workDir: string;
  dataDir: string;
  configPath: string;
  backupDir: string;
  dynamicCommandsConfigPath: string;
  wsUrl: string;
  host?: string;
  port?: number;
  token?: string;
  getOneBotStatus?: () => Record<string, any>;
  recoverOneBot?: () => Promise<Record<string, any>>;
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
