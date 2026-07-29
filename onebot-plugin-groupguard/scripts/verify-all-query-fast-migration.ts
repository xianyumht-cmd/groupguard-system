import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createAramIntranetCommandPlugin,
  createLolbanIntranetCommandPlugin,
  executeAramIntranetQuery,
  executeLolbanIntranetQuery
} from '../src/dynamic-commands/intranet_query_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';
import { requestIntranetDelivery } from '../src/services/intranet_query_service.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const runtimeSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_query_runtime_plugin.ts', import.meta.url));
const genericSourcePath = fileURLToPath(new URL('../src/services/intranet_query_service.ts', import.meta.url));
const interactionSourcePath = fileURLToPath(new URL('../src/services/interaction_service.ts', import.meta.url));

async function loadEnvelope(name: string) {
  const text = await readFile(`${fixtureRoot}/${name}`, 'utf8');
  return parseGroupGuardQueryDelivery(JSON.parse(text));
}

function inputFor(commandId: string, trigger: string, argument: string) {
  return {
    commandId,
    registryVersion: 1,
    rawText: `${trigger} ${argument}`,
    cleanedText: `${trigger} ${argument}`,
    rawArgument: argument,
    mappedParameters: {},
    messageType: 'group',
    userId: '123456789',
    groupId: '960957757',
    source: 'dynamic'
  } as any;
}

function contextFor(plugin: any, rawMessage: string) {
  return {
    event: {
      message_type: 'group',
      user_id: 123456789,
      group_id: 960957757,
      message_id: Math.floor(Math.random() * 1000000),
      self_id: 755396669,
      raw_message: rawMessage
    },
    pluginContext: {},
    plugin: {
      metadata: plugin.metadata,
      enabled: true,
      runtimeConfig: {},
      effectiveConfig: {}
    },
    commandContext: {
      rawText: rawMessage,
      cleanedText: rawMessage.replace(/\[CQ:[^\]]+\]/g, '').trim(),
      source: 'dynamic',
      commandId: plugin.definition.id,
      matchedAt: plugin.definition.trigger.value
    }
  } as any;
}

const aramPlugin = createAramIntranetCommandPlugin();
const banPlugin = createLolbanIntranetCommandPlugin();
assert.equal(aramPlugin.definition.id, 'builtin.query.aram.intranet');
assert.equal(aramPlugin.definition.trigger.value, '海符榜');
assert.equal(aramPlugin.definition.featureKey, 'query.lol_aram_augments');
assert.ok(Number(aramPlugin.definition.priority || 0) > 40);
assert.equal(banPlugin.definition.id, 'builtin.query.lolban.intranet');
assert.equal(banPlugin.definition.trigger.value, '查封号');
assert.equal(banPlugin.definition.featureKey, 'query.lol_ban');
assert.ok(Number(banPlugin.definition.priority || 0) > 40);

for (const removed of [
  '海符榜',
  '查封号',
  '设置封号主接口',
  '设置封号接口配置',
  '删除封号备用接口'
]) {
  assert.equal(INTERACTION_PREFIXES.includes(removed), false, `legacy route still claims ${removed}`);
}
assert.equal(INTERACTION_EXACT.includes('封号接口列表'), false, 'legacy ban provider list must be unreachable');

const aramEnvelope = await loadEnvelope('delivery-success-forward.json');
let aramRequestCount = 0;
let aramPayload: any = null;
const aramResult = await requestIntranetDelivery({
  baseUrl: 'http://192.168.3.100:5001',
  feature: 'aram',
  parameters: { hero: '亚索' },
  preferred: 'forward',
  requestId: 'gg-aram-test-001',
  requestFn: (async (_baseUrl: string, payload: any) => {
    aramRequestCount += 1;
    aramPayload = payload;
    return aramEnvelope;
  }) as any
});
assert.equal(aramRequestCount, 1);
assert.equal(aramPayload.feature, 'aram');
assert.deepEqual(aramPayload.parameters, { hero: '亚索' });
assert.equal(aramResult.plan.kind, 'forward');

const banEnvelope = await loadEnvelope('delivery-success-text.json');
let banRequestCount = 0;
let banPayload: any = null;
const banResult = await requestIntranetDelivery({
  baseUrl: 'http://192.168.3.100:5001',
  feature: 'lolban',
  parameters: { qq: '123456789' },
  preferred: 'text',
  requestId: 'gg-ban-test-001',
  requestFn: (async (_baseUrl: string, payload: any) => {
    banRequestCount += 1;
    banPayload = payload;
    return banEnvelope;
  }) as any
});
assert.equal(banRequestCount, 1);
assert.equal(banPayload.feature, 'lolban');
assert.deepEqual(banPayload.parameters, { qq: '123456789' });
assert.equal(banResult.plan.kind, 'segments');

const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.global = {
    ...(config.global || {}),
    lolQueryRequestTimeoutSeconds: 20,
    lolQueryGlobalMinIntervalSeconds: 0,
    lolQueryGroupMinIntervalSeconds: 0,
    lolQueryGlobalRateLimitPerMinute: 5000,
    lolQueryGroupRateLimitPerMinute: 1000,
    lolQueryDailyLimit: 100000,
    banQueryUserCooldownSeconds: 0
  };
  config.groups = {
    ...(config.groups || {}),
    '960957757': {
      ...(config.groups?.['960957757'] || {}),
      aramQueryOutputFormat: 'forward'
    }
  };
  configStateService.setConfig(config);

  let executeAramCount = 0;
  const executedAram = await executeAramIntranetQuery(
    inputFor(aramPlugin.definition.id, '海符榜', '亚索'),
    contextFor(aramPlugin, '海符榜 亚索'),
    (async (_baseUrl: string, payload: any) => {
      executeAramCount += 1;
      assert.equal(payload.feature, 'aram');
      assert.equal(payload.parameters.hero, '亚索');
      return aramEnvelope;
    }) as any
  );
  assert.equal(executeAramCount, 1);
  assert.equal(executedAram.ok, true);
  if (executedAram.ok) assert.equal(executedAram.response.type, 'structured');

  let executeBanCount = 0;
  const executedBan = await executeLolbanIntranetQuery(
    inputFor(banPlugin.definition.id, '查封号', '[CQ:at,qq=123456789]'),
    contextFor(banPlugin, '查封号 [CQ:at,qq=123456789]'),
    (async (_baseUrl: string, payload: any) => {
      executeBanCount += 1;
      assert.equal(payload.feature, 'lolban');
      assert.equal(payload.parameters.qq, '123456789');
      return banEnvelope;
    }) as any
  );
  assert.equal(executeBanCount, 1);
  assert.equal(executedBan.ok, true);
  if (executedBan.ok) assert.equal(executedBan.response.type, 'structured');

  let failedAramCount = 0;
  const failedAram = await executeAramIntranetQuery(
    inputFor(aramPlugin.definition.id, '海符榜', '亚索'),
    contextFor(aramPlugin, '海符榜 亚索'),
    (async () => {
      failedAramCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failedAramCount, 1, 'ARAM transport failure must not trigger a second or public request');
  assert.equal(failedAram.ok, true);
  if (failedAram.ok) assert.equal((failedAram.response as any).text, '内网查询服务暂时不可用，请稍后再试。');

  let failedBanCount = 0;
  const failedBan = await executeLolbanIntranetQuery(
    inputFor(banPlugin.definition.id, '查封号', '123456789'),
    contextFor(banPlugin, '查封号 123456789'),
    (async () => {
      failedBanCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failedBanCount, 1, 'ban transport failure must not trigger a second or public request');
  assert.equal(failedBan.ok, true);
  if (failedBan.ok) assert.equal((failedBan.response as any).text, '内网查询服务暂时不可用，请稍后再试。');
} finally {
  configStateService.setConfig(originalConfig as any);
}

const runtimeSource = (await readFile(runtimeSourcePath, 'utf8')).toLowerCase();
const genericSource = (await readFile(genericSourcePath, 'utf8')).toLowerCase();
for (const forbidden of [
  'raw.githubusercontent.com',
  'game.gtimg.cn',
  'op.gg',
  'lolso1.com',
  'lol2099.top'
]) {
  assert.equal(runtimeSource.includes(forbidden), false, `runtime contains forbidden public upstream: ${forbidden}`);
  assert.equal(genericSource.includes(forbidden), false, `generic client contains forbidden public upstream: ${forbidden}`);
}
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false, 'runtime command plugin must not call fetch directly');

const legacySource = await readFile(interactionSourcePath, 'utf8');
assert.match(legacySource, /if \(text\.startsWith\('海符榜'\)\)/, 'legacy code should remain reviewable during migration');
assert.match(legacySource, /if \(text\.startsWith\('查封号'\)\)/, 'legacy ban code should remain reviewable during migration');

console.log('all-query fast migration verification passed');
