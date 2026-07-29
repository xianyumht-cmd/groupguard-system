import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createIntranetDynamicCommandPlugin,
  executeIntranetDynamicCommand
} from '../src/dynamic-commands/intranet_dynamic_command_plugin.ts';
import { validateDynamicCommandDefinition } from '../src/dynamic-commands/command_validator.ts';
import type { DynamicCommandDefinition } from '../src/dynamic-commands/types.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';
import { migrateDynamicCommands } from './migrate-dynamic-http-to-intranet.mjs';

const defaultConfigPath = fileURLToPath(new URL('../config/dynamic-commands/commands.json', import.meta.url));
const registryPath = fileURLToPath(new URL('../src/dynamic-commands/command_plugin_registry.ts', import.meta.url));
const runtimePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_dynamic_command_plugin.ts', import.meta.url));
const fixturePath = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/delivery-success-text.json', import.meta.url));

const defaultConfig = JSON.parse(await readFile(defaultConfigPath, 'utf8'));
assert.equal(defaultConfig.version, '2.0.0');
assert.deepEqual(defaultConfig.commands.map((command: any) => command.id), [
  'quote.daily',
  'music.search',
  'video.info'
]);
for (const command of defaultConfig.commands) {
  assert.equal(command.featureType, 'query');
  assert.equal(command.provider.type, 'intranet');
  assert.equal(command.response.type, 'structured');
  const serialized = JSON.stringify(command);
  for (const forbidden of ['http://', 'https://', 'headers', 'query":', 'body":', 'textPath', 'template']) {
    assert.equal(serialized.includes(forbidden), false, `${command.id} leaked client provider detail: ${forbidden}`);
  }
}

const definition: DynamicCommandDefinition = {
  id: 'music.search',
  enabled: true,
  priority: 90,
  featureType: 'query',
  featureKey: 'query.dynamic_music',
  scope: 'group',
  allowedGroups: [],
  blockedGroups: [],
  requiresLicense: true,
  permission: 'all',
  trigger: { type: 'prefix', value: '点歌 ' },
  parameters: { keyword: '$1' },
  parameterSchema: { required: ['keyword'], optional: [] },
  provider: { type: 'intranet' },
  response: { type: 'structured' },
  fallbackText: 'music service unavailable'
};
assert.deepEqual(validateDynamicCommandDefinition(definition), []);
const plugin = createIntranetDynamicCommandPlugin(definition, 'json');
assert.equal(plugin.definition.provider.type, 'intranet');
assert.equal(plugin.source, 'json');

const legacyDefinition: DynamicCommandDefinition = {
  ...definition,
  provider: {
    type: 'http',
    method: 'GET',
    url: 'https://itunes.apple.com/search',
    query: { term: '$keyword' },
    timeoutMs: 5000
  },
  response: { type: 'text', textPath: 'results[0].trackViewUrl' }
};
assert.match(validateDynamicCommandDefinition(legacyDefinition)[0]?.message || '', /legacy_http_provider_forbidden/);

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const parsedFixture = parseGroupGuardQueryDelivery(fixture);
const dynamicEnvelope = {
  ...parsedFixture,
  feature: 'dynamic',
  delivery: {
    kind: 'segments' as const,
    segments: [{ type: 'text' as const, text: 'https://result.example/song/1' }]
  },
  meta: { command_id: 'music.search', source: 'live' }
};

const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.global = { ...(config.global || {}), lolQueryRequestTimeoutSeconds: 20 };
  configStateService.setConfig(config);

  const input = {
    commandId: 'music.search',
    registryVersion: 1,
    rawText: '点歌 晴天',
    cleanedText: '点歌 晴天',
    rawArgument: '晴天',
    mappedParameters: { keyword: '晴天' },
    messageType: 'group',
    userId: '20002',
    groupId: '10001',
    source: 'dynamic'
  } as any;
  const context = {
    event: {
      message_type: 'group',
      user_id: 20002,
      group_id: 10001,
      message_id: 30003,
      self_id: 755396669,
      raw_message: '点歌 晴天'
    }
  } as any;

  let requestCount = 0;
  let sentPayload: any = null;
  const result = await executeIntranetDynamicCommand(
    definition,
    input,
    context,
    (async (baseUrl: string, payload: any) => {
      requestCount += 1;
      assert.equal(baseUrl, 'http://192.168.3.100:5001');
      sentPayload = payload;
      return dynamicEnvelope;
    }) as any
  );
  assert.equal(requestCount, 1);
  assert.equal(sentPayload.feature, 'dynamic');
  assert.deepEqual(sentPayload.parameters, {
    command_id: 'music.search',
    keyword: '晴天'
  });
  assert.equal(JSON.stringify(sentPayload).includes('itunes'), false);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.response.type, 'structured');
    const deliveries = (result.response as any).payload.deliveries;
    assert.equal(deliveries[0].channel, 'group');
    assert.equal(deliveries[0].targetId, '10001');
  }

  let failureCount = 0;
  const failed = await executeIntranetDynamicCommand(
    definition,
    input,
    context,
    (async () => {
      failureCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failureCount, 1, 'client must not retry dynamic providers');
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.errorType, 'http_error');
} finally {
  configStateService.setConfig(originalConfig as any);
}

const migrated = migrateDynamicCommands({
  version: '1.0.0',
  commands: [
    {
      id: 'custom.path',
      enabled: true,
      priority: 50,
      trigger: { type: 'prefix', value: '查资料 ' },
      parameters: { keyword: '$1' },
      parameterSchema: { required: ['keyword'], optional: [] },
      provider: {
        type: 'http',
        method: 'GET',
        url: 'https://provider.example/search',
        headers: { Authorization: 'Bearer secret' },
        query: { q: '$keyword' },
        timeoutMs: 4000
      },
      response: { type: 'text', textPath: 'data.answer' },
      fallbackText: '查询失败'
    },
    {
      id: 'custom.template',
      enabled: true,
      trigger: { type: 'exact', value: '状态' },
      parameterSchema: { required: [], optional: [] },
      provider: {
        type: 'http',
        method: 'POST',
        url: 'https://provider.example/status',
        body: { fixed: '1' }
      },
      response: { type: 'text', template: '状态：{data.status|未知}\n说明：{message|无}' },
      fallbackText: '状态服务失败'
    }
  ]
});
assert.equal(migrated.report.counts.total, 2);
assert.equal(migrated.report.counts.migrated_http, 2);
assert.ok(migrated.report.client_sha256.match(/^[a-f0-9]{64}$/));
assert.ok(migrated.report.service_sha256.match(/^[a-f0-9]{64}$/));
for (const command of migrated.clientConfig.commands) {
  assert.equal(command.provider.type, 'intranet');
  const serialized = JSON.stringify(command);
  assert.equal(serialized.includes('provider.example'), false);
  assert.equal(serialized.includes('Bearer secret'), false);
  assert.equal(serialized.includes('data.answer'), false);
}
assert.equal(migrated.serviceCatalog.commands[0].response.text_path, 'data.answer');
assert.equal(migrated.serviceCatalog.commands[0].provider.headers.Authorization, 'Bearer secret');
assert.equal(migrated.serviceCatalog.commands[1].response.template, '状态：{data.status|未知}\n说明：{message|无}');

const registrySource = await readFile(registryPath, 'utf8');
assert.match(registrySource, /createIntranetDynamicCommandPlugin/);
assert.doesNotMatch(registrySource, /createHttpCommandPlugin/);
assert.match(registrySource, /provider\.type !== 'intranet'/);
const runtimeSource = (await readFile(runtimePath, 'utf8')).toLowerCase();
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false);
for (const forbidden of ['http://', 'https://', 'provider.url', 'response.textpath', 'response.template']) {
  assert.equal(runtimeSource.includes(forbidden), false, `dynamic client runtime contains provider business detail: ${forbidden}`);
}

console.log('intranet dynamic command verification passed');
