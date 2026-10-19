/**
 * Offline English notices for translation failures.
 *
 * Never include the source text or the provider's raw error in this output:
 * either may contain credentials, CQ payloads, or private Q&A content.
 * Business categories are inferred conservatively from recognizable error
 * notices, not from arbitrary response content.
 */
export type TranslationFailureCode =
  | 'TRANSLATION_DISABLED'
  | 'TRANSLATION_TIMEOUT'
  | 'TRANSLATION_AUTH_FAILED'
  | 'TRANSLATION_RATE_LIMITED'
  | 'TRANSLATION_BAD_RESPONSE'
  | 'TRANSLATION_PROVIDER_UNAVAILABLE';

interface BusinessFailure {
  code: string;
  notice: string;
}

// Do not use broad substring searches against arbitrary Q&A or result bodies.
// Only short, clearly error-shaped texts are eligible for business classification.
const BUSINESS_FAILURES: ReadonlyArray<{ code: string; notice: string; pattern: RegExp }> = [
  {
    code: 'QUERY_BACKEND_UNAVAILABLE',
    notice: 'The internal query service is temporarily unavailable.',
    pattern: /^内网查询服务暂时不可用[，,。\s]|^内网查询服务暂时不可用$/i
  },
  {
    code: 'QUERY_CONFIG_MISSING',
    notice: 'The internal query service address is not configured.',
    pattern: /^未配置\s+LOL\s+API\s+Base\b/i
  },
  {
    code: 'QUERY_INPUT_REQUIRED',
    notice: 'This command requires a valid query argument.',
    pattern: /^(?:请输入[：:]\s*(?:查合集|海符榜)|请指定要查询的QQ号)/i
  },
  {
    code: 'QUERY_GROUP_ONLY',
    notice: 'This command can only be used in a group.',
    pattern: /^(?:查合集|海符榜|查封号)仅支持群聊使用/i
  },
  {
    code: 'QUERY_AUTH_EXPIRED',
    notice: 'The data provider session has expired or authentication failed.',
    pattern: /^(?:(?:查询|战绩|隐藏|封号|接口|上游|SO1|服务).{0,45})?(?:登录(?:态)?(?:失效|过期)|未登录|鉴权失败|认证失败|授权(?:失效|过期)|(?:SO1_AUTH_EXPIRED|AUTH_EXPIRED|SESSION_EXPIRED|UNAUTHORIZED))/i
  },
  {
    code: 'QUERY_RATE_LIMITED',
    notice: 'The query is being rate-limited. Please retry later.',
    pattern: /^(?:查询|请求|接口|上游|服务|查战绩|查封号|查合集|海符榜).{0,60}(?:限流|过于频繁|次数(?:已用完|超限|不足)|频率限制|429\b)|^(?:限流|请求过于频繁|QUERY_RATE_LIMITED|RATE_LIMITED)/i
  },
  {
    code: 'QUERY_TIMEOUT',
    notice: 'The query timed out before a result was available.',
    pattern: /^(?:(?:查询|请求|接口|上游|服务|服务器|战绩|合集|海符榜|查战绩|查封号|查合集).{0,80})?(?:连接超时|请求超时|响应超时|读取超时|查询超时|超时|UPSTREAM_TIMEOUT|QUERY_TIMEOUT|READ_TIMEOUT|CONNECT_TIMEOUT)/i
  },
  {
    code: 'QUERY_NETWORK_ERROR',
    notice: 'The query service could not connect to its upstream provider.',
    pattern: /^(?:(?:查询|请求|接口|上游|服务|服务器|战绩|合集|海符榜).{0,80})?(?:连接失败|网络异常|网络错误|无法连接|连接被拒绝|DNS(?:解析)?失败|connection_error|ECONNREFUSED|ENOTFOUND|QUERY_NETWORK_ERROR)/i
  },
  {
    code: 'QUERY_BAD_RESPONSE',
    notice: 'The upstream provider returned an invalid or unsupported response.',
    pattern: /^(?:(?:查询|请求|接口|上游|服务|服务器|战绩|合集|海符榜).{0,80})?(?:解析失败|返回格式错误|数据格式错误|JSON解析失败|无效响应|QUERY_BAD_RESPONSE|schema_invalid|parse_error)/i
  },
  {
    code: 'QUERY_NOT_FOUND',
    notice: 'No matching record was found for this query.',
    pattern: /^(?:(?:查询|战绩|玩家|召唤师|英雄|封号|合集|海符榜).{0,45})?(?:未找到(?:相关|匹配)?(?:玩家|记录|数据|结果|英雄|信息)|没有找到(?:玩家|记录|数据|结果)|暂无(?:相关)?(?:数据|记录|结果)|QUERY_NOT_FOUND)/i
  },
  {
    code: 'QUERY_UPSTREAM_UNAVAILABLE',
    notice: 'The query provider is temporarily unavailable or busy.',
    pattern: /^(?:(?:查询|请求|接口|上游|服务|服务器|战绩|合集|海符榜).{0,80})?(?:服务器繁忙|接口繁忙|服务繁忙|上游不可用|服务暂不可用|接口不可用|(?:HTTP\s*)?50[0234]\b|UPSTREAM_UNAVAILABLE|QUERY_UPSTREAM_UNAVAILABLE)/i
  },
  {
    code: 'QUERY_FAILED',
    notice: 'The query could not be completed.',
    pattern: /^(?:查战绩|查封号|查合集|海符榜|查询|接口请求|上游请求|数据查询).{0,60}(?:失败|异常|出错|错误)[。！!]?$/i
  }
];

export function classifyTranslationFailure(error: unknown): TranslationFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message === 'translation_endpoint_disabled') return 'TRANSLATION_DISABLED';
  if (/\b(?:401|403)\b|unauthorized|forbidden|invalid[_ -]?api[_ -]?key/i.test(message)) {
    return 'TRANSLATION_AUTH_FAILED';
  }
  if (/\b429\b|rate[_ -]?limit|quota/i.test(message)) return 'TRANSLATION_RATE_LIMITED';
  if (/abort|timeout|timed out|ETIMEDOUT/i.test(message)) return 'TRANSLATION_TIMEOUT';
  if (/empty_translation|invalid[_ -]?json|unexpected token|JSON|mymemory_text_too_long/i.test(message)) {
    return 'TRANSLATION_BAD_RESPONSE';
  }
  return 'TRANSLATION_PROVIDER_UNAVAILABLE';
}

export function classifyBusinessFailure(text: string): BusinessFailure | null {
  const value = text.trim();
  if (!value || value.length > 200 || value.includes('\n')) return null;
  for (const rule of BUSINESS_FAILURES) {
    if (rule.pattern.test(value)) return { code: rule.code, notice: rule.notice };
  }
  return null;
}

export function englishTranslationFailureNotice(sourceText: string, error: unknown): string {
  const translationCode = classifyTranslationFailure(error);
  const businessFailure = classifyBusinessFailure(sourceText);
  if (businessFailure) {
    return `${businessFailure.notice} [${businessFailure.code}; ${translationCode}]`;
  }
  // A successful reply can also fail translation. Never label it a query failure.
  return `The original reply could not be translated into English; the query may have succeeded. [${translationCode}]`;
}

const lastLogAt = new Map<TranslationFailureCode, number>();
const LOG_THROTTLE_MS = 60_000;

export function recordTranslationFailure(error: unknown): void {
  const code = classifyTranslationFailure(error);
  const now = Date.now();
  if (now - (lastLogAt.get(code) ?? 0) < LOG_THROTTLE_MS) return;
  lastLogAt.set(code, now);
  // No raw text, response body, endpoint, headers, or provider error details.
  console.warn(`[GroupGuard] output_translation_fallback code=${code} locale=en`);
}
