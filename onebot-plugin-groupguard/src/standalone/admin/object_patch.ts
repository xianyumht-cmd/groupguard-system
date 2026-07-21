import type { JsonRecord } from './types';

export function splitPath(key: string): string[] {
  const text = String(key || '').trim();
  if (text.startsWith('global.featureSwitches.query.')) {
    return ['global', 'featureSwitches', `query.${text.slice('global.featureSwitches.query.'.length)}`];
  }
  if (text.startsWith('global.featureSwitches.builtin.')) {
    return ['global', 'featureSwitches', `builtin.${text.slice('global.featureSwitches.builtin.'.length)}`];
  }
  if (text.startsWith('featureSwitches.query.')) {
    return ['featureSwitches', `query.${text.slice('featureSwitches.query.'.length)}`];
  }
  if (text.startsWith('featureSwitches.builtin.')) {
    return ['featureSwitches', `builtin.${text.slice('featureSwitches.builtin.'.length)}`];
  }
  return text.split('.').map(item => item.trim()).filter(Boolean);
}

export function setByPath(target: JsonRecord, key: string, value: any): void {
  const parts = splitPath(key);
  if (!parts.length) return;
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

export function parsePatchValue(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function applyPatch<T extends JsonRecord>(config: T, patch: JsonRecord): T {
  const next = JSON.parse(JSON.stringify(config || {}));
  for (const [key, value] of Object.entries(patch || {})) {
    if (!key || key === '__proto__' || key.includes('__proto__')) continue;
    setByPath(next, key, parsePatchValue(value));
  }
  return next;
}
