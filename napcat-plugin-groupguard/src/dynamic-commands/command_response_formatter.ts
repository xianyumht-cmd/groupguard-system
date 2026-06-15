import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { send } from './response_capture_runtime';
import type { UnifiedCommandResponse } from './types';

function getStructuredDeliveries(payload: unknown): Array<{
  channel: 'group' | 'private';
  targetId: string;
  scene: string;
  message?: string;
  vars?: Record<string, string | number | boolean>;
  segments?: Array<Record<string, unknown>>;
  forwardNodes?: Array<Record<string, unknown>>;
}> {
  if (!payload || typeof payload !== 'object') return [];
  const deliveries = (payload as { deliveries?: unknown; }).deliveries;
  if (!Array.isArray(deliveries)) return [];
  return deliveries.filter((delivery): delivery is {
    channel: 'group' | 'private';
    targetId: string;
    scene: string;
    message?: string;
    vars?: Record<string, string | number | boolean>;
    segments?: Array<Record<string, unknown>>;
    forwardNodes?: Array<Record<string, unknown>>;
  } => (
    !!delivery &&
    typeof delivery === 'object' &&
    (((delivery as any).channel === 'group') || ((delivery as any).channel === 'private')) &&
    typeof (delivery as any).targetId === 'string' &&
    typeof (delivery as any).scene === 'string' &&
    (
      typeof (delivery as any).message === 'string' ||
      Array.isArray((delivery as any).segments) ||
      Array.isArray((delivery as any).forwardNodes)
    )
  ));
}

export function formatUnifiedCommandResponse(response: UnifiedCommandResponse): string {
  if (response.type === 'text') return response.text.trim();
  if (response.type === 'link') {
    return [response.title, response.text, response.url].filter(Boolean).join('\n').trim();
  }
  if (response.type === 'media') {
    return [response.title, response.text, response.url].filter(Boolean).join('\n').trim();
  }
  const deliveries = getStructuredDeliveries(response.payload);
  if (deliveries.length) {
    return deliveries.map((delivery) => delivery.message || '').filter(Boolean).join('\n').trim();
  }
  try {
    return [response.text, JSON.stringify(response.payload, null, 2)].filter(Boolean).join('\n').trim();
  } catch {
    return response.text.trim();
  }
}

export async function sendUnifiedCommandResponse(event: OB11Message, response: UnifiedCommandResponse): Promise<void> {
  if (response.type === 'structured') {
    const deliveries = getStructuredDeliveries(response.payload);
    if (deliveries.length) {
      for (const delivery of deliveries) {
        await send(delivery);
      }
      return;
    }
  }
  const text = formatUnifiedCommandResponse(response);
  if (event.message_type === 'private') {
    await send({ channel: 'private', targetId: String(event.user_id), scene: 'raw_text', message: text, force: true, applyTemplate: true });
    return;
  }
  await send({ channel: 'group', targetId: String(event.group_id || ''), scene: 'raw_text', message: text, force: true, applyTemplate: true });
}
