import fs from 'fs';
import path from 'path';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { DEFAULT_PLUGIN_CONFIG } from '../config';

export interface StandaloneContextOptions {
  actions: any;
  dataDir: string;
  configPath?: string;
  adapterName?: string;
  logger?: Console;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureConfigFile(configPath: string): void {
  if (fs.existsSync(configPath)) return;
  const mainConfig = { ...DEFAULT_PLUGIN_CONFIG, groups: {} };
  fs.writeFileSync(configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
}

function createNapCatConfigShim() {
  return {
    combine: (...items: unknown[]) => items,
    html: (html: string) => ({ type: 'html', html }),
    text: (key: string, label: string, defaultValue = '', description = '') => ({ type: 'text', key, label, defaultValue, description }),
    boolean: (key: string, label: string, defaultValue = false, description = '') => ({ type: 'boolean', key, label, defaultValue, description }),
    number: (key: string, label: string, defaultValue = 0, description = '') => ({ type: 'number', key, label, defaultValue, description }),
    select: (key: string, label: string, defaultValue = '', options: unknown[] = [], description = '') => ({ type: 'select', key, label, defaultValue, options, description })
  };
}

function createLoggerShim(logger: Console = console) {
  return {
    info: (message: string) => logger.info(message),
    warn: (message: string) => logger.warn(message),
    error: (message: string) => logger.error(message),
    debug: (message: string) => logger.debug?.(message) ?? logger.info(message)
  };
}

function createRouterShim() {
  const noop = () => undefined;
  return {
    static: noop,
    page: noop,
    getNoAuth: noop,
    postNoAuth: noop,
    get: noop,
    post: noop
  };
}

export function createStandaloneContext(options: StandaloneContextOptions): NapCatPluginContext {
  const dataDir = path.resolve(options.dataDir);
  const configPath = path.resolve(options.configPath || path.join(dataDir, 'config.json'));
  ensureDir(dataDir);
  ensureDir(path.dirname(configPath));
  ensureDir(path.join(dataDir, 'groups'));
  ensureConfigFile(configPath);

  const ctx = {
    logger: createLoggerShim(options.logger),
    actions: options.actions,
    adapterName: options.adapterName || 'snowluma-onebot',
    pluginManager: { config: {} },
    NapCatConfig: createNapCatConfigShim(),
    configPath,
    router: createRouterShim()
  };

  return ctx as unknown as NapCatPluginContext;
}
