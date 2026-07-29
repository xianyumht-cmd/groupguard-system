import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  normalizeIntranetPreferredOutput,
  requestIntranetDelivery,
  type IntranetDeliveryRequestFn,
  type IntranetPreferredOutput
} from '../services/intranet_query_service';
import {
  buildIntranetStructuredResult,
  resolveIntranetQueryTimeoutMs
} from './intranet_query_runtime_plugin';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

const COMMAND_ID = 'builtin.query.battle.intranet';
const TRIGGER = '查战绩';
const PRIORITY = 90;
const FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';

export interface BattleQueryInput {
  playerId: string;
  region: string;
}

function textResult(text: string): UnifiedCommandExecutionResult {
  return {
    ok: true,
    response: {
      type: 'text',
      text
    }
  };
}

export function parseBattleQueryInput(value: unknown):
  | { ok: true; value: BattleQueryInput }
  | { ok: false; reason: string } {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: '请输入：查战绩张三#12345' };
  const parts = raw.split(/\s+/).filter(Boolean);
  const playerRaw = String(parts[0] || '').replace(/\s+/g, '');
  const hashIndex = playerRaw.indexOf('#');
  if (hashIndex <= 0 || hashIndex >= playerRaw.length - 1) {
    return { ok: false, reason: '格式错误，示例：查战绩张三#12345' };
  }
  const gameName = playerRaw.slice(0, hashIndex).trim();
  const tagLine = playerRaw.slice(hashIndex + 1).trim();
  if (!gameName || !tagLine) return { ok: false, reason: '格式错误，示例：查战绩张三#12345' };
  if (tagLine.length < 2 || tagLine.length > 12) {
    return { ok: false, reason: '标签长度需在 2-12 个字符之间' };
  }
  const region = parts.slice(1).join('').trim();
  return {
    ok: true,
    value: {
      playerId: `${gameName}#${tagLine}`,
      region
    }
  };
}

export function resolveBattlePreferredOutput(groupId: string): IntranetPreferredOutput {
  const config = configStateService.getConfig() as any;
  const group = configStateService.resolveGroupSettings(groupId) as any;
  const groupValue = group?.lolQueryOutputFormat;
  if (groupValue !== undefined && groupValue !== '') return normalizeIntranetPreferredOutput(groupValue);
  const profileValue = config?.queryCommandProfiles?.lol_battle?.outputFormat;
  if (profileValue !== undefined && profileValue !== '') return normalizeIntranetPreferredOutput(profileValue);
  return normalizeIntranetPreferredOutput(config?.lolQueryOutputFormat || 'forward');
}

function requestIdFromContext(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  const compact = [
    'gg',
    'battle',
    String(input.groupId || ''),
    String(input.userId || ''),
    messageId || Date.now().toString(36)
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_');
  return compact.slice(0, 128);
}

function safeErrorTag(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240);
}

export async function executeBattleIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const parsed = parseBattleQueryInput(
    input.rawArgument || input.cleanedText.slice(TRIGGER.length)
  );
  if (!parsed.ok) return textResult(parsed.reason);

  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') return textResult('查战绩仅支持群聊使用。');

  const config = configStateService.getConfig() as any;
  const baseUrl = String(config?.lolApiBaseUrl || '').trim();
  if (!baseUrl) {
    return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');
  }

  try {
    const parameters: Record<string, string> = { name: parsed.value.playerId };
    if (parsed.value.region) parameters.region = parsed.value.region;
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'battle',
      parameters,
      preferred: resolveBattlePreferredOutput(groupId),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext(input, context),
      ...(requestFn ? { requestFn } : {})
    });
    return buildIntranetStructuredResult(
      plan,
      groupId,
      String((context.event as any).self_id || '0'),
      '🎮 战绩查询',
      '查战绩结果已生成。'
    );
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] battle request failed: ${safeErrorTag(error)}`);
    return textResult(FALLBACK_TEXT);
  }
}

export function createBattleIntranetCommandPlugin(): CommandPlugin {
  return {
    metadata: {
      id: COMMAND_ID,
      name: 'intranet-battle-query',
      description: 'Route battle queries through the channel-neutral intranet delivery contract',
      version: '1.0.0',
      author: 'system.builtin.intranet-query',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: COMMAND_ID,
      enabled: true,
      priority: PRIORITY,
      featureType: 'query',
      featureKey: 'query.lol_battle',
      scope: 'group',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: true,
      permission: 'all',
      trigger: {
        type: 'prefix',
        value: TRIGGER
      },
      parameterSchema: {
        required: [],
        optional: ['name', 'region']
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'structured'
      },
      fallbackText: FALLBACK_TEXT
    },
    schema: {
      id: COMMAND_ID,
      name: 'intranet-battle-query',
      enabled: true,
      trigger: TRIGGER,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: '内网查战绩最终交付协议',
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: ['name', 'region']
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: (input, context) => executeBattleIntranetQuery(input, context),
    fallback: async () => textResult(FALLBACK_TEXT)
  };
}

let registered = false;

export function registerIntranetBattleCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([createBattleIntranetCommandPlugin()]);
  registered = true;
}
