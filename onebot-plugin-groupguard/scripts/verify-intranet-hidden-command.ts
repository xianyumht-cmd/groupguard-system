import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createHiddenIntranetCommandPlugin,
  executeHiddenIntranetQuery,
  parseHiddenQueryInput
} from '../src/dynamic-commands/intranet_hidden_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const runtimeSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_hidden_runtime_plugin.ts', import.meta.url));
const commandsSourcePath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));
const legacySourcePath = fileURLToPath(new URL('../src/services/interaction_service.ts', import.meta.url));

async function loadHiddenEnvelope() {
  const text = await readFile(`${fixtureRoot}/delivery-success-forward.json`, 'utf8');
  const parsed = parseGroupGuardQueryDelivery(JSON.parse(text));
  return {
    ...parsed,
    feature: 'hidden',
    meta: {
      source: 'live',
      stale: false,
      count: 2,
      player: { name: 'TheShy', region: '1' }
    }
  };
}

const plugin = createHiddenIntranetCommandPlugin();
assert.equal(plugin.definition.id, 'builtin.query.hidden.intranet');
assert.equal(plugin.definition.trigger.value, '查隐藏');
assert.equal(plugin.definition.featureKey, 'query.lol_hidden');
assert.ok(Number(plugin.definition.priority || 0) > 40);

for (const removed of ['查隐藏', '设置lolurl', '设置lolkey', '设置loltoken']) {
  assert.equal(INTERACTION_PREFIXES.includes(removed), false, `legacy route still claims ${removed}`);
}

assert.deepEqual(parseHiddenQueryInput('TheShy'), {
  ok: true,
  value: { name: 'TheShy', region: '1' }
});
assert.deepEqual(parseHiddenQueryInput('TheShy 2'), {
  ok: true,
  value: { name: 'TheShy', region: '2' }
});
assert.equal(parseHiddenQueryInput('').ok, false);

const envelope = await loadHiddenEnvelope();
const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.lolQueryUrl = 'https://must-not-be-used.example/query';
  config.lolAuthKey = 'must-not-be-used-key';
  config.lolToken = 'must-not-be-used-token';
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
      lolQueryOutputFormat: 'forward'
    }
  };
  configStateService.setConfig(config);

  const input = {
    commandId: plugin.definition.id,
    registryVersion: 1,
    rawText: '查隐藏 TheShy 2',
    cleanedText: '查隐藏 TheShy 2',
    rawArgument: 'TheShy 2',
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
      message_id: 20260730,
      self_id: 755396669,
      raw_message: '查隐藏 TheShy 2'
    },
    pluginContext: {},
    plugin: {
      metadata: plugin.metadata,
      enabled: true,
      runtimeConfig: {},
      effectiveConfig: {}
    },
    commandContext: {
      rawText: '查隐藏 TheShy 2',
      cleanedText: '查隐藏 TheShy 2',
      source: 'dynamic',
      commandId: plugin.definition.id,
      matchedAt: '查隐藏'
    }
  } as any;

  let requestCount = 0;
  let capturedBaseUrl = '';
  let capturedPayload: any = null;
  const result = await executeHiddenIntranetQuery(
    input,
    context,
    (async (baseUrl: string, payload: any) => {
      requestCount += 1;
      capturedBaseUrl = baseUrl;
      capturedPayload = payload;
      return envelope;
    }) as any
  );
  assert.equal(requestCount, 1, 'hidden command must make exactly one intranet request');
  assert.equal(capturedBaseUrl, 'http://192.168.3.100:5001');
  assert.equal(capturedPayload.feature, 'hidden');
  assert.deepEqual(capturedPayload.parameters, { name: 'TheShy', region: '2' });
  assert.equal(capturedPayload.preferred, 'forward');
  assert.equal(JSON.stringify(capturedPayload).includes('must-not-be-used'), false);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.response.type, 'structured');
    const deliveries = (result.response as any).payload.deliveries;
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].channel, 'group');
    assert.ok(Array.isArray(deliveries[0].forwardNodes));
  }

  let failedCount = 0;
  const failed = await executeHiddenIntranetQuery(
    input,
    context,
    (async () => {
      failedCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failedCount, 1, 'hidden failure must not trigger a second or public request');
  assert.equal(failed.ok, true);
  if (failed.ok) {
    assert.equal(failed.response.type, 'text');
    assert.equal((failed.response as any).text, '内网查询服务暂时不可用，请稍后再试。');
  }
} finally {
  configStateService.setConfig(originalConfig as any);
}

const runtimeSource = (await readFile(runtimeSourcePath, 'utf8')).toLowerCase();
for (const forbidden of [
  'lolso1.com',
  'ww1.lolso1.com',
  'authorization',
  'bearer ',
  'lolqueryurl',
  'lolauthkey',
  'loltoken',
  'zhanjikey'
]) {
  assert.equal(runtimeSource.includes(forbidden), false, `hidden runtime contains forbidden provider behavior: ${forbidden}`);
}
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false, 'hidden runtime must not call fetch directly');

const commandsSource = await readFile(commandsSourcePath, 'utf8');
assert.match(commandsSource, /registerIntranetHiddenCommandPlugins\(\)/);
const legacySource = await readFile(legacySourcePath, 'utf8');
assert.match(legacySource, /if \(text\.startsWith\('查隐藏'\)\)/, 'legacy hidden code should remain reviewable during migration');
assert.match(legacySource, /lolToken/, 'legacy secret fields should remain visible for later config migration review');

console.log('intranet hidden command verification passed');
