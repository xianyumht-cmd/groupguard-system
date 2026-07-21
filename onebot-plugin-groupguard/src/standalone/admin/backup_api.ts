import fs from 'fs';
import path from 'path';
import { backupFile, ensureDir } from './backup';
import type { SnowLumaAdminServerOptions } from './types';

function safeStat(filePath: string) {
  try { return fs.statSync(filePath); } catch { return null; }
}

export function listBackups(options: SnowLumaAdminServerOptions) {
  ensureDir(options.backupDir);
  return fs.readdirSync(options.backupDir)
    .map(name => {
      const fullPath = path.join(options.backupDir, name);
      const stat = safeStat(fullPath);
      if (!stat) return null;
      return {
        name,
        path: fullPath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mtime: new Date(stat.mtimeMs).toLocaleString('zh-CN'),
        files: stat.isDirectory() ? fs.readdirSync(fullPath).slice(0, 20) : []
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.mtimeMs - a.mtimeMs);
}

export function createSnapshot(options: SnowLumaAdminServerOptions) {
  const copied: Array<{ label: string; path: string; }> = [];
  copied.push({ label: 'config.json', path: backupFile(options.configPath, options.backupDir, 'config.json') });
  copied.push({ label: 'commands.json', path: backupFile(options.dynamicCommandsConfigPath, options.backupDir, 'commands.json') });
  return copied;
}
