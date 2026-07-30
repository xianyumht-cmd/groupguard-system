import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { send } from './response_capture_runtime';
import type { UnifiedCommandResponse } from './types';

function inferResponseScene(event: OB11Message): string {
  const text = String(event.raw_message || '').replace(/\[CQ:[^\]]+\]/g, '').trim();
  if (!text) return 'raw_text';
  const queryPrefixes = [
    '查战绩', '查封号', '查隐藏', '查合集', '海符榜',
    '查骗子', '举报骗子', '查同行', '举报同行',
    '查邀请', '查来源', '邀请查询', '邀请榜',
    '封号接口列表', '战绩接口状态', '战绩配置', '骗子接口状态'
  ];
  if (queryPrefixes.some(prefix => text.startsWith(prefix))) return 'external_query';
  if (text.startsWith('查') || text.includes('查询')) return 'query';
  return 'raw_text';
}

function normalizeDeliveryScene(delivery: {
  channel: 'group' | 'private';
  targetId: string;
  scene: string;
  message?: string;
  vars?: Record<string, string | number | boolean>;
  segments?: Array<Record<string, unknown>>;
  forwardNodes?: Array<Record<string, unknown>>;
  skipProbability?: boolean;
}, fallbackScene: string) {
  return {
    ...delivery,
    scene: delivery.scene && delivery.scene !== 'raw_text' ? delivery.scene : fallbackScene
  };
}

function getStructuredDeliveries(payload: unknown): Array<{
  channel: 'group' | 'private';
  targetId: string;
  scene: string;
  message?: string;
  vars?: Record<string, string | number | boolean>;
  segments?: Array<Record<string, unknown>>;
  forwardNodes?: Array<Record<string, unknown>>;
  skipProbability?: boolean;
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
    skipProbability?: boolean;
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
  const inferredScene = inferResponseScene(event);
  if (response.type === 'structured') {
    const deliveries = getStructuredDeliveries(response.payload);
    if (deliveries.length) {
      for (const delivery of deliveries) {
        await send(normalizeDeliveryScene(delivery, inferredScene));
      }
      return;
    }
  }
  const text = formatUnifiedCommandResponse(response);
  if (event.message_type === 'private') {
    await send({ channel: 'private', targetId: String(event.user_id), scene: inferredScene, message: text, force: true, applyTemplate: true });
    return;
  }
  await send({ channel: 'group', targetId: String(event.group_id || ''), scene: inferredScene, message: text, force: true, applyTemplate: true });
}
