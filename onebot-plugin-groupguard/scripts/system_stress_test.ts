import { communicationStateService } from '../src/core/state-services/communication_state_service';
import { commandDispatcher } from '../src/commands/dispatcher';
import { getDynamicCommandRuntimeStats, initializeDynamicCommandMetrics } from '../src/dynamic-commands/command_engine';
import { initializeDynamicCommands, loadDynamicCommands } from '../src/dynamic-commands/command_loader';
import { refreshCommandPluginRegistry } from '../src/dynamic-commands/command_plugin_registry';
import {
  getAllCommandMetrics,
  getCircuitBreakerHotspots
} from '../src/dynamic-commands/command_observability';
import { refreshDynamicCommandRegistry } from '../src/dynamic-commands/command_registry';
import { setCommandPluginRuntimeConfig, setCommandPluginEnabled } from '../src/dynamic-commands/command_plugin_store';

const TOTAL_REQUESTS = 120;
const sentMessages: string[] = [];

function toMetricMap() {
  return new Map(getAllCommandMetrics().map((item) => [item.commandId, item]));
}

function diffMetrics(before: ReturnType<typeof toMetricMap>, after: ReturnType<typeof toMetricMap>) {
  return Array.from(after.entries()).map(([commandId, current]) => {
    const previous = before.get(commandId);
    return {
      commandId,
      successCount: current.successCount - (previous?.successCount || 0),
      failureCount: current.failureCount - (previous?.failureCount || 0),
      averageLatencyMs: current.averageLatencyMs,
      lastFailureReason: current.lastFailureReason,
      messageTypeStats: {
        group: current.messageTypeStats.group - (previous?.messageTypeStats.group || 0),
        private: current.messageTypeStats.private - (previous?.messageTypeStats.private || 0)
      }
    };
  });
}

function toBreakerMap() {
  return new Map(getCircuitBreakerHotspots().map((item) => [item.commandId, item]));
}

communicationStateService.sendGroupText = async (_groupId: string, content: string) => {
  sentMessages.push(content);
};

communicationStateService.sendPrivateMsg = async (_userId: string, content: string) => {
  sentMessages.push(content);
};

let requestCount = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  requestCount += 1;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes('hitokoto')) {
    if (requestCount <= 8 || requestCount % 9 === 0) {
      return new Response(JSON.stringify({ error: 'upstream failure' }), { status: 500 });
    }
    if (requestCount % 11 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return new Response(JSON.stringify({ hitokoto: `quote-${requestCount}` }), { status: 200 });
  }
  if (url.includes('itunes.apple.com')) {
    return new Response(JSON.stringify({ results: [{ trackViewUrl: `https://music.example/${requestCount}` }] }), { status: 200 });
  }
  if (url.includes('dailymotion.com')) {
    return new Response(JSON.stringify({ list: [{ url: `https://video.example/${requestCount}` }] }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
}) as typeof fetch;

await initializeDynamicCommands();
for (const pluginId of ['quote.daily', 'music.search']) {
  setCommandPluginEnabled(pluginId, true);
  setCommandPluginRuntimeConfig(pluginId, {});
}
refreshCommandPluginRegistry();
refreshDynamicCommandRegistry();
await initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));
const beforeMetrics = toMetricMap();
const beforeBreakers = toBreakerMap();
const beforeRuntimeStats = getDynamicCommandRuntimeStats();
const startedAt = Date.now();
const outcomes = await Promise.all(Array.from({ length: TOTAL_REQUESTS }, (_, index) => (
  commandDispatcher.handle({
    raw_message: index % 3 === 0 ? 'quote' : index % 3 === 1 ? '点歌 test' : '视频 test',
    message_type: index % 5 === 0 ? 'private' : 'group',
    group_id: 10000 + index,
    user_id: 20000 + (index % 10)
  } as any, {} as any)
)));
const durationMs = Date.now() - startedAt;

const metrics = diffMetrics(beforeMetrics, toMetricMap());
const totalSuccess = metrics.reduce((sum, item) => sum + item.successCount, 0);
const totalFailure = metrics.reduce((sum, item) => sum + item.failureCount, 0);
const totalCount = totalSuccess + totalFailure;
const averageLatencyMs = metrics.length
  ? metrics.reduce((sum, item) => sum + item.averageLatencyMs, 0) / metrics.length
  : 0;
const breakerHotspots = getCircuitBreakerHotspots().map((item) => ({
  ...item,
  activationCount: (item.activationCount || 0) - (beforeBreakers.get(item.commandId)?.activationCount || 0)
})).filter((item) => item.activationCount > 0 || item.state !== 'closed');
const breakerActivations = breakerHotspots.reduce((sum, item) => sum + (item.activationCount || 0), 0);
const runtimeStatsNow = getDynamicCommandRuntimeStats();
const failureReasonEntries = Object.entries(runtimeStatsNow.failureReasons as Record<string, number>)
  .map(([reason, count]): [string, number] => [
    reason,
    count - ((beforeRuntimeStats.failureReasons as Record<string, number>)[reason] || 0)
  ])
  .filter(([, count]) => count > 0);
const runtimeStats = {
  totalRetryAttempts: runtimeStatsNow.totalRetryAttempts - beforeRuntimeStats.totalRetryAttempts,
  totalRetryRecoveredSuccesses: runtimeStatsNow.totalRetryRecoveredSuccesses - beforeRuntimeStats.totalRetryRecoveredSuccesses,
  totalCacheHits: runtimeStatsNow.totalCacheHits - beforeRuntimeStats.totalCacheHits,
  failureReasons: Object.fromEntries(failureReasonEntries)
};
const trueSuccessRate = totalCount > 0 ? totalSuccess / totalCount : 0;
const effectiveSuccessRate = TOTAL_REQUESTS > 0 ? sentMessages.length / TOTAL_REQUESTS : 0;
const cacheHitRatio = TOTAL_REQUESTS > 0 ? runtimeStats.totalCacheHits / TOTAL_REQUESTS : 0;

console.log(JSON.stringify({
  totalRequests: TOTAL_REQUESTS,
  handledCount: outcomes.filter(Boolean).length,
  trueSuccessRate,
  effectiveSuccessRate,
  failureRate: totalCount > 0 ? totalFailure / totalCount : 0,
  averageLatencyMs,
  retryAttempts: runtimeStats.totalRetryAttempts,
  retryRecoveredSuccesses: runtimeStats.totalRetryRecoveredSuccesses,
  cacheHitRatio,
  failureReasons: runtimeStats.failureReasons,
  breakerActivations,
  breakerHotspots,
  slowestCommands: [...metrics].sort((left, right) => right.averageLatencyMs - left.averageLatencyMs).slice(0, 5),
  runtimeDurationMs: durationMs,
  sentMessageCount: sentMessages.length
}, null, 2));
