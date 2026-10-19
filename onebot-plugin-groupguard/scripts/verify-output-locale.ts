import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_PLUGIN_CONFIG, normalizePluginConfig } from '../src/config';
import { pluginStateContextAdapter } from '../src/core/state-infra/plugin_state_context_adapter';
import { configStateService } from '../src/core/state-services/config_state_service';
import { generateReply } from '../src/reply_generator';
import { localizeOneBotSendParamsSafe, localizeOutputTextSafe } from '../src/services/output_locale_egress_guard';
import {
  clearOutputLocaleCacheForTest,
  localizeOneBotSendParams,
  localizeOutputText,
  normalizeOutputLocale,
  type OutputTranslationFn,
} from '../src/services/output_locale_service';
import { qunGuanjiaService, type QunGuanjiaRouteResult } from '../src/services/qun_guanjia_service';
import {
  resolveOutputTranslationPolicy,
  secureOutputTranslator,
} from '../src/services/output_translation_policy';
import { pluginState } from '../src/state';
import { OneBotActionCaller } from '../src/standalone/onebot_action_caller';
import { applyOutputLocaleWebUiPatch } from '../src/standalone/admin/output_locale_webui_patch';
import {
  classifyBusinessFailure,
  classifyTranslationFailure,
} from '../src/services/output_translation_fallback';

async function verifyTranslationPrivacyPolicy(): Promise<void> {
  assert.deepEqual(
    resolveOutputTranslationPolicy({ GROUPGUARD_TRANSLATE_ENDPOINT: 'off' } as NodeJS.ProcessEnv),
    { mode: 'disabled', endpoint: '', allowPublicFallback: false },
    'explicit off must disable every network translation provider'
  );
  assert.deepEqual(
    resolveOutputTranslationPolicy({ GROUPGUARD_TRANSLATE_ENDPOINT: 'https://translate.internal/v1' } as NodeJS.ProcessEnv),
    { mode: 'custom', endpoint: 'https://translate.internal/v1', allowPublicFallback: false },
    'custom endpoint must be a privacy boundary by default'
  );
  assert.deepEqual(
    resolveOutputTranslationPolicy({
      GROUPGUARD_TRANSLATE_ENDPOINT: 'https://translate.internal/v1',
      GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK: 'true'
    } as NodeJS.ProcessEnv),
    { mode: 'custom', endpoint: 'https://translate.internal/v1', allowPublicFallback: true },
    'public fallback must require an explicit opt-in for custom endpoints'
  );
  assert.deepEqual(
    resolveOutputTranslationPolicy({} as NodeJS.ProcessEnv),
    { mode: 'disabled', endpoint: '', allowPublicFallback: false },
    'network translation must require explicit operator configuration'
  );

  const originalFetch = globalThis.fetch;
  const previousEndpoint = process.env.GROUPGUARD_TRANSLATE_ENDPOINT;
  const previousFallback = process.env.GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK;
  const previousApiKey = process.env.GROUPGUARD_TRANSLATE_API_KEY;
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  try {
    const calls: string[] = [];
    (globalThis as any).fetch = async (input: unknown) => {
      calls.push(String(input));
      throw new Error('unexpected_network_call');
    };
    process.env.GROUPGUARD_TRANSLATE_ENDPOINT = 'off';
    delete process.env.GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK;
    delete process.env.GROUPGUARD_TRANSLATE_API_KEY;
    await assert.rejects(() => secureOutputTranslator('测试隐私边界', 'en'), /translation_endpoint_disabled/);
    assert.equal(calls.length, 0, 'disabled translation must not perform any fetch');

    calls.length = 0;
    process.env.GROUPGUARD_TRANSLATE_ENDPOINT = 'https://translate.internal/v1';
    delete process.env.GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK;
    await assert.rejects(() => secureOutputTranslator('测试私有端点', 'en'), /unexpected_network_call/);
    assert.deepEqual(calls, ['https://translate.internal/v1'], 'private endpoint failure must not silently call a public provider');

    calls.length = 0;
    process.env.GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK = 'true';
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://translate.internal/v1') {
        return { ok: false, status: 503, json: async () => ({}) } as any;
      }
      if (url.startsWith('https://api.mymemory.translated.net/get?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ responseData: { translatedText: 'privacy fallback translated' } })
        } as any;
      }
      throw new Error(`unexpected_url:${url}`);
    };
    assert.equal(
      await secureOutputTranslator('测试显式公共兜底', 'en'),
      'privacy fallback translated',
      'explicit public fallback must work after a failed custom endpoint'
    );
    assert.equal(calls.length, 2, 'explicit custom fallback should call custom endpoint once then one public provider');
    assert.equal(calls[0], 'https://translate.internal/v1');
    assert.match(calls[1], /^https:\/\/api\.mymemory\.translated\.net\/get\?/);
  } finally {
    (globalThis as any).fetch = originalFetch;
    restoreEnv('GROUPGUARD_TRANSLATE_ENDPOINT', previousEndpoint);
    restoreEnv('GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK', previousFallback);
    restoreEnv('GROUPGUARD_TRANSLATE_API_KEY', previousApiKey);
  }
}

function verifyFleetRollbackContracts(): void {
  const repoDual = fs.readFileSync(new URL('../../scripts/windows/groupguard-update-89-121.ps1', import.meta.url), 'utf8');
  assert.match(repoDual, /\$rollbackScript\s*=/, 'repository dual-host launcher must bind the audited rollback workflow');
  assert.match(repoDual, /Invoke-CompletedHostRollback/, 'repository dual-host launcher must roll back already-completed hosts');
  assert.match(repoDual, /for \(\$index = \$Hosts\.Count - 1; \$index -ge 0; \$index--\)/, 'repository fleet rollback must run in reverse order');
  assert.match(repoDual, /exit 90/, 'repository launcher must expose incomplete fleet reconciliation as a dedicated failure');

  const bundleRunner = fs.readFileSync(new URL('../../scripts/windows/groupguard-deploy-bundle.ps1', import.meta.url), 'utf8');
  assert.match(bundleRunner, /groupguard-remote-rollback\.sh/, 'immutable bundle runner must require the remote rollback helper');
  assert.match(bundleRunner, /Invoke-HostRollback/, 'immutable bundle runner must reconcile previously completed hosts');
  assert.match(bundleRunner, /for \(\$index = \$completedHosts\.Count - 1; \$index -ge 0; \$index--\)/, 'bundle fleet rollback must run in reverse order');
  assert.match(bundleRunner, /exit 90/, 'bundle runner must expose incomplete fleet reconciliation as a dedicated failure');

  const buildWorkflow = fs.readFileSync(new URL('../../.github/workflows/groupguard-build.yml', import.meta.url), 'utf8');
  assert.match(
    buildWorkflow,
    /cp \.\.\/scripts\/windows\/groupguard-remote-rollback\.sh "\$bundle\/groupguard-remote-rollback\.sh"/,
    'immutable artifact must package the audited rollback helper'
  );
}

async function verifyQunGuanjiaLocalizationBoundary(): Promise<void> {
  const previousPluginConfig = pluginState.config;
  const previousActions = pluginState.actions;
  const originalRouteGroupMessage = qunGuanjiaService.routeGroupMessage;
  const routedCalls: Array<{ params: any; scene: string }> = [];
  const rawCalls: Array<{ action: string; params: unknown }> = [];
  let routeResult: QunGuanjiaRouteResult = { handled: true, ok: true, fallback: false };
  const sourceText = '完成后我会把链接发到这里';
  const localizedText = '完成後我會把連結發到這裡';

  try {
    pluginState.config = {
      ...previousPluginConfig,
      global: {
        ...previousPluginConfig.global,
        outputLocale: 'zh-TW',
        botSendWrapperEnabled: false,
      } as any,
      groups: {},
    };
    qunGuanjiaService.routeGroupMessage = async (params: any, scene: string) => {
      routedCalls.push({ params, scene });
      return routeResult;
    };
    pluginStateContextAdapter.setActions({
      call: async (action: string, params: unknown) => {
        rawCalls.push({ action, params });
        return { status: 'ok', retcode: 0, data: { message_id: 10001 } };
      }
    } as any);

    const wrappedActions = pluginState.actions as any;
    const sendParams = {
      group_id: 123456,
      message: [{ type: 'text', data: { text: sourceText } }]
    };

    const routedResult = await wrappedActions.call('send_group_msg', sendParams);
    assert.equal(routedCalls.length, 1, 'QunGuanjia route must receive one offered group message');
    assert.equal(
      routedCalls[0].params.message[0].data.text,
      localizedText,
      'QunGuanjia success route must receive the localized copy before bypassing OneBot egress'
    );
    assert.equal(rawCalls.length, 0, 'successful QunGuanjia routing must bypass the OneBot transport');
    assert.equal(routedResult?.data?.channel, 'qun_guanjia');

    routedCalls.length = 0;
    rawCalls.length = 0;
    routeResult = { handled: true, ok: false, fallback: true, error: 'synthetic_route_failure' };

    await wrappedActions.call('send_group_msg', sendParams);
    assert.equal(routedCalls.length, 1, 'fallback attempt must still offer one localized copy to QunGuanjia');
    assert.equal(
      routedCalls[0].params.message[0].data.text,
      localizedText,
      'QunGuanjia fallback attempt must receive localized text'
    );
    assert.equal(rawCalls.length, 1, 'fallback must continue to the underlying OneBot transport exactly once');
    assert.equal(rawCalls[0].action, 'send_group_msg');
    assert.equal(
      (rawCalls[0].params as any).message[0].data.text,
      sourceText,
      'fallback must keep the original text for the final OneBot egress to localize exactly once'
    );
  } finally {
    qunGuanjiaService.routeGroupMessage = originalRouteGroupMessage;
    pluginState.config = previousPluginConfig;
    pluginState.actions = previousActions;
  }
}

async function verifyDifferentiatedTranslationFailures(): Promise<void> {
  const disabled: OutputTranslationFn = async () => {
    throw new Error('translation_endpoint_disabled');
  };
  const cases: Array<[string, string, string]> = [
    ['查询请求超时，请稍后再试', 'QUERY_TIMEOUT', 'timed out'],
    ['接口连接失败，请稍后再试', 'QUERY_NETWORK_ERROR', 'connect'],
    ['服务器繁忙，请稍后再试', 'QUERY_UPSTREAM_UNAVAILABLE', 'unavailable'],
    ['查询登录态失效，请重新登录', 'QUERY_AUTH_EXPIRED', 'session'],
    ['请求触发限流，请稍后再试', 'QUERY_RATE_LIMITED', 'rate-limited'],
    ['查询未找到玩家', 'QUERY_NOT_FOUND', 'No matching'],
    ['查询数据格式错误', 'QUERY_BAD_RESPONSE', 'invalid'],
    ['查封号查询失败', 'QUERY_FAILED', 'could not be completed'],
  ];
  for (const [original, code, text] of cases) {
    const output = await localizeOutputText(original, 'en', disabled);
    assert.ok(output.includes(code), `missing ${code} for ${original}`);
    assert.ok(output.includes('TRANSLATION_DISABLED'), 'must distinguish translator failure from business failure');
    assert.ok(output.toLowerCase().includes(text.toLowerCase()));
    assert.ok(!output.includes(original), 'English-only mode must not leak original text');
    assert.ok(!output.includes('Translation is temporarily unavailable.'));
  }

  assert.equal(classifyBusinessFailure('请不要在群里说服务器繁忙'), null, 'ordinary Q&A must not be interpreted as upstream error');
  assert.equal(classifyBusinessFailure('查询成功，已找到玩家及其战绩'), null, 'successful business text is not an error');
  assert.equal(classifyBusinessFailure('查询接口偶发超时\n这一段是自定义问答，不代表本次请求失败'), null, 'multiline Q&A must not be categorized as failed request');
  assert.equal(classifyTranslationFailure(new Error('HTTP 401')), 'TRANSLATION_AUTH_FAILED');
  assert.equal(classifyTranslationFailure(new Error('HTTP 429')), 'TRANSLATION_RATE_LIMITED');
  assert.equal(classifyTranslationFailure(new Error('AbortError')), 'TRANSLATION_TIMEOUT');
  assert.equal(classifyTranslationFailure(new Error('empty_translation')), 'TRANSLATION_BAD_RESPONSE');
  assert.equal(classifyTranslationFailure(new Error('connection refused')), 'TRANSLATION_PROVIDER_UNAVAILABLE');

  const success = await localizeOutputText('查询成功，玩家已找到，排位数据正在展示', 'en', disabled);
  assert.match(success, /the query may have succeeded/i, 'translation failure must not imply a successful query failed');
  assert.ok(!success.includes('QUERY_FAILED'));
  const unknown = await localizeOutputText('群里今天活动安排如下', 'en', disabled);
  assert.match(unknown, /original reply could not be translated/i);
  assert.ok(!unknown.includes('群里'));

  const sensitive = await localizeOutputText(
    '查询请求超时，地址：https://example.invalid/secret?token=private',
    'en', disabled
  );
  assert.ok(sensitive.includes('QUERY_TIMEOUT'));
  assert.ok(!sensitive.includes('private'));
  assert.ok(!sensitive.includes('example.invalid'));

  const forwarded = await localizeOneBotSendParamsSafe('send_group_forward_msg', {
    messages: [{
      type: 'node',
      data: {
        nickname: 'Operator',
        content: [
          { type: 'text', data: { text: '接口连接失败' } },
          { type: 'image', data: { file: 'https://example.com/private-image.jpg' } },
        ]
      }
    }]
  }, 'en', disabled) as any;
  assert.ok(forwarded.messages[0].data.content[0].data.text.includes('QUERY_NETWORK_ERROR'));
  assert.equal(forwarded.messages[0].data.content[1].data.file, 'https://example.com/private-image.jpg');

  let attempts = 0;
  let repaired = false;
  const recoveringTranslator: OutputTranslationFn = async () => {
    attempts += 1;
    if (!repaired) throw new Error('HTTP 503');
    return 'The reply is available again.';
  };
  const retryText = '查询完成并生成最新统计';
  assert.match(await localizeOutputText(retryText, 'en', recoveringTranslator), /TRANSLATION_PROVIDER_UNAVAILABLE/);
  repaired = true;
  assert.equal(await localizeOutputText(retryText, 'en', recoveringTranslator), 'The reply is available again.');
  assert.equal(await localizeOutputText(retryText, 'en', recoveringTranslator), 'The reply is available again.');
  assert.equal(attempts, 2, 'failed translation cannot poison successful-translation cache');
}

async function main(): Promise<void> {
  clearOutputLocaleCacheForTest();
  assert.equal(normalizeOutputLocale(undefined), 'zh-CN');
  assert.equal(normalizeOutputLocale('zh-TW'), 'zh-TW');
  assert.equal(normalizeOutputLocale('en'), 'en');
  assert.equal(normalizeOutputLocale('fr'), 'zh-CN');

  assert.equal(
    await localizeOutputText('复制下面内容到浏览器打开：', 'zh-TW'),
    '複製下方內容到瀏覽器開啟：'
  );
  assert.equal(
    await localizeOutputText('复制下面内容到浏览器打开：', 'en'),
    'Copy the content below and open it in your browser:'
  );
  assert.equal(
    await localizeOutputText('查询过于频繁（全局每分钟上限 120 次）', 'en'),
    'Too many query requests (global limit: 120 per minute).'
  );

  const fakeTranslator: OutputTranslationFn = async (text, locale) => {
    if (locale === 'en') return text.replace('点击这个链接购买：', 'Click this link to purchase: ');
    return text.replace('点击这个链接购买：', '點擊這個連結購買：');
  };
  const customQa = '点击这个链接购买：https://example.com/order?a=1';
  assert.equal(
    await localizeOutputText(customQa, 'en', fakeTranslator),
    'Click this link to purchase: https://example.com/order?a=1'
  );

  await verifyDifferentiatedTranslationFailures();
  await verifyTranslationPrivacyPolicy();
  verifyFleetRollbackContracts();

  const localizedParams = await localizeOneBotSendParams('send_group_msg', {
    group_id: 123456,
    message: [
      { type: 'text', data: { text: '需要管理员权限' } },
      { type: 'image', data: { file: 'https://example.com/result.png', summary: '查询图片' } },
    ]
  }, 'en', fakeTranslator) as any;
  assert.equal(localizedParams.message[0].data.text, 'Administrator permission is required.');
  assert.equal(localizedParams.message[1].data.file, 'https://example.com/result.png');
  assert.equal(localizedParams.message[1].data.summary, '查询图片');

  const localizedForward = await localizeOneBotSendParams('send_group_forward_msg', {
    group_id: 123456,
    messages: [{
      type: 'node',
      data: {
        nickname: 'GroupGuard',
        user_id: '10000',
        content: [{ type: 'text', data: { text: '需要管理员权限' } }]
      }
    }]
  }, 'en', fakeTranslator) as any;
  assert.equal(localizedForward.messages[0].data.nickname, 'GroupGuard');
  assert.equal(localizedForward.messages[0].data.content[0].data.text, 'Administrator permission is required.');

  const protectedTraditional = await localizeOneBotSendParamsSafe('send_group_msg', {
    group_id: 123456,
    message: [{
      type: 'text',
      data: {
        text: '复制这个地址：https://example.com/路径/文件\n```ts\nconst 查询 = "简体";\n```\n然后打开浏览器。'
      }
    }]
  }, 'zh-TW') as any;
  const protectedTraditionalText = String(protectedTraditional.message[0].data.text || '');
  assert.match(protectedTraditionalText, /^複製這個地址：/);
  assert.match(protectedTraditionalText, /然後開啟瀏覽器。$/);
  assert.ok(protectedTraditionalText.includes('https://example.com/路径/文件'), 'URL must remain byte-for-byte unchanged');
  assert.ok(protectedTraditionalText.includes('```ts\nconst 查询 = "简体";\n```'), 'fenced code must remain byte-for-byte unchanged');

  assert.equal(
    await localizeOutputTextSafe('完成后我会把链接发到这里', 'zh-TW'),
    '完成後我會把連結發到這裡',
    'common context-sensitive Traditional output must not remain partially Simplified'
  );

  const protectedForwardTraditional = await localizeOneBotSendParamsSafe('send_group_forward_msg', {
    group_id: 123456,
    messages: [{
      type: 'node',
      data: {
        nickname: 'GroupGuard',
        user_id: '10000',
        content: [{ type: 'text', data: { text: '复制 `{查询}` 后打开浏览器' } }]
      }
    }]
  }, 'zh-TW') as any;
  assert.equal(
    protectedForwardTraditional.messages[0].data.content[0].data.text,
    '複製 `{查询}` 後開啟瀏覽器'
  );

  const cqTraditional = await localizeOutputTextSafe(
    '发送 [CQ:image,file=C:\\图片\\简体.png] 后继续',
    'zh-TW'
  );
  assert.ok(cqTraditional.includes('[CQ:image,file=C:\\图片\\简体.png]'), 'CQ payload must remain byte-for-byte unchanged');
  assert.match(cqTraditional, /^傳送 /);
  assert.match(cqTraditional, / 後繼續$/);

  const normalized = normalizePluginConfig({
    ...DEFAULT_PLUGIN_CONFIG,
    global: { ...DEFAULT_PLUGIN_CONFIG.global, outputLocale: 'en' }
  } as any) as any;
  assert.equal(normalized.global.outputLocale, 'en', 'normalization must preserve global.outputLocale');

  const nonChineseSettings = { ...DEFAULT_PLUGIN_CONFIG.global, outputLocale: 'en' } as any;
  const generated = generateReply({
    scene: 'permission_denied',
    raw: '需要管理员权限',
    settings: nonChineseSettings
  });
  assert.equal(generated.text, '需要管理员权限', 'non-zh-CN mode must not add Simplified-Chinese persona wrappers');

  const patchedPage = applyOutputLocaleWebUiPatch('<html><head></head><body><button id="refreshBtn"></button><section id="tab-advanced"><form id="advancedForm"></form></section></body></html>');
  assert.match(patchedPage, /global\.outputLocale/);
  assert.match(patchedPage, /简体中文（默认）/);
  assert.match(patchedPage, /繁體中文/);
  assert.match(patchedPage, />English</);
  assert.match(patchedPage, /syncGenericField/);
  assert.match(patchedPage, /refreshBtn/);

  await verifyQunGuanjiaLocalizationBoundary();

  const previousConfig = configStateService.getConfig();
  const downstreamCalls: Array<{ action: string; params: any }> = [];
  try {
    configStateService.setConfig({
      ...previousConfig,
      global: { ...previousConfig.global, outputLocale: 'en' } as any,
      groups: {}
    });
    const fakeWsClient = {
      call: async (action: string, params: unknown) => {
        downstreamCalls.push({ action, params });
        return { status: 'ok' };
      }
    } as any;
    const caller = new OneBotActionCaller(fakeWsClient);
    await caller.call('send_group_msg', {
      group_id: 123456,
      message: [
        { type: 'text', data: { text: '需要管理员权限' } },
        { type: 'image', data: { file: 'https://example.com/query.png' } }
      ]
    });
    assert.equal(downstreamCalls.length, 1);
    assert.equal(downstreamCalls[0].params.message[0].data.text, 'Administrator permission is required.');
    assert.equal(downstreamCalls[0].params.message[1].data.file, 'https://example.com/query.png');
  } finally {
    configStateService.setConfig(previousConfig);
  }

  const downstreamTraditional: Array<{ action: string; params: any }> = [];
  try {
    configStateService.setConfig({
      ...previousConfig,
      global: { ...previousConfig.global, outputLocale: 'zh-TW' } as any,
      groups: {}
    });
    const fakeWsClient = {
      call: async (action: string, params: unknown) => {
        downstreamTraditional.push({ action, params });
        return { status: 'ok' };
      }
    } as any;
    const caller = new OneBotActionCaller(fakeWsClient);
    await caller.call('send_group_msg', {
      group_id: 123456,
      message: [{ type: 'text', data: { text: '复制 `查询简体` 后打开浏览器：https://example.com/简体' } }]
    });
    const sent = String(downstreamTraditional[0].params.message[0].data.text || '');
    assert.ok(sent.includes('`查询简体`'), 'OneBot final egress must preserve inline code');
    assert.ok(sent.includes('https://example.com/简体'), 'OneBot final egress must preserve URL');
    assert.match(sent, /^複製 /);
    assert.match(sent, / 後開啟瀏覽器：/);
  } finally {
    configStateService.setConfig(previousConfig);
  }

  console.log('output locale verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
