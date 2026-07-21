import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { getCommandPluginRecord, listAllCommandPlugins } from './command_plugin_registry';
import type { DynamicCommandErrorType } from './types';

interface AggregatedMetricState {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastCalledAt: string | null;
  lastErrorType: DynamicCommandErrorType | null;
}

interface RuntimeObservabilityPersistedState {
  version: 1;
  pluginMetrics: Record<string, AggregatedMetricState & { errorCounts: Record<string, number>; }>;
  commandMetrics: Record<string, AggregatedMetricState>;
  errorMetrics: Record<string, number>;
  userUsage: Record<string, Record<string, number>>;
  groupUsage: Record<string, Record<string, number>>;
}

export interface PluginObservabilityMetricSnapshot {
  pluginId: string;
  metadata: NonNullable<ReturnType<typeof getCommandPluginRecord>>['metadata'] | null;
  enabled: boolean;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageLatencyMs: number;
  errorCounts: Record<string, number>;
  lastCalledAt: string | null;
  lastErrorType: DynamicCommandErrorType | null;
}

export interface CommandUsageMetricSnapshot {
  commandId: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageLatencyMs: number;
  lastCalledAt: string | null;
  topUsers: Array<{ userId: string; count: number; }>;
  topGroups: Array<{ groupId: string; count: number; }>;
}

export interface ErrorMetricSnapshot {
  errorType: string;
  totalCount: number;
  plugins: Array<{ pluginId: string; count: number; }>;
}

const OBSERVABILITY_STORE_PATH = path.resolve(process.cwd(), 'data', 'runtime-observability.json');
const MAX_PLUGIN_METRICS = 200;
const MAX_COMMAND_METRICS = 500;
const MAX_USAGE_PER_OWNER = 200;
const pluginMetrics = new Map<string, AggregatedMetricState & { errorCounts: Record<string, number>; }>();
const commandMetrics = new Map<string, AggregatedMetricState>();
const errorMetrics = new Map<string, number>();
const userUsage = new Map<string, Map<string, number>>();
const groupUsage = new Map<string, Map<string, number>>();
let storeLoaded = false;
let persistTimer: NodeJS.Timeout | null = null;

function createAggregatedMetricState(): AggregatedMetricState {
  return {
    totalCalls: 0,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
    lastCalledAt: null,
    lastErrorType: null
  };
}

function ensureStoreLoaded(): void {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    if (!fs.existsSync(OBSERVABILITY_STORE_PATH)) return;
    const raw = fs.readFileSync(OBSERVABILITY_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeObservabilityPersistedState>;
    for (const [pluginId, metric] of Object.entries(parsed.pluginMetrics || {})) {
      pluginMetrics.set(pluginId, {
        ...createAggregatedMetricState(),
        ...metric,
        errorCounts: { ...(metric.errorCounts || {}) }
      });
    }
    for (const [commandId, metric] of Object.entries(parsed.commandMetrics || {})) {
      commandMetrics.set(commandId, {
        ...createAggregatedMetricState(),
        ...metric
      });
    }
    for (const [errorType, count] of Object.entries(parsed.errorMetrics || {})) {
      errorMetrics.set(errorType, Number(count || 0));
    }
    for (const [commandId, usage] of Object.entries(parsed.userUsage || {})) {
      userUsage.set(commandId, new Map(Object.entries(usage).map(([userId, count]) => [userId, Number(count || 0)])));
    }
    for (const [commandId, usage] of Object.entries(parsed.groupUsage || {})) {
      groupUsage.set(commandId, new Map(Object.entries(usage).map(([groupId, count]) => [groupId, Number(count || 0)])));
    }
  } catch (error) {
    loggingStateService.warn(`[RuntimeObservability] failed to load metrics store: ${error}`);
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        await fsp.mkdir(path.dirname(OBSERVABILITY_STORE_PATH), { recursive: true });
        const payload: RuntimeObservabilityPersistedState = {
          version: 1,
          pluginMetrics: Object.fromEntries(pluginMetrics.entries()),
          commandMetrics: Object.fromEntries(commandMetrics.entries()),
          errorMetrics: Object.fromEntries(errorMetrics.entries()),
          userUsage: Object.fromEntries(Array.from(userUsage.entries()).map(([commandId, usage]) => [
            commandId,
            Object.fromEntries(usage.entries())
          ])),
          groupUsage: Object.fromEntries(Array.from(groupUsage.entries()).map(([commandId, usage]) => [
            commandId,
            Object.fromEntries(usage.entries())
          ]))
        };
        await fsp.writeFile(OBSERVABILITY_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8');
      } catch (error) {
        loggingStateService.warn(`[RuntimeObservability] failed to persist metrics store: ${error}`);
      }
    })();
  }, 200);
}

function updateAggregate(
  aggregate: AggregatedMetricState,
  latencyMs: number,
  succeeded: boolean,
  errorType: DynamicCommandErrorType | null
): void {
  aggregate.totalCalls += 1;
  aggregate.totalLatencyMs += latencyMs;
  aggregate.lastCalledAt = new Date().toISOString();
  aggregate.lastErrorType = errorType;
  if (succeeded) {
    aggregate.successCount += 1;
    return;
  }
  aggregate.failureCount += 1;
}

function incrementUsage(map: Map<string, Map<string, number>>, ownerId: string, targetId?: string): void {
  if (!targetId) return;
  if (!map.has(ownerId)) {
    map.set(ownerId, new Map());
  }
  const usage = map.get(ownerId)!;
  usage.set(targetId, (usage.get(targetId) || 0) + 1);
  if (usage.size > MAX_USAGE_PER_OWNER) {
    const keys = Array.from(usage.keys());
    for (let i = 0; i < keys.length - MAX_USAGE_PER_OWNER; i += 1) {
      usage.delete(keys[i]);
    }
  }
}

function toAverageLatency(state: AggregatedMetricState): number {
  return state.totalCalls > 0 ? state.totalLatencyMs / state.totalCalls : 0;
}

function toTopUsage(usage: Map<string, number> | undefined, key: 'userId' | 'groupId') {
  return Array.from((usage || new Map()).entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      [key]: id,
      count
    })) as Array<{ count: number; } & Record<typeof key, string>>;
}

export function recordCommandExecutionMetric(input: {
  pluginId: string;
  commandId: string;
  userId: string;
  groupId?: string;
  latencyMs: number;
  succeeded: boolean;
  errorType: DynamicCommandErrorType | null;
}): void {
  ensureStoreLoaded();
  if (!pluginMetrics.has(input.pluginId)) {
    pluginMetrics.set(input.pluginId, {
      ...createAggregatedMetricState(),
      errorCounts: {}
    });
  }
  if (!commandMetrics.has(input.commandId)) {
    commandMetrics.set(input.commandId, createAggregatedMetricState());
  }
  if (pluginMetrics.size > MAX_PLUGIN_METRICS) {
    const keys = Array.from(pluginMetrics.keys());
    for (let i = 0; i < keys.length - MAX_PLUGIN_METRICS; i += 1) {
      pluginMetrics.delete(keys[i]);
    }
  }
  if (commandMetrics.size > MAX_COMMAND_METRICS) {
    const keys = Array.from(commandMetrics.keys());
    for (let i = 0; i < keys.length - MAX_COMMAND_METRICS; i += 1) {
      commandMetrics.delete(keys[i]);
    }
  }
  const pluginMetric = pluginMetrics.get(input.pluginId)!;
  const commandMetric = commandMetrics.get(input.commandId)!;
  updateAggregate(pluginMetric, input.latencyMs, input.succeeded, input.errorType);
  updateAggregate(commandMetric, input.latencyMs, input.succeeded, input.errorType);
  if (input.errorType) {
    pluginMetric.errorCounts[input.errorType] = (pluginMetric.errorCounts[input.errorType] || 0) + 1;
    errorMetrics.set(input.errorType, (errorMetrics.get(input.errorType) || 0) + 1);
  }
  incrementUsage(userUsage, input.commandId, input.userId);
  incrementUsage(groupUsage, input.commandId, input.groupId);
  schedulePersist();
}

export function getPluginObservabilityMetrics(): PluginObservabilityMetricSnapshot[] {
  ensureStoreLoaded();
  const allPluginIds = new Set([
    ...Array.from(pluginMetrics.keys()),
    ...listAllCommandPlugins().map((plugin) => plugin.definition.id)
  ]);
  return Array.from(allPluginIds).map((pluginId) => {
    const metric = pluginMetrics.get(pluginId) || {
      ...createAggregatedMetricState(),
      errorCounts: {}
    };
    const record = getCommandPluginRecord(pluginId);
    return {
      pluginId,
      metadata: record?.metadata || null,
      enabled: record?.enabled ?? false,
      totalCalls: metric.totalCalls,
      successCount: metric.successCount,
      failureCount: metric.failureCount,
      successRate: metric.totalCalls > 0 ? metric.successCount / metric.totalCalls : 0,
      averageLatencyMs: toAverageLatency(metric),
      errorCounts: { ...metric.errorCounts },
      lastCalledAt: metric.lastCalledAt,
      lastErrorType: metric.lastErrorType
    };
  }).sort((left, right) => right.totalCalls - left.totalCalls || left.pluginId.localeCompare(right.pluginId));
}

export function getCommandUsageMetrics(): CommandUsageMetricSnapshot[] {
  ensureStoreLoaded();
  const allCommandIds = new Set([
    ...Array.from(commandMetrics.keys()),
    ...listAllCommandPlugins().map((plugin) => plugin.definition.id)
  ]);
  return Array.from(allCommandIds).map((commandId) => {
    const metric = commandMetrics.get(commandId) || createAggregatedMetricState();
    return {
      commandId,
      totalCalls: metric.totalCalls,
      successCount: metric.successCount,
      failureCount: metric.failureCount,
      successRate: metric.totalCalls > 0 ? metric.successCount / metric.totalCalls : 0,
      averageLatencyMs: toAverageLatency(metric),
      lastCalledAt: metric.lastCalledAt,
      topUsers: toTopUsage(userUsage.get(commandId), 'userId'),
      topGroups: toTopUsage(groupUsage.get(commandId), 'groupId')
    };
  }).sort((left, right) => right.totalCalls - left.totalCalls || left.commandId.localeCompare(right.commandId));
}

export function getErrorObservabilityMetrics(): ErrorMetricSnapshot[] {
  ensureStoreLoaded();
  const perPlugin = Array.from(pluginMetrics.entries());
  return Array.from(errorMetrics.entries())
    .map(([errorType, totalCount]) => ({
      errorType,
      totalCount,
      plugins: perPlugin
        .map(([pluginId, metric]) => ({
          pluginId,
          count: metric.errorCounts[errorType] || 0
        }))
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count)
    }))
    .sort((left, right) => right.totalCount - left.totalCount || left.errorType.localeCompare(right.errorType));
}

export function getRuntimeObservabilitySnapshot() {
  return {
    plugins: getPluginObservabilityMetrics(),
    commands: getCommandUsageMetrics(),
    errors: getErrorObservabilityMetrics()
  };
}

export function resetRuntimeObservabilityStore(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  storeLoaded = true;
  pluginMetrics.clear();
  commandMetrics.clear();
  errorMetrics.clear();
  userUsage.clear();
  groupUsage.clear();
}
