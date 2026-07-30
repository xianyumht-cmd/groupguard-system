import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createBattleIntranetCommandPlugin,
  executeBattleIntranetQuery,
  parseBattleQueryInput
} from '../src/dynamic-commands/intranet_battle_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const runtimeSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_battle_runtime_plugin.ts', import.meta.url));
const commandsSourcePath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));
const legacySourcePath = fileURLToPath(new URL('../src/services/interaction_service.ts', import.meta.url));

async function loadTextEnvelope() {
  const text = await readFile(`${fixtureRoot}/delivery-success-text.json`, 'utf8');
  const parsed = parseGroupGuardQueryDelivery(JSON.parse(text));
  return {
    ...parsed,
    feature: 'battle',
    meta: {
      source: 'live',
      stale: false,
      count: 1,
      player: {
        name: '测试玩家#12345',
        region: '艾欧尼亚',
        rank: '钻石 IV'
      }
    }
  };
}

const plugin = createBattleIntranetCommandPlugin();
assert.equal(plugin.definition.id, 'builtin.query.battle.intranet');
assert.equal(plugin.definition.trigger.type, 'prefix');
assert.equal(plugin.definition.trigger.value, '查战绩');
assert.equal(plugin.definition.featureKey, 'query.lol_battle');
assert.ok(Number(plugin.definition.priority || 0) > 40);
assert.equal(INTERACTION_PREFIXES.includes('查战绩'), false, 'legacy interaction route must not claim 查战绩');

assert.deepEqual(parseBattleQueryInput('张三#12345'), {
  ok: true,
  value: { playerId: '张三#12345', region: '' }
});
assert.deepEqual(parseBattleQueryInput('张三#12345 艾欧尼亚'), {
  ok: true,
  value: { playerId: '张三#12345', region: '艾欧尼亚' }
});
assert.equal(parseBattleQueryInput('张三').ok, false);
assert.equal(parseBattleQueryInput('张三#1').ok, false);

const envelope = await loadTextEnvelope();
const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.lolQueryOutputFormat = 'text';
  config.global = {
    ...(config.global || {}),
    lolQueryRequestTimeoutSeconds: 20,
    lolQueryGlobalMinIntervalSeconds: 0,
    lolQueryGroupMinIntervalSeconds: 0
  };
  config.groups = {
    ...(config.groups || {}),
    '960957757': {
      ...(config.groups?.['960957757'] || {}),
      lolQueryOutputFormat: 'text'
    }
  };
  configStateService.setConfig(config);

  const input = {
    commandId: plugin.definition.id,
    registryVersion: 1,
    rawText: '查战绩 张三#12345 艾欧尼亚',
    cleanedText: '查战绩 张三#12345 艾欧尼亚',
    rawArgument: '张三#12345 艾欧尼亚',
    mappedParameters: {},
    messageType: 'group',
    userId: '123456789',
    groupId: '960957757',
    source: 'dynamic'
  } as any;
  const context = {
    event: {
      message_type: 'group',
      user_id: 123456789,
      group_id: 960957757,
      message_id: 20260729,
      self_id: 755396669,
      raw_message: '查战绩 张三#12345 艾欧尼亚'
    },
    pluginContext: {},
    plugin: {
      metadata: plugin.metadata,
      enabled: true,
      runtimeConfig: {},
      effectiveConfig: {}
    },
    commandContext: {
      rawText: '查战绩 张三#12345 艾欧尼亚',
      cleanedText: '查战绩 张三#12345 艾欧尼亚',
      source: 'dynamic',
      commandId: plugin.definition.id,
      matchedAt: '查战绩'
    }
  } as any;

  let requestCount = 0;
  let capturedPayload: any = null;
  const result = await executeBattleIntranetQuery(
    input,
    context,
    (async (_baseUrl: string, payload: any) => {
      requestCount += 1;
      capturedPayload = payload;
      return envelope;
    }) as any
  );
  assert.equal(requestCount, 1, 'battle command must make exactly one intranet request');
  assert.equal(capturedPayload.feature, 'battle');
  assert.deepEqual(capturedPayload.parameters, {
    name: '张三#12345',
    region: '艾欧尼亚'
  });
  assert.equal(capturedPayload.preferred, 'text');
  assert.equal(capturedPayload.capabilities.text, true);
  assert.equal(capturedPayload.capabilities.image, true);
  assert.equal(capturedPayload.capabilities.forward, true);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.response.type, 'structured');
    const deliveries = (result.response as any).payload.deliveries;
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].channel, 'group');
    assert.equal(deliveries[0].targetId, '960957757');
    assert.equal(deliveries[0].applyTemplate, false);
  }

  let failedRequestCount = 0;
  const failed = await executeBattleIntranetQuery(
    input,
    context,
    (async () => {
      failedRequestCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failedRequestCount, 1, 'network failure must not trigger a second or public request');
  assert.equal(failed.ok, true);
  if (failed.ok) {
    assert.equal(failed.response.type, 'text');
    assert.equal((failed.response as any).text, '内网查询服务暂时不可用，请稍后再试。');
  }
} finally {
  configStateService.setConfig(originalConfig as any);
}

const runtimeSource = (await readFile(runtimeSourcePath, 'utf8')).toLowerCase();
for (const forbidden of ['raw.githubusercontent.com', 'game.gtimg.cn', 'op.gg', 'lolso1.com', '/cross_query']) {
  assert.equal(runtimeSource.includes(forbidden), false, `battle runtime contains forbidden upstream behavior: ${forbidden}`);
}
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false, 'battle runtime must not call fetch directly');

const commandsSource = await readFile(commandsSourcePath, 'utf8');
assert.match(commandsSource, /registerIntranetBattleCommandPlugins\(\)/);
const legacySource = await readFile(legacySourcePath, 'utf8');
assert.match(legacySource, /if \(text\.startsWith\('查战绩'\)\)/, 'legacy battle code should remain reviewable during migration');

console.log('intranet battle command verification passed');
