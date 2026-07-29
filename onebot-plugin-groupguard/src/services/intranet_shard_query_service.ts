import {
  requestGroupGuardQueryDelivery,
  toOneBotDeliveryPlan,
  type GroupGuardQueryDeliveryEnvelope,
  type GroupGuardQueryRequest,
  type OneBotDeliveryPlan
} from './groupguard_query_delivery_client';

export type ShardPreferredOutput = NonNullable<GroupGuardQueryRequest['preferred']>;
export type ShardDeliveryRequestFn = typeof requestGroupGuardQueryDelivery;

export interface ShardDeliveryRequestOptions {
  baseUrl: string;
  hero: string;
  preferred?: ShardPreferredOutput;
  timeoutMs?: number;
  requestId?: string;
  requestFn?: ShardDeliveryRequestFn;
}

export interface ShardDeliveryRequestResult {
  envelope: GroupGuardQueryDeliveryEnvelope;
  plan: OneBotDeliveryPlan;
}

export function normalizeShardPreferredOutput(value: unknown): ShardPreferredOutput {
  if (value === 'text' || value === 'image' || value === 'forward') return value;
  return 'auto';
}

export async function requestShardDelivery(options: ShardDeliveryRequestOptions): Promise<ShardDeliveryRequestResult> {
  const hero = String(options.hero || '').trim();
  if (!hero) throw new Error('shard_hero_required');
  const requestFn = options.requestFn || requestGroupGuardQueryDelivery;
  const envelope = await requestFn(
    options.baseUrl,
    {
      feature: 'shard',
      parameters: { hero },
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
  if (envelope.feature !== 'shard') throw new Error('delivery_feature_mismatch');
  return {
    envelope,
    plan: toOneBotDeliveryPlan(envelope)
  };
}
