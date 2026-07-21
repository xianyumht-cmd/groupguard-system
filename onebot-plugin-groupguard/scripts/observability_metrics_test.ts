import { communicationStateService } from '../src/core/state-services/communication_state_service';
import { commandDispatcher } from '../src/commands/dispatcher';
import { initializeDynamicCommands } from '../src/dynamic-commands/command_loader';
import {
  assertCommandPluginRegistryReady,
  getCommandPluginRecord,
  listAllCommandPlugins,
  refreshCommandPluginRegistry
} from '../src/dynamic-commands/command_plugin_registry';
import { refreshDynamicCommandRegistry } from '../src/dynamic-commands/command_registry';
import { getCommandMetricsView, getErrorMetricsView, getPluginMetricsView } from '../src/dynamic-commands/command_observability';
import { registerLegacyRuntimePlugins } from '../src/dynamic-commands/legacy_runtime_plugins';
import { resetRuntimeObservabilityStore } from '../src/dynamic-commands/runtime_observability_store';
import { setCommandPluginRuntimeConfig, setCommandPluginEnabled } from '../src/dynamic-commands/command_plugin_store';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

registerLegacyRuntimePlugins();
await initializeDynamicCommands();
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();
resetRuntimeObservabilityStore();

const plugin = listAllCommandPlugins().find((item) => item.source === 'json') || listAllCommandPlugins()[0];
assert(plugin, 'observability_plugin_not_found');
const triggerMessage = plugin.definition.trigger.type === 'exact'
  ? plugin.definition.trigger.value
  : `${plugin.definition.trigger.value} test`;
const originalRuntimeConfig = { ...(getCommandPluginRecord(plugin.definition.id)?.runtimeConfig || {}) };

communicationStateService.sendGroupText = async () => {};
communicationStateService.sendPrivateMsg = async () => {};
communicationStateService.sendGroupMsg = async () => {};
communicationStateService.callApi = async () => ({ status: 'ok' });
globalThis.fetch = (async () => (
  new Response(JSON.stringify({ hitokoto: 'observable-quote' }), { status: 200 })
)) as typeof fetch;

setCommandPluginEnabled(plugin.definition.id, true);
setCommandPluginRuntimeConfig(plugin.definition.id, {
  allowed_users: ['u-allow'],
  allowed_groups: ['g-allow']
});
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-denied',
  user_id: 'u-denied'
} as any, {} as any);

await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-allow',
  user_id: 'u-allow'
} as any, {} as any);

await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-allow',
  user_id: 'u-allow'
} as any, {} as any);

const pluginMetric = getPluginMetricsView().find((item) => item.pluginId === plugin.definition.id);
const commandMetric = getCommandMetricsView().find((item) => item.commandId === plugin.definition.id);
const permissionDeniedMetric = getErrorMetricsView().find((item) => item.errorType === 'permission_denied');

assert(pluginMetric, 'plugin_metric_missing');
assert(commandMetric, 'command_metric_missing');
assert(permissionDeniedMetric, 'permission_metric_missing');
assert(pluginMetric.totalCalls === 3, 'plugin_total_calls_mismatch');
assert(pluginMetric.successCount === 2, 'plugin_success_count_mismatch');
assert(pluginMetric.failureCount === 1, 'plugin_failure_count_mismatch');
assert(pluginMetric.errorCounts.permission_denied === 1, 'plugin_permission_error_count_mismatch');
assert(commandMetric.topUsers.some((item) => item.userId === 'u-allow' && item.count === 2), 'top_user_metric_missing');
assert(commandMetric.topGroups.some((item) => item.groupId === 'g-allow' && item.count === 2), 'top_group_metric_missing');
assert(permissionDeniedMetric.totalCount >= 1, 'permission_metric_total_mismatch');
assert(permissionDeniedMetric.plugins.some((item) => item.pluginId === plugin.definition.id && item.count >= 1), 'permission_metric_plugin_breakdown_missing');

setCommandPluginRuntimeConfig(plugin.definition.id, originalRuntimeConfig);
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

console.log(JSON.stringify({
  pluginId: plugin.definition.id,
  pluginMetric,
  commandMetric,
  permissionDeniedMetric
}, null, 2));
