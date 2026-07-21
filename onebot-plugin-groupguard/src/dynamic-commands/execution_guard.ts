import { AsyncLocalStorage } from 'async_hooks';
import { loggingStateService } from '../core/state-services/logging_state_service';

type ExecutionStage = 'dispatcher' | 'command_engine' | 'plugin_runtime' | 'response_capture';

interface ExecutionGuardState {
  traceId: string;
  commandId: string;
  rawText: string;
  stages: Record<ExecutionStage, number>;
  path: ExecutionStage[];
}

export interface ExecutionGuardHistoryItem {
  traceId: string;
  commandId: string;
  rawText: string;
  stages: Record<ExecutionStage, number>;
  path: ExecutionStage[];
}

const executionGuardStorage = new AsyncLocalStorage<ExecutionGuardState>();
const executionGuardHistory: ExecutionGuardHistoryItem[] = [];
const MAX_HISTORY_ITEMS = 200;

function buildViolationError(message: string, context?: Record<string, unknown>): Error {
  const error = new Error('circuit_break_violation');
  loggingStateService.error(JSON.stringify({
    scope: 'dynamic_command_execution_guard',
    event: 'execution_violation',
    timestamp: new Date().toISOString(),
    message,
    context,
    stack: error.stack
  }));
  return error;
}

function getStateOrThrow(context?: Record<string, unknown>): ExecutionGuardState {
  const state = executionGuardStorage.getStore();
  if (!state) {
    throw buildViolationError('missing_execution_scope', context);
  }
  return state;
}

function pushHistory(state: ExecutionGuardState): void {
  executionGuardHistory.push({
    traceId: state.traceId,
    commandId: state.commandId,
    rawText: state.rawText,
    stages: {
      dispatcher: state.stages.dispatcher,
      command_engine: state.stages.command_engine,
      plugin_runtime: state.stages.plugin_runtime,
      response_capture: state.stages.response_capture
    },
    path: [...state.path]
  });
  while (executionGuardHistory.length > MAX_HISTORY_ITEMS) {
    executionGuardHistory.shift();
  }
}

export function getExecutionGuardHistory(): ExecutionGuardHistoryItem[] {
  return [...executionGuardHistory];
}

export function resetExecutionGuardHistory(): void {
  executionGuardHistory.length = 0;
}

export async function runWithDispatcherExecutionScope<T>(
  input: {
    commandId: string;
    rawText: string;
  },
  operation: () => Promise<T>
): Promise<T> {
  if (executionGuardStorage.getStore()) {
    throw buildViolationError('nested_dispatcher_scope', input);
  }
  const state: ExecutionGuardState = {
    traceId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    commandId: input.commandId,
    rawText: input.rawText,
    stages: {
      dispatcher: 1,
      command_engine: 0,
      plugin_runtime: 0,
      response_capture: 0
    },
    path: ['dispatcher']
  };
  return executionGuardStorage.run(state, async () => {
    const result = await operation();
    pushHistory(state);
    return result;
  });
}

export async function runWithCommandEngineScope<T>(
  commandId: string,
  operation: () => Promise<T>
): Promise<T> {
  const state = getStateOrThrow({ stage: 'command_engine', commandId });
  if (state.commandId !== commandId) {
    throw buildViolationError('command_id_mismatch', { expected: state.commandId, received: commandId });
  }
  if (state.stages.command_engine !== 0) {
    throw buildViolationError('command_engine_reentry', { commandId });
  }
  state.stages.command_engine += 1;
  state.path.push('command_engine');
  return operation();
}

export async function runWithPluginRuntimeScope<T>(
  commandId: string,
  operation: () => Promise<T>
): Promise<T> {
  const state = getStateOrThrow({ stage: 'plugin_runtime', commandId });
  if (state.commandId !== commandId || state.stages.command_engine !== 1 || state.stages.plugin_runtime !== 0) {
    throw buildViolationError('plugin_runtime_sequence_violation', {
      commandId,
      expectedCommandId: state.commandId,
      stages: state.stages
    });
  }
  state.stages.plugin_runtime += 1;
  state.path.push('plugin_runtime');
  return operation();
}

export async function runWithResponseCaptureScope<T>(
  commandId: string,
  operation: () => Promise<T>
): Promise<T> {
  const state = getStateOrThrow({ stage: 'response_capture', commandId });
  if (state.commandId !== commandId || state.stages.command_engine !== 1 || state.stages.plugin_runtime !== 1 || state.stages.response_capture !== 0) {
    throw buildViolationError('response_capture_sequence_violation', {
      commandId,
      expectedCommandId: state.commandId,
      stages: state.stages
    });
  }
  state.stages.response_capture += 1;
  state.path.push('response_capture');
  return operation();
}

export function assertResponseCaptureAllowed(context?: Record<string, unknown>): void {
  const state = executionGuardStorage.getStore();
  if (!state) return;
  if (state.stages.response_capture !== 1) {
    throw buildViolationError('response_capture_not_active', {
      ...context,
      commandId: state.commandId,
      stages: state.stages
    });
  }
}

export function assertPluginRuntimeCaptureAllowed(context?: Record<string, unknown>): void {
  const state = executionGuardStorage.getStore();
  if (!state) return;
  if (state.stages.plugin_runtime !== 1 || state.stages.response_capture > 0) {
    throw buildViolationError('plugin_capture_sequence_violation', {
      ...context,
      commandId: state.commandId,
      stages: state.stages
    });
  }
}
