import type { DynamicCommandDefinition } from './types';

const BLOCKED_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function tokenizeArgument(rawArgument: string): string[] {
  return rawArgument.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function resolveParameterReference(reference: string, values: Record<string, string>): string {
  const match = reference.match(/^\$([a-zA-Z_]\w*|\d+)$/);
  if (!match) return '';
  return values[match[1]] ?? '';
}

export function buildDynamicCommandParameters(command: DynamicCommandDefinition, rawArgument: string): Record<string, string> {
  const values: Record<string, string> = {
    raw: rawArgument
  };
  const tokens = tokenizeArgument(rawArgument);
  for (let index = 0; index < tokens.length; index++) {
    values[String(index + 1)] = tokens[index];
  }
  for (const [name, source] of Object.entries(command.parameters || {})) {
    values[name] = resolveParameterReference(source, values);
  }
  return values;
}

export function replaceDynamicCommandTokens(template: string, parameters: Record<string, string>): string {
  return template.replace(/\$([a-zA-Z_]\w*|\d+)\b/g, (_, key: string) => parameters[key] ?? '');
}

type PathSegment =
  | { type: 'property'; value: string; }
  | { type: 'index'; value: number; };

function parseDotPath(dotPath: string): PathSegment[] | null {
  const trimmed = dotPath.trim();
  if (!trimmed) return [];
  const segments: PathSegment[] = [];
  let current = '';
  let i = 0;
  while (i < trimmed.length) {
    const char = trimmed[i];
    if (char === '.') {
      if (current) {
        if (BLOCKED_PATH_KEYS.has(current)) return null;
        segments.push({ type: 'property', value: current });
        current = '';
      }
      i++;
      continue;
    }
    if (char === '[') {
      if (current) {
        if (BLOCKED_PATH_KEYS.has(current)) return null;
        segments.push({ type: 'property', value: current });
        current = '';
      }
      const closingIndex = trimmed.indexOf(']', i + 1);
      if (closingIndex === -1) return null;
      const rawIndex = trimmed.slice(i + 1, closingIndex).trim();
      if (!/^\d+$/.test(rawIndex)) return null;
      segments.push({ type: 'index', value: Number(rawIndex) });
      i = closingIndex + 1;
      continue;
    }
    current += char;
    i++;
  }
  if (current) {
    if (BLOCKED_PATH_KEYS.has(current)) return null;
    segments.push({ type: 'property', value: current });
  }
  return segments;
}

export function safeExtractByDotPath(input: unknown, dotPath: string | undefined): unknown {
  if (!dotPath) return input;
  const segments = parseDotPath(dotPath);
  if (!segments) return undefined;
  let current: unknown = input;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (segment.type === 'index') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.value];
      continue;
    }
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment.value)) return undefined;
    current = (current as Record<string, unknown>)[segment.value];
  }
  return current;
}
