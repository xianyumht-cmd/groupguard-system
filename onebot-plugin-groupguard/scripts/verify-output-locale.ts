import assert from 'node:assert/strict';
import { DEFAULT_PLUGIN_CONFIG, normalizePluginConfig } from '../src/config';
import { configStateService } from '../src/core/state-services/config_state_service';
import { generateReply } from '../src/reply_generator';
import { localizeOneBotSendParamsSafe } from '../src/services/output_locale_egress_guard';
import {
  clearOutputLocaleCacheForTest,
  localizeOneBotSendParams,
  localizeOutputText,
  normalizeOutputLocale,
  type OutputTranslationFn,
} from '../src/services/output_locale_service';
import { OneBotActionCaller } from '../src/standalone/onebot_action_caller';
import { applyOutputLocaleWebUiPatch } from '../src/standalone/admin/output_locale_webui_patch';

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

  const patchedPage = applyOutputLocaleWebUiPatch('<html><head></head><body><section id="tab-advanced"><form id="advancedForm"></form></section></body></html>');
  assert.match(patchedPage, /global\.outputLocale/);
  assert.match(patchedPage, /简体中文（默认）/);
  assert.match(patchedPage, /繁體中文/);
  assert.match(patchedPage, />English</);

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
