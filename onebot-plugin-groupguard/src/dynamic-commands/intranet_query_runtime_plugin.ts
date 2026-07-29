import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  requestGroupGuardQueryDelivery,
  toOneBotDeliveryPlan,
  type GroupGuardQueryDeliveryEnvelope,
  type GroupGuardQueryRequest,
  type OneBotDeliveryPlan
} from '../services/groupguard_query_delivery_client';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

const SHARD_COMMAND_ID = 'builtin.query.shard.intranet';
const SHARD_TRIGGER = '查合集';
const SHARD_PRIORITY = 90;
const SHARD_FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';

type DeliveryRequestFn = typeof requestGroupGuardQueryDelivery;
type ShardPreferredOutput = NonNullable<GroupGuardQueryRequest['preferred']>;

export interface ShardDeliveryRequestOptions {
  baseUrl: string;
  hero: string;
  preferred?: ShardPreferredOutput;
  timeoutMs?: number;
  requestId?: string;
  requestFn?: DeliveryRequestFn;
}

export interface ShardDeliveryRequestResult {
  envelope: GroupGuardQueryDeliveryEnvelope;
  plan: OneBotDeliveryPlan;
}

function normalizeOutput(value: unknown): ShardPreferredOutput {
  if (value === 'text' || value === 'image' || value === 'forward') return value;
  return 'auto';
}

export function resolveShardPreferredOutput(groupId: string): ShardPreferredOutput {
  const config = configStateService.getConfig() as any;
  const group = configStateService.resolveGroupSettings(groupId) as any;
  if (group && Object.prototype.hasOwnProperty.call(group, 'shardQueryOutputFormat')) {
    return normalizeOutput(group.shardQueryOutputFormat);
  }
  const profileValue = config?.queryCommandProfiles?.lol_shard?.outputFormat;
  if (profileValue !== undefined && profileValue !== '') return normalizeOutput(profileValue);
  return normalizeOutput(config?.shardQueryOutputFormat || 'image');
}

export function resolveShardQueryTimeoutMs(): number {
  const config = configStateService.getConfig() as any;
  const raw = Number(config?.global?.lolQueryRequestTimeoutSeconds ?? 20);
  const seconds = Number.isFinite(raw) ? Math.min(120, Math.max(3, Math.floor(raw))) : 20;
  return seconds * 1000;
}

function requestIdFromContext(input: UnifiedCommandNormalizedInput, context: UnifiedCommandExecutionContext): string {
  const messageId = String((context.event as any).message_id || '').trim();
  const groupId = String(input.groupId || '').trim();
  const userId = String(input.userId || '').trim();
  const compact = ['gg', 'shard', groupId, userId, messageId || Date.now().toString(36)]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_');
  return compact.slice(0, 128);
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

function planText(plan: OneBotDeliveryPlan): string {
  if (plan.kind === 'segments') {
    const text = plan.segments
      .map((segment) => segment.type === 'text' ? segment.data.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return text || '查合集结果已生成。';
  }
  return '查合集结果已生成。';
}

export function buildShardStructuredResult(
  plan: OneBotDeliveryPlan,
  groupId: string,
  selfId: string
): UnifiedCommandExecutionResult {
  if (plan.kind === 'segments') {
    return {
      ok: true,
      response: {
        type: 'structured',
        text: planText(plan),
        payload: {
          deliveries: [
            {
              channel: 'group',
              targetId: groupId,
              scene: 'external_query',
              segments: plan.segments,
              force: true,
              applyTemplate: false,
              skipProbability: true
            }
          ]
        }
      }
    };
  }

  const forwardNodes = plan.nodes.map((node) => ({
    type: 'node',
    data: {
      nickname: '📦 合集查询',
      user_id: selfId,
      content: node.segments
    }
  }));
  return {
    ok: true,
    response: {
      type: 'structured',
      text: '查合集结果已生成。',
      payload: {
        deliveries: [
          {
            channel: 'group',
            targetId: groupId,
            scene: 'external_query',
            forwardNodes,
            force: true,
            applyTemplate: false,
            skipProbability: true
          }
        ]
      }
    }
  };
}

function safeErrorTag(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240);
}

export async function executeShardIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn: DeliveryRequestFn = requestGroupGuardQueryDelivery
): Promise<UnifiedCommandExecutionResult> {
  const hero = String(input.rawArgument || input.cleanedText.slice(SHARD_TRIGGER.length)).trim();
  if (!hero) {
    return {
      ok: true,
      response: {
        type: 'text',
        text: '请输入：查合集 亚索'
      }
    };
  }
  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') {
    return {
      ok: true,
      response: {
        type: 'text',
        text: '查合集仅支持群聊使用。'
      }
    };
  }
  const config = configStateService.getConfig() as any;
  const baseUrl = String(config?.lolApiBaseUrl || '').trim();
  if (!baseUrl) {
    return {
      ok: true,
      response: {
        type: 'text',
        text: '未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。'
      }
    };
  }

  try {
    const { plan } = await requestShardDelivery({
      baseUrl,
      hero,
      preferred: resolveShardPreferredOutput(groupId),
      timeoutMs: resolveShardQueryTimeoutMs(),
      requestId: requestIdFromContext(input, context),
      requestFn
    });
    const selfId = String((context.event as any).self_id || '0');
    return buildShardStructuredResult(plan, groupId, selfId);
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] shard request failed: ${safeErrorTag(error)}`);
    return {
      ok: true,
      response: {
        type: 'text',
        text: SHARD_FALLBACK_TEXT
      }
    };
  }
}

export function createShardIntranetCommandPlugin(): CommandPlugin {
  return {
    metadata: {
      id: SHARD_COMMAND_ID,
      name: 'intranet-shard-query',
      description: 'Route the built-in shard query through the lolapisevers intranet delivery contract',
      version: '1.0.0',
      author: 'system.builtin.intranet-query',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: SHARD_COMMAND_ID,
      enabled: true,
      priority: SHARD_PRIORITY,
      featureType: 'query',
      featureKey: 'query.lol_shard',
      scope: 'group',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: true,
      permission: 'all',
      trigger: {
        type: 'prefix',
        value: SHARD_TRIGGER
      },
      parameterSchema: {
        required: [],
        optional: ['hero']
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'structured'
      },
      fallbackText: SHARD_FALLBACK_TEXT
    },
    schema: {
      id: SHARD_COMMAND_ID,
      name: 'intranet-shard-query',
      enabled: true,
      trigger: SHARD_TRIGGER,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: '内网查合集最终交付协议',
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: ['hero']
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: (input, context) => executeShardIntranetQuery(input, context),
    fallback: async () => ({
      ok: true,
      response: {
        type: 'text',
        text: SHARD_FALLBACK_TEXT
      }
    })
  };
}

let registered = false;

export function registerIntranetQueryCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([createShardIntranetCommandPlugin()]);
  registered = true;
}
