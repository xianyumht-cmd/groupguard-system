import {
  requestGroupGuardQueryDelivery,
  toOneBotDeliveryPlan,
  type GroupGuardQueryDeliveryEnvelope,
  type GroupGuardQueryRequest,
  type OneBotDeliveryPlan
} from './groupguard_query_delivery_client';

export type IntranetQueryFeature = GroupGuardQueryRequest['feature'];
export type IntranetPreferredOutput = NonNullable<GroupGuardQueryRequest['preferred']>;
export type IntranetDeliveryRequestFn = typeof requestGroupGuardQueryDelivery;

export interface IntranetDeliveryRequestOptions {
  baseUrl: string;
  feature: IntranetQueryFeature;
  parameters: Record<string, string>;
  preferred?: IntranetPreferredOutput;
  timeoutMs?: number;
  requestId?: string;
  requestFn?: IntranetDeliveryRequestFn;
}

export interface IntranetDeliveryRequestResult {
  envelope: GroupGuardQueryDeliveryEnvelope;
  plan: OneBotDeliveryPlan;
}

export function normalizeIntranetPreferredOutput(value: unknown): IntranetPreferredOutput {
  if (value === 'text' || value === 'image' || value === 'forward') return value;
  return 'auto';
}

export async function requestIntranetDelivery(
  options: IntranetDeliveryRequestOptions
): Promise<IntranetDeliveryRequestResult> {
  const feature = String(options.feature || '').trim() as IntranetQueryFeature;
  if (!feature) throw new Error('delivery_feature_required');
  const parameters = Object.fromEntries(
    Object.entries(options.parameters || {})
      .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
      .filter(([key, value]) => Boolean(key && value))
  );
  if (!Object.keys(parameters).length) throw new Error('delivery_parameters_required');
  const requestFn = options.requestFn || requestGroupGuardQueryDelivery;
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
    },
    { timeoutMs: options.timeoutMs }
  );
  if (envelope.feature !== feature) throw new Error('delivery_feature_mismatch');
  return {
    envelope,
    plan: toOneBotDeliveryPlan(envelope)
  };
}
