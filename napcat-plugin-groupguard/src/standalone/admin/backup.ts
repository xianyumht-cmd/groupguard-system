import fs from 'fs';
import path from 'path';

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function backupFile(sourcePath: string, backupDir: string, label: string): string {
  ensureDir(backupDir);
  const dir = path.join(backupDir, `webui-${timestamp()}`);
  ensureDir(dir);
  const target = path.join(dir, label);
  if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, target);
  return target;
}
