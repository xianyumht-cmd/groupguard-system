import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  buildShardStructuredResult,
  createShardIntranetCommandPlugin,
  executeShardIntranetQuery
} from '../src/dynamic-commands/intranet_query_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';
import { requestShardDelivery } from '../src/services/intranet_shard_query_service.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const pluginSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_query_runtime_plugin.ts', import.meta.url));
const commandsSourcePath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));

async function loadEnvelope(name: string) {
  const text = await readFile(`${fixtureRoot}/${name}`, 'utf8');
  return parseGroupGuardQueryDelivery(JSON.parse(text));
}

const plugin = createShardIntranetCommandPlugin();
assert.equal(plugin.definition.id, 'builtin.query.shard.intranet');
assert.equal(plugin.definition.trigger.type, 'prefix');
assert.equal(plugin.definition.trigger.value, '查合集');
assert.equal(plugin.definition.featureKey, 'query.lol_shard');
assert.ok(Number(plugin.definition.priority || 0) > 40, 'intranet shard plugin must outrank the legacy interaction plugin');
assert.equal(INTERACTION_PREFIXES.includes('查合集'), false, 'legacy interaction route must no longer claim 查合集');

const imageEnvelope = await loadEnvelope('delivery-success-image.json');
let requestCount = 0;
let capturedPayload: any = null;
const imageResult = await requestShardDelivery({
  baseUrl: 'http://192.168.3.89:5001',
  hero: '滑板鞋',
  preferred: 'image',
  timeoutMs: 5000,
  requestId: 'gg-shard-test-001',
  requestFn: (async (_baseUrl: string, payload: any) => {
    requestCount += 1;
    capturedPayload = payload;
    return imageEnvelope;
  }) as any
});
assert.equal(requestCount, 1, 'shard command must make exactly one intranet delivery request');
assert.equal(capturedPayload.feature, 'shard');
assert.deepEqual(capturedPayload.parameters, { hero: '滑板鞋' });
assert.equal(capturedPayload.preferred, 'image');
assert.equal(capturedPayload.capabilities.text, true);
assert.equal(capturedPayload.capabilities.image, true);
assert.equal(capturedPayload.capabilities.forward, true);
assert.equal(imageResult.plan.kind, 'segments');
if (imageResult.plan.kind === 'segments') {
  assert.equal(imageResult.plan.segments[0]?.type, 'image');
  assert.match((imageResult.plan.segments[0] as any)?.data?.file || '', /^base64:\/\//);
}

const imageStructured = buildShardStructuredResult(imageResult.plan, '960957757', '755396669');
assert.equal(imageStructured.ok, true);
if (imageStructured.ok) {
  assert.equal(imageStructured.response.type, 'structured');
  const delivery = (imageStructured.response as any).payload.deliveries[0];
  assert.equal(delivery.channel, 'group');
  assert.equal(delivery.targetId, '960957757');
  assert.equal(delivery.scene, 'external_query');
  assert.equal(delivery.segments[0].type, 'image');
  assert.equal(delivery.applyTemplate, false);
}

const forwardFixture = await loadEnvelope('delivery-success-forward.json');
const forwardEnvelope = { ...forwardFixture, feature: 'shard' as const };
const forwardResult = await requestShardDelivery({
  baseUrl: 'http://192.168.3.89:5001',
  hero: '滑板鞋',
  preferred: 'forward',
  requestFn: (async () => forwardEnvelope) as any
});
const forwardStructured = buildShardStructuredResult(forwardResult.plan, '960957757', '755396669');
assert.equal(forwardStructured.ok, true);
if (forwardStructured.ok) {
  const delivery = (forwardStructured.response as any).payload.deliveries[0];
  assert.equal(Array.isArray(delivery.forwardNodes), true);
  assert.equal(delivery.forwardNodes.length, 2);
  assert.equal(delivery.forwardNodes[0].data.user_id, '755396669');
}

const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const testConfig = structuredClone(originalConfig) as any;
  testConfig.lolApiBaseUrl = 'http://192.168.3.89:5001';
  testConfig.global = {
    ...(testConfig.global || {}),
    lolQueryRequestTimeoutSeconds: 20
  };
  testConfig.groups = {
    ...(testConfig.groups || {}),
    '960957757': {
      ...(testConfig.groups?.['960957757'] || {}),
      shardQueryOutputFormat: 'image'
    }
  };
  configStateService.setConfig(testConfig);

  const input = {
    commandId: 'builtin.query.shard.intranet',
    registryVersion: 1,
    rawText: '查合集 滑板鞋',
    cleanedText: '查合集 滑板鞋',
    rawArgument: '滑板鞋',
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
      message_id: 101,
      self_id: 755396669,
      raw_message: '查合集 滑板鞋'
    },
    pluginContext: {},
    plugin: {
      metadata: plugin.metadata,
      enabled: true,
      runtimeConfig: {},
      effectiveConfig: {}
    },
    commandContext: {
      rawText: '查合集 滑板鞋',
      cleanedText: '查合集 滑板鞋',
      source: 'dynamic',
      commandId: plugin.definition.id,
      matchedAt: '查合集'
    }
  } as any;

  let executeRequestCount = 0;
  const executed = await executeShardIntranetQuery(
    input,
    context,
    (async (_baseUrl: string, payload: any) => {
      executeRequestCount += 1;
      assert.equal(payload.parameters.hero, '滑板鞋');
      return imageEnvelope;
    }) as any
  );
  assert.equal(executeRequestCount, 1);
  assert.equal(executed.ok, true);
  if (executed.ok) assert.equal(executed.response.type, 'structured');

  let failedRequestCount = 0;
  const failed = await executeShardIntranetQuery(
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

const pluginSource = (await readFile(pluginSourcePath, 'utf8')).toLowerCase();
for (const forbidden of ['raw.githubusercontent.com', 'game.gtimg.cn', 'op.gg', 'lol2099.top']) {
  assert.equal(pluginSource.includes(forbidden), false, `intranet shard runtime contains forbidden public upstream: ${forbidden}`);
}
const commandsSource = await readFile(commandsSourcePath, 'utf8');
assert.match(commandsSource, /registerIntranetQueryCommandPlugins\(\)/);

console.log('intranet shard command verification passed');
