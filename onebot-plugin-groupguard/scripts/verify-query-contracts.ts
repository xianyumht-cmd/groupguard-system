import assert from 'node:assert/strict';
import { normalizePluginConfig } from '../src/config.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { getQueryOverview, testQueryEndpoint } from '../src/standalone/admin/query_api.ts';
import { deliverOneBotImageToGroup, fetchOneBotImageFile } from '../src/services/lol_image_delivery.ts';
import { getBuildInfo } from '../src/build_info.ts';

const originalConfig = configStateService.getConfig();
const originalFetch = globalThis.fetch;

try {
  configStateService.setConfig(normalizePluginConfig({
    lolApiBaseUrl: 'http://lol-api.test:5001',
    global: {
      lolQueryRequestTimeoutSeconds: 20
    }
  } as any));

  let requestedUrl = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      name: 'ZCG烧火棍丘丘人#73557',
      recent_matches: []
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  const banSuccess = await testQueryEndpoint({
    type: 'lol_ban',
    param: '2621735529'
  });
  const banUrl = new URL(requestedUrl);
  assert.equal(banUrl.pathname, '/api/v2/lolban');
  assert.equal(banUrl.searchParams.get('qq'), '2621735529');
  assert.equal(banUrl.searchParams.get('compat'), 'napcat');
  assert.equal(banSuccess.ok, true);

  await assert.rejects(
    () => testQueryEndpoint({ type: 'lol_ban', param: '123456789012' }),
    /5-11/
  );
  await assert.rejects(
    () => testQueryEndpoint({ type: 'not-a-query', param: 'x' }),
    /未知查询类型/
  );

  const success = await testQueryEndpoint({
    type: 'lol_battle',
    param: 'ZCG烧火棍丘丘人#73557'
  });
  const battleUrl = new URL(requestedUrl);
  assert.equal(battleUrl.pathname, '/cross_query');
  assert.equal(battleUrl.searchParams.get('name'), 'ZCG烧火棍丘丘人#73557');
  assert.equal(battleUrl.searchParams.get('output'), 'pretty');
  assert.equal(battleUrl.searchParams.has('qq'), false);
  assert.equal(success.ok, true);
  assert.equal(success.response.status, 200);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    detail: [{ loc: ['query', 'name'], msg: 'Field required' }]
  }), {
    status: 422,
    statusText: 'Unprocessable Entity',
    headers: { 'content-type': 'application/json' }
  })) as typeof fetch;

  const rejected = await testQueryEndpoint({
    type: 'lol_battle',
    param: 'ZCG烧火棍丘丘人#73557'
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'upstream_http_422');
  assert.equal(rejected.response.ok, false);
  assert.equal(rejected.response.status, 422);
  assert.match(rejected.finalReplyPreview, /查询失败：上游 HTTP 422/);

  let imageFetchCount = 0;
  const imageFile = await fetchOneBotImageFile('http://lol-api.test/image', {
    timeoutMs: 1000,
    fetchFn: (async () => {
      imageFetchCount += 1;
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' }
      });
    }) as typeof fetch
  });
  assert.equal(imageFetchCount, 1);
  assert.equal(imageFile, `base64://${Buffer.from([137, 80, 78, 71]).toString('base64')}`);

  let streamedBodyCancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3]));
    },
    cancel() {
      streamedBodyCancelled = true;
    }
  });
  await assert.rejects(
    () => fetchOneBotImageFile('http://lol-api.test/oversized-stream', {
      timeoutMs: 1000,
      maxBytes: 4,
      fetchFn: (async () => new Response(oversizedStream, {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })) as typeof fetch
    }),
    /image_too_large_6/
  );
  assert.equal(streamedBodyCancelled, true, 'streaming image download must be cancelled as soon as the byte limit is exceeded');

  let declaredBodyCancelled = false;
  const declaredOversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      declaredBodyCancelled = true;
    }
  });
  await assert.rejects(
    () => fetchOneBotImageFile('http://lol-api.test/declared-oversized', {
      timeoutMs: 1000,
      maxBytes: 4,
      fetchFn: (async () => new Response(declaredOversizedStream, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '5' }
      })) as typeof fetch
    }),
    /image_too_large_5/
  );
  assert.equal(declaredBodyCancelled, true, 'declared oversized image response must be cancelled without buffering the body');

  let deliveredImageOptions: Record<string, any> | null = null;
  await deliverOneBotImageToGroup('805402626', 'http://lol-api.test/image', {
    timeoutMs: 1000,
    fetchFn: (async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '4' }
    })) as typeof fetch,
    sendGroupMsg: async (_groupId, _message, options) => {
      deliveredImageOptions = options;
    }
  });
  assert.equal(deliveredImageOptions?.requireDelivery, true);
  await assert.rejects(
    () => deliverOneBotImageToGroup('805402626', 'http://lol-api.test/image', {
      timeoutMs: 1000,
      fetchFn: (async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' }
      })) as typeof fetch,
      sendGroupMsg: async () => {
        throw new Error('group_send_not_delivered:send_rate_limited');
      }
    }),
    /group_send_not_delivered/
  );

  const build = getBuildInfo();
  assert.equal(build.service, 'groupguard');
  assert.equal(build.config_schema_version, 8);
  assert.equal(build.contract_version, 'groupguard-lol-api.v2');

  const overview = getQueryOverview();
  assert.equal(overview.rows.find((row: any) => row.type === 'lol_ban')?.dataSource, 'local-api');
  assert.equal(overview.rows.find((row: any) => row.type === 'lol_aram_augments')?.trigger, '海符榜');

  configStateService.setConfig(normalizePluginConfig({} as any));
  const unconfigured = getQueryOverview();
  assert.equal(unconfigured.config.lolApiBaseUrl, '');
  assert.equal(unconfigured.config.lanzouUpdatePush.monitorBaseUrl, '');
  assert.ok(unconfigured.validation.errors.some((message: string) => message.includes('LOL API Base 未配置')));

  console.log('query contract verification passed');
} finally {
  configStateService.setConfig(originalConfig);
  globalThis.fetch = originalFetch;
}
