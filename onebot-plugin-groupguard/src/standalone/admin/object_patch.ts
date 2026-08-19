import type { JsonRecord } from './types';

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafePath(parts: string[]): boolean {
  return parts.length > 0 && parts.every(part => part && !FORBIDDEN_PATH_SEGMENTS.has(part));
}

export function splitPath(key: string): string[] {
  const text = String(key || '').trim();
  let parts: string[];
  if (text.startsWith('global.featureSwitches.query.')) {
    parts = ['global', 'featureSwitches', `query.${text.slice('global.featureSwitches.query.'.length)}`];
  } else if (text.startsWith('global.featureSwitches.builtin.')) {
    parts = ['global', 'featureSwitches', `builtin.${text.slice('global.featureSwitches.builtin.'.length)}`];
  } else if (text.startsWith('featureSwitches.query.')) {
    parts = ['featureSwitches', `query.${text.slice('featureSwitches.query.'.length)}`];
  } else if (text.startsWith('featureSwitches.builtin.')) {
    parts = ['featureSwitches', `builtin.${text.slice('featureSwitches.builtin.'.length)}`];
  } else {
    parts = text.split('.').map(item => item.trim()).filter(Boolean);
  }
  return isSafePath(parts) ? parts : [];
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
    if (!splitPath(key).length) continue;
    setByPath(next, key, parsePatchValue(value));
  }
  return next;
}
