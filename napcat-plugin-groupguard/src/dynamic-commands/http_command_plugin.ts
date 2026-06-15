import { loggingStateService } from '../core/state-services/logging_state_service';
import { applyHttpResponseTransformHooks } from './command_plugin_interface';
import { isDynamicCommandSnapshotCurrent } from './command_registry';
import { validateDynamicCommandDefinition } from './command_validator';
import {
  initializeCircuitBreakerStore,
  loadCircuitBreakerState,
  saveCircuitBreakerState
} from './circuit_breaker_store';
import { getCompatibleFetch } from './fetch_compat';
import {
  initializeMetricsStore,
  loadMetrics,
  saveMetrics
} from './metrics_store';
import { runWithDynamicCommandSemaphore } from './request_semaphore';
import { replaceDynamicCommandTokens, safeExtractByDotPath } from './command_runtime';
import {
  buildResponseCacheKey,
  initializeResponseCacheStore,
  loadLastSuccessfulResponse,
  saveLastSuccessfulResponse
} from './response_cache_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  CommandRuntimeSchemaItem,
  DynamicCommandCircuitBreakerSnapshot,
  DynamicCommandDebugTrace,
  DynamicCommandDefinition,
  DynamicCommandErrorType,
  DynamicCommandHealthReportItem,
  DynamicCommandMetricSnapshot,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput,
  UnifiedCommandResponse
} from './types';

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;
const HARD_EXECUTION_LIMIT_MS = 10_000;
const SOFT_EXECUTION_WARNING_MS = 8_000;
const NETWORK_RETRY_DELAYS_MS = [100, 500];
const EMPTY_RESPONSE_RETRY_DELAY_MS = 100;
const CIRCUIT_BREAKER_DECAY_INTERVAL_MS = 30_000;
const HALF_OPEN_MAX_TRIAL_REQUESTS = 2;

type CircuitBreakerStateName = 'closed' | 'open' | 'half_open';

interface CircuitBreakerState {
  state: CircuitBreakerStateName;
  consecutiveFailures: number;
  openedAt: number;
  halfOpenInFlight: boolean;
  halfOpenTrialCount: number;
  lastFailureAt: number;
}

interface DynamicCommandMetricState {
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  lastFailureReason: DynamicCommandErrorType | null;
  messageTypeStats: {
    group: number;
    private: number;
  };
}

const circuitBreakerStates = new Map<string, CircuitBreakerState>();
const circuitBreakerActivationCounts = new Map<string, number>();
const dynamicCommandMetrics = new Map<string, DynamicCommandMetricState>();
const pluginDebugTraces = new Map<string, DynamicCommandDebugTrace>();
let runtimeStoresInitialized = false;
const retryStats = {
  totalRetryAttempts: 0,
  totalRetryRecoveredSuccesses: 0,
  totalCacheHits: 0,
  failureReasons: new Map<string, number>()
};

function buildUrl(baseUrl: string, query?: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function resolveRequestMap(input: Record<string, string> | undefined, parameters: Record<string, string>): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = replaceDynamicCommandTokens(value, parameters);
  }
  return output;
}

function normalizeResponseText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildFailureResult(errorType: DynamicCommandErrorType, message: string): UnifiedCommandExecutionResult {
  return {
    ok: false,
    errorType,
    message
  };
}

function logPluginRuntimeEvent(
  level: 'info' | 'warn',
  payload: Record<string, unknown>
): void {
  const tag = 'dynamic_command_runtime';
  if (level === 'warn') {
    loggingStateService.warn(`${tag}:${String(payload.event || '')}`);
    return;
  }
  loggingStateService.info(`${tag}:${String(payload.event || '')}`);
}

function getOrCreatePluginTrace(commandId: string): DynamicCommandDebugTrace {
  if (!pluginDebugTraces.has(commandId)) {
    pluginDebugTraces.set(commandId, {
      commandId,
      resolvedAt: null,
      resolutionLatencyMs: null,
      validation: {
        ok: true,
        errorType: null,
        detail: null,
        durationMs: null
      },
      execution: {
        ok: true,
        errorType: null,
        detail: null,
        durationMs: null,
        fallbackTriggered: false,
        fallbackReason: null
      },
      circuitBreakerState: 'unknown'
    });
  }
  return pluginDebugTraces.get(commandId)!;
}

function recordPluginValidationTrace(
  commandId: string,
  result: { ok: boolean; errorType?: DynamicCommandErrorType; detail?: string; durationMs: number; }
): void {
  const trace = getOrCreatePluginTrace(commandId);
  trace.validation = {
    ok: result.ok,
    errorType: result.errorType || null,
    detail: result.detail || null,
    durationMs: result.durationMs
  };
}

function recordPluginExecutionTrace(
  commandId: string,
  result: { ok: boolean; errorType?: DynamicCommandErrorType; detail?: string; durationMs: number; fallbackTriggered?: boolean; fallbackReason?: string; }
): void {
  const trace = getOrCreatePluginTrace(commandId);
  trace.execution = {
    ok: result.ok,
    errorType: result.errorType || null,
    detail: result.detail || null,
    durationMs: result.durationMs,
    fallbackTriggered: !!result.fallbackTriggered,
    fallbackReason: result.fallbackReason || null
  };
  trace.circuitBreakerState = getCircuitBreakerState(commandId).state;
}

function buildSuccessResponse(text: string): UnifiedCommandResponse {
  if (/^https?:\/\//i.test(text.trim())) {
    return {
      type: 'link',
      text,
      url: text.trim()
    };
  }
  return {
    type: 'text',
    text
  };
}

function getCircuitBreakerState(commandId: string): CircuitBreakerState {
  if (!circuitBreakerStates.has(commandId)) {
    circuitBreakerStates.set(commandId, {
      state: 'closed',
      consecutiveFailures: 0,
      openedAt: 0,
      halfOpenInFlight: false,
      halfOpenTrialCount: 0,
      lastFailureAt: 0
    });
  }
  return circuitBreakerStates.get(commandId)!;
}

function toCircuitBreakerSnapshot(commandId: string, state: CircuitBreakerState): DynamicCommandCircuitBreakerSnapshot {
  return {
    commandId,
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    openedAt: state.openedAt,
    lastFailureAt: state.lastFailureAt
  };
}

function persistCircuitBreakerState(commandId: string): void {
  void saveCircuitBreakerState(commandId, toCircuitBreakerSnapshot(commandId, getCircuitBreakerState(commandId)));
}

function setCircuitBreakerState(commandId: string, nextState: CircuitBreakerStateName, reason: string): void {
  const state = getCircuitBreakerState(commandId);
  if (state.state !== nextState) {
    logPluginRuntimeEvent(nextState === 'open' ? 'warn' : 'info', {
      event: 'circuit_breaker_transition',
      commandId,
      previousState: state.state,
      nextState,
      reason,
      consecutiveFailures: state.consecutiveFailures
    });
  }
  state.state = nextState;
  getOrCreatePluginTrace(commandId).circuitBreakerState = nextState;
}

function canExecuteHttpCommand(commandId: string): UnifiedCommandExecutionResult | null {
  const state = getCircuitBreakerState(commandId);
  const now = Date.now();
  if (state.lastFailureAt > 0) {
    const decaySteps = Math.floor((now - state.lastFailureAt) / CIRCUIT_BREAKER_DECAY_INTERVAL_MS);
    if (decaySteps > 0) {
      state.consecutiveFailures = Math.max(0, state.consecutiveFailures - decaySteps);
      state.lastFailureAt = now;
      if (state.state === 'closed' && state.consecutiveFailures === 0) {
        persistCircuitBreakerState(commandId);
      }
    }
  }
  if (state.state === 'open') {
    if (now - state.openedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      setCircuitBreakerState(commandId, 'half_open', 'cooldown_elapsed');
      state.halfOpenInFlight = false;
      state.halfOpenTrialCount = 0;
      persistCircuitBreakerState(commandId);
      return null;
    }
    return buildFailureResult('circuit_open', 'circuit_open');
  }
  if (state.state === 'half_open') {
    if (state.halfOpenInFlight || state.halfOpenTrialCount >= HALF_OPEN_MAX_TRIAL_REQUESTS) {
      return buildFailureResult('circuit_open', 'circuit_half_open');
    }
    state.halfOpenInFlight = true;
    state.halfOpenTrialCount += 1;
  }
  return null;
}

function markCircuitBreakerSuccess(commandId: string): void {
  const state = getCircuitBreakerState(commandId);
  setCircuitBreakerState(commandId, 'closed', 'execution_success');
  state.consecutiveFailures = 0;
  state.openedAt = 0;
  state.halfOpenInFlight = false;
  state.halfOpenTrialCount = 0;
  persistCircuitBreakerState(commandId);
}

function markCircuitBreakerFailure(commandId: string): void {
  const state = getCircuitBreakerState(commandId);
  const previousState = state.state;
  state.consecutiveFailures += 1;
  state.halfOpenInFlight = false;
  state.lastFailureAt = Date.now();
  if (state.state === 'half_open' || state.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    setCircuitBreakerState(commandId, 'open', 'failure_threshold');
    state.openedAt = Date.now();
    if (previousState !== 'open') {
      circuitBreakerActivationCounts.set(commandId, (circuitBreakerActivationCounts.get(commandId) || 0) + 1);
    }
    persistCircuitBreakerState(commandId);
    return;
  }
  setCircuitBreakerState(commandId, 'closed', 'failure_below_threshold');
  persistCircuitBreakerState(commandId);
}

function clearCircuitBreakerInFlight(commandId: string): void {
  const state = getCircuitBreakerState(commandId);
  if (state.state === 'half_open') {
    state.halfOpenInFlight = false;
    persistCircuitBreakerState(commandId);
  }
}

function getOrCreateMetricState(commandId: string): DynamicCommandMetricState {
  if (!dynamicCommandMetrics.has(commandId)) {
    dynamicCommandMetrics.set(commandId, {
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      lastFailureReason: null,
      messageTypeStats: {
        group: 0,
        private: 0
      }
    });
  }
  return dynamicCommandMetrics.get(commandId)!;
}

function recordDynamicCommandMetric(
  commandId: string,
  outcome: { success: boolean; latencyMs: number; errorType?: DynamicCommandErrorType; messageType?: 'group' | 'private'; }
): void {
  const metric = getOrCreateMetricState(commandId);
  metric.totalLatencyMs += outcome.latencyMs;
  if (outcome.success) {
    metric.successCount += 1;
  } else {
    metric.failureCount += 1;
    metric.lastFailureReason = outcome.errorType || null;
  }
  const totalCount = metric.successCount + metric.failureCount;
  metric.averageLatencyMs = totalCount > 0 ? metric.totalLatencyMs / totalCount : 0;
  if (outcome.messageType) {
    metric.messageTypeStats[outcome.messageType] += 1;
  }
  void saveMetrics(commandId, {
    commandId,
    successCount: metric.successCount,
    failureCount: metric.failureCount,
    averageLatencyMs: metric.averageLatencyMs,
    lastFailureReason: metric.lastFailureReason,
    messageTypeStats: {
      group: metric.messageTypeStats.group,
      private: metric.messageTypeStats.private
    }
  });
}

export function getDynamicCommandMetrics(): DynamicCommandMetricSnapshot[] {
  return Array.from(dynamicCommandMetrics.entries()).map(([commandId, metric]) => ({
    commandId,
    successCount: metric.successCount,
    failureCount: metric.failureCount,
    averageLatencyMs: metric.averageLatencyMs,
    lastFailureReason: metric.lastFailureReason,
    messageTypeStats: {
      group: metric.messageTypeStats.group,
      private: metric.messageTypeStats.private
    }
  }));
}

export function getDynamicCommandMetric(commandId: string): DynamicCommandMetricSnapshot | null {
  const metric = dynamicCommandMetrics.get(commandId);
  if (!metric) return null;
  return {
    commandId,
    successCount: metric.successCount,
    failureCount: metric.failureCount,
    averageLatencyMs: metric.averageLatencyMs,
    lastFailureReason: metric.lastFailureReason,
    messageTypeStats: {
      group: metric.messageTypeStats.group,
      private: metric.messageTypeStats.private
    }
  };
}

export function recordDynamicCommandFinalOutcome(
  commandId: string,
  outcome: UnifiedCommandExecutionResult,
  messageType: 'group' | 'private',
  latencyMs: number
): void {
  if (outcome.ok) {
    recordDynamicCommandMetric(commandId, {
      success: true,
      latencyMs,
      messageType
    });
    return;
  }
  recordDynamicCommandMetric(commandId, {
    success: false,
    latencyMs,
    errorType: outcome.errorType,
    messageType
  });
}

export async function initializeDynamicCommandRuntime(commandIds: string[]): Promise<void> {
  if (!runtimeStoresInitialized) {
    await initializeMetricsStore();
    await initializeCircuitBreakerStore();
    await initializeResponseCacheStore();
    runtimeStoresInitialized = true;
  }
  for (const commandId of commandIds) {
    if (!dynamicCommandMetrics.has(commandId)) {
      const persistedMetric = await loadMetrics(commandId);
      if (persistedMetric) {
        dynamicCommandMetrics.set(commandId, {
          successCount: persistedMetric.successCount,
          failureCount: persistedMetric.failureCount,
          totalLatencyMs: persistedMetric.averageLatencyMs * (persistedMetric.successCount + persistedMetric.failureCount),
          averageLatencyMs: persistedMetric.averageLatencyMs,
          lastFailureReason: persistedMetric.lastFailureReason,
          messageTypeStats: {
            group: persistedMetric.messageTypeStats.group,
            private: persistedMetric.messageTypeStats.private
          }
        });
      }
    }
    if (!circuitBreakerStates.has(commandId)) {
      const persistedCircuitState = await loadCircuitBreakerState(commandId);
      if (persistedCircuitState) {
        circuitBreakerStates.set(commandId, {
          state: persistedCircuitState.state,
          consecutiveFailures: persistedCircuitState.consecutiveFailures,
          openedAt: persistedCircuitState.openedAt,
          halfOpenInFlight: false,
          halfOpenTrialCount: 0,
          lastFailureAt: persistedCircuitState.lastFailureAt
        });
      }
    }
  }
}

export function getAllCircuitBreakerStates(): Record<string, {
  state: CircuitBreakerStateName;
  consecutiveFailures: number;
  openedAt: number;
  lastFailureAt: number;
  activationCount: number;
}> {
  return Object.fromEntries(Array.from(circuitBreakerStates.entries()).map(([commandId, state]) => [
    commandId,
    {
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      openedAt: state.openedAt,
      lastFailureAt: state.lastFailureAt,
      activationCount: circuitBreakerActivationCounts.get(commandId) || 0
    }
  ]));
}

export function getDynamicCommandRuntimeStats() {
  return {
    totalRetryAttempts: retryStats.totalRetryAttempts,
    totalRetryRecoveredSuccesses: retryStats.totalRetryRecoveredSuccesses,
    totalCacheHits: retryStats.totalCacheHits,
    failureReasons: Object.fromEntries(retryStats.failureReasons.entries())
  };
}

export function getDynamicCommandDebugTrace(commandId: string): DynamicCommandDebugTrace | null {
  return pluginDebugTraces.get(commandId) || null;
}

function recordFailureReason(errorType: DynamicCommandErrorType): void {
  retryStats.failureReasons.set(errorType, (retryStats.failureReasons.get(errorType) || 0) + 1);
}

function shouldRetryResult(result: UnifiedCommandExecutionResult): boolean {
  if (result.ok) return false;
  if (result.errorType === 'timeout_soft' || result.errorType === 'timeout_hard') return true;
  if (result.errorType !== 'http_error') return false;
  if (/^HTTP 5\d\d$/.test(result.message) || result.message === 'HTTP 429') return true;
  if (!/^HTTP \d{3}$/.test(result.message)) return true;
  return false;
}

export function getDynamicCommandHealthReport(): DynamicCommandHealthReportItem[] {
  return getDynamicCommandMetrics().map((metric) => {
    const total = metric.successCount + metric.failureCount;
    const successRate = total > 0 ? metric.successCount / total : 1;
    const circuitState = getCircuitBreakerState(metric.commandId).state;
    let score = Math.round(successRate * 100);
    if (metric.averageLatencyMs >= 5000) score -= 40;
    else if (metric.averageLatencyMs >= 3000) score -= 20;
    else if (metric.averageLatencyMs >= 1500) score -= 10;
    if (circuitState === 'half_open') score -= 20;
    if (circuitState === 'open') score -= 50;
    const boundedScore = Math.max(0, Math.min(100, score));
    let status: DynamicCommandHealthReportItem['status'] = 'healthy';
    if (boundedScore < 80) status = 'degraded';
    if (boundedScore < 50) status = 'failing';
    return {
      commandId: metric.commandId,
      status,
      score: boundedScore,
      successRate,
      averageLatencyMs: metric.averageLatencyMs,
      circuitState,
      lastFailureReason: metric.lastFailureReason
    };
  });
}

function parseHttpResponsePayload(responseText: string): { data: unknown; isJson: boolean; } | { data: string; isJson: false; } {
  try {
    return {
      data: JSON.parse(responseText),
      isJson: true
    };
  } catch {
    return {
      data: responseText,
      isJson: false
    };
  }
}

function validateInput(definition: DynamicCommandDefinition, input: UnifiedCommandNormalizedInput): UnifiedCommandExecutionResult | null {
  if (!isDynamicCommandSnapshotCurrent(input.registryVersion)) {
    return buildFailureResult('validation_error', 'stale_snapshot');
  }
  const definitionErrors = validateDynamicCommandDefinition(definition);
  if (definitionErrors.length) {
    return buildFailureResult('validation_error', definitionErrors[0].message);
  }
  const missingRequired = definition.parameterSchema.required.filter((name) => {
    const value = input.mappedParameters[name];
    return typeof value !== 'string' || !value.trim();
  });
  if (missingRequired.length) {
    return buildFailureResult('validation_error', `missing_required_parameters:${missingRequired.join(',')}`);
  }
  return null;
}

async function executeSingleRetryAttempt(
  compatibleFetch: typeof fetch,
  url: string,
  baseInit: RequestInit,
  definition: DynamicCommandDefinition,
  input: UnifiedCommandNormalizedInput,
  normalizedTimeoutMs: number,
  deadlineAt: number,
  attemptNumber: number
): Promise<UnifiedCommandExecutionResult> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return buildFailureResult('timeout_hard', 'timeout_hard');
  }
  const attemptTimeoutMs = Math.max(100, Math.min(normalizedTimeoutMs, remainingMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
  const init: RequestInit = {
    ...baseInit,
    signal: controller.signal
  };

  try {
    const response = await compatibleFetch(url, init);
    const responseText = await response.text();
    if (!response.ok) {
      return buildFailureResult('http_error', `HTTP ${response.status}`);
    }
    const parsedPayload = parseHttpResponsePayload(responseText);
    if (parsedPayload.isJson && !definition.response.textPath) {
      return buildFailureResult('invalid_response', 'missing_text_path');
    }
    if (!parsedPayload.isJson && definition.response.textPath && /^[\[{]/.test(responseText.trim())) {
      return buildFailureResult('invalid_response', 'invalid_json');
    }
    const transformedPayload = await applyHttpResponseTransformHooks(parsedPayload.data, {
      command: definition,
      registryVersion: input.registryVersion,
      priority: definition.priority || 0,
      matchedTrigger: definition.trigger.value,
      rawArgument: input.rawArgument,
      mappedParameters: input.mappedParameters
    });
    const extracted = parsedPayload.isJson
      ? safeExtractByDotPath(transformedPayload, definition.response.textPath)
      : transformedPayload;
    const normalizedExtracted = normalizeResponseText(extracted).trim();
    if (!normalizedExtracted || extracted == null) {
      if (attemptNumber === 1) {
        retryStats.totalRetryAttempts += 1;
        await new Promise((resolve) => setTimeout(resolve, EMPTY_RESPONSE_RETRY_DELAY_MS));
        return executeSingleRetryAttempt(compatibleFetch, url, baseInit, definition, input, normalizedTimeoutMs, deadlineAt, attemptNumber + 1);
      }
      return buildFailureResult('empty_response', 'empty_response');
    }
    return {
      ok: true,
      response: buildSuccessResponse(normalizedExtracted)
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return buildFailureResult(attemptTimeoutMs >= remainingMs ? 'timeout_hard' : 'timeout_soft', attemptTimeoutMs >= remainingMs ? 'timeout_hard' : 'timeout_soft');
    }
    return buildFailureResult('http_error', String(error?.message || error));
  } finally {
    clearTimeout(timer);
  }
}

async function executeHttpDefinition(definition: DynamicCommandDefinition, input: UnifiedCommandNormalizedInput): Promise<UnifiedCommandExecutionResult> {
  return runWithDynamicCommandSemaphore(async () => {
    if (definition.provider.type !== 'http') {
      return buildFailureResult('validation_error', `invalid_provider_type:${definition.id}`);
    }
    const provider = definition.provider;
    const circuitGuardResult = canExecuteHttpCommand(definition.id);
    if (circuitGuardResult) {
      logPluginRuntimeEvent('warn', {
        event: 'plugin_execution_short_circuit',
        commandId: definition.id,
        reason: circuitGuardResult.errorType
      });
      return circuitGuardResult;
    }
    const timeoutMs = Math.min(HARD_EXECUTION_LIMIT_MS, Number.isFinite(provider.timeoutMs)
      ? Math.max(1000, Number(provider.timeoutMs))
      : HARD_EXECUTION_LIMIT_MS);
    const deadlineAt = Date.now() + HARD_EXECUTION_LIMIT_MS;
    const softWarningTimer = setTimeout(() => {
      loggingStateService.warn(`[DynamicCommandRuntime] soft timeout warning command=${definition.id} elapsed=${SOFT_EXECUTION_WARNING_MS}`);
    }, SOFT_EXECUTION_WARNING_MS);

    try {
      const resolvedUrl = replaceDynamicCommandTokens(provider.url, input.mappedParameters);
      const resolvedHeaders = resolveRequestMap(provider.headers, input.mappedParameters);
      const resolvedQuery = resolveRequestMap(provider.query, input.mappedParameters);
      const resolvedBody = resolveRequestMap(provider.body, input.mappedParameters);
      const url = buildUrl(resolvedUrl, resolvedQuery);
      const baseInit: RequestInit = {
        method: provider.method,
        headers: resolvedHeaders
      };
      if (provider.method === 'POST' && resolvedBody) {
        baseInit.body = JSON.stringify(resolvedBody);
        baseInit.headers = {
          'Content-Type': 'application/json',
          ...(resolvedHeaders || {})
        };
      }

      const compatibleFetch = await getCompatibleFetch();
      let finalResult = await executeSingleRetryAttempt(compatibleFetch, url, baseInit, definition, input, timeoutMs, deadlineAt, 1);
      let recoveredByRetry = false;

      if (!finalResult.ok && shouldRetryResult(finalResult)) {
        for (let retryIndex = 0; retryIndex < NETWORK_RETRY_DELAYS_MS.length; retryIndex++) {
          retryStats.totalRetryAttempts += 1;
          await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[retryIndex]));
          const retryResult = await executeSingleRetryAttempt(
            compatibleFetch,
            url,
            baseInit,
            definition,
            input,
            timeoutMs,
            deadlineAt,
            retryIndex + 2
          );
          if (retryResult.ok) {
            finalResult = retryResult;
            recoveredByRetry = true;
            break;
          }
          finalResult = retryResult;
          if (finalResult.errorType === 'invalid_response') break;
        }
      }

      if (finalResult.ok) {
        if (recoveredByRetry) {
          retryStats.totalRetryRecoveredSuccesses += 1;
        }
        markCircuitBreakerSuccess(definition.id);
        return finalResult;
      }
      markCircuitBreakerFailure(definition.id);
      recordFailureReason(finalResult.errorType);
      return finalResult;
    } catch (error: any) {
      markCircuitBreakerFailure(definition.id);
      const failure = error?.name === 'AbortError'
        ? buildFailureResult('timeout_hard', 'timeout_hard')
        : buildFailureResult('http_error', String(error?.message || error));
      recordFailureReason(failure.errorType);
      return failure;
    } finally {
      clearCircuitBreakerInFlight(definition.id);
      clearTimeout(softWarningTimer);
    }
  }).catch((error: any) => {
    const message = String(error?.message || error || '');
    if (message === 'backpressure_reject') {
      return buildFailureResult('quota_exceeded', 'backpressure_reject');
    }
    throw error;
  });
}

function buildSchema(definition: DynamicCommandDefinition, source: 'json' | 'plugin'): CommandRuntimeSchemaItem {
  return {
    id: definition.id,
    name: definition.id,
    enabled: definition.enabled !== false,
    trigger: definition.trigger.value,
    triggerType: definition.trigger.type,
    permission: 'all',
    scope: 'group/private',
    hot: (definition.priority || 0) > 0,
    desc: definition.fallbackText || `动态命令 ${definition.id}`,
    source,
    inputSchema: {
      required: definition.parameterSchema.required,
      optional: definition.parameterSchema.optional
    },
    outputSchema: {
      supported: ['text', 'link', 'media', 'structured'],
      defaultType: 'text'
    }
  };
}

export function createHttpCommandPlugin(definition: DynamicCommandDefinition, source: 'json' | 'plugin' = 'json'): CommandPlugin {
  return {
    metadata: {
      id: definition.id,
      name: definition.id,
      description: definition.fallbackText || `动态命令 ${definition.id}`,
      version: '1.0.0',
      author: source === 'json' ? 'system.json-loader' : 'system.plugin-runtime',
      specVersion: '3.0'
    },
    definition,
    source,
    schema: buildSchema(definition, source),
    defaultConfig: {},
    validate: async (input, _context) => {
      const startedAt = Date.now();
      const result = validateInput(definition, input);
      recordPluginValidationTrace(definition.id, {
        ok: !result,
        errorType: result && !result.ok ? result.errorType : undefined,
        detail: result && !result.ok ? result.message : 'validation_ok',
        durationMs: Date.now() - startedAt
      });
      logPluginRuntimeEvent(result ? 'warn' : 'info', {
        event: 'plugin_validation',
        commandId: definition.id,
        ok: !result,
        errorType: result && !result.ok ? result.errorType : null,
        durationMs: Date.now() - startedAt
      });
      return result;
    },
    execute: async (input, _context) => {
      const startedAt = Date.now();
      const result = await executeHttpDefinition(definition, input);
      if (result.ok) {
        const cacheKey = buildResponseCacheKey(definition.id, {
          rawArgument: input.rawArgument,
          mappedParameters: input.mappedParameters
        });
        await saveLastSuccessfulResponse(cacheKey, normalizeResponseText(result.response.type === 'text'
          ? result.response.text
          : result.response.type === 'link'
            ? result.response.url
            : result.response.type === 'media'
              ? result.response.url
              : result.response.text));
        recordPluginExecutionTrace(definition.id, {
          ok: true,
          detail: 'execution_ok',
          durationMs: Date.now() - startedAt
        });
        logPluginRuntimeEvent('info', {
          event: 'plugin_execution',
          commandId: definition.id,
          ok: true,
          durationMs: Date.now() - startedAt
        });
        return result;
      }
      recordPluginExecutionTrace(definition.id, {
        ok: false,
        errorType: result.errorType,
        detail: result.message,
        durationMs: Date.now() - startedAt
      });
      logPluginRuntimeEvent('warn', {
        event: 'plugin_execution',
        commandId: definition.id,
        ok: false,
        errorType: result.errorType,
        durationMs: Date.now() - startedAt
      });
      return result;
    },
    fallback: async (input, failure, _context) => {
      const cacheKey = buildResponseCacheKey(definition.id, {
        rawArgument: input.rawArgument,
        mappedParameters: input.mappedParameters
      });
      if (failure.errorType === 'circuit_open') {
        const cachedResponse = await loadLastSuccessfulResponse(cacheKey);
        if (cachedResponse) {
          retryStats.totalCacheHits += 1;
          recordPluginExecutionTrace(definition.id, {
            ok: true,
            durationMs: 0,
            fallbackTriggered: true,
            fallbackReason: failure.errorType,
            detail: 'fallback_cache_hit'
          });
          logPluginRuntimeEvent('info', {
            event: 'plugin_fallback',
            commandId: definition.id,
            fallbackReason: failure.errorType,
            strategy: 'cache'
          });
          return {
            ok: true,
            response: buildSuccessResponse(cachedResponse)
          };
        }
      }
      recordPluginExecutionTrace(definition.id, {
        ok: true,
        durationMs: 0,
        fallbackTriggered: true,
        fallbackReason: failure.errorType,
        detail: 'fallback_text'
      });
      logPluginRuntimeEvent('warn', {
        event: 'plugin_fallback',
        commandId: definition.id,
        fallbackReason: failure.errorType,
        strategy: 'fallback_text'
      });
      return {
        ok: true,
        response: {
          type: 'text',
          text: definition.fallbackText || '动态命令暂时不可用，请稍后再试'
        }
      };
    }
  };
}
