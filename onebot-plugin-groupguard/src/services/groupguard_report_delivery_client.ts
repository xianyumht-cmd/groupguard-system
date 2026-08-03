import {
  parseGroupGuardQueryDelivery,
  toOneBotDeliveryPlan,
  isIntranetHostname,
  type GroupGuardQueryDeliveryEnvelope,
  type OneBotDeliveryPlan
} from './groupguard_query_delivery_client';

export const GROUPGUARD_REPORT_DELIVERY_PATH = '/api/v1/groupguard/report' as const;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

export interface GroupGuardReportRequest {
  feature: 'scammer_report' | 'peer_report';
  parameters: Record<string, string>;
  preferred?: 'auto' | 'text' | 'image' | 'forward';
  capabilities?: {
    text?: boolean;
    image?: boolean;
    forward?: boolean;
  };
  request_id: string;
  client?: string;
}

export interface GroupGuardReportDeliveryResult {
  envelope: GroupGuardQueryDeliveryEnvelope;
  plan: OneBotDeliveryPlan;
}

export function resolveGroupGuardReportEndpoint(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl || '').trim());
  } catch {
    throw new Error('lol_api_base_url_invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('lol_api_base_protocol_invalid');
  if (parsed.username || parsed.password) throw new Error('lol_api_base_credentials_forbidden');
  if (parsed.search || parsed.hash) throw new Error('lol_api_base_query_forbidden');
  if (parsed.pathname && parsed.pathname !== '/') throw new Error('lol_api_base_path_forbidden');
  if (!isIntranetHostname(parsed.hostname)) throw new Error('lol_api_base_must_be_intranet');
  return `${parsed.origin}${GROUPGUARD_REPORT_DELIVERY_PATH}`;
}

export async function requestGroupGuardReportDelivery(
  baseUrl: string,
  payload: GroupGuardReportRequest,
  options: {
    timeoutMs?: number;
    fetchFn?: typeof fetch;
    maxResponseChars?: number;
    writeToken?: string;
  } = {}
): Promise<GroupGuardQueryDeliveryEnvelope> {
  const endpoint = resolveGroupGuardReportEndpoint(baseUrl);
  const writeToken = String(options.writeToken || '').trim();
  if (!writeToken) throw new Error('delivery_write_token_required');
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = Math.max(1_000, Math.min(Number(options.timeoutMs || 20_000), 120_000));
  const maxResponseChars = Math.max(1_024, Math.min(Number(options.maxResponseChars || MAX_RESPONSE_CHARS), MAX_RESPONSE_CHARS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-groupguard-token': writeToken
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseChars) {
      await response.body?.cancel();
      throw new Error('delivery_response_too_large');
    }
    const text = await response.text();
    if (text.length > maxResponseChars) throw new Error('delivery_response_too_large');
    if (response.status === 401 || response.status === 403) {
      throw new Error(`delivery_auth_failed_http_${response.status}`);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(`delivery_response_invalid_json_http_${response.status}`);
    }
    const envelope = parseGroupGuardQueryDelivery(decoded);
    if (!response.ok && envelope.ok) throw new Error(`delivery_http_status_conflict_${response.status}`);
    return envelope;
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'AbortError') throw new Error('delivery_request_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestAndPlanGroupGuardReport(
  baseUrl: string,
  payload: GroupGuardReportRequest,
  options: Parameters<typeof requestGroupGuardReportDelivery>[2] = {}
): Promise<GroupGuardReportDeliveryResult> {
  const envelope = await requestGroupGuardReportDelivery(baseUrl, payload, options);
  return { envelope, plan: toOneBotDeliveryPlan(envelope) };
}
