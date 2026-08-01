import { normalizePluginConfig } from '../../config';
import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { applyPatch } from './object_patch';
import { backupFile } from './backup';
import { ensureObjectConfig, readJsonFile } from './json_file';
import type { JsonRecord, SnowLumaAdminServerOptions } from './types';

export function getRawConfig(options: SnowLumaAdminServerOptions): JsonRecord {
  return ensureObjectConfig(readJsonFile(options.configPath, {}));
}

export function saveRawConfig(options: SnowLumaAdminServerOptions, nextConfig: any): void {
  const configObject = ensureObjectConfig(nextConfig);
  const normalized = normalizePluginConfig(configObject as any);
  const previous = configStateService.getConfig();
  backupFile(options.configPath, options.backupDir, 'config.json');
  try {
    configStateService.setConfig(normalized);
    saveConfigStrict(options.ctx);
  } catch (error) {
    configStateService.setConfig(previous);
    throw error;
  }
}

export function patchRawConfig(options: SnowLumaAdminServerOptions, patch: JsonRecord): void {
  const current = getRawConfig(options);
  saveRawConfig(options, applyPatch(current, patch));
}
