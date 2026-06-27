import fs from 'fs';
import path from 'path';
import { ensureDir } from './backup';

export function readJsonFile(filePath: string, fallback: any = {}): any {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeJsonFile(filePath: string, value: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function ensureObjectConfig(value: any): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config.json 必须是 JSON 对象，不能是数组或空值');
  }
  return value;
}
