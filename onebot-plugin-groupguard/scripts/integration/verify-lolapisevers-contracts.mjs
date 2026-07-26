#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const valueArg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
};
const mode = valueArg('--mode') || process.env.CONTRACT_TEST_MODE || 'mock';
const allowGroupSend = argv.includes('--allow-group-send');
const outputPath = valueArg('--output');
const expectedContractVersion = 'groupguard-lol-api.v2';
const testGroupId = String(process.env.TEST_GROUP_ID || (mode === 'mock' ? 'mock-test-group' : '')).trim();
const authorizedTestGroupId = String(process.env.AUTHORIZED_TEST_GROUP_ID || (mode === 'mock' ? testGroupId : '')).trim();
const testQq = String(process.env.TEST_BAN_QQ || '2621735529').trim();
const testPlayer = String(process.env.TEST_BATTLE_NAME || 'ZCG烧火棍丘丘人#73557').trim();
const testHero = String(process.env.TEST_ARAM_HERO || '亚索').trim();
const adminToken = String(process.env.GROUPGUARD_ADMIN_TOKEN || '').trim();
const runnerStarted = performance.now();

const report = {
  schema_version: '1.0',
  record_type: 'cross_repo_contract_verification',
  run_id: `contracts-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`,
  mode,
  started_at: new Date().toISOString(),
  mutating_actions_allowed: allowGroupSend,
  cases: []
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(id, risk, task) {
  const started = performance.now();
  try {
    const evidence = await task();
    report.cases.push({
      id,
      risk,
      status: 'pass',
      elapsed_ms: Math.round(performance.now() - started),
      evidence
    });
  } catch (error) {
    report.cases.push({
      id,
      risk,
      status: 'fail',
      elapsed_ms: Math.round(performance.now() - started),
      error: String(error?.message || error).slice(0, 500)
    });
  }
}

function skipCase(id, risk, reason) {
  report.cases.push({ id, risk, status: 'skipped', elapsed_ms: 0, reason });
}

function notRunCase(id, risk, reason) {
  report.cases.push({ id, risk, status: 'not_run', elapsed_ms: 0, reason });
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = String(response.headers.get('content-type') || '');
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  if (contentType.includes('json')) {
    try {
      json = JSON.parse(buffer.toString('utf-8'));
    } catch {
      json = null;
    }
  }
  return { response, contentType, buffer, json };
}

function adminHeaders(extra = {}) {
  return {
    ...(adminToken ? { 'x-groupguard-token': adminToken } : {}),
    ...extra
  };
}

async function createMockServer() {
  const deliveries = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const sendJson = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/livez') return sendJson(200, { status: 'ok', liveness: 'up' });
    if (url.pathname === '/readyz') return sendJson(200, { status: 'ok', ready: true });
    if (url.pathname === '/build-info') {
      return sendJson(200, { service: 'lolapisevers', commit_sha: 'a'.repeat(40), contract_version: 'groupguard-lol-api.v2' });
    }
    if (url.pathname === '/cross_query') {
      return sendJson(url.searchParams.get('name') ? 200 : 422, {
        name: url.searchParams.get('name'),
        recent_matches: []
      });
    }
    if (url.pathname === '/api/v2/lolban') {
      return sendJson(200, {
        code: 200,
        msg: '此账号状态正常',
        source: 'live',
        provider: 'mock',
        data: { qq: url.searchParams.get('qq'), status: '正常', end_time: '账号状态正常' }
      });
    }
    if (url.pathname === '/aram_augments' && url.searchParams.get('output') === 'image') {
      res.writeHead(200, { 'content-type': 'image/png', etag: '"mock"', 'cache-control': 'public, max-age=300' });
      return res.end(Buffer.from([137, 80, 78, 71]));
    }
    if (url.pathname === '/aram_augments') {
      return sendJson(200, { hero: { alias: 'Yasuo' }, rows: [], total: 0 });
    }
    if (url.pathname === '/monitor/health') {
      return sendJson(200, { ok: true, running: true, ready: true, status: 'healthy', pending_watcher_count: 0 });
    }
    if (url.pathname === '/groupguard/api/health' || url.pathname === '/groupguard/api/readyz') {
      return sendJson(200, {
        ok: true,
        status: 'healthy',
        ready: true,
        build: {
          service: 'groupguard',
          commit_sha: 'b'.repeat(40),
          contract_version: expectedContractVersion
        },
        capabilities: { messagingReady: true }
      });
    }
    if (url.pathname === '/groupguard/api/query/overview') {
      return sendJson(200, {
        config: {
          lanzouUpdatePush: {
            enabled: true,
            groupIds: [testGroupId],
            privateUserIds: [],
            targets: []
          }
        }
      });
    }
    if (url.pathname === '/groupguard/api/lanzou-update/event' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        const duplicate = deliveries.has(payload.event_id);
        deliveries.add(payload.event_id);
        sendJson(200, {
          ok: true,
          eventId: payload.event_id,
          deliveryState: 'complete',
          deduplicatedCount: duplicate ? 1 : 0,
          deliveries: [{ ok: true, targetKey: `group:${testGroupId}`, deduplicated: duplicate }]
        });
      });
      return;
    }
    sendJson(404, { ok: false, error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

let mock = null;
let lolBase = String(process.env.LOL_API_BASE_URL || '').replace(/\/+$/, '');
let monitorBase = String(process.env.LANZOU_MONITOR_BASE_URL || '').replace(/\/+$/, '');
let groupguardBase = String(process.env.GROUPGUARD_ADMIN_BASE_URL || '').replace(/\/+$/, '');

try {
  if (mode === 'mock') {
    mock = await createMockServer();
    lolBase = mock.origin;
    monitorBase = `${mock.origin}/monitor`;
    groupguardBase = `${mock.origin}/groupguard`;
  } else {
    assert(mode === 'live', 'mode must be mock or live');
    const missing = [
      !lolBase ? 'LOL_API_BASE_URL' : '',
      !monitorBase ? 'LANZOU_MONITOR_BASE_URL' : '',
      !groupguardBase ? 'GROUPGUARD_ADMIN_BASE_URL' : ''
    ].filter(Boolean);
    assert(missing.length === 0, `live mode requires: ${missing.join(', ')}`);
  }

  await runCase('service_liveness', 'read_only', async () => {
    const { response, json } = await request(`${lolBase}/livez`);
    assert(response.ok && json?.liveness === 'up', `livez_http_${response.status}`);
    return { http_status: response.status, liveness: json.liveness };
  });

  await runCase('service_readiness', 'read_only', async () => {
    const { response, json } = await request(`${lolBase}/readyz`);
    assert(response.ok && json?.ready === true, `readyz_http_${response.status}`);
    return { http_status: response.status, ready: json.ready };
  });

  await runCase('service_build_traceability', 'read_only', async () => {
    const { response, json } = await request(`${lolBase}/build-info`);
    assert(response.ok, `build_info_http_${response.status}`);
    assert(/^[0-9a-f]{40}$/i.test(String(json?.commit_sha || '')), 'build_commit_sha_incomplete');
    assert(json?.contract_version === expectedContractVersion, 'service_contract_version_mismatch');
    return { service: json.service, commit_complete: true, contract_version: json.contract_version || '' };
  });

  await runCase('battle_name_contract', 'read_only', async () => {
    const url = new URL(`${lolBase}/cross_query`);
    url.searchParams.set('name', testPlayer);
    url.searchParams.set('output', 'pretty');
    const { response, json } = await request(url);
    assert(response.ok, `battle_http_${response.status}`);
    assert(json && !json.detail, 'battle_upstream_validation_failed');
    return { http_status: response.status, parameter: 'name', output: 'pretty' };
  });

  await runCase('ban_unified_contract', 'read_only', async () => {
    const url = new URL(`${lolBase}/api/v2/lolban`);
    url.searchParams.set('qq', testQq);
    url.searchParams.set('output', 'json');
    url.searchParams.set('compat', 'napcat');
    const { response, json } = await request(url);
    assert(response.ok, `ban_http_${response.status}`);
    assert(['正常', '封禁'].includes(String(json?.data?.status || '')), 'ban_status_unknown');
    return {
      http_status: response.status,
      status: json.data.status,
      source: json.source || '',
      provider_present: Boolean(json.provider)
    };
  });

  await runCase('aram_json_contract', 'read_only', async () => {
    const url = new URL(`${lolBase}/aram_augments`);
    url.searchParams.set('hero', testHero);
    url.searchParams.set('output', 'json');
    const { response, json } = await request(url);
    assert(response.ok && json?.hero && Array.isArray(json?.rows), `aram_json_http_${response.status}`);
    return { http_status: response.status, canonical_alias: json.hero.alias || '', row_count: json.rows.length };
  });

  await runCase('aram_image_contract', 'read_only', async () => {
    const url = new URL(`${lolBase}/aram_augments`);
    url.searchParams.set('hero', testHero);
    url.searchParams.set('output', 'image');
    const { response, contentType, buffer } = await request(url);
    assert(response.ok && contentType.startsWith('image/'), `aram_image_http_${response.status}`);
    assert(buffer.length > 0, 'aram_image_empty');
    return {
      http_status: response.status,
      content_type: contentType.split(';')[0],
      bytes: buffer.length,
      etag_present: Boolean(response.headers.get('etag')),
      cache_control: response.headers.get('cache-control') || ''
    };
  });

  if (monitorBase) {
    await runCase('lanzou_monitor_health', 'read_only', async () => {
      const { response, json } = await request(`${monitorBase}/health`);
      assert(response.ok && json?.ok === true, `monitor_health_http_${response.status}`);
      assert(json?.running === true, 'monitor_not_running');
      return {
        http_status: response.status,
        status: json.status || '',
        ready: json.ready !== false,
        pending_watcher_count: Number(json.pending_watcher_count || 0),
        orphan_watcher_count: Number(json.orphan_watcher_count || 0)
      };
    });
  } else {
    skipCase('lanzou_monitor_health', 'read_only', 'LANZOU_MONITOR_BASE_URL not configured');
  }

  if (groupguardBase) {
    await runCase('groupguard_health_and_build', 'read_only', async () => {
      const { response, json } = await request(`${groupguardBase}/api/readyz`, { headers: adminHeaders() });
      assert(response.ok && json?.ok === true, `groupguard_health_http_${response.status}`);
      assert(json?.ready === true, 'groupguard_not_ready');
      assert(/^[0-9a-f]{40}$/i.test(String(json?.build?.commit_sha || '')), 'groupguard_commit_sha_incomplete');
      assert(json?.build?.contract_version === expectedContractVersion, 'groupguard_contract_version_mismatch');
      return {
        http_status: response.status,
        status: json.status || '',
        ready: json.ready === true,
        messaging_ready: json.capabilities?.messagingReady === true,
        commit_complete: true
      };
    });
  } else {
    skipCase('groupguard_health_and_build', 'read_only', 'GROUPGUARD_ADMIN_BASE_URL not configured');
  }

  if (!allowGroupSend) {
    notRunCase('callback_idempotency_delivery', 'mutating_test_group', 'requires --allow-group-send');
  } else {
    await runCase('callback_idempotency_delivery', 'mutating_test_group', async () => {
      assert(groupguardBase, 'GROUPGUARD_ADMIN_BASE_URL is required');
      assert(testGroupId && authorizedTestGroupId && testGroupId === authorizedTestGroupId, 'test group authorization mismatch');
      const overview = await request(`${groupguardBase}/api/query/overview`, { headers: adminHeaders() });
      assert(overview.response.ok, `groupguard_overview_http_${overview.response.status}`);
      const settings = overview.json?.config?.lanzouUpdatePush || {};
      const groupTargets = [
        ...(Array.isArray(settings.groupIds) ? settings.groupIds : []),
        ...(Array.isArray(settings.targets)
          ? settings.targets.filter((item) => item?.enabled !== false && item?.type !== 'private').map((item) => item.groupId)
          : [])
      ].map(String).filter(Boolean);
      const privateTargets = [
        ...(Array.isArray(settings.privateUserIds) ? settings.privateUserIds : []),
        ...(Array.isArray(settings.targets)
          ? settings.targets.filter((item) => item?.enabled !== false && item?.type === 'private').map((item) => item.userId)
          : [])
      ].map(String).filter(Boolean);
      assert(groupTargets.length > 0 && groupTargets.every((id) => id === testGroupId), 'configured groups exceed authorized test group');
      assert(privateTargets.length === 0, 'private targets must be empty during delivery test');

      const event = {
        event_id: `contract-${Date.now()}`,
        type: 'lanzou_update.contract_test',
        watcher_id: 'contract-verification',
        previous_signature: 'before',
        current_signature: `after-${Date.now()}`,
        created_at: new Date().toISOString(),
        title: '跨仓协议验收',
        url: 'https://example.invalid/contract-test',
        message: '跨仓协议验收测试消息',
        diff: { added: [{ id: 'contract', name: 'contract-test.txt' }], removed: [], changed: [] }
      };
      const post = () => request(`${groupguardBase}/api/lanzou-update/event`, {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(event)
      });
      const first = await post();
      const duplicate = await post();
      assert(first.response.ok && first.json?.deliveryState === 'complete', `callback_first_http_${first.response.status}`);
      assert(duplicate.response.ok && duplicate.json?.deliveryState === 'complete', `callback_duplicate_http_${duplicate.response.status}`);
      assert(Number(duplicate.json?.deduplicatedCount || 0) >= 1, 'callback_duplicate_not_deduplicated');
      return {
        first_delivery_state: first.json.deliveryState,
        duplicate_delivery_state: duplicate.json.deliveryState,
        duplicate_suppressed: true,
        target_scope: 'authorized_test_group_only'
      };
    });
  }
} catch (error) {
  report.cases.push({
    id: report.cases.length === 0 ? 'runner_configuration' : 'runner_execution',
    risk: 'read_only',
    status: 'fail',
    elapsed_ms: Math.round(performance.now() - runnerStarted),
    error: String(error?.message || error).slice(0, 500)
  });
} finally {
  if (mock?.server) await new Promise((resolve) => mock.server.close(resolve));
}

report.finished_at = new Date().toISOString();
report.summary = {
  passed: report.cases.filter((item) => item.status === 'pass').length,
  failed: report.cases.filter((item) => item.status === 'fail').length,
  skipped: report.cases.filter((item) => item.status === 'skipped').length,
  not_run: report.cases.filter((item) => item.status === 'not_run').length
};
report.overall_gate = report.summary.failed > 0
  ? 'fail'
  : report.summary.not_run > 0 || report.summary.skipped > 0
    ? 'partial'
    : 'pass';
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized, 'utf-8');
process.stdout.write(serialized);
if (report.summary.failed > 0) process.exitCode = 1;
