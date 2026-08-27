import type { OutputLocale, OutputTranslationFn } from './output_locale_service';

const DEFAULT_LIBRE_ENDPOINT = 'https://libretranslate.com/translate';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

type TargetLocale = Exclude<OutputLocale, 'zh-CN'>;

export interface OutputTranslationPolicy {
  mode: 'disabled' | 'public-default' | 'custom';
  endpoint: string;
  allowPublicFallback: boolean;
}

function envFlag(name: string): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function resolveOutputTranslationPolicy(env: NodeJS.ProcessEnv = process.env): OutputTranslationPolicy {
  const hasExplicitEndpoint = Object.prototype.hasOwnProperty.call(env, 'GROUPGUARD_TRANSLATE_ENDPOINT');
  const configured = String(env.GROUPGUARD_TRANSLATE_ENDPOINT ?? '').trim();
  if (hasExplicitEndpoint && (!configured || configured.toLowerCase() === 'off')) {
    return { mode: 'disabled', endpoint: '', allowPublicFallback: false };
  }
  if (hasExplicitEndpoint) {
    return {
      mode: 'custom',
      endpoint: configured,
      allowPublicFallback: ['1', 'true', 'yes', 'on'].includes(String(env.GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK || '').trim().toLowerCase())
    };
  }
  return { mode: 'public-default', endpoint: DEFAULT_LIBRE_ENDPOINT, allowPublicFallback: true };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function translateViaEndpoint(text: string, locale: TargetLocale, endpoint: string): Promise<string> {
  const body: Record<string, string> = {
    q: text,
    source: 'zh',
    target: locale === 'zh-TW' ? 'zt' : 'en',
    format: 'text'
  };
  const apiKey = String(process.env.GROUPGUARD_TRANSLATE_API_KEY || '').trim();
  if (apiKey) body.api_key = apiKey;
  const data = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  }, 3500);
  const translated = String(data?.translatedText || '').trim();
  if (!translated) throw new Error('empty_translation');
  return translated;
}

async function translateViaMyMemory(text: string, locale: TargetLocale): Promise<string> {
  if (Buffer.byteLength(text, 'utf8') > 450) throw new Error('mymemory_text_too_long');
  const target = locale === 'zh-TW' ? 'zh-TW' : 'en';
  const url = new URL(MYMEMORY_ENDPOINT);
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `zh-CN|${target}`);
  url.searchParams.set('mt', '1');
  const data = await fetchJson(url.toString(), { method: 'GET', headers: { accept: 'application/json' } }, 2500);
  const translated = String(data?.responseData?.translatedText || '').trim();
  if (!translated || translated.toLowerCase().includes('no query specified')) throw new Error('empty_translation');
  return translated;
}

export const secureOutputTranslator: OutputTranslationFn = async (text, locale) => {
  const policy = resolveOutputTranslationPolicy();
  if (policy.mode === 'disabled') throw new Error('translation_endpoint_disabled');

  let firstError: unknown;
  try {
    return await translateViaEndpoint(text, locale, policy.endpoint);
  } catch (error) {
    firstError = error;
  }

  if (!policy.allowPublicFallback || policy.mode === 'custom') {
    throw firstError instanceof Error ? firstError : new Error('translation_unavailable');
  }

  try {
    return await translateViaMyMemory(text, locale);
  } catch (error) {
    throw error instanceof Error ? error : new Error('translation_unavailable');
  }
};

export function isPublicTranslationFallbackEnabled(): boolean {
  return resolveOutputTranslationPolicy().allowPublicFallback;
}
