const SENSITIVE_QUERY_KEY = /^(?:access[_-]?token|token|authorization|auth|api[_-]?key|key|password|passwd|secret)$/i;

export function redactWebSocketUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return redactSensitiveText(raw);
    }
    parsed.username = '';
    parsed.password = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.set(key, '***');
    }
    if (parsed.hash) parsed.hash = '#***';
    return parsed.toString();
  } catch {
    return redactSensitiveText(raw);
  }
}

export function redactSensitiveText(value: unknown): string {
  return String(value || '')
    .replace(/wss?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        for (const key of Array.from(parsed.searchParams.keys())) {
          if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.set(key, '***');
        }
        if (parsed.hash) parsed.hash = '#***';
        return parsed.toString();
      } catch {
        return 'ws://***';
      }
    })
    .replace(
      /((?:access[_-]?token|token|authorization|auth|api[_-]?key|key|password|passwd|secret)\s*[=:]\s*)[^&\s,;]+/gi,
      '$1***'
    );
}
