import {
  requestGroupGuardQueryDelivery,
  toOneBotDeliveryPlan,
  type GroupGuardQueryDeliveryEnvelope,
  type GroupGuardQueryRequest,
  type OneBotDeliveryPlan
} from './groupguard_query_delivery_client';
import {
  requestGroupGuardReportDelivery,
  type GroupGuardReportRequest
} from './groupguard_report_delivery_client';
import {
  createQueryDeliveryTrace,
  markApiRequestStarted,
  markApiResponseReceived,
  markDeliveryPlanReady,
  type QueryDeliveryTrace
} from './query_delivery_observability';

export type IntranetQueryFeature =
  | GroupGuardQueryRequest['feature']
  | 'battle'
  | 'video'
  | 'scammer'
  | 'peer'
  | 'dynamic';
export type IntranetReportFeature = GroupGuardReportRequest['feature'];
export type IntranetPreferredOutput = NonNullable<GroupGuardQueryRequest['preferred']>;
export type IntranetDeliveryRequestFn = typeof requestGroupGuardQueryDelivery;
export type IntranetReportRequestFn = typeof requestGroupGuardReportDelivery;

export interface IntranetDeliveryRequestOptions {
  baseUrl: string;
  feature: IntranetQueryFeature;
  parameters: Record<string, string>;
  preferred?: IntranetPreferredOutput;
  timeoutMs?: number;
  requestId?: string;
  requestFn?: IntranetDeliveryRequestFn;
  trace?: QueryDeliveryTrace;
}

export interface IntranetReportRequestOptions {
  baseUrl: string;
  feature: IntranetReportFeature;
  parameters: Record<string, string>;
  preferred?: IntranetPreferredOutput;
  timeoutMs?: number;
  requestId: string;
  client?: string;
  writeToken: string;
  requestFn?: IntranetReportRequestFn;
}

export interface IntranetDeliveryRequestResult {
  envelope: GroupGuardQueryDeliveryEnvelope;
  plan: OneBotDeliveryPlan;
  trace?: QueryDeliveryTrace;
}

export function normalizeIntranetPreferredOutput(value: unknown): IntranetPreferredOutput {
  if (value === 'text' || value === 'image' || value === 'forward') return value;
  if (value === 'card') return 'image';
  return 'auto';
}

function normalizeParameters(parameters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parameters || {})
      .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
      .filter(([key, value]) => Boolean(key && value))
  );
}

export async function requestIntranetDelivery(
  options: IntranetDeliveryRequestOptions
): Promise<IntranetDeliveryRequestResult> {
  const feature = String(options.feature || '').trim() as IntranetQueryFeature;
  if (!feature) throw new Error('delivery_feature_required');
  const parameters = normalizeParameters(options.parameters);
  if (!Object.keys(parameters).length) throw new Error('delivery_parameters_required');
  const requestFn = options.requestFn || requestGroupGuardQueryDelivery;
  const trace = options.trace || createQueryDeliveryTrace(feature);
  markApiRequestStarted(trace);
  const envelope = await requestFn(
    options.baseUrl,
    {
      feature,
      parameters,
      preferred: options.preferred || 'auto',
      capabilities: {
        text: true,
        image: true,
        forward: true
      },
      ...(options.requestId ? { request_id: options.requestId } : {})
    } as GroupGuardQueryRequest,
    { timeoutMs: options.timeoutMs }
  );
  markApiResponseReceived(trace, envelope);
  if (envelope.feature !== feature) throw new Error('delivery_feature_mismatch');
  const plan = toOneBotDeliveryPlan(envelope);
  markDeliveryPlanReady(trace, plan);
  return {
    envelope,
    plan,
    trace
  };
}

export async function requestIntranetReportDelivery(
  options: IntranetReportRequestOptions
): Promise<IntranetDeliveryRequestResult> {
  const feature = String(options.feature || '').trim() as IntranetReportFeature;
  if (feature !== 'scammer_report' && feature !== 'peer_report') {
    throw new Error('delivery_feature_required');
  }
  const requestId = String(options.requestId || '').trim();
  if (!requestId) throw new Error('delivery_request_id_required');
  const writeToken = String(options.writeToken || '').trim();
  if (!writeToken) throw new Error('delivery_write_token_required');
  const parameters = normalizeParameters(options.parameters);
  if (!Object.keys(parameters).length) throw new Error('delivery_parameters_required');
  const requestFn = options.requestFn || requestGroupGuardReportDelivery;
  const envelope = await requestFn(
    options.baseUrl,
    {
      feature,
      parameters,
      preferred: options.preferred || 'text',
      capabilities: {
        text: true,
        image: false,
        forward: true
      },
      request_id: requestId,
      client: String(options.client || 'snowluma').slice(0, 64)
    },
    {
      timeoutMs: options.timeoutMs,
      writeToken
    }
  );
  if (envelope.feature !== feature) throw new Error('delivery_feature_mismatch');
  return {
    envelope,
    plan: toOneBotDeliveryPlan(envelope)
  };
}
