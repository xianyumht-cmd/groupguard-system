import type { TargetFilePushConfig } from './target_file_push_config';

export async function callTargetFilePushInterface(options: {
  config: TargetFilePushConfig;
  apiToken: string;
  pathname: string;
  method?: string;
  body?: unknown;
}): Promise<Record<string, any>> {
  if (!options.config.apiBaseUrl) throw new Error('接口端地址未配置');
  if (!options.apiToken) throw new Error('接口写入 Token 未配置');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${options.config.apiBaseUrl}${options.pathname}`, {
      method: options.method || 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-groupguard-token': options.apiToken,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data: Record<string, any> = {};
    try { data = JSON.parse(text) as Record<string, any>; } catch { data = { detail: text.slice(0, 300) }; }
    if (!response.ok) throw new Error(String(data.detail || data.error || `接口端 HTTP ${response.status}`));
    return data;
  } finally {
    clearTimeout(timer);
  }
}
