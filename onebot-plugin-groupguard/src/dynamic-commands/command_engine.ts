import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import type { OneBotMessageEvent } from '../protocol/onebot11/types';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { shouldBlockByBotRole } from '../core/bot_role';
import type { CommandContext } from '../commands/dispatcher';
import {
  runAfterExecuteHooks,
  runBeforeExecuteHooks,
  runOnErrorHooks
} from './command_plugin_interface';
import { getCommandPluginRecord } from './command_plugin_registry';
import { assertCommandPluginResultContract } from './command_runtime_plugin';
import {
  formatUnifiedCommandResponse,
  sendUnifiedCommandResponse
} from './command_response_formatter';
import {
  getAllCircuitBreakerStates,
  getDynamicCommandDebugTrace,
  getDynamicCommandHealthReport,
  getDynamicCommandMetric,
  getDynamicCommandMetrics,
  getDynamicCommandRuntimeStats,
  initializeDynamicCommandRuntime,
  recordDynamicCommandFinalOutcome
} from './http_command_plugin';
import {
  runWithCommandEngineScope,
  runWithPluginRuntimeScope,
  runWithResponseCaptureScope
} from './execution_guard';
import { enforcePluginAccessPolicy } from './plugin_access_guard';
import { recordCommandExecutionMetric } from './runtime_observability_store';
import type {
  DynamicCommandExecutionResult,
  DynamicCommandErrorType,
  DynamicCommandMatchResult,
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

export {
  getAllCircuitBreakerStates,
  getDynamicCommandDebugTrace,
  getDynamicCommandHealthReport,
  getDynamicCommandMetric,
  getDynamicCommandMetrics,
  getDynamicCommandRuntimeStats
} from './http_command_plugin';

export const initializeDynamicCommandMetrics = initializeDynamicCommandRuntime;

function buildFailureResult(errorType: DynamicCommandErrorType, message: string): DynamicCommandExecutionResult {
  return {
    ok: false,
    errorType,
    message
  };
}

function buildUnifiedFailureResult(
  errorType: DynamicCommandErrorType,
  message: string
): Extract<UnifiedCommandExecutionResult, { ok: false }> {
  return { ok: false, errorType, message };
}

function toLegacyExecutionResult(result: UnifiedCommandExecutionResult): DynamicCommandExecutionResult {
  if (!result.ok) {
    return buildFailureResult(result.errorType, result.message);
  }
  return {
    ok: true,
    text: formatUnifiedCommandResponse(result.response)
  };
}

function logPluginEngineEvent(
  level: 'info' | 'warn',
  payload: Record<string, unknown>
): void {
  const serialized = JSON.stringify({
    scope: 'dynamic_command_engine',
    timestamp: new Date().toISOString(),
    ...payload
  });
  if (level === 'warn') {
    loggingStateService.warn(serialized);
    return;
  }
  loggingStateService.info(serialized);
}

function buildNormalizedInput(
  matched: DynamicCommandMatchResult,
  event: Pick<OneBotMessageEvent, 'message_type' | 'user_id' | 'group_id' | 'raw_message'>,
  commandContext: Pick<CommandContext, 'cleanedText' | 'source'>
): UnifiedCommandNormalizedInput {
  return {
    commandId: matched.command.id,
    registryVersion: matched.registryVersion,
    rawText: event.raw_message || '',
    cleanedText: commandContext.cleanedText,
    rawArgument: matched.rawArgument,
    mappedParameters: matched.mappedParameters,
    messageType: event.message_type === 'private' ? 'private' : 'group',
    userId: String(event.user_id || ''),
    groupId: event.group_id ? String(event.group_id) : undefined,
    source: commandContext.source
  };
}

async function executeResolvedPlugin(
  matched: DynamicCommandMatchResult,
  input: UnifiedCommandNormalizedInput,
  executionContext: UnifiedCommandExecutionContext
): Promise<{ primaryResult: UnifiedCommandExecutionResult; finalResult: UnifiedCommandExecutionResult; }> {
  return runWithPluginRuntimeScope(matched.command.id, async () => {
    const resolvedAt = Date.now();
    const pluginRecord = getCommandPluginRecord(matched.command.id);
    if (!pluginRecord) {
      const failure = buildUnifiedFailureResult('validation_error', `plugin_not_found:${matched.command.id}`);
      logPluginEngineEvent('warn', {
        event: 'plugin_resolution',
        commandId: matched.command.id,
        ok: false,
        resolutionLatencyMs: Date.now() - resolvedAt
      });
      return {
        primaryResult: failure,
        finalResult: failure
      };
    }
    const plugin = pluginRecord.plugin;
    logPluginEngineEvent('info', {
      event: 'plugin_resolution',
      commandId: matched.command.id,
      ok: true,
      source: plugin.source,
      resolutionLatencyMs: Date.now() - resolvedAt
    });
    const runtimeContext: UnifiedCommandExecutionContext = {
      ...executionContext,
      plugin: {
        metadata: plugin.metadata,
        enabled: pluginRecord.enabled,
        runtimeConfig: pluginRecord.runtimeConfig,
        effectiveConfig: pluginRecord.effectiveConfig
      }
    };
    const guardResult = enforcePluginAccessPolicy(runtimeContext);
    if (guardResult) {
      assertCommandPluginResultContract(guardResult);
      logPluginEngineEvent('warn', {
        event: 'plugin_access_denied',
        commandId: matched.command.id,
        errorType: guardResult.errorType
      });
      return {
        primaryResult: guardResult,
        finalResult: guardResult
      };
    }
    const validationResult = await plugin.validate?.(input, runtimeContext);
    if (validationResult) {
      assertCommandPluginResultContract(validationResult);
    }
    if (validationResult) {
      const fallbackResult = !validationResult.ok && plugin.fallback
        ? await plugin.fallback(input, validationResult, runtimeContext)
        : null;
      if (fallbackResult) {
        assertCommandPluginResultContract(fallbackResult);
      }
      return {
        primaryResult: validationResult,
        finalResult: fallbackResult || validationResult
      };
    }
    const primaryResult = await plugin.execute(input, runtimeContext);
    assertCommandPluginResultContract(primaryResult);
    const fallbackResult = !primaryResult.ok && plugin.fallback
      ? await plugin.fallback(input, primaryResult, runtimeContext)
      : null;
    if (fallbackResult) {
      assertCommandPluginResultContract(fallbackResult);
    }
    return {
      primaryResult,
      finalResult: fallbackResult || primaryResult
    };
  });
}

function logDynamicCommandEvent(payload: {
  commandId: string;
  type: 'success' | 'failure';
  latency: number;
  errorType?: DynamicCommandErrorType;
  timestamp: string;
  rawMessage?: string;
  detail?: string;
}): void {
  const serialized = JSON.stringify(payload);
  if (payload.type === 'failure') {
    loggingStateService.warn(serialized);
    return;
  }
  loggingStateService.info(serialized);
}

function recordExecution(input: {
  pluginId: string;
  commandId: string;
  finalResult: UnifiedCommandExecutionResult;
  messageType: 'group' | 'private';
  userId: string;
  groupId?: string;
  latencyMs: number;
  rawMessage?: string;
  detail?: string;
}): void {
  recordCommandExecutionMetric({
    pluginId: input.pluginId,
    commandId: input.commandId,
    userId: input.userId,
    groupId: input.groupId,
    latencyMs: input.latencyMs,
    succeeded: input.finalResult.ok,
    errorType: input.finalResult.ok ? null : input.finalResult.errorType
  });
  recordDynamicCommandFinalOutcome(input.commandId, input.finalResult, input.messageType, input.latencyMs);
  logDynamicCommandEvent({
    commandId: input.commandId,
    type: input.finalResult.ok ? 'success' : 'failure',
    latency: input.latencyMs,
    errorType: input.finalResult.ok ? undefined : input.finalResult.errorType,
    timestamp: new Date().toISOString(),
    rawMessage: input.rawMessage,
    detail: input.detail
  });
}

export async function executeDynamicCommand(
  matched: DynamicCommandMatchResult,
  event: OneBotMessageEvent,
  _ctx: GroupGuardRuntimeContext,
  commandContext: CommandContext,
  startedAt = Date.now(),
  rawMessage = event.raw_message || ''
): Promise<boolean> {
  return runWithCommandEngineScope(matched.command.id, async () => {
    const hookContext = {
      commandId: matched.command.id,
      rawMessage,
      cleanedText: commandContext.cleanedText,
      source: commandContext.source
    };
    try {
      const input = buildNormalizedInput(matched, event, commandContext);
      const roleBlock = shouldBlockByBotRole({
        source: matched.command.id.startsWith('legacy.') ? 'legacy' : 'dynamic_command',
        rawMessage,
        featureType: matched.command.featureType || 'dynamic',
        featureKey: matched.command.featureKey || `dynamic.${matched.command.id}`,
        commandId: matched.command.id,
        legacyDomain: matched.command.id.startsWith('legacy.') ? matched.command.id.split('.')[1] : undefined
      });
      if (roleBlock.blocked) {
        loggingStateService.info(roleBlock.logLine || `bot_role_blocked role=${roleBlock.role} intent=${roleBlock.intent} rawMessage=${rawMessage} source=dynamic_command`);
        return true;
      }
      await runBeforeExecuteHooks(matched, hookContext);
      const executionStartedAt = Date.now();
      const { primaryResult, finalResult } = await executeResolvedPlugin(matched, input, {
        event,
        pluginContext: _ctx,
        plugin: {
          metadata: {
            id: matched.command.id,
            name: matched.command.id,
            description: matched.command.id,
            version: '1.0.0',
            author: 'system',
            specVersion: '3.0'
          },
          enabled: true,
          runtimeConfig: {},
          effectiveConfig: {}
        },
        commandContext
      });
      const finalLatencyMs = Date.now() - startedAt;
      recordExecution({
        pluginId: matched.command.id,
        commandId: matched.command.id,
        finalResult,
        messageType: input.messageType,
        userId: input.userId,
        groupId: input.groupId,
        latencyMs: finalLatencyMs,
        rawMessage,
        detail: finalResult.ok ? undefined : finalResult.message
      });
      logPluginEngineEvent(primaryResult.ok ? 'info' : 'warn', {
        event: 'plugin_execution_result',
        commandId: matched.command.id,
        ok: primaryResult.ok,
        errorType: primaryResult.ok ? null : primaryResult.errorType,
        durationMs: Date.now() - executionStartedAt
      });

      if (!primaryResult.ok && primaryResult.errorType !== 'bot_role_blocked') {
        await runOnErrorHooks(matched, primaryResult.errorType, primaryResult.message, hookContext);
      }

      await runAfterExecuteHooks(matched, toLegacyExecutionResult(finalResult), hookContext);

      if (!finalResult.ok) {
        if (finalResult.errorType === 'bot_role_blocked') {
          return true;
        }
        if (
          finalResult.errorType === 'plugin_disabled' ||
          finalResult.errorType === 'permission_denied' ||
          finalResult.errorType === 'quota_exceeded'
        ) {
          await runWithResponseCaptureScope(matched.command.id, async () => {
            await sendUnifiedCommandResponse(event, {
              type: 'text',
              text: finalResult.errorType
            });
          });
          return true;
        }
        return false;
      }

      await runWithResponseCaptureScope(matched.command.id, async () => {
        await sendUnifiedCommandResponse(event, finalResult.response);
      });
      return true;
    } catch (error) {
      const finalLatencyMs = Date.now() - startedAt;
      const finalResult: UnifiedCommandExecutionResult = {
        ok: false,
        errorType: 'http_error',
        message: String(error)
      };
      recordExecution({
        pluginId: matched.command.id,
        commandId: matched.command.id,
        finalResult,
        messageType: event.message_type === 'private' ? 'private' : 'group',
        userId: String(event.user_id || ''),
        groupId: event.group_id ? String(event.group_id) : undefined,
        latencyMs: finalLatencyMs,
        rawMessage,
        detail: String(error)
      });
      logPluginEngineEvent('warn', {
        event: 'plugin_execution_exception',
        commandId: matched.command.id,
        errorType: 'http_error',
        trace: getDynamicCommandDebugTrace(matched.command.id)
      });
      await runOnErrorHooks(matched, 'http_error', String(error), hookContext);
      return false;
    }
  });
}
