import {
  normalizeIntranetPreferredOutput,
  requestIntranetDelivery,
  type IntranetDeliveryRequestFn,
  type IntranetDeliveryRequestResult,
  type IntranetPreferredOutput
} from './intranet_query_service';

export type ShardPreferredOutput = IntranetPreferredOutput;
export type ShardDeliveryRequestFn = IntranetDeliveryRequestFn;

export interface ShardDeliveryRequestOptions {
  baseUrl: string;
  hero: string;
  preferred?: ShardPreferredOutput;
  timeoutMs?: number;
  requestId?: string;
  requestFn?: ShardDeliveryRequestFn;
}

export type ShardDeliveryRequestResult = IntranetDeliveryRequestResult;

export function normalizeShardPreferredOutput(value: unknown): ShardPreferredOutput {
  return normalizeIntranetPreferredOutput(value);
}

export async function requestShardDelivery(options: ShardDeliveryRequestOptions): Promise<ShardDeliveryRequestResult> {
  const hero = String(options.hero || '').trim();
  if (!hero) throw new Error('shard_hero_required');
  return requestIntranetDelivery({
    baseUrl: options.baseUrl,
    feature: 'shard',
    parameters: { hero },
    preferred: options.preferred || 'auto',
    timeoutMs: options.timeoutMs,
    requestId: options.requestId,
    requestFn: options.requestFn
  });
}
