import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  normalizeShardPreferredOutput,
  requestShardDelivery,
  type ShardDeliveryRequestFn,
  type ShardPreferredOutput
} from '../services/intranet_shard_query_service';
import {
  normalizeIntranetPreferredOutput,
  requestIntranetDelivery,
  type IntranetDeliveryRequestFn,
  type IntranetPreferredOutput
} from '../services/intranet_query_service';
import type { OneBotDeliveryPlan } from '../services/groupguard_query_delivery_client';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

export { requestShardDelivery } from '../services/intranet_shard_query_service';
export { requestIntranetDelivery } from '../services/intranet_query_service';

const SHARD_COMMAND_ID = 'builtin.query.shard.intranet';
const ARAM_COMMAND_ID = 'builtin.query.aram.intranet';
const LOLBAN_COMMAND_ID = 'builtin.query.lolban.intranet';
const SHARD_TRIGGER = '查合集';
const ARAM_TRIGGER = '海符榜';
const LOLBAN_TRIGGER = '查封号';
const QUERY_PRIORITY = 90;
const QUERY_FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';

function textResult(text: string): UnifiedCommandExecutionResult {
  return {
    ok: true,
    response: {
      type: 'text',
      text
    }
  };
}

function resolveLolApiBaseUrl(): string {
  const config = configStateService.getConfig() as any;
  return String(config?.lolApiBaseUrl || '').trim();
}

export function resolveShardPreferredOutput(groupId: string): ShardPreferredOutput {
  const config = configStateService.getConfig() as any;
  const group = configStateService.resolveGroupSettings(groupId) as any;
  if (group && Object.prototype.hasOwnProperty.call(group, 'shardQueryOutputFormat')) {
    return normalizeShardPreferredOutput(group.shardQueryOutputFormat);
  }
  const profileValue = config?.queryCommandProfiles?.lol_shard?.outputFormat;
  if (profileValue !== undefined && profileValue !== '') return normalizeShardPreferredOutput(profileValue);
  return normalizeShardPreferredOutput(config?.shardQueryOutputFormat || 'image');
}

export function resolveAramPreferredOutput(groupId: string): IntranetPreferredOutput {
  const config = configStateService.getConfig() as any;
  const group = configStateService.resolveGroupSettings(groupId) as any;
  if (group && Object.prototype.hasOwnProperty.call(group, 'aramQueryOutputFormat')) {
    return normalizeIntranetPreferredOutput(group.aramQueryOutputFormat);
  }
  const profileValue = config?.queryCommandProfiles?.lol_aram_augments?.outputFormat
    ?? config?.queryCommandProfiles?.aram?.outputFormat;
  if (profileValue !== undefined && profileValue !== '') return normalizeIntranetPreferredOutput(profileValue);
  return normalizeIntranetPreferredOutput(config?.aramQueryOutputFormat || 'image');
}

export function resolveUnifiedQueryPreferredOutput(
  groupId: string,
  profileKeys: string[] = []
): IntranetPreferredOutput {
  const config = configStateService.getConfig() as any;
  for (const key of profileKeys) {
    const profileValue = config?.queryCommandProfiles?.[key]?.outputFormat;
    if (profileValue !== undefined && profileValue !== '') {
      return normalizeIntranetPreferredOutput(profileValue);
    }
  }
  const group = configStateService.resolveGroupSettings(groupId) as any;
  return normalizeIntranetPreferredOutput(
    group?.lolQueryOutputFormat
      ?? config?.global?.lolQueryOutputFormat
      ?? config?.lolQueryOutputFormat
      ?? 'text'
  );
}

export function resolveIntranetQueryTimeoutMs(): number {
  const config = configStateService.getConfig() as any;
  const raw = Number(config?.global?.lolQueryRequestTimeoutSeconds ?? 20);
  const seconds = Number.isFinite(raw) ? Math.min(120, Math.max(3, Math.floor(raw))) : 20;
  return seconds * 1000;
}

export const resolveShardQueryTimeoutMs = resolveIntranetQueryTimeoutMs;

function requestIdFromContext(
  feature: string,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  const groupId = String(input.groupId || '').trim();
  const userId = String(input.userId || '').trim();
  const compact = ['gg', feature, groupId, userId, messageId || Date.now().toString(36)]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_');
  return compact.slice(0, 128);
}

function planText(plan: OneBotDeliveryPlan, fallback: string): string {
  if (plan.kind === 'segments') {
    const text = plan.segments
      .map((segment) => segment.type === 'text' ? segment.data.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return text || fallback;
  }
  return fallback;
}

export function buildIntranetStructuredResult(
  plan: OneBotDeliveryPlan,
  groupId: string,
  selfId: string,
  title: string,
  completionText: string
): UnifiedCommandExecutionResult {
  if (plan.kind === 'segments') {
    return {
      ok: true,
      response: {
        type: 'structured',
        text: planText(plan, completionText),
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
      nickname: title,
      user_id: selfId,
      content: node.segments
    }
  }));
  return {
    ok: true,
    response: {
      type: 'structured',
      text: completionText,
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

export function buildShardStructuredResult(
  plan: OneBotDeliveryPlan,
  groupId: string,
  selfId: string
): UnifiedCommandExecutionResult {
  return buildIntranetStructuredResult(plan, groupId, selfId, '📦 合集查询', '查合集结果已生成。');
}

function safeErrorTag(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240);
}

function validateGroupInput(
  input: UnifiedCommandNormalizedInput,
  commandName: string
): { groupId: string } | { error: UnifiedCommandExecutionResult } {
  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') {
    return { error: textResult(`${commandName}仅支持群聊使用。`) };
  }
  return { groupId };
}

function requireBaseUrl(): string | null {
  const baseUrl = resolveLolApiBaseUrl();
  return baseUrl || null;
}

export async function executeShardIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: ShardDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const hero = String(input.rawArgument || input.cleanedText.slice(SHARD_TRIGGER.length)).trim();
  if (!hero) return textResult('请输入：查合集 亚索');
  const group = validateGroupInput(input, SHARD_TRIGGER);
  if ('error' in group) return group.error;
  const baseUrl = requireBaseUrl();
  if (!baseUrl) return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');

  try {
    const { plan } = await requestShardDelivery({
      baseUrl,
      hero,
      preferred: resolveShardPreferredOutput(group.groupId),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext('shard', input, context),
      ...(requestFn ? { requestFn } : {})
    });
    const selfId = String((context.event as any).self_id || '0');
    return buildShardStructuredResult(plan, group.groupId, selfId);
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] shard request failed: ${safeErrorTag(error)}`);
    return textResult(QUERY_FALLBACK_TEXT);
  }
}

export async function executeAramIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const hero = String(input.rawArgument || input.cleanedText.slice(ARAM_TRIGGER.length)).trim();
  if (!hero) return textResult('请输入：海符榜 亚索');
  const group = validateGroupInput(input, ARAM_TRIGGER);
  if ('error' in group) return group.error;
  const baseUrl = requireBaseUrl();
  if (!baseUrl) return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');

  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'aram',
      parameters: { hero },
      preferred: resolveAramPreferredOutput(group.groupId),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext('aram', input, context),
      ...(requestFn ? { requestFn } : {})
    });
    const selfId = String((context.event as any).self_id || '0');
    return buildIntranetStructuredResult(plan, group.groupId, selfId, '🧬 海符榜', '海符榜结果已生成。');
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] aram request failed: ${safeErrorTag(error)}`);
    return textResult(QUERY_FALLBACK_TEXT);
  }
}

function extractBanTarget(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const argument = String(input.rawArgument || '').trim();
  if (/^\d{5,11}$/.test(argument)) return argument;
  const raw = String((context.event as any).raw_message || input.rawText || '');
  const at = raw.match(/\[CQ:at,qq=(\d{5,11})\]/);
  if (at?.[1]) return at[1];
  const numeric = argument.match(/\d{5,11}/) || raw.match(/\d{5,11}/);
  return numeric?.[0] || '';
}

export async function executeLolbanIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const qq = extractBanTarget(input, context);
  if (!qq) return textResult('请指定要查询的QQ号，例如：查封号 123456789 或 查封号 @某人');
  const group = validateGroupInput(input, LOLBAN_TRIGGER);
  if ('error' in group) return group.error;
  const baseUrl = requireBaseUrl();
  if (!baseUrl) return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');

  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'lolban',
      parameters: { qq },
      preferred: resolveUnifiedQueryPreferredOutput(group.groupId, ['lol_ban', 'lolban']),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext('lolban', input, context),
      ...(requestFn ? { requestFn } : {})
    });
    const selfId = String((context.event as any).self_id || '0');
    return buildIntranetStructuredResult(plan, group.groupId, selfId, '🔒 封号查询', '查封号结果已生成。');
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] lolban request failed: ${safeErrorTag(error)}`);
    return textResult(QUERY_FALLBACK_TEXT);
  }
}

function createDefinition(
  id: string,
  name: string,
  description: string,
  trigger: string,
  featureKey: string,
  optionalParameter: string,
  execute: CommandPlugin['execute']
): CommandPlugin {
  return {
    metadata: {
      id,
      name,
      description,
      version: '1.1.0',
      author: 'system.builtin.intranet-query',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id,
      enabled: true,
      priority: QUERY_PRIORITY,
      featureType: 'query',
      featureKey,
      scope: 'group',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: true,
      permission: 'all',
      trigger: {
        type: 'prefix',
        value: trigger
      },
      parameterSchema: {
        required: [],
        optional: [optionalParameter]
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'structured'
      },
      fallbackText: QUERY_FALLBACK_TEXT
    },
    schema: {
      id,
      name,
      enabled: true,
      trigger,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: description,
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: [optionalParameter]
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute,
    fallback: async () => textResult(QUERY_FALLBACK_TEXT)
  };
}

export function createShardIntranetCommandPlugin(): CommandPlugin {
  return createDefinition(
    SHARD_COMMAND_ID,
    'intranet-shard-query',
    '内网查合集最终交付协议',
    SHARD_TRIGGER,
    'query.lol_shard',
    'hero',
    (input, context) => executeShardIntranetQuery(input, context)
  );
}

export function createAramIntranetCommandPlugin(): CommandPlugin {
  return createDefinition(
    ARAM_COMMAND_ID,
    'intranet-aram-query',
    '内网海符榜最终交付协议',
    ARAM_TRIGGER,
    'query.lol_aram_augments',
    'hero',
    (input, context) => executeAramIntranetQuery(input, context)
  );
}

export function createLolbanIntranetCommandPlugin(): CommandPlugin {
  return createDefinition(
    LOLBAN_COMMAND_ID,
    'intranet-lolban-query',
    '内网查封号最终交付协议',
    LOLBAN_TRIGGER,
    'query.lol_ban',
    'qq',
    (input, context) => executeLolbanIntranetQuery(input, context)
  );
}

let registered = false;

export function registerIntranetQueryCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([
    createShardIntranetCommandPlugin(),
    createAramIntranetCommandPlugin(),
    createLolbanIntranetCommandPlugin()
  ]);
  registered = true;
}
