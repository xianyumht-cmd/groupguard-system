import {
  getCommandPluginRecord,
  getCommandRuntimeSchemaModules,
  listCommandPluginManagementRecords
} from './command_plugin_registry';
import { getDynamicCommandRegistrySnapshotVersion } from './command_registry';
import { getCommandHealthReport } from './command_health_service';
import {
  getAllCircuitBreakerStates,
  getDynamicCommandDebugTrace,
  getDynamicCommandHealthReport,
  getDynamicCommandMetrics,
  getDynamicCommandRuntimeStats
} from './command_engine';
import {
  getCommandUsageMetrics,
  getErrorObservabilityMetrics,
  getPluginObservabilityMetrics,
  getRuntimeObservabilitySnapshot
} from './runtime_observability_store';

export function getAllCommandMetrics() {
  return getDynamicCommandMetrics();
}

export function getCircuitBreakerState() {
  return getAllCircuitBreakerStates();
}

export function getActiveCommands() {
  return listCommandPluginManagementRecords().map((record) => ({
    id: record.id,
    schema: record.schema,
    trigger: record.trigger,
    priority: record.priority,
    enabled: record.enabled,
    source: record.source
  }));
}

export function getRegistryVersion() {
  return getDynamicCommandRegistrySnapshotVersion();
}

export function getSystemHealthOverview() {
  const metrics = getDynamicCommandMetrics();
  const health = getDynamicCommandHealthReport();
  const circuitStates = getAllCircuitBreakerStates();
  const openBreakers = Object.values(circuitStates).filter((state) => state.state === 'open').length;
  const degradedCommands = health.filter((item) => item.status !== 'healthy').length;
  return {
    registryVersion: getRegistryVersion(),
    activeCommandCount: listCommandPluginManagementRecords().filter((record) => record.enabled).length,
    openBreakers,
    degradedCommands,
    averageLatencyMs: metrics.length
      ? metrics.reduce((sum, item) => sum + item.averageLatencyMs, 0) / metrics.length
      : 0
  };
}

export function getCommandRuntimeSchema() {
  return getCommandRuntimeSchemaModules();
}

export function getPluginRegistrySnapshot() {
  return listCommandPluginManagementRecords();
}

export function getPluginDebugSnapshot(commandId: string) {
  const pluginRecord = getCommandPluginRecord(commandId);
  if (!pluginRecord) return null;
  const plugin = pluginRecord.plugin;
  return {
    plugin: {
      id: plugin.definition.id,
      source: plugin.source,
      metadata: plugin.metadata,
      enabled: pluginRecord.enabled,
      runtimeConfig: pluginRecord.runtimeConfig,
      effectiveConfig: pluginRecord.effectiveConfig,
      definition: plugin.definition,
      schema: pluginRecord.schema
    },
    trace: getDynamicCommandDebugTrace(commandId),
    metric: getDynamicCommandMetrics().find((item) => item.commandId === commandId) || null,
    health: getCommandHealthReport().find((item) => item.commandId === commandId) || null,
    circuitBreaker: getAllCircuitBreakerStates()[commandId] || null
  };
}

export function getTopFailingCommands(limit = 5) {
  return [...getCommandHealthReport()]
    .sort((left, right) => left.score - right.score)
    .slice(0, limit);
}

export function getSlowestCommands(limit = 5) {
  return [...getAllCommandMetrics()]
    .sort((left, right) => right.averageLatencyMs - left.averageLatencyMs)
    .slice(0, limit);
}

export function getCircuitBreakerHotspots() {
  return Object.entries(getAllCircuitBreakerStates())
    .filter(([, state]) => state.state !== 'closed')
    .map(([commandId, state]) => ({
      commandId,
      ...state
    }))
    .sort((left, right) => right.consecutiveFailures - left.consecutiveFailures);
}

export function getRuntimeMetricsSnapshot() {
  return {
    metrics: getAllCommandMetrics(),
    runtime: getDynamicCommandRuntimeStats(),
    observability: getRuntimeObservabilitySnapshot()
  };
}

export function getPluginMetricsView() {
  return getPluginObservabilityMetrics();
}

export function getCommandMetricsView() {
  return getCommandUsageMetrics();
}

export function getErrorMetricsView() {
  return getErrorObservabilityMetrics();
}
