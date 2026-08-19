import { normalizeGroupSettings } from './config';
import type { GroupGuardSettings } from './types';

export type ConfigValueSource = 'global' | 'group';
export type ConfigSourceMap = Record<string, ConfigValueSource>;

export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type GroupSettingsOverride = DeepPartial<GroupGuardSettings> & { useGlobal?: boolean };

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeKey(key: string): boolean {
  return Boolean(key) && !FORBIDDEN_PATH_SEGMENTS.has(key);
}

function safeClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => safeClone(item)) as T;
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isSafeKey(key) || child === undefined) continue;
    out[key] = safeClone(child);
  }
  return out as T;
}

/**
 * Deeply merge configuration objects while keeping arrays atomic.
 * Undefined means "inherit"; false/0/empty-string are real overrides.
 */
export function deepMergeConfig<T>(base: T, override: unknown): T {
  if (override === undefined) return safeClone(base);
  if (Array.isArray(override)) return safeClone(override) as T;
  if (!isPlainRecord(override)) return override as T;

  const baseRecord = isPlainRecord(base) ? base as Record<string, unknown> : {};
  const out: Record<string, unknown> = safeClone(baseRecord);
  for (const [key, value] of Object.entries(override)) {
    if (!isSafeKey(key) || value === undefined) continue;
    const baseValue = baseRecord[key];
    out[key] = isPlainRecord(value) && isPlainRecord(baseValue)
      ? deepMergeConfig(baseValue, value)
      : safeClone(value);
  }
  return out as T;
}

function projectNormalizedShape(source: unknown, normalized: unknown): unknown {
  if (Array.isArray(source)) return Array.isArray(normalized) ? safeClone(normalized) : safeClone(source);
  if (!isPlainRecord(source)) return normalized === undefined ? safeClone(source) : safeClone(normalized);

  const normalizedRecord = isPlainRecord(normalized) ? normalized : {};
  const out: Record<string, unknown> = {};
  for (const [key, sourceValue] of Object.entries(source)) {
    if (!isSafeKey(key) || sourceValue === undefined) continue;
    const normalizedValue = Object.prototype.hasOwnProperty.call(normalizedRecord, key)
      ? normalizedRecord[key]
      : sourceValue;
    out[key] = projectNormalizedShape(sourceValue, normalizedValue);
  }
  return out;
}

/**
 * Validate/coerce only fields that actually exist in a stored group overlay.
 * Unlike normalizeGroupSettings(), this function never fills omitted fields
 * with defaults, so omission remains a reliable "inherit global" signal.
 */
export function normalizeGroupOverride(input: unknown): GroupSettingsOverride {
  if (!isPlainRecord(input)) return {};
  const sanitized = safeClone(input) as GroupSettingsOverride;
  const normalizedFull = normalizeGroupSettings(sanitized as GroupGuardSettings);
  const projected = projectNormalizedShape(sanitized, normalizedFull);
  return isPlainRecord(projected) ? projected as GroupSettingsOverride : {};
}

/** Resolve the final settings used by runtime for one group. */
export function resolveEffectiveGroupSettings(
  globalSettings: GroupGuardSettings,
  groupSettings?: unknown
): GroupGuardSettings {
  const globalNormalized = normalizeGroupSettings(globalSettings || {} as GroupGuardSettings);
  if (!isPlainRecord(groupSettings)) return globalNormalized;

  const override = normalizeGroupOverride(groupSettings);
  if (override.useGlobal === true) {
    return normalizeGroupSettings({ ...globalNormalized, useGlobal: true });
  }

  const effective = deepMergeConfig(globalNormalized, override) as GroupGuardSettings;
  effective.useGlobal = false;
  return normalizeGroupSettings(effective);
}

function hasOwnPath(target: unknown, path: string[]): boolean {
  let current: unknown = target;
  for (const part of path) {
    if (!isPlainRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function collectLeafSources(
  value: unknown,
  groupOverride: GroupSettingsOverride,
  useGlobal: boolean,
  path: string[],
  out: ConfigSourceMap
): void {
  if (isPlainRecord(value)) {
    const entries = Object.entries(value).filter(([key]) => isSafeKey(key));
    if (!entries.length && path.length) {
      out[path.join('.')] = !useGlobal && hasOwnPath(groupOverride, path) ? 'group' : 'global';
      return;
    }
    for (const [key, child] of entries) collectLeafSources(child, groupOverride, useGlobal, [...path, key], out);
    return;
  }
  if (path.length) out[path.join('.')] = !useGlobal && hasOwnPath(groupOverride, path) ? 'group' : 'global';
}

export function getGroupConfigSourceMap(
  globalSettings: GroupGuardSettings,
  groupSettings?: unknown
): ConfigSourceMap {
  const override = normalizeGroupOverride(groupSettings);
  const useGlobal = override.useGlobal === true || !isPlainRecord(groupSettings);
  const effective = resolveEffectiveGroupSettings(globalSettings, groupSettings);
  const out: ConfigSourceMap = {};
  collectLeafSources(effective, override, useGlobal, [], out);
  return out;
}

export function setGroupOverridePath(
  groupSettings: unknown,
  dottedPath: string,
  value: unknown
): GroupSettingsOverride {
  const parts = String(dottedPath || '').split('.').map(part => part.trim()).filter(Boolean);
  if (!parts.length || parts.some(part => !isSafeKey(part))) throw new Error('invalid_group_config_path');

  const next = safeClone(normalizeGroupOverride(groupSettings)) as Record<string, unknown>;
  let current = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!isPlainRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = safeClone(value);
  return normalizeGroupOverride(next);
}

export function deleteGroupOverridePath(groupSettings: unknown, dottedPath: string): GroupSettingsOverride {
  const parts = String(dottedPath || '').split('.').map(part => part.trim()).filter(Boolean);
  if (!parts.length || parts.some(part => !isSafeKey(part))) throw new Error('invalid_group_config_path');

  const next = safeClone(normalizeGroupOverride(groupSettings)) as Record<string, unknown>;
  const parents: Array<{ object: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> | null = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current || !isPlainRecord(current[part])) return normalizeGroupOverride(next);
    parents.push({ object: current, key: part });
    current = current[part] as Record<string, unknown>;
  }
  if (!current) return normalizeGroupOverride(next);
  delete current[parts[parts.length - 1]];

  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const { object, key } = parents[index];
    const child = object[key];
    if (isPlainRecord(child) && Object.keys(child).length === 0) delete object[key];
    else break;
  }
  return normalizeGroupOverride(next);
}
