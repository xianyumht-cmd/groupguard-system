import fs from 'fs';
import path from 'path';
import { contextStateService } from '../../core/state-services/context_state_service';
import { identityStateService } from '../../core/state-services/identity_state_service';
import { getFeatureGateSnapshot } from '../../core/feature_gate';
import { loadDynamicCommands } from '../../dynamic-commands/command_loader';
import type { SnowLumaAdminServerOptions } from './types';

export function getStatus(options: SnowLumaAdminServerOptions) {
  const sqlitePath = path.join(options.dataDir, 'groupguard.db');
  const dynamicCommands = loadDynamicCommands();
  return {
    workDir: options.workDir,
    processCwd: process.cwd(),
    configPath: options.configPath,
    dataDir: options.dataDir,
    sqlitePath,
    backupDir: options.backupDir,
    dynamicCommandsPath: options.dynamicCommandsConfigPath,
    wsUrl: options.wsUrl,
    botId: identityStateService.getBotId() || '',
    adapterName: contextStateService.getAdapterName() || '',
    dynamicCommandsCount: dynamicCommands.length,
    feature: getFeatureGateSnapshot(),
    exists: {
      config: fs.existsSync(options.configPath),
      sqlite: fs.existsSync(sqlitePath),
      dynamicCommands: fs.existsSync(options.dynamicCommandsConfigPath),
      backupDir: fs.existsSync(options.backupDir)
    }
  };
}
