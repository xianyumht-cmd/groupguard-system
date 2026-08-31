import type {
  DeliveryImageSegment,
  DeliverySegment,
  GroupGuardQueryDeliveryEnvelope,
  OneBotDeliveryPlan
} from './groupguard_query_delivery_client';
import { performance } from 'node:perf_hooks';

export const QUERY_DELIVERY_TIMING_SCHEMA = 'query-delivery-timing.v1' as const;

export interface QueryDeliveryTrace {
  schemaVersion: typeof QUERY_DELIVERY_TIMING_SCHEMA;
  feature: string;
  t0PluginReceivedAt: number;
  t1ApiRequestAt?: number;
  t2ApiResponseAt?: number;
  t3DeliveryPlanAt?: number;
  t4PayloadReadyAt?: number;
  t7PayloadPrepareStartedAt?: number;
  t5QueueSubmittedAt?: number;
  t6QueueWorkerStartedAt?: number;
  t7RiskDelayFinishedAt?: number;
  t8SendStartedAt?: number;
  t9SendFinishedAt?: number;
  sendStatus?: 'pending' | 'success' | 'failed';
  transport?: 'send_queue' | 'direct_onebot';
  requestId?: string;
  deliveryKind?: string;
  imageBytes?: number;
  imageBase64Chars?: number;
  imageCount?: number;
  apiTiming?: Record<string, unknown>;
  monotonicT0At: number;
  monotonicT1At?: number;
  monotonicT2At?: number;
  monotonicT3At?: number;
  monotonicT4At?: number;
  monotonicT5At?: number;
  monotonicT6At?: number;
  monotonicPayloadPrepareAt?: number;
  monotonicRiskDelayAt?: number;
  monotonicT8At?: number;
  monotonicT9At?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10) / 10 : undefined;
}

function safeImageTiming(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of [
    'cache',
    'assets',
    'cache_lookup_ms',
    'asset_ms',
    'encode_ms',
    'render_ms',
    'asset_count',
    'expected_asset_count',
    'bytes',
    'base64_chars',
    'asset_lookup_started_offset_ms',
    'asset_available_offset_ms',
    'width',
    'height'
  ]) {
    if (key === 'cache' || key === 'assets') {
      if (typeof value[key] === 'string') result[key] = String(value[key]).slice(0, 32);
      continue;
    }
    const number = safeNumber(value[key]);
    if (number !== undefined) result[key] = number;
  }
  return Object.keys(result).length ? result : undefined;
}

export function safeApiTiming(meta: unknown): Record<string, unknown> | undefined {
  if (!isRecord(meta) || !isRecord(meta.timing)) return undefined;
  const raw = meta.timing;
  const result: Record<string, unknown> = { schema_version: QUERY_DELIVERY_TIMING_SCHEMA };
  for (const key of ['query_ms', 'render_ms', 'delivery_prepare_ms', 'api_total_ms']) {
    const number = safeNumber(raw[key]);
    if (number !== undefined) result[key] = number;
  }
  if (isRecord(raw.api_stage_offsets_ms)) {
    const stages: Record<string, unknown> = {};
    for (const key of [
      't3_render_started',
      't4_render_finished',
      't7_payload_prepare_started',
      't7_payload_ready'
    ]) {
      const number = safeNumber(raw.api_stage_offsets_ms[key]);
      if (number !== undefined) stages[key] = number;
    }
    if (Object.keys(stages).length) result.api_stage_offsets_ms = stages;
  }
  const image = safeImageTiming(raw.image);
  if (image) result.image = image;
  return Object.keys(result).length > 1 ? result : undefined;
}

export function createQueryDeliveryTrace(feature: string): QueryDeliveryTrace {
  return {
    schemaVersion: QUERY_DELIVERY_TIMING_SCHEMA,
    feature: String(feature || '').slice(0, 96),
    t0PluginReceivedAt: Date.now(),
    monotonicT0At: performance.now()
  };
}

function imageStats(segments: DeliverySegment[]): { bytes: number; base64Chars: number; count: number } {
  let bytes = 0;
  let base64Chars = 0;
  let count = 0;
  const visit = (segment: DeliverySegment): void => {
    if (segment.type === 'image') {
      const image = segment as DeliveryImageSegment;
      bytes += Math.max(0, Number(image.bytes) || 0);
      base64Chars += String(image.data || '').length;
      count += 1;
      return;
    }
    if (segment.type === 'forward') {
      for (const node of segment.nodes) {
        for (const nested of node.segments) visit(nested);
      }
    }
  };
  for (const segment of segments) visit(segment);
  return { bytes, base64Chars, count };
}

export function markApiRequestStarted(trace: QueryDeliveryTrace): void {
  trace.t1ApiRequestAt = Date.now();
  trace.monotonicT1At = performance.now();
}

export function markApiResponseReceived(
  trace: QueryDeliveryTrace,
  envelope: GroupGuardQueryDeliveryEnvelope
): void {
  trace.t2ApiResponseAt = Date.now();
  trace.monotonicT2At = performance.now();
  trace.requestId = String(envelope.request_id || '').slice(0, 128);
  trace.deliveryKind = envelope.delivery.kind;
  const stats = imageStats(envelope.delivery.segments);
  trace.imageBytes = stats.bytes;
  trace.imageBase64Chars = stats.base64Chars;
  trace.imageCount = stats.count;
  trace.apiTiming = safeApiTiming(envelope.meta);
}

export function markDeliveryPlanReady(trace: QueryDeliveryTrace, _plan: OneBotDeliveryPlan): void {
  trace.t3DeliveryPlanAt = Date.now();
  trace.monotonicT3At = performance.now();
}

export function markPayloadPrepareStarted(trace: QueryDeliveryTrace): void {
  trace.t7PayloadPrepareStartedAt = Date.now();
  trace.monotonicPayloadPrepareAt = performance.now();
}

export function markPayloadReady(trace: QueryDeliveryTrace): void {
  trace.t4PayloadReadyAt = Date.now();
  trace.monotonicT4At = performance.now();
}

export function markQueueSubmitted(trace: QueryDeliveryTrace): void {
  trace.t5QueueSubmittedAt = Date.now();
  trace.monotonicT5At = performance.now();
  trace.transport = 'send_queue';
}

export function markQueueWorkerStarted(trace: QueryDeliveryTrace): void {
  trace.t6QueueWorkerStartedAt = Date.now();
  trace.monotonicT6At = performance.now();
}

export function markRiskDelayFinished(trace: QueryDeliveryTrace): void {
  trace.t7RiskDelayFinishedAt = Date.now();
  trace.monotonicRiskDelayAt = performance.now();
}

export function markSendStarted(trace: QueryDeliveryTrace): void {
  trace.t8SendStartedAt = Date.now();
  trace.monotonicT8At = performance.now();
  if (!trace.transport) trace.transport = 'direct_onebot';
  trace.sendStatus = 'pending';
}

export function markSendFinished(trace: QueryDeliveryTrace, status: 'success' | 'failed' = 'success'): void {
  trace.t9SendFinishedAt = Date.now();
  trace.monotonicT9At = performance.now();
  trace.sendStatus = status;
}

function elapsed(from: number | undefined, to: number | undefined): number | undefined {
  if (!from || !to || to < from) return undefined;
  return to - from;
}

export function serializeQueryDeliveryTrace(trace: QueryDeliveryTrace): Record<string, unknown> {
  const t0 = trace.monotonicT0At;
  const t1 = trace.monotonicT1At;
  const t2 = trace.monotonicT2At;
  const t3 = trace.monotonicT3At;
  const t4 = trace.monotonicT4At;
  const t5 = trace.monotonicT5At;
  const t6 = trace.monotonicT6At;
  const payloadPrepare = trace.monotonicPayloadPrepareAt;
  const t8 = trace.monotonicT8At;
  const t9 = trace.monotonicT9At;
  const result: Record<string, unknown> = {
    schema_version: QUERY_DELIVERY_TIMING_SCHEMA,
    feature: trace.feature,
    request_id: trace.requestId || '',
    delivery_kind: trace.deliveryKind || '',
    image_bytes: trace.imageBytes || 0,
    image_base64_chars: trace.imageBase64Chars || 0,
    image_count: trace.imageCount || 0,
    t0_plugin_received_at: trace.t0PluginReceivedAt,
    t1_api_request_at: trace.t1ApiRequestAt || 0,
    t2_api_response_at: trace.t2ApiResponseAt || 0,
    t3_delivery_plan_at: trace.t3DeliveryPlanAt || 0,
    t4_payload_ready_at: trace.t4PayloadReadyAt || 0,
    t7_payload_prepare_started_at: trace.t7PayloadPrepareStartedAt || 0,
    t5_queue_submitted_at: trace.t5QueueSubmittedAt || 0,
    t6_queue_worker_started_at: trace.t6QueueWorkerStartedAt || 0,
    t7_risk_delay_finished_at: trace.t7RiskDelayFinishedAt || 0,
    t8_send_started_at: trace.t8SendStartedAt || 0,
    t9_send_finished_at: trace.t9SendFinishedAt || 0,
    plugin_to_api_ms: elapsed(t0, t1) || 0,
    api_round_trip_ms: elapsed(t1, t2) || 0,
    plan_decode_ms: elapsed(t2, t3) || 0,
    payload_prepare_ms: elapsed(t3, t4) || 0,
    payload_prepare_decode_ms: elapsed(payloadPrepare, t3) || 0,
    queue_wait_ms: elapsed(t5, t6) || 0,
    risk_delay_ms: elapsed(t6, trace.monotonicRiskDelayAt) || 0,
    response_to_queue_ms: elapsed(t4, t5) || 0,
    response_to_send_ms: elapsed(t4, t8) || 0,
    onebot_processing_ms: elapsed(t8, t9) || 0,
    send_total_ms: elapsed(t8, t9) || 0,
    end_to_end_ms: elapsed(t0, t9) || 0,
    send_status: trace.sendStatus || 'pending',
    transport: trace.transport || 'unknown'
  };
  if (trace.apiTiming) result.api = trace.apiTiming;
  return result;
}
