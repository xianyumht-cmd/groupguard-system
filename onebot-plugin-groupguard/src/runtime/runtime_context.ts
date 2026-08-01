import type { HostProfile } from '../hosts/host_profile';
import type { OneBotActionClient } from '../protocol/onebot11/action_client';

export interface RuntimeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RuntimePaths {
  workDir: string;
  configPath: string;
  configDir: string;
  dataDir: string;
  backupDir: string;
  dynamicCommandsConfigPath: string;
}

export interface RuntimeRouter {
  static?(route: string, directory: string): void;
  page?(options: Record<string, unknown>): void;
  getNoAuth?(route: string, handler: (...args: any[]) => unknown): void;
  postNoAuth?(route: string, handler: (...args: any[]) => unknown): void;
  get?(route: string, handler: (...args: any[]) => unknown): void;
  post?(route: string, handler: (...args: any[]) => unknown): void;
}

/**
 * The only runtime object that GroupGuard business code may receive.
 * Host-specific transport/config objects must be normalized before this boundary.
 */
export interface GroupGuardRuntimeContext extends RuntimePaths {
  logger: RuntimeLogger;
  actions: OneBotActionClient;
  hostProfile: HostProfile;
  router: RuntimeRouter;
  paths: RuntimePaths;
}

export type GroupGuardCommandContext = Pick<GroupGuardRuntimeContext, 'configPath'>;
