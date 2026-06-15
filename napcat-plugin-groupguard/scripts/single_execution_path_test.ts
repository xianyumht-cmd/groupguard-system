import { communicationStateService } from '../src/core/state-services/communication_state_service';
import { commandDispatcher } from '../src/commands/dispatcher';
import { initializeDynamicCommands, loadDynamicCommands } from '../src/dynamic-commands/command_loader';
import {
  assertCommandPluginRegistryReady,
  listCommandPlugins,
  refreshCommandPluginRegistry
} from '../src/dynamic-commands/command_plugin_registry';
import { refreshDynamicCommandRegistry, resolveDynamicCommand } from '../src/dynamic-commands/command_registry';
import { initializeDynamicCommandMetrics } from '../src/dynamic-commands/command_engine';
import { registerLegacyRuntimePlugins } from '../src/dynamic-commands/legacy_runtime_plugins';
import {
  getExecutionGuardHistory,
  resetExecutionGuardHistory
} from '../src/dynamic-commands/execution_guard';

type TestResult = {
  commandId: string;
  resolved: boolean;
  handled: boolean;
  stages?: Record<'dispatcher' | 'command_engine' | 'plugin_runtime' | 'response_capture', number>;
  path?: string[];
  error?: string;
};

function buildMessage(commandId: string, triggerType: 'exact' | 'prefix', triggerValue: string): string {
  if (triggerType === 'exact') return triggerValue;
  if (commandId.startsWith('legacy.')) return `${triggerValue} 测试`;
  return `${triggerValue} test`;
}

function buildEvent(scope: string, rawMessage: string) {
  const isPrivateOnly = scope === 'private';
  return {
    raw_message: rawMessage,
    message_type: isPrivateOnly ? 'private' : 'group',
    group_id: isPrivateOnly ? undefined : '10001',
    user_id: '30001',
    self_id: '40001'
  } as any;
}

const deliveries: Array<{ type: string; targetId: string; }> = [];

communicationStateService.sendGroupText = async (groupId: string) => {
  deliveries.push({ type: 'group_text', targetId: groupId });
};

communicationStateService.sendPrivateMsg = async (userId: string) => {
  deliveries.push({ type: 'private_text', targetId: userId });
};

communicationStateService.sendGroupMsg = async (groupId: string) => {
  deliveries.push({ type: 'group_msg', targetId: groupId });
};

communicationStateService.callApi = async (action: string, payload?: any) => {
  if (action === 'send_group_forward_msg') {
    deliveries.push({ type: 'group_forward', targetId: String(payload?.group_id || '') });
    return { status: 'ok' };
  }
  if (action === 'get_group_list') return [];
  if (action === 'get_group_member_info') return { role: 'member' };
  if (action === 'get_group_member_list') return [];
  if (action === 'get_group_info') return { group_name: 'test-group' };
  return { status: 'ok' };
};

let requestCount = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  requestCount += 1;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes('hitokoto')) {
    return new Response(JSON.stringify({ hitokoto: `quote-${requestCount}` }), { status: 200 });
  }
  if (url.includes('itunes.apple.com')) {
    return new Response(JSON.stringify({ results: [{ trackViewUrl: `https://music.example/${requestCount}` }] }), { status: 200 });
  }
  if (url.includes('dailymotion.com')) {
    return new Response(JSON.stringify({ list: [{ url: `https://video.example/${requestCount}` }] }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, value: `response-${requestCount}` }), { status: 200 });
}) as typeof fetch;

registerLegacyRuntimePlugins();
await initializeDynamicCommands();
refreshCommandPluginRegistry();
assertCommandPluginRegistryReady();
refreshDynamicCommandRegistry();
await initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));

const results: TestResult[] = [];

for (const plugin of listCommandPlugins()) {
  const rawMessage = buildMessage(plugin.definition.id, plugin.definition.trigger.type, plugin.definition.trigger.value);
  const resolved = resolveDynamicCommand(rawMessage);
  if (!resolved || resolved.command.id !== plugin.definition.id) {
    results.push({
      commandId: plugin.definition.id,
      resolved: false,
      handled: false,
      error: `registry_resolution_mismatch:${resolved?.command.id || 'none'}`
    });
    continue;
  }
  resetExecutionGuardHistory();
  deliveries.length = 0;
  let handled = false;
  try {
    handled = await commandDispatcher.handle(buildEvent(plugin.schema.scope, rawMessage), {} as any);
  } catch (error) {
    results.push({
      commandId: plugin.definition.id,
      resolved: true,
      handled: false,
      error: String(error)
    });
    continue;
  }
  const history = getExecutionGuardHistory();
  const trace = history[history.length - 1];
  if (!trace) {
    results.push({
      commandId: plugin.definition.id,
      resolved: true,
      handled,
      error: 'missing_execution_trace'
    });
    continue;
  }
  const exactPath = trace.path.join('>');
  if (
    trace.stages.dispatcher !== 1 ||
    trace.stages.command_engine !== 1 ||
    trace.stages.plugin_runtime !== 1 ||
    trace.stages.response_capture !== 1 ||
    exactPath !== 'dispatcher>command_engine>plugin_runtime>response_capture'
  ) {
    results.push({
      commandId: plugin.definition.id,
      resolved: true,
      handled,
      stages: trace.stages,
      path: trace.path,
      error: 'execution_invariant_violation'
    });
    continue;
  }
  if (!handled) {
    results.push({
      commandId: plugin.definition.id,
      resolved: true,
      handled,
      stages: trace.stages,
      path: trace.path,
      error: 'dispatcher_not_handled'
    });
    continue;
  }
  results.push({
    commandId: plugin.definition.id,
    resolved: true,
    handled,
    stages: trace.stages,
    path: trace.path
  });
}

const failures = results.filter((item) => item.error);

console.log(JSON.stringify({
  totalCommands: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  failures
}, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
