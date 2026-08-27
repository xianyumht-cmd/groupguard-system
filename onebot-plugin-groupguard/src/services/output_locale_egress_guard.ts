import {
  localizeOneBotSendParams,
  normalizeOutputLocale,
  type OutputTranslationFn,
} from './output_locale_service';

const PROTECTED_TEXT_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\[CQ:[^\]]+\]/g,
  /https?:\/\/[^\s<>"'`]+/gi,
  /www\.[^\s<>"'`]+/gi,
  /\{[A-Za-z0-9_.-]+\}/g,
  /\b[A-Za-z]:\\[^\s\r\n]+/g,
  /(?:^|\s)\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g,
];

const TRADITIONAL_EGRESS_FIXUPS: Array<[string, string]> = [
  ['然后', '然後'],
  ['之后', '之後'],
  ['以后', '以後'],
  ['后来', '後來'],
  ['后续', '後續'],
  ['随后', '隨後'],
  ['后開啟', '後開啟'],
];

interface ProtectedEnvelope {
  params: unknown;
  restore: (params: unknown) => unknown;
}

function protectString(value: string, bucket: string[]): string {
  let result = value;
  for (const pattern of PROTECTED_TEXT_PATTERNS) {
    result = result.replace(pattern, (matched) => {
      const index = bucket.push(matched) - 1;
      return `__GGSAFE${index}__`;
    });
  }
  return result;
}

function restoreString(value: string, bucket: string[]): string {
  return bucket.reduce((result, original, index) => result.split(`__GGSAFE${index}__`).join(original), value);
}

function applyTraditionalEgressFixups(value: string): string {
  let result = value;
  for (const [from, to] of TRADITIONAL_EGRESS_FIXUPS) result = result.split(from).join(to);
  return result;
}

function cloneAndTransformText(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value);
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const cloned: Record<string, any> = { ...(entry as Record<string, any>) };
    const data = cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)
      ? { ...cloned.data }
      : cloned.data;
    cloned.data = data;
    if (cloned.type === 'text' && data && typeof data.text === 'string') {
      data.text = transform(data.text);
    }
    return cloned;
  });
}

function cloneAndTransformForward(value: unknown, transform: (text: string) => string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const cloned: Record<string, any> = { ...(node as Record<string, any>) };
    const data = cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)
      ? { ...cloned.data }
      : cloned.data;
    cloned.data = data;
    if (data && Object.prototype.hasOwnProperty.call(data, 'content')) {
      data.content = cloneAndTransformText(data.content, transform);
    }
    return cloned;
  });
}

function transformOneBotTextParams(action: string, paramsInput: unknown, transform: (text: string) => string): unknown {
  if (!paramsInput || typeof paramsInput !== 'object' || Array.isArray(paramsInput)) return paramsInput;
  const params: Record<string, any> = { ...(paramsInput as Record<string, any>) };
  const normalizedAction = String(action || '').toLowerCase();
  if (normalizedAction === 'send_group_forward_msg' || normalizedAction === 'send_private_forward_msg') {
    params.messages = cloneAndTransformForward(params.messages, transform);
    return params;
  }
  if (normalizedAction === 'send_group_msg' || normalizedAction === 'send_private_msg' || normalizedAction === 'send_msg') {
    params.message = cloneAndTransformText(params.message, transform);
  }
  return params;
}

function protectTraditionalParams(action: string, params: unknown): ProtectedEnvelope {
  const bucket: string[] = [];
  const protectedParams = transformOneBotTextParams(action, params, (text) => protectString(text, bucket));
  return {
    params: protectedParams,
    restore: (value: unknown) => transformOneBotTextParams(action, value, (text) => restoreString(text, bucket)),
  };
}

export async function localizeOneBotSendParamsSafe(
  action: string,
  params: unknown,
  localeInput: unknown,
  translator?: OutputTranslationFn,
): Promise<unknown> {
  const locale = normalizeOutputLocale(localeInput);
  if (locale !== 'zh-TW') {
    return translator
      ? localizeOneBotSendParams(action, params, locale, translator)
      : localizeOneBotSendParams(action, params, locale);
  }

  // Traditional Chinese uses a local fast conversion path in output_locale_service.
  // Protect machine-sensitive spans before that fast path so URLs, CQ codes, paths,
  // placeholders and code stay byte-for-byte identical to their source values.
  const envelope = protectTraditionalParams(action, params);
  const localized = translator
    ? await localizeOneBotSendParams(action, envelope.params, locale, translator)
    : await localizeOneBotSendParams(action, envelope.params, locale);
  const fixed = transformOneBotTextParams(action, localized, applyTraditionalEgressFixups);
  return envelope.restore(fixed);
}
