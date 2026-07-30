import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  createRiskIntranetCommandPlugins,
  executeRiskIntranetQuery,
  executeRiskIntranetReport,
  parseRiskIdentifier,
  parseRiskQueryArgument,
  parseRiskReportArgument
} from '../src/dynamic-commands/intranet_risk_runtime_plugin.ts';
import { parseGroupGuardQueryDelivery } from '../src/services/groupguard_query_delivery_client.ts';
import { resolveGroupGuardReportEndpoint } from '../src/services/groupguard_report_delivery_client.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const runtimeSourcePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_risk_runtime_plugin.ts', import.meta.url));
const commandsSourcePath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));
const legacySourcePath = fileURLToPath(new URL('../src/services/interaction_service.ts', import.meta.url));

async function textEnvelope(feature: string, text: string) {
  const fixture = JSON.parse(await readFile(`${fixtureRoot}/delivery-success-text.json`, 'utf8'));
  const parsed = parseGroupGuardQueryDelivery(fixture);
  return {
    ...parsed,
    feature,
    delivery: {
      kind: 'segments' as const,
      segments: [{ type: 'text' as const, text }]
    },
    meta: {}
  };
}

const plugins = createRiskIntranetCommandPlugins();
assert.deepEqual(
  plugins.map((plugin) => plugin.definition.id),
  [
    'builtin.query.scammer.intranet',
    'builtin.query.peer.intranet',
    'builtin.report.scammer.intranet',
    'builtin.report.peer.intranet'
  ]
);
assert.ok(plugins.every((plugin) => Number(plugin.definition.priority || 0) > 40));
assert.deepEqual(parseRiskIdentifier('123456789'), { type: 'qq', value: '123456789' });
assert.deepEqual(parseRiskIdentifier('QQ:123456789'), { type: 'qq', value: '123456789' });
assert.deepEqual(parseRiskIdentifier('微信:wx_peer_01'), { type: 'wechat', value: 'wx_peer_01' });
assert.deepEqual(parseRiskIdentifier('wx_test'), { type: 'wechat', value: 'wx_test' });
assert.equal(parseRiskIdentifier('12'), null);
assert.equal(parseRiskQueryArgument('wx_test').ok, true);
assert.equal(parseRiskReportArgument('123456789 收款后失联').ok, true);
assert.equal(parseRiskReportArgument('123456789').ok, false);

for (const removed of [
  '查骗子',
  '举报骗子',
  '查同行',
  '举报同行',
  '设置骗子查询接口',
  '添加骗子查询接口',
  '删除骗子查询接口',
  '设置骗子举报接口',
  '设置骗子库限制',
  '设置骗子风控'
]) {
  assert.equal(INTERACTION_PREFIXES.includes(removed), false, `legacy route still claims ${removed}`);
}
assert.equal(INTERACTION_EXACT.includes('骗子接口状态'), false);
assert.equal(resolveGroupGuardReportEndpoint('http://192.168.3.100:5001'), 'http://192.168.3.100:5001/api/v1/groupguard/report');
assert.throws(() => resolveGroupGuardReportEndpoint('https://public.example.com'), /must_be_intranet/);

const originalConfig = structuredClone(configStateService.getConfig() as any);
try {
  const config = structuredClone(originalConfig) as any;
  config.lolApiBaseUrl = 'http://192.168.3.100:5001';
  config.scammerQueryUrls = ['https://must-not-be-used.example/query?qq={qq}'];
  config.scammerReportUrl = 'https://must-not-be-used.example/report';
  config.global = {
    ...(config.global || {}),
    lolQueryRequestTimeoutSeconds: 20,
    lolQueryGlobalMinIntervalSeconds: 0,
    lolQueryGroupMinIntervalSeconds: 0
  };
  configStateService.setConfig(config);

  const scammerEnvelope = await textEnvelope('scammer', '🔎 骗子查询\n暂未发现已收录风险记录');
  const peerReportEnvelope = await textEnvelope('peer_report', '✅ 同行举报已收录');
  const queryInput = {
    commandId: 'builtin.query.scammer.intranet',
    registryVersion: 1,
    rawText: '查骗子 [CQ:at,qq=123456789]',
    cleanedText: '查骗子',
    rawArgument: '',
    mappedParameters: {},
    messageType: 'group',
    userId: '20002',
    groupId: '10001',
    source: 'dynamic'
  } as any;
  const queryContext = {
    event: {
      message_type: 'group',
      user_id: 20002,
      group_id: 10001,
      message_id: 30003,
      self_id: 755396669,
      raw_message: '查骗子 [CQ:at,qq=123456789]'
    }
  } as any;

  let queryCount = 0;
  let queryPayload: any = null;
  const queryResult = await executeRiskIntranetQuery(
    'scammer',
    '查骗子',
    queryInput,
    queryContext,
    (async (baseUrl: string, payload: any) => {
      queryCount += 1;
      assert.equal(baseUrl, 'http://192.168.3.100:5001');
      queryPayload = payload;
      return scammerEnvelope;
    }) as any
  );
  assert.equal(queryCount, 1);
  assert.equal(queryPayload.feature, 'scammer');
  assert.deepEqual(queryPayload.parameters, { identifier_type: 'qq', identifier: '123456789' });
  assert.equal(JSON.stringify(queryPayload).includes('must-not-be-used'), false);
  assert.equal(queryResult.ok, true);
  if (queryResult.ok) assert.equal(queryResult.response.type, 'structured');

  const reportInput = {
    commandId: 'builtin.report.peer.intranet',
    registryVersion: 1,
    rawText: '举报同行 wx_peer_01 同行证据',
    cleanedText: '举报同行 wx_peer_01 同行证据',
    rawArgument: 'wx_peer_01 同行证据',
    mappedParameters: {},
    messageType: 'group',
    userId: '20002',
    groupId: '10001',
    source: 'dynamic'
  } as any;
  const reportContext = {
    event: {
      message_type: 'group',
      user_id: 20002,
      group_id: 10001,
      message_id: 40004,
      self_id: 755396669,
      raw_message: '举报同行 wx_peer_01 同行证据'
    }
  } as any;

  const reportRequestIds: string[] = [];
  let reportCount = 0;
  const reportRequest = (async (baseUrl: string, payload: any) => {
    reportCount += 1;
    assert.equal(baseUrl, 'http://192.168.3.100:5001');
    reportRequestIds.push(payload.request_id);
    assert.equal(payload.feature, 'peer_report');
    assert.deepEqual(payload.parameters, {
      identifier_type: 'wechat',
      identifier: 'wx_peer_01',
      content: '同行证据',
      group_id: '10001',
      actor_id: '20002'
    });
    return peerReportEnvelope;
  }) as any;
  const firstReport = await executeRiskIntranetReport('peer', '举报同行', reportInput, reportContext, reportRequest);
  const secondReport = await executeRiskIntranetReport('peer', '举报同行', reportInput, reportContext, reportRequest);
  assert.equal(reportCount, 2, 'each command execution performs exactly one intranet request');
  assert.equal(reportRequestIds[0], reportRequestIds[1], 'same message must produce stable idempotency request_id');
  assert.equal(firstReport.ok, true);
  assert.equal(secondReport.ok, true);

  let failureCount = 0;
  const failed = await executeRiskIntranetQuery(
    'peer',
    '查同行',
    { ...queryInput, rawText: '查同行 wx_peer_01', cleanedText: '查同行 wx_peer_01', rawArgument: 'wx_peer_01' },
    { ...queryContext, event: { ...queryContext.event, raw_message: '查同行 wx_peer_01' } },
    (async () => {
      failureCount += 1;
      throw new TypeError('fetch failed');
    }) as any
  );
  assert.equal(failureCount, 1, 'risk failure must not trigger a second or public request');
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
  'storageadapter',
  'scammerqueryurls',
  'scammerreporturl',
  'upsertcontactriskreport',
  'queryscammerbyendpoint',
  'submitexternalscammerreport',
  'http://',
  'https://'
]) {
  assert.equal(runtimeSource.includes(forbidden), false, `risk runtime contains forbidden business behavior: ${forbidden}`);
}
assert.equal(/\bfetch\s*\(/.test(runtimeSource), false, 'risk runtime must not call fetch directly');

const commandsSource = await readFile(commandsSourcePath, 'utf8');
assert.match(commandsSource, /registerIntranetRiskCommandPlugins\(\)/);
const legacySource = await readFile(legacySourcePath, 'utf8');
assert.match(legacySource, /parseRiskQueryCommand\(text, queryDef\.command\)/, 'legacy query code remains reviewable but unreachable');
assert.match(legacySource, /parseRiskReportCommand\(text, reportDef\.command\)/, 'legacy report code remains reviewable but unreachable');
assert.match(legacySource, /storageAdapter\.upsertContactRiskReport/, 'legacy local write code remains reviewable during migration');

console.log('intranet risk command verification passed');
