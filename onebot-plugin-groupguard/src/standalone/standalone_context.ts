import fs from 'fs';
import path from 'path';
import { DEFAULT_PLUGIN_CONFIG } from '../config';
import type { HostProfile } from '../hosts/host_profile';
import type { OneBotActionClient } from '../protocol/onebot11/action_client';
import type {
  GroupGuardRuntimeContext,
  RuntimeLogger,
  RuntimeRouter,
} from '../runtime/runtime_context';

export interface StandaloneContextOptions {
  actions: OneBotActionClient;
  hostProfile: HostProfile;
  workDir: string;
  dataDir: string;
  configPath?: string;
  backupDir?: string;
  dynamicCommandsConfigPath?: string;
  logger?: Console | RuntimeLogger;
  router?: RuntimeRouter;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureConfigFile(configPath: string): void {
  if (fs.existsSync(configPath)) return;
  const mainConfig = { ...DEFAULT_PLUGIN_CONFIG, groups: {} };
  fs.writeFileSync(configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
}

function createLogger(logger: Console | RuntimeLogger = console): RuntimeLogger {
  return {
    info: (message: string) => logger.info(message),
    warn: (message: string) => logger.warn(message),
    error: (message: string) => logger.error(message),
    debug: (message: string) => {
      if (typeof logger.debug === 'function') logger.debug(message);
      else logger.info(message);
    }
  };
}

function createRouter(): RuntimeRouter {
  const noop = () => undefined;
  return {
    static: noop,
    page: noop,
    getNoAuth: noop,
    postNoAuth: noop,
    get: noop,
    post: noop,
  };
}

export function createStandaloneRuntimeContext(options: StandaloneContextOptions): GroupGuardRuntimeContext {
  const workDir = path.resolve(options.workDir);
  const dataDir = path.resolve(options.dataDir);
  const configPath = path.resolve(options.configPath || path.join(workDir, 'config.json'));
  const configDir = path.dirname(configPath);
  const backupDir = path.resolve(options.backupDir || path.join(workDir, 'backups'));
  const dynamicCommandsConfigPath = path.resolve(
    options.dynamicCommandsConfigPath || path.join(workDir, 'config', 'dynamic-commands', 'commands.json')
  );
  ensureDir(workDir);
  ensureDir(dataDir);
  ensureDir(backupDir);
  ensureDir(path.dirname(dynamicCommandsConfigPath));
  ensureDir(configDir);
  ensureConfigFile(configPath);

  const paths = { workDir, dataDir, configPath, configDir, backupDir, dynamicCommandsConfigPath };
  return {
    logger: createLogger(options.logger),
    actions: options.actions,
    hostProfile: options.hostProfile,
    router: options.router || createRouter(),
    paths,
    ...paths,
  };
}
