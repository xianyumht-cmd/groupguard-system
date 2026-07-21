import { loggingStateService } from '../core/state-services/logging_state_service';
import type { DynamicCommandExecutionResult, DynamicCommandMatchResult } from './types';

const PLUGIN_HOOK_SOFT_TIMEOUT_MS = 50;

export interface DynamicCommandLifecycleContext {
  commandId: string;
  rawMessage?: string;
  cleanedText?: string;
  source?: string;
}

export interface DynamicCommandPlugin {
  id: string;
  enabled?: boolean;
  priority?: number;
  transformHttpResponse?: (payload: unknown, match: DynamicCommandMatchResult) => Promise<unknown> | unknown;
  beforeMatch?: (text: string) => Promise<void> | void;
  beforeExecute?: (match: DynamicCommandMatchResult, context: DynamicCommandLifecycleContext) => Promise<void> | void;
  afterExecute?: (match: DynamicCommandMatchResult, result: DynamicCommandExecutionResult, context: DynamicCommandLifecycleContext) => Promise<void> | void;
  onError?: (match: DynamicCommandMatchResult, errorType: string, detail: string, context: DynamicCommandLifecycleContext) => Promise<void> | void;
}

const registeredCommandPlugins = new Map<string, DynamicCommandPlugin>();

export function registerCommandPlugin(plugin: DynamicCommandPlugin): void {
  registeredCommandPlugins.set(plugin.id, plugin);
}

export function getRegisteredCommandPlugins(): DynamicCommandPlugin[] {
  return Array.from(registeredCommandPlugins.values())
    .filter((plugin) => plugin.enabled !== false)
    .sort((left, right) => (right.priority || 0) - (left.priority || 0) || left.id.localeCompare(right.id));
}

async function runPluginHookSafely<T>(
  plugin: DynamicCommandPlugin,
  hookName: 'beforeMatch' | 'beforeExecute' | 'afterExecute' | 'onError' | 'transformHttpResponse',
  operation: () => Promise<T>,
  fallbackValue: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const hookPromise = Promise.resolve(operation()).finally(() => {
      if (timer) clearTimeout(timer);
    });
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        loggingStateService.warn(`[DynamicCommandPlugin][${plugin.id}] ${hookName} soft timeout`);
        resolve(fallbackValue);
      }, PLUGIN_HOOK_SOFT_TIMEOUT_MS);
    });
    return await Promise.race([hookPromise, timeoutPromise]);
  } catch (error) {
    if (timer) clearTimeout(timer);
    loggingStateService.warn(`[DynamicCommandPlugin][${plugin.id}] ${hookName} failed: ${error}`);
    return fallbackValue;
  }
}

export async function runBeforeMatchHooks(text: string): Promise<void> {
  for (const plugin of getRegisteredCommandPlugins()) {
    if (!plugin.beforeMatch) continue;
    await runPluginHookSafely(plugin, 'beforeMatch', async () => {
      await plugin.beforeMatch?.(text);
    }, undefined);
  }
}

export async function runBeforeExecuteHooks(match: DynamicCommandMatchResult, context: DynamicCommandLifecycleContext): Promise<void> {
  for (const plugin of getRegisteredCommandPlugins()) {
    if (!plugin.beforeExecute) continue;
    await runPluginHookSafely(plugin, 'beforeExecute', async () => {
      await plugin.beforeExecute?.(match, context);
    }, undefined);
  }
}

export async function runAfterExecuteHooks(
  match: DynamicCommandMatchResult,
  result: DynamicCommandExecutionResult,
  context: DynamicCommandLifecycleContext
): Promise<void> {
  for (const plugin of getRegisteredCommandPlugins()) {
    if (!plugin.afterExecute) continue;
    await runPluginHookSafely(plugin, 'afterExecute', async () => {
      await plugin.afterExecute?.(match, result, context);
    }, undefined);
  }
}

export async function runOnErrorHooks(
  match: DynamicCommandMatchResult,
  errorType: string,
  detail: string,
  context: DynamicCommandLifecycleContext
): Promise<void> {
  for (const plugin of getRegisteredCommandPlugins()) {
    if (!plugin.onError) continue;
    await runPluginHookSafely(plugin, 'onError', async () => {
      await plugin.onError?.(match, errorType, detail, context);
    }, undefined);
  }
}

export async function applyHttpResponseTransformHooks(payload: unknown, match: DynamicCommandMatchResult): Promise<unknown> {
  let transformed = payload;
  for (const plugin of getRegisteredCommandPlugins()) {
    if (!plugin.transformHttpResponse) continue;
    transformed = await runPluginHookSafely(plugin, 'transformHttpResponse', async () => (
      await plugin.transformHttpResponse?.(transformed, match)
    ) as unknown, transformed);
  }
  return transformed;
}
