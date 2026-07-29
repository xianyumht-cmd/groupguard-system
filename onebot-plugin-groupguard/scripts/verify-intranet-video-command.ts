import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createVideoIntranetCommandPlugin,
  executeVideoIntranetQuery,
  parseVideoCategory
} from '../src/dynamic-commands/intranet_video_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const runtimeSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_video_runtime_plugin.ts', import.meta.url));
const commandsSourcePath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));
const legacySourcePath = fileURLToPath(new URL('../src/services/interaction_service.ts', import.meta.url));

async function loadVideoEnvelope() {
  const text = await readFile(`${fixtureRoot}/delivery-success-text.json`, 'utf8');
  const parsed = parseGroupGuardQueryDelivery(JSON.parse(text));
  return {
    ...parsed,
    feature: 'video',
    delivery: {
      kind: 'segments',
      segments: [
        {
          type: 'text',
          text: '🎬 搞笑 视频\nhttps://cdn.example.com/funny.mp4'
        }
      ]
    },
    meta: {
      source: 'live',
      stale: false,
      category: '搞笑',
      provider: '搞笑'
    }
  };
}

const plugin = createVideoIntranetCommandPlugin();
assert.equal(plugin.definition.id, 'builtin.query.video.intranet');
assert.equal(plugin.definition.trigger.value, '我要看');
assert.equal(plugin.definition.featureKey, 'query.video');
assert.ok(Number(plugin.definition.priority || 0) > 40);

for (const removed of ['我要看', '设置看视频接口', '删除看视频接口']) {
  assert.equal(INTERACTION_PREFIXES.includes(removed), false, `legacy route still claims ${removed}`);
}
assert.equal(INTERACTION_EXACT.includes('看视频接口列表'), false);
assert.deepEqual(parseVideoCategory(''), { ok: true, category: '热门' });
assert.deepEqual(parseVideoCategory('搞笑'), { ok: true, category: '搞笑' });
assert.equal(parseVideoCategory('x'.repeat(65)).ok, false);

const envelope = await loadVideoEnvelope();
const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.videoApiTemplates = {
    搞笑: 'https://must-not-be-used.example/api?category={category}'
  };
  config.global = {
    ...(config.global || {}),
    lolQueryRequestTimeoutSeconds: 20,
    lolQueryGlobalMinIntervalSeconds: 0,
    lolQueryGroupMinIntervalSeconds: 0
  };
  configStateService.setConfig(config);

  const input = {
    commandId: plugin.definition.id,
    registryVersion: 1,
    rawText: '我要看 搞笑',
    cleanedText: '我要看 搞笑',
    rawArgument: '搞笑',
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
      message_id: 20260731,
      self_id: 755396669,
      raw_message: '我要看 搞笑'
    },
    pluginContext: {},
    plugin: {
      metadata: plugin.metadata,
      enabled: true,
      runtimeConfig: {},
      effectiveConfig: {}
    },
    commandContext: {
      rawText: '我要看 搞笑',
      cleanedText: '我要看 搞笑',
      source: 'dynamic',
      commandId: plugin.definition.id,
      matchedAt: '我要看'
    }
  } as any;

  let requestCount = 0;
  let capturedBaseUrl = '';
  let capturedPayload: any = null;
  const result = await executeVideoIntranetQuery(
    input,
    context,
    (async (baseUrl: string, payload: any) => {
      requestCount += 1;
      capturedBaseUrl = baseUrl;
      capturedPayload = payload;
      return envelope;
    }) as any
  );
  assert.equal(requestCount, 1, 'video command must make exactly one intranet request');
  assert.equal(capturedBaseUrl, 'http://192.168.3.100:5001');
  assert.equal(capturedPayload.feature, 'video');
  assert.deepEqual(capturedPayload.parameters, { category: '搞笑' });
  assert.equal(capturedPayload.preferred, 'text');
  assert.equal(JSON.stringify(capturedPayload).includes('must-not-be-used'), false);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.response.type, 'structured');
    const delivery = (result.response as any).payload.deliveries[0];
    assert.equal(delivery.channel, 'group');
    assert.equal(delivery.targetId, '960957757');
    assert.equal(delivery.segments[0].type, 'text');
    assert.match(delivery.segments[0].data.text, /cdn\.example\.com/);
  }

  let failedCount = 0;
  const failed = await executeVideoIntranetQuery(
    input,
    context,
    (async () => {
      failedCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failedCount, 1, 'video failure must not trigger a second or public request');
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
  'videoapitemplates',
  'resolvevideorequesturl',
  'extractvideourl',
  'http://',
  'https://'
]) {
  assert.equal(runtimeSource.includes(forbidden), false, `video runtime contains forbidden provider behavior: ${forbidden}`);
}
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false, 'video runtime must not call fetch directly');

const commandsSource = await readFile(commandsSourcePath, 'utf8');
assert.match(commandsSource, /registerIntranetVideoCommandPlugins\(\)/);
const legacySource = await readFile(legacySourcePath, 'utf8');
assert.match(legacySource, /if \(text\.startsWith\('我要看'\)\)/, 'legacy video code should remain reviewable during migration');
assert.match(legacySource, /videoApiTemplates/, 'legacy provider fields should remain visible for later config migration review');

console.log('intranet video command verification passed');
