export type PluginConfigSchema = any;
export type PluginLogger = {
  log: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};
export type NapCatPluginContext = any;
export type PluginModule = any;
