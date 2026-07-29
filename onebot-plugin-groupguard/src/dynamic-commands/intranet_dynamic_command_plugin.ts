import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  requestIntranetDelivery,
  type IntranetDeliveryRequestFn
} from '../services/intranet_query_service';
import type { OneBotDeliveryPlan } from '../services/groupguard_query_delivery_client';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  DynamicCommandDefinition,
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

function failure(message: string): Extract<UnifiedCommandExecutionResult, { ok: false }> {
  return { ok: false, errorType: 'http_error', message };
}

function fallbackText(definition: DynamicCommandDefinition): string {
  return String(definition.fallbackText || '动态查询暂时不可用，请稍后再试').trim();
}

function requestId(
  definition: DynamicCommandDefinition,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  return [
    'gg',
    'dynamic',
    definition.id,
    String(input.groupId || ''),
    String(input.userId || ''),
    messageId || Date.now().toString(36)
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 128);
}

function timeoutMs(): number {
  const config = configStateService.getConfig() as any;
  const raw = Number(config?.global?.lolQueryRequestTimeoutSeconds ?? 20);
  const seconds = Number.isFinite(raw) ? Math.min(120, Math.max(3, Math.floor(raw))) : 20;
  return seconds * 1000;
}

function planText(plan: OneBotDeliveryPlan, fallback: string): string {
  if (plan.kind !== 'segments') return fallback;
  const text = plan.segments
    .map((segment) => segment.type === 'text' ? segment.data.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || fallback;
}

function structuredResult(
  plan: OneBotDeliveryPlan,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  completionText: string
): UnifiedCommandExecutionResult {
  const channel = input.messageType === 'private' ? 'private' : 'group';
  const targetId = channel === 'private' ? String(input.userId || '') : String(input.groupId || '');
  if (!targetId) return failure('delivery_target_required');

  if (plan.kind === 'segments') {
    return {
      ok: true,
      response: {
        type: 'structured',
        text: planText(plan, completionText),
        payload: {
          deliveries: [
            {
              channel,
              targetId,
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

  if (channel === 'private') {
    const flattened = plan.nodes
      .flatMap((node) => node.segments)
      .map((segment) => segment.type === 'text' ? segment.data.text : '')
      .filter(Boolean)
      .join('\n\n')
      .trim();
    return {
      ok: true,
      response: {
        type: 'structured',
        text: flattened || completionText,
        payload: {
          deliveries: [
            {
              channel: 'private',
              targetId,
              scene: 'external_query',
              message: flattened || completionText,
              force: true,
              applyTemplate: false,
              skipProbability: true
            }
          ]
        }
      }
    };
  }

  const selfId = String((context.event as any).self_id || '0');
  return {
    ok: true,
    response: {
      type: 'structured',
      text: completionText,
      payload: {
        deliveries: [
          {
            channel: 'group',
            targetId,
            scene: 'external_query',
            forwardNodes: plan.nodes.map((node) => ({
              type: 'node',
              data: {
                nickname: definitionTitle(input.commandId),
                user_id: selfId,
                content: node.segments
              }
            })),
            force: true,
            applyTemplate: false,
            skipProbability: true
          }
        ]
      }
    }
  };
}

function definitionTitle(commandId: string): string {
  return `动态查询 · ${String(commandId || '').slice(0, 64)}`;
}

function validateMappedParameters(
  definition: DynamicCommandDefinition,
  input: UnifiedCommandNormalizedInput
): UnifiedCommandExecutionResult | null {
  if (definition.provider.type !== 'intranet') {
    return { ok: false, errorType: 'validation_error', message: `dynamic_provider_must_be_intranet:${definition.id}` };
  }
  const missing = definition.parameterSchema.required.filter((name) => {
    const value = input.mappedParameters[name];
    return typeof value !== 'string' || !value.trim();
  });
  if (missing.length) {
    return {
      ok: false,
      errorType: 'validation_error',
      message: `missing_required_parameters:${missing.join(',')}`
    };
  }
  return null;
}

export async function executeIntranetDynamicCommand(
  definition: DynamicCommandDefinition,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const config = configStateService.getConfig() as any;
  const baseUrl = String(config?.lolApiBaseUrl || '').trim();
  if (!baseUrl) return failure('lol_api_base_url_missing');
  const parameters = {
    command_id: definition.id,
    ...Object.fromEntries(
      Object.entries(input.mappedParameters || {})
        .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
        .filter(([key, value]) => Boolean(key && value))
    )
  };
  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: 'dynamic',
      parameters,
      preferred: 'text',
      timeoutMs: timeoutMs(),
      requestId: requestId(definition, input, context),
      ...(requestFn ? { requestFn } : {})
    });
    return structuredResult(plan, input, context, `动态查询 ${definition.id} 已完成。`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    loggingStateService.warn(`[IntranetDynamic] command=${definition.id} failed=${detail.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 200)}`);
    return failure(detail.slice(0, 200));
  }
}

export function createIntranetDynamicCommandPlugin(
  definition: DynamicCommandDefinition,
  source: 'json' | 'plugin' = 'json'
): CommandPlugin {
  if (definition.provider.type !== 'intranet') {
    throw new Error(`dynamic_provider_must_be_intranet:${definition.id}`);
  }
  return {
    metadata: {
      id: definition.id,
      name: definition.id,
      description: definition.fallbackText || `动态命令 ${definition.id}`,
      version: '1.0.0',
      author: source === 'json' ? 'system.intranet-json-loader' : 'system.intranet-plugin-runtime',
      specVersion: '3.0'
    },
    definition,
    source,
    schema: {
      id: definition.id,
      name: definition.id,
      enabled: definition.enabled !== false,
      trigger: definition.trigger.value,
      triggerType: definition.trigger.type,
      permission: definition.permission || 'all',
      scope: definition.scope || 'group',
      hot: (definition.priority || 0) > 0,
      desc: definition.fallbackText || `动态命令 ${definition.id}`,
      source,
      inputSchema: {
        required: definition.parameterSchema.required,
        optional: definition.parameterSchema.optional
      },
      outputSchema: {
        supported: ['text', 'structured'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async (input) => validateMappedParameters(definition, input),
    execute: (input, context) => executeIntranetDynamicCommand(definition, input, context),
    fallback: async () => ({
      ok: true,
      response: {
        type: 'text',
        text: fallbackText(definition)
      }
    })
  };
}
