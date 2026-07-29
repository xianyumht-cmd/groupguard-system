import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  requestIntranetDelivery,
  type IntranetDeliveryRequestFn
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

const COMMAND_ID = 'builtin.query.video.intranet';
const TRIGGER = '我要看';
const PRIORITY = 90;
const FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';

function textResult(text: string): UnifiedCommandExecutionResult {
  return {
    ok: true,
    response: {
      type: 'text',
      text
    }
  };
}

export function parseVideoCategory(value: unknown):
  | { ok: true; category: string }
  | { ok: false; reason: string } {
  const category = String(value || '').trim() || '热门';
  if (category.length > 64) return { ok: false, reason: '视频分类过长，请缩短后重试。' };
  return { ok: true, category };
}

function requestIdFromContext(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  return [
    'gg',
    'video',
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

export async function executeVideoIntranetQuery(
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const parsed = parseVideoCategory(
    input.rawArgument || input.cleanedText.slice(TRIGGER.length)
  );
  if (!parsed.ok) return textResult(parsed.reason);

  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') return textResult('我要看仅支持群聊使用。');

  const config = configStateService.getConfig() as any;
  const baseUrl = String(config?.lolApiBaseUrl || '').trim();
  if (!baseUrl) {
    return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');
  }

  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'video',
      parameters: { category: parsed.category },
      preferred: 'text',
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext(input, context),
      ...(requestFn ? { requestFn } : {})
    });
    return buildIntranetStructuredResult(
      plan,
      groupId,
      String((context.event as any).self_id || '0'),
      '🎬 视频查询',
      '视频查询结果已生成。'
    );
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] video request failed: ${safeErrorTag(error)}`);
    return textResult(FALLBACK_TEXT);
  }
}

export function createVideoIntranetCommandPlugin(): CommandPlugin {
  return {
    metadata: {
      id: COMMAND_ID,
      name: 'intranet-video-query',
      description: 'Route video queries through the channel-neutral intranet delivery contract',
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
      featureKey: 'query.video',
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
        optional: ['category']
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
      name: 'intranet-video-query',
      enabled: true,
      trigger: TRIGGER,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: '内网视频最终交付协议',
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: ['category']
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: (input, context) => executeVideoIntranetQuery(input, context),
    fallback: async () => textResult(FALLBACK_TEXT)
  };
}

let registered = false;

export function registerIntranetVideoCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([createVideoIntranetCommandPlugin()]);
  registered = true;
}
