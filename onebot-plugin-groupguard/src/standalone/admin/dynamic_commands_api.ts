import { forceReloadDynamicCommands } from '../../dynamic-commands/command_loader';
import { backupFile } from './backup';
import { readJsonFile, writeJsonFile } from './json_file';
import type { SnowLumaAdminServerOptions } from './types';

const DEFAULT_DYNAMIC_COMMANDS = { version: '1', commands: [] };

export function ensureDynamicCommandsConfig(value: any): Record<string, any> {
  if (Array.isArray(value)) return { version: '1', commands: value };
  if (!value || typeof value !== 'object') return { ...DEFAULT_DYNAMIC_COMMANDS };
  if (!Array.isArray(value.commands)) value.commands = [];
  if (typeof value.version !== 'string') value.version = '1';
  return value;
}

export function getDynamicCommandsConfig(options: SnowLumaAdminServerOptions): Record<string, any> {
  return ensureDynamicCommandsConfig(readJsonFile(options.dynamicCommandsConfigPath, { ...DEFAULT_DYNAMIC_COMMANDS }));
}

export async function saveDynamicCommandsConfig(options: SnowLumaAdminServerOptions, nextConfig: any): Promise<number> {
  const next = ensureDynamicCommandsConfig(nextConfig);
  backupFile(options.dynamicCommandsConfigPath, options.backupDir, 'commands.json');
  writeJsonFile(options.dynamicCommandsConfigPath, next);
  const commands = await forceReloadDynamicCommands();
  return commands.length;
}
