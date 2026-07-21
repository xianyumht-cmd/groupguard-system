import { communicationStateService } from '../src/core/state-services/communication_state_service';
import { commandDispatcher } from '../src/commands/dispatcher';
import { initializeDynamicCommands } from '../src/dynamic-commands/command_loader';
import {
  assertCommandPluginRegistryReady,
  getCommandPlugin,
  getCommandPluginRecord,
  listAllCommandPlugins,
  refreshCommandPluginRegistry
} from '../src/dynamic-commands/command_plugin_registry';
import { refreshDynamicCommandRegistry, resolveDynamicCommand } from '../src/dynamic-commands/command_registry';
import { registerLegacyRuntimePlugins } from '../src/dynamic-commands/legacy_runtime_plugins';
import {
  setCommandPluginRuntimeConfig,
  setCommandPluginEnabled
} from '../src/dynamic-commands/command_plugin_store';

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

const plugin = listAllCommandPlugins().find((item) => item.source === 'json') || listAllCommandPlugins()[0];
assert(plugin, 'plugin_not_found_for_test');
setCommandPluginEnabled(plugin.definition.id, true);
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

const triggerMessage = plugin.definition.trigger.type === 'exact'
  ? plugin.definition.trigger.value
  : `${plugin.definition.trigger.value} test`;

const beforeRecord = getCommandPluginRecord(plugin.definition.id);
assert(beforeRecord, 'plugin_record_missing_before');
assert(beforeRecord.metadata.id === plugin.definition.id, 'plugin_metadata_mismatch');
assert(beforeRecord.enabled === true, 'plugin_should_start_enabled');
const originalRuntimeConfig = { ...(beforeRecord.runtimeConfig || {}) };

const resolvedBefore = resolveDynamicCommand(triggerMessage);
assert(resolvedBefore?.command.id === plugin.definition.id, 'plugin_should_resolve_before_disable');

setCommandPluginEnabled(plugin.definition.id, false);
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

assert(getCommandPlugin(plugin.definition.id) === null, 'disabled_plugin_should_not_be_resolved');
assert(resolveDynamicCommand(triggerMessage)?.command.id === plugin.definition.id, 'disabled_plugin_should_still_match_registry');

const disabledMessages: string[] = [];
communicationStateService.sendGroupText = async (_groupId: string, content: string) => {
  disabledMessages.push(content);
};
communicationStateService.sendPrivateMsg = async (_userId: string, content: string) => {
  disabledMessages.push(content);
};
await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-disabled',
  user_id: 'u-disabled'
} as any, {} as any);
assert(disabledMessages[disabledMessages.length - 1] === 'plugin_disabled', 'disabled_plugin_should_return_explicit_error');

setCommandPluginRuntimeConfig(plugin.definition.id, { featureFlag: 'managed', threshold: 3 });
setCommandPluginEnabled(plugin.definition.id, true);
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

const afterRecord = getCommandPluginRecord(plugin.definition.id);
assert(afterRecord, 'plugin_record_missing_after');
assert(afterRecord.enabled === true, 'plugin_should_be_enabled_after_toggle');
assert(afterRecord.runtimeConfig.featureFlag === 'managed', 'plugin_runtime_config_not_persisted');
assert(afterRecord.effectiveConfig.featureFlag === 'managed', 'plugin_effective_config_not_merged');
assert(afterRecord.metadata.version === '1.0.0', 'plugin_metadata_version_missing');

const resolvedAfter = resolveDynamicCommand(triggerMessage);
assert(resolvedAfter?.command.id === plugin.definition.id, 'plugin_should_resolve_after_enable');

const sentMessages: string[] = [];
communicationStateService.sendGroupText = async (_groupId: string, content: string) => {
  sentMessages.push(content);
};
communicationStateService.sendPrivateMsg = async (_userId: string, content: string) => {
  sentMessages.push(content);
};
communicationStateService.sendGroupMsg = async (_groupId: string, payload: any) => {
  sentMessages.push(JSON.stringify(payload));
};
communicationStateService.callApi = async (action: string, payload?: any) => {
  if (action === 'send_group_forward_msg') {
    sentMessages.push(JSON.stringify(payload?.messages || []));
    return { status: 'ok' };
  }
  return { status: 'ok' };
};
globalThis.fetch = (async () => (
  new Response(JSON.stringify({ hitokoto: 'managed-quote' }), { status: 200 })
)) as typeof fetch;

setCommandPluginRuntimeConfig(plugin.definition.id, {
  ...originalRuntimeConfig,
  allowed_users: ['u-allowed'],
  allowed_groups: ['g-allowed'],
  daily_limit: 1
});
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

sentMessages.length = 0;
await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-denied',
  user_id: 'u-denied'
} as any, {} as any);
assert(sentMessages[sentMessages.length - 1] === 'permission_denied', 'permission_guard_should_reject');

sentMessages.length = 0;
await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-allowed',
  user_id: 'u-allowed'
} as any, {} as any);
assert(sentMessages[sentMessages.length - 1] !== 'permission_denied', 'allowed_execution_should_pass');

sentMessages.length = 0;
await commandDispatcher.handle({
  raw_message: triggerMessage,
  message_type: 'group',
  group_id: 'g-allowed',
  user_id: 'u-allowed'
} as any, {} as any);
assert(sentMessages[sentMessages.length - 1] === 'quota_exceeded', 'quota_guard_should_reject_after_limit');

setCommandPluginRuntimeConfig(plugin.definition.id, originalRuntimeConfig);
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();

console.log(JSON.stringify({
  pluginId: plugin.definition.id,
  metadata: afterRecord.metadata,
  enabled: afterRecord.enabled,
  runtimeConfig: afterRecord.runtimeConfig,
  effectiveConfig: afterRecord.effectiveConfig,
  permissionDeniedResponse: 'permission_denied',
  quotaExceededResponse: 'quota_exceeded',
  resolvedBeforeDisable: resolvedBefore?.command.id || null,
  resolvedAfterEnable: resolvedAfter?.command.id || null
}, null, 2));
