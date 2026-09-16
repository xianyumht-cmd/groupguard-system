import { normalizeGroupSettings } from './config';
import type { GroupGuardSettings, GroupSettingsOverride } from './types';
export type { GroupSettingsOverride } from './types';

export type ConfigValueSource = 'global' | 'group';
export type ConfigSourceMap = Record<string, ConfigValueSource>;

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeKey(key: string): boolean {
  return Boolean(key) && !FORBIDDEN_PATH_SEGMENTS.has(key);
}

function splitGroupOverridePath(dottedPath: string): string[] {
  const text = String(dottedPath || '').trim();
  let parts: string[];
  // featureSwitches is a Record whose business keys intentionally contain a
  // dot (for example "query.lol_ban"). Keep those keys atomic, matching the
  // existing config form/object-patch contract, instead of creating a nested
  // { query: { lol_ban: ... } } object that runtime would not read.
  if (text.startsWith('featureSwitches.query.')) {
    parts = ['featureSwitches', `query.${text.slice('featureSwitches.query.'.length)}`];
  } else if (text.startsWith('featureSwitches.builtin.')) {
    parts = ['featureSwitches', `builtin.${text.slice('featureSwitches.builtin.'.length)}`];
  } else {
    parts = text.split('.').map(part => part.trim()).filter(Boolean);
  }
  if (!parts.length || parts.some(part => !isSafeKey(part))) return [];
  return parts;
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

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).filter(isSafeKey).sort();
  const rightKeys = Object.keys(right).filter(isSafeKey).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
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

/**
 * A missing group row inherits globally. An existing historical row without an
 * explicit useGlobal flag keeps the legacy behavior: it is an active group
 * overlay. Only an explicit true means whole-group global inheritance.
 */
export function isGroupFullyInherited(groupSettings?: unknown): boolean {
  if (!isPlainRecord(groupSettings)) return true;
  return normalizeGroupOverride(groupSettings).useGlobal === true;
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
  const useGlobal = isGroupFullyInherited(groupSettings);
  const effective = resolveEffectiveGroupSettings(globalSettings, groupSettings);
  const out: ConfigSourceMap = {};
  collectLeafSources(effective, override, useGlobal, [], out);
  return out;
}

/**
 * Old group rows may already be full snapshots. Keep their explicit paths.
 * For paths newly introduced by a broad WebUI form submit, remove values that
 * merely repeat the global value so new/edited rows remain sparse.
 */
export function compactNewInheritedValues(
  globalSettings: GroupGuardSettings,
  previousGroupSettings: unknown,
  candidateGroupSettings: unknown
): GroupSettingsOverride {
  const global = normalizeGroupSettings(globalSettings || {} as GroupGuardSettings) as unknown as Record<string, unknown>;
  const previous = normalizeGroupOverride(previousGroupSettings) as Record<string, unknown>;
  const candidate = normalizeGroupOverride(candidateGroupSettings) as Record<string, unknown>;

  const compact = (globalNode: unknown, previousNode: unknown, candidateNode: unknown, root = false): unknown => {
    if (!isPlainRecord(candidateNode)) return safeClone(candidateNode);
    const globalRecord = isPlainRecord(globalNode) ? globalNode : {};
    const previousRecord = isPlainRecord(previousNode) ? previousNode : {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(candidateNode)) {
      if (!isSafeKey(key) || value === undefined) continue;
      if (root && key === 'useGlobal') {
        out[key] = safeClone(value);
        continue;
      }
      const existedBefore = Object.prototype.hasOwnProperty.call(previousRecord, key);
      const globalValue = globalRecord[key];
      if (isPlainRecord(value)) {
        const nested = compact(globalValue, previousRecord[key], value, false);
        if (isPlainRecord(nested) && Object.keys(nested).length === 0 && !existedBefore) continue;
        out[key] = nested;
        continue;
      }
      if (!existedBefore && deepEqual(value, globalValue)) continue;
      out[key] = safeClone(value);
    }
    return out;
  };

  return normalizeGroupOverride(compact(global, previous, candidate, true));
}

export function setGroupOverridePath(
  groupSettings: unknown,
  dottedPath: string,
  value: unknown
): GroupSettingsOverride {
  const parts = splitGroupOverridePath(dottedPath);
  if (!parts.length) throw new Error('invalid_group_config_path');

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
  const parts = splitGroupOverridePath(dottedPath);
  if (!parts.length) throw new Error('invalid_group_config_path');

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
