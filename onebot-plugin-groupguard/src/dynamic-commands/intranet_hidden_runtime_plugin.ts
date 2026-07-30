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

const COMMAND_ID = 'builtin.query.hidden.intranet';
const TRIGGER = '查隐藏';
const PRIORITY = 90;
const FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';

export interface HiddenQueryInput {
  name: string;
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

export function parseHiddenQueryInput(value: unknown):
  | { ok: true; value: HiddenQueryInput }
  | { ok: false; reason: string } {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: '请指定召唤师名称，例如：查隐藏 TheShy 1' };
  const parts = raw.split(/\s+/).filter(Boolean);
  const name = String(parts[0] || '').trim();
  const region = String(parts[1] || '1').trim();
  if (!name) return { ok: false, reason: '请指定召唤师名称，例如：查隐藏 TheShy 1' };
  if (name.length > 64) return { ok: false, reason: '召唤师名称过长，请检查后重试。' };
  if (region.length > 32) return { ok: false, reason: '大区参数过长，请检查后重试。' };
  return { ok: true, value: { name, region } };
}

export function resolveHiddenPreferredOutput(groupId: string): IntranetPreferredOutput {
  const config = configStateService.getConfig() as any;
  const group = configStateService.resolveGroupSettings(groupId) as any;
  const groupValue = group?.lolQueryOutputFormat;
  if (groupValue !== undefined && groupValue !== '') {
    const normalized = normalizeIntranetPreferredOutput(groupValue);
    return normalized === 'image' ? 'forward' : normalized;
  }
  const profileValue = config?.queryCommandProfiles?.lol_hidden?.outputFormat;
  if (profileValue !== undefined && profileValue !== '') {
    const normalized = normalizeIntranetPreferredOutput(profileValue);
    return normalized === 'image' ? 'forward' : normalized;
  }
  return 'forward';
}

function requestIdFromContext(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  return [
    'gg',
    'hidden',
    String(input.groupId || ''),
    String(input.userId || ''),
    messageId || Date.now().toString(36)
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 128);
}

function safeErrorTag(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240);
}

export async function executeHiddenIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const parsed = parseHiddenQueryInput(
    input.rawArgument || input.cleanedText.slice(TRIGGER.length)
  );
  if (!parsed.ok) return textResult(parsed.reason);

  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') return textResult('查隐藏仅支持群聊使用。');

  const config = configStateService.getConfig() as any;
  const baseUrl = String(config?.lolApiBaseUrl || '').trim();
  if (!baseUrl) {
    return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');
  }

  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'hidden',
      parameters: {
        name: parsed.value.name,
        region: parsed.value.region
      },
      preferred: resolveHiddenPreferredOutput(groupId),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext(input, context),
      ...(requestFn ? { requestFn } : {})
    });
    return buildIntranetStructuredResult(
      plan,
      groupId,
      String((context.event as any).self_id || '0'),
      '🕵️ 隐藏战绩',
      '查隐藏结果已生成。'
    );
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] hidden request failed: ${safeErrorTag(error)}`);
    return textResult(FALLBACK_TEXT);
  }
}

export function createHiddenIntranetCommandPlugin(): CommandPlugin {
  return {
    metadata: {
      id: COMMAND_ID,
      name: 'intranet-hidden-query',
      description: 'Route hidden battle queries through the channel-neutral intranet delivery contract',
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
      featureKey: 'query.lol_hidden',
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
      name: 'intranet-hidden-query',
      enabled: true,
      trigger: TRIGGER,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: '内网查隐藏最终交付协议',
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
    execute: (input, context) => executeHiddenIntranetQuery(input, context),
    fallback: async () => textResult(FALLBACK_TEXT)
  };
}

let registered = false;

export function registerIntranetHiddenCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([createHiddenIntranetCommandPlugin()]);
  registered = true;
}
