import { createHash } from 'node:crypto';

export const GROUPGUARD_QUERY_DELIVERY_PROTOCOL = 'groupguard-query-delivery.v1' as const;
export const GROUPGUARD_QUERY_DELIVERY_PATH = '/api/v1/groupguard/query' as const;

const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DELIVERY_KEYS = new Set([
  'protocol',
  'ok',
  'feature',
  'request_id',
  'client_request_id',
  'delivery',
  'error',
  'retry',
  'meta'
]);

export type GroupGuardQueryFeature =
  | 'shard'
  | 'aram'
  | 'lolban'
  | 'battle'
  | 'video'
  | 'scammer'
  | 'peer'
  | 'dynamic';

export interface GroupGuardQueryRequest {
  feature: GroupGuardQueryFeature;
  parameters: Record<string, string>;
  preferred?: 'auto' | 'text' | 'image' | 'forward';
  capabilities?: {
    text?: boolean;
    image?: boolean;
    forward?: boolean;
  };
  request_id?: string;
  client?: string;
}

export interface DeliveryTextSegment {
  type: 'text';
  text: string;
}

export interface DeliveryImageSegment {
  type: 'image';
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp';
  encoding: 'base64';
  data: string;
  filename: string;
  bytes: number;
  sha256: string;
}

export interface DeliveryForwardNode {
  segments: Array<DeliveryTextSegment | DeliveryImageSegment>;
}

export interface DeliveryForwardSegment {
  type: 'forward';
  nodes: DeliveryForwardNode[];
}

export type DeliverySegment = DeliveryTextSegment | DeliveryImageSegment | DeliveryForwardSegment;

export interface GroupGuardQueryDeliveryEnvelope {
  protocol: typeof GROUPGUARD_QUERY_DELIVERY_PROTOCOL;
  ok: boolean;
  feature: string;
  request_id: string;
  client_request_id: string;
  delivery: {
    kind: 'segments' | 'forward';
    segments: DeliverySegment[];
  };
  error: null | {
    code: string;
    user_message: string;
    retryable: boolean;
  };
  retry: {
    allowed: boolean;
    after_seconds: number;
  };
  meta: Record<string, unknown>;
}

export type OneBotDeliveryPlan =
  | {
      kind: 'segments';
      segments: Array<
        | { type: 'text'; data: { text: string } }
        | { type: 'image'; data: { file: string } }
      >;
    }
  | {
      kind: 'forward';
      nodes: Array<{
        segments: Array<
          | { type: 'text'; data: { text: string } }
          | { type: 'image'; data: { file: string } }
        >;
      }>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: Set<string>, label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${label}_fields_changed`);
  }
}

function requiredString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label}_must_be_string`);
  if ((!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`${label}_length_invalid`);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}_must_be_boolean`);
  return value;
}

function requiredInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}_invalid`);
  }
  return Number(value);
}

function decodeAndVerifyImage(segment: Record<string, unknown>): DeliveryImageSegment {
  assertExactKeys(
    segment,
    new Set(['type', 'mime_type', 'encoding', 'data', 'filename', 'bytes', 'sha256']),
    'image_segment'
  );
  if (segment.type !== 'image') throw new Error('image_segment_type_invalid');
  if (segment.encoding !== 'base64') throw new Error('image_segment_encoding_invalid');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(segment.mime_type || ''))) {
    throw new Error('image_segment_mime_invalid');
  }
  const data = requiredString(segment.data, 'image_segment_data', MAX_RESPONSE_CHARS);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error('image_segment_base64_invalid');
  }
  const raw = Buffer.from(data, 'base64');
  if (raw.length === 0 || raw.length > MAX_IMAGE_BYTES) {
    throw new Error('image_segment_size_invalid');
  }
  const canonical = raw.toString('base64').replace(/=+$/g, '');
  if (canonical !== data.replace(/=+$/g, '')) {
    throw new Error('image_segment_base64_noncanonical');
  }
  const declaredBytes = requiredInteger(segment.bytes, 'image_segment_bytes', 1, MAX_IMAGE_BYTES);
  if (declaredBytes !== raw.length) throw new Error('image_segment_byte_count_mismatch');
  const declaredSha = requiredString(segment.sha256, 'image_segment_sha256', 64);
  if (!/^[a-f0-9]{64}$/.test(declaredSha)) throw new Error('image_segment_sha256_invalid');
  const actualSha = createHash('sha256').update(raw).digest('hex');
  if (actualSha !== declaredSha) throw new Error('image_segment_sha256_mismatch');
  return {
    type: 'image',
    mime_type: segment.mime_type as DeliveryImageSegment['mime_type'],
    encoding: 'base64',
    data,
    filename: requiredString(segment.filename, 'image_segment_filename', 128),
    bytes: declaredBytes,
    sha256: declaredSha
  };
}

function parseTextSegment(segment: Record<string, unknown>): DeliveryTextSegment {
  assertExactKeys(segment, new Set(['type', 'text']), 'text_segment');
  if (segment.type !== 'text') throw new Error('text_segment_type_invalid');
  return {
    type: 'text',
    text: requiredString(segment.text, 'text_segment_text', 20_000, true)
  };
}

function parseForwardSegment(segment: Record<string, unknown>): DeliveryForwardSegment {
  assertExactKeys(segment, new Set(['type', 'nodes']), 'forward_segment');
  if (segment.type !== 'forward') throw new Error('forward_segment_type_invalid');
  if (!Array.isArray(segment.nodes) || segment.nodes.length === 0 || segment.nodes.length > 32) {
    throw new Error('forward_nodes_invalid');
  }
  const nodes = segment.nodes.map((node, index) => {
    if (!isRecord(node)) throw new Error(`forward_node_${index}_invalid`);
    assertExactKeys(node, new Set(['segments']), `forward_node_${index}`);
    if (!Array.isArray(node.segments) || node.segments.length === 0 || node.segments.length > 32) {
      throw new Error(`forward_node_${index}_segments_invalid`);
    }
    return {
      segments: node.segments.map((item, segmentIndex) => {
        if (!isRecord(item)) throw new Error(`forward_node_${index}_segment_${segmentIndex}_invalid`);
        if (item.type === 'text') return parseTextSegment(item);
        if (item.type === 'image') return decodeAndVerifyImage(item);
        throw new Error(`forward_node_${index}_segment_${segmentIndex}_type_invalid`);
      })
    };
  });
  return { type: 'forward', nodes };
}

function parseDeliverySegment(value: unknown, index: number): DeliverySegment {
  if (!isRecord(value)) throw new Error(`delivery_segment_${index}_invalid`);
  if (value.type === 'text') return parseTextSegment(value);
  if (value.type === 'image') return decodeAndVerifyImage(value);
  if (value.type === 'forward') return parseForwardSegment(value);
  throw new Error(`delivery_segment_${index}_type_invalid`);
}

export function parseGroupGuardQueryDelivery(value: unknown): GroupGuardQueryDeliveryEnvelope {
  if (!isRecord(value)) throw new Error('delivery_envelope_invalid');
  assertExactKeys(value, DELIVERY_KEYS, 'delivery_envelope');
  if (value.protocol !== GROUPGUARD_QUERY_DELIVERY_PROTOCOL) throw new Error('delivery_protocol_unsupported');
  const ok = requiredBoolean(value.ok, 'delivery_ok');
  const feature = requiredString(value.feature, 'delivery_feature', 96);
  const requestId = requiredString(value.request_id, 'delivery_request_id', 128);
  const clientRequestId = requiredString(value.client_request_id, 'delivery_client_request_id', 128, true);
  if (!isRecord(value.delivery)) throw new Error('delivery_payload_invalid');
  assertExactKeys(value.delivery, new Set(['kind', 'segments']), 'delivery_payload');
  if (value.delivery.kind !== 'segments' && value.delivery.kind !== 'forward') {
    throw new Error('delivery_kind_invalid');
  }
  if (!Array.isArray(value.delivery.segments) || value.delivery.segments.length === 0 || value.delivery.segments.length > 64) {
    throw new Error('delivery_segments_invalid');
  }
  const segments = value.delivery.segments.map(parseDeliverySegment);
  if (value.delivery.kind === 'forward' && (segments.length !== 1 || segments[0].type !== 'forward')) {
    throw new Error('delivery_forward_shape_invalid');
  }
  if (value.delivery.kind === 'segments' && segments.some((segment) => segment.type === 'forward')) {
    throw new Error('delivery_segments_shape_invalid');
  }
  if (!isRecord(value.retry)) throw new Error('delivery_retry_invalid');
  assertExactKeys(value.retry, new Set(['allowed', 'after_seconds']), 'delivery_retry');
  const retry = {
    allowed: requiredBoolean(value.retry.allowed, 'delivery_retry_allowed'),
    after_seconds: requiredInteger(value.retry.after_seconds, 'delivery_retry_after_seconds', 0, 86_400)
  };
  let error: GroupGuardQueryDeliveryEnvelope['error'] = null;
  if (value.error !== null) {
    if (!isRecord(value.error)) throw new Error('delivery_error_invalid');
    assertExactKeys(value.error, new Set(['code', 'user_message', 'retryable']), 'delivery_error');
    error = {
      code: requiredString(value.error.code, 'delivery_error_code', 96),
      user_message: requiredString(value.error.user_message, 'delivery_error_user_message', 500),
      retryable: requiredBoolean(value.error.retryable, 'delivery_error_retryable')
    };
  }
  if (ok && error !== null) throw new Error('delivery_success_has_error');
  if (!ok && error === null) throw new Error('delivery_failure_missing_error');
  if (!isRecord(value.meta)) throw new Error('delivery_meta_invalid');
  return {
    protocol: GROUPGUARD_QUERY_DELIVERY_PROTOCOL,
    ok,
    feature,
    request_id: requestId,
    client_request_id: clientRequestId,
    delivery: {
      kind: value.delivery.kind,
      segments
    },
    error,
    retry,
    meta: value.meta
  };
}

export function toOneBotDeliveryPlan(envelope: GroupGuardQueryDeliveryEnvelope): OneBotDeliveryPlan {
  if (!envelope.ok) {
    const message = envelope.error?.user_message || '查询失败，请稍后再试。';
    return {
      kind: 'segments',
      segments: [{ type: 'text', data: { text: message } }]
    };
  }
  if (envelope.delivery.kind === 'forward') {
    const forward = envelope.delivery.segments[0];
    if (forward.type !== 'forward') throw new Error('delivery_forward_shape_invalid');
    return {
      kind: 'forward',
      nodes: forward.nodes.map((node) => ({
        segments: node.segments.map((segment) => {
          if (segment.type === 'text') {
            return { type: 'text' as const, data: { text: segment.text } };
          }
          return {
            type: 'image' as const,
            data: { file: `base64://${segment.data}` }
          };
        })
      }))
    };
  }
  return {
    kind: 'segments',
    segments: envelope.delivery.segments.map((segment) => {
      if (segment.type === 'text') {
        return { type: 'text' as const, data: { text: segment.text } };
      }
      if (segment.type === 'image') {
        return { type: 'image' as const, data: { file: `base64://${segment.data}` } };
      }
      throw new Error('delivery_nested_forward_invalid');
    })
  };
}

export function isIntranetHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host === '127.0.0.1' || host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  if (/^[a-z0-9-]+$/i.test(host)) return true;
  return false;
}

export function resolveGroupGuardQueryEndpoint(baseUrl: string): string {
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
  return `${parsed.origin}${GROUPGUARD_QUERY_DELIVERY_PATH}`;
}

export async function requestGroupGuardQueryDelivery(
  baseUrl: string,
  payload: GroupGuardQueryRequest,
  options: {
    timeoutMs?: number;
    fetchFn?: typeof fetch;
    maxResponseChars?: number;
  } = {}
): Promise<GroupGuardQueryDeliveryEnvelope> {
  const endpoint = resolveGroupGuardQueryEndpoint(baseUrl);
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
        'content-type': 'application/json'
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
