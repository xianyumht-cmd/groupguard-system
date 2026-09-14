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
    scammerQueryUrls: ['http://scammer-api.test/query?qq={qq}'],
    eleBuildApiBaseUrl: 'http://ele-api.test/api',
    global: {
      lolQueryRequestTimeoutSeconds: 20
    }
  } as any));

  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  let queryFetchCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    queryFetchCount += 1;
    requestedUrl = String(input);
    requestedInit = init;
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
  assert.equal(requestedInit?.redirect, 'manual');

  await assert.rejects(
    () => testQueryEndpoint({ type: 'lol_ban', param: '123456789012' }),
    /5-11/
  );
  await assert.rejects(
    () => testQueryEndpoint({ type: 'not-a-query', param: 'x' }),
    /未知查询类型/
  );

  const beforeCustomFetchCount = queryFetchCount;
  await assert.rejects(
    () => testQueryEndpoint({ type: 'custom', param: 'x', url: 'http://127.0.0.1:5099/private' }),
    /禁止任意 URL/
  );
  assert.equal(queryFetchCount, beforeCustomFetchCount, 'custom URL must be rejected before any outbound request');

  await assert.rejects(
    () => testQueryEndpoint({ type: 'lol_battle', param: 'test#1', headers: { authorization: 'Bearer attacker-controlled' } }),
    /禁止自定义请求头/
  );
  assert.equal(queryFetchCount, beforeCustomFetchCount, 'custom headers must be rejected before any outbound request');

  const scammer = await testQueryEndpoint({
    type: 'scammer',
    param: '12345',
    url: 'http://127.0.0.1:5099/private'
  });
  const scammerUrl = new URL(requestedUrl);
  assert.equal(scammerUrl.hostname, 'scammer-api.test');
  assert.equal(scammerUrl.searchParams.get('qq'), '12345');
  assert.equal(scammer.ok, true);

  const ele = await testQueryEndpoint({
    type: 'ele_build',
    param: 'demo-build',
    url: 'http://127.0.0.1:5099/private'
  });
  const eleUrl = new URL(requestedUrl);
  assert.equal(eleUrl.hostname, 'ele-api.test');
  assert.equal(eleUrl.pathname, '/api/build/active/demo-build');
  assert.equal(ele.ok, true);

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

  let redirectFetchCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    redirectFetchCount += 1;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, {
      status: 302,
      statusText: 'Found',
      headers: { location: 'http://127.0.0.1:5099/private' }
    });
  }) as typeof fetch;
  const redirectRejected = await testQueryEndpoint({
    type: 'lol_battle',
    param: 'ZCG烧火棍丘丘人#73557'
  });
  assert.equal(redirectFetchCount, 1, 'query tester must not follow redirect hops');
  assert.equal(redirectRejected.ok, false);
  assert.equal(redirectRejected.error, 'upstream_http_302');

  let declaredBodyCancelled = false;
  const declaredOversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      declaredBodyCancelled = true;
    }
  });
  globalThis.fetch = (async () => new Response(declaredOversizedStream, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(256 * 1024 + 1)
    }
  })) as typeof fetch;
  const declaredOversized = await testQueryEndpoint({
    type: 'lol_battle',
    param: 'ZCG烧火棍丘丘人#73557'
  });
  assert.equal(declaredOversized.ok, false);
  assert.match(declaredOversized.error, /^upstream_body_too_large_262145$/);
  assert.equal(declaredBodyCancelled, true, 'declared oversized query response must be cancelled before buffering');

  let streamedBodyCancelled = false;
  const streamedOversizedBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(140 * 1024));
    },
    cancel() {
      streamedBodyCancelled = true;
    }
  });
  globalThis.fetch = (async () => new Response(streamedOversizedBody, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })) as typeof fetch;
  const streamedOversized = await testQueryEndpoint({
    type: 'lol_battle',
    param: 'ZCG烧火棍丘丘人#73557'
  });
  assert.equal(streamedOversized.ok, false);
  assert.match(streamedOversized.error, /^upstream_body_too_large_/);
  assert.equal(streamedBodyCancelled, true, 'streaming query response must be cancelled as soon as the byte limit is exceeded');

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

  let streamedImageBodyCancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3]));
    },
    cancel() {
      streamedImageBodyCancelled = true;
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
  assert.equal(streamedImageBodyCancelled, true, 'streaming image download must be cancelled as soon as the byte limit is exceeded');

  let declaredImageBodyCancelled = false;
  const declaredOversizedImageStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      declaredImageBodyCancelled = true;
    }
  });
  await assert.rejects(
    () => fetchOneBotImageFile('http://lol-api.test/declared-oversized', {
      timeoutMs: 1000,
      maxBytes: 4,
      fetchFn: (async () => new Response(declaredOversizedImageStream, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '5' }
      })) as typeof fetch
    }),
    /image_too_large_5/
  );
  assert.equal(declaredImageBodyCancelled, true, 'declared oversized image response must be cancelled without buffering the body');

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
