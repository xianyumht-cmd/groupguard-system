import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG } from '../src/config.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { contextStateService } from '../src/core/state-services/context_state_service.ts';
import { storageAdapter } from '../src/storage_adapter.ts';
import { applyWebUiTheme, GROUPGUARD_WEBUI_THEME_STORAGE_KEY } from '../src/standalone/admin/webui_theme.ts';
import { normalizeQueryOverviewForWebUi, patchQueryPageHtml } from '../src/standalone/admin/query_webui_facade.ts';
import { startSnowLumaAdminServer } from '../src/standalone/admin/server.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderQueryPage } from '../src/standalone/admin/query_page.ts';
import { renderQunGuanjiaPage } from '../src/standalone/admin/qun_guanjia_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function findAvailablePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function fetchWithStartupRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function adminJson(
  baseUrl: string,
  token: string,
  route: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: unknown,
): Promise<any> {
  const response = await fetchWithStartupRetry(`${baseUrl}${route}`, {
    method,
    headers: {
      'x-groupguard-token': token,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json() as any;
  assert.equal(response.status, 200, `${method} ${route} failed: ${JSON.stringify(body)}`);
  assert.equal(body?.ok, true, `${method} ${route} must return ok=true`);
  return body;
}

const patchedQueryPage = patchQueryPageHtml(renderQueryPage());
const pages = [
  renderHomePage(),
  renderQaPage(),
  patchedQueryPage,
  renderQunGuanjiaPage(),
  renderGroupFileMirrorPage()
];

for (const raw of pages) {
  const designed = applyWebUiTheme(raw);
  assert.match(designed, /id="groupguard-control-panel-style"/);
  assert.match(designed, /id="groupguard-control-panel-bootstrap"/);
  assert.match(designed, /id="groupguard-control-panel-controller"/);
  assert.match(designed, /id="groupguard-config-maturity-style"/);
  assert.match(designed, /id="groupguard-config-maturity-controller"/);
  assert.ok(designed.includes(GROUPGUARD_WEBUI_THEME_STORAGE_KEY));
  assert.ok(designed.includes("['light','☀ 日间']"));
  assert.ok(designed.includes("['system','◐ 跟随']"));
  assert.ok(designed.includes("['dark','☾ 夜间']"));
  assert.ok(designed.includes('prefers-color-scheme: dark'));
  assert.ok(designed.includes('Microsoft YaHei UI'));
  assert.ok(designed.includes('backdrop-filter'));
  assert.ok(designed.includes('mountControlPanel'));
  assert.ok(designed.includes('gg-control-panel'));
  assert.ok(designed.includes('gg-admin-shell'));
  assert.ok(designed.includes('gg-sidebar'));
  assert.ok(designed.includes('gg-page-header'));
  assert.ok(designed.includes('gg-section-content'));
  assert.ok(designed.includes('gg-section-actions'));
  assert.ok(designed.includes('gg-live-dashboard'));
  assert.ok(designed.includes('gg-savebar'));
  assert.ok(designed.includes('mountDirtyState'));
  assert.ok(designed.includes('mountDangerConfirm'));
  assert.ok(designed.includes("api('/api/readyz')"));
  assert.ok(designed.includes("api('/api/status')"));
  assert.ok(designed.includes("api('/api/build-info')"));
  assert.ok(designed.includes("['群管配置'"));
  assert.ok(designed.includes("['服务与风控'"));
  assert.ok(designed.includes("'self-update':['系统更新'"));
  assert.ok(designed.includes("['高级设置',['self-update','advanced','raw']]"));
  assert.ok(designed.includes("['高级设置','系统更新','/#self-update','更']"));
  assert.ok(designed.includes("dataset.ggGlobalConfig='1'"));
  assert.ok(designed.includes("textContent='全局配置'"));
  assert.ok(designed.includes("api('/api/groups/batch','POST'"));
  assert.ok(designed.includes('__restorePath'));
  assert.ok(designed.includes("__operation:'restore-path'"));
  assert.ok(designed.includes('让所有群的链接提示继承全局'));
  assert.ok(designed.includes('恢复该字段为全局继承'));
  assert.ok(designed.includes('将目标值写成分群覆盖'));
  assert.ok(designed.includes('来源：本群'));
  assert.ok(designed.includes('继承全局配置'));
  assert.ok(designed.includes('休眠历史覆盖'));
  assert.equal(applyWebUiTheme(designed), designed, 'control panel injection must be idempotent');
}

assert.throws(() => applyWebUiTheme('<div>invalid</div>'), /webui_theme_invalid_html/);
assert.equal(patchedQueryPage.includes('查隐藏'), false);
assert.equal(patchedQueryPage.includes('lol_hidden'), false);
for (const mode of ['text', 'forward', 'image']) assert.ok(patchedQueryPage.includes(mode));
assert.ok(patchedQueryPage.includes("dynamic:'动态查询默认'"));
assert.ok(patchedQueryPage.includes('插件只提交输出偏好'));

const overview = normalizeQueryOverviewForWebUi({
  ok: true,
  base: {
    masterEnabled: true,
    queryEnabled: true,
    dynamicCommandEnabled: true,
    defaultOutputFormat: 'forward'
  },
  config: { lolApiBaseUrl: 'http://192.168.3.100:5001' },
  profiles: {
    lol_hidden: { enabled: true },
    scammer: { outputFormat: 'image' },
    dynamic: { outputFormat: 'text' }
  },
  rows: [
    { type: 'lol_hidden', outputFormat: 'text' },
    { type: 'lol_ban', outputFormat: 'text', dataSource: 'legacy' },
    { type: 'scammer', outputFormat: 'text', dataSource: 'external' },
    { type: 'peer', outputFormat: 'text', dataSource: 'local-db' }
  ]
});
assert.equal(overview.rows.some((row: any) => row.type === 'lol_hidden'), false);
assert.equal(overview.profiles.lol_hidden, undefined);
assert.equal(overview.rows.find((row: any) => row.type === 'lol_ban').outputFormat, 'forward');
assert.equal(overview.rows.find((row: any) => row.type === 'scammer').outputFormat, 'image');
assert.equal(overview.rows.find((row: any) => row.type === 'peer').dataSource, 'local-api');
assert.equal(overview.rows.find((row: any) => row.type === 'dynamic').outputFormat, 'text');

// Behavior-level server wiring and group-config mutation checks. Equivalent
// refactors inside server.ts/group_api.ts must remain green as long as clients
// observe the same HTTP and persisted configuration semantics.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-webui-behavior-'));
const dataDir = path.join(tempDir, 'data');
const configPath = path.join(tempDir, 'config.json');
const originalConfig = configStateService.getConfig();
const originalContext = {
  dataDir: contextStateService.getDataDir(),
  configDir: contextStateService.getConfigDir(),
  configPath: contextStateService.getConfigPath(),
};
let runtime: ReturnType<typeof startSnowLumaAdminServer> | null = null;
try {
  const testConfig = clone(DEFAULT_PLUGIN_CONFIG);
  testConfig.global.qaLinkDelivery = {
    enabled: false,
    noticeText: 'global notice',
    delayMinMs: 1000,
    delayMaxMs: 3000,
    wrapInCodeBlock: false,
  };
  testConfig.global.qaEnabled = true;
  testConfig.groups = {
    // Active sparse overlay.
    '10001': {
      useGlobal: false,
      qaLinkDelivery: { enabled: true, noticeText: 'active local notice' },
    },
    // Whole-group inheritance with dormant historical values.
    '10002': {
      useGlobal: true,
      qaLinkDelivery: { enabled: true, noticeText: 'dormant local notice' },
    },
    // Explicit inheritance row without dormant values: safe for set-path, but
    // must not become a meaningless {useGlobal:false}-only row by itself.
    '10003': { useGlobal: true },
    // Historical row that predates useGlobal remains an active overlay.
    '10004': {
      qaLinkDelivery: { enabled: true, noticeText: 'legacy local notice' },
    },
    // Existing equal-to-global ownership must survive broad-form compaction.
    '10007': { useGlobal: false, qaEnabled: true },
    // No dormant values to reactivate when whole-group inheritance is disabled.
    '10008': { useGlobal: true },
  };

  contextStateService.setConfigDir(tempDir);
  contextStateService.setConfigPath(configPath);
  contextStateService.setDataDir(dataDir);
  configStateService.setConfig(testConfig);
  storageAdapter.init(tempDir);
  storageAdapter.replaceAllGroupConfigs(testConfig.groups, () => undefined);

  const port = await findAvailablePort();
  const token = 'webui-behavior-regression-token';
  runtime = startSnowLumaAdminServer({
    ctx: { configPath } as any,
    workDir: tempDir,
    dataDir,
    configPath,
    backupDir: path.join(tempDir, 'backups'),
    dynamicCommandsConfigPath: path.join(tempDir, 'dynamic-commands.json'),
    wsUrl: 'ws://127.0.0.1:3001',
    host: '127.0.0.1',
    port,
    token,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { 'x-groupguard-token': token };
  const routeBodies = new Map<string, string>();
  for (const route of ['/', '/qa.html', '/query.html', '/qun-guanjia.html', '/group-file-mirror.html', '/target-file-push.html']) {
    const response = await fetchWithStartupRetry(`${baseUrl}${route}`, { headers });
    assert.equal(response.status, 200, `${route} must be served successfully`);
    const body = await response.text();
    routeBodies.set(route, body);
    assert.match(body, /id="groupguard-control-panel-style"/, `${route} must receive the unified control-panel theme`);
    assert.match(body, /id="groupguard-config-maturity-style"/, `${route} must receive the config-maturity layer`);
  }

  const servedQueryPage = routeBodies.get('/query.html') || '';
  assert.equal(servedQueryPage.includes('查隐藏'), false, 'retired hidden query must not leak through the served query page');
  assert.equal(servedQueryPage.includes('lol_hidden'), false, 'retired hidden query profile must not leak through the served query page');
  for (const mode of ['text', 'forward', 'image']) {
    assert.ok(servedQueryPage.includes(mode), `served query page must expose ${mode} output mode`);
  }

  // set-path is a deliberate group override even when the selected value equals
  // the global value. Dormant historical rows must be skipped rather than
  // silently reactivated or erased.
  const setPath = await adminJson(baseUrl, token, '/api/groups/batch', 'POST', {
    patch: {
      __operation: 'set-path',
      path: 'qaLinkDelivery.enabled',
      value: false,
      groupIds: ['10001', '10002', '10003', '10005'],
    },
  });
  assert.equal(setPath.operation, 'set-path');
  assert.equal(setPath.updated, 3);
  assert.deepEqual(setPath.groupIds, ['10001', '10003', '10005']);
  assert.equal(setPath.skippedDormant, 1);
  assert.deepEqual(setPath.skippedDormantGroupIds, ['10002']);

  const activeAfterSet = await adminJson(baseUrl, token, '/api/groups/10001');
  assert.equal(activeAfterSet.group.qaLinkDelivery.enabled, false);
  assert.equal(activeAfterSet.sources['qaLinkDelivery.enabled'], 'group');
  const dormantAfterSet = await adminJson(baseUrl, token, '/api/groups/10002');
  assert.equal(dormantAfterSet.useGlobal, true);
  assert.equal(dormantAfterSet.group.qaLinkDelivery.enabled, true);
  assert.equal(dormantAfterSet.group.qaLinkDelivery.noticeText, 'dormant local notice');
  assert.equal(dormantAfterSet.effective.qaLinkDelivery.enabled, false);
  assert.equal(dormantAfterSet.effective.qaLinkDelivery.noticeText, 'global notice');
  const emptyInheritedAfterSet = await adminJson(baseUrl, token, '/api/groups/10003');
  assert.equal(emptyInheritedAfterSet.useGlobal, false);
  assert.equal(emptyInheritedAfterSet.group.qaLinkDelivery.enabled, false);
  const newGroupAfterSet = await adminJson(baseUrl, token, '/api/groups/10005');
  assert.equal(newGroupAfterSet.configured, true);
  assert.equal(newGroupAfterSet.useGlobal, false);
  assert.equal(newGroupAfterSet.group.qaLinkDelivery.enabled, false);

  let persisted = storageAdapter.loadAllGroupConfigs();
  assert.equal(persisted['10001']?.qaLinkDelivery?.enabled, false);
  assert.equal(persisted['10002']?.useGlobal, true);
  assert.equal(persisted['10002']?.qaLinkDelivery?.enabled, true);
  assert.equal(persisted['10005']?.qaLinkDelivery?.enabled, false);

  // restore-path removes only the selected ownership path. It is safe for a
  // dormant row, preserves unrelated dormant values, and deletes an otherwise
  // empty active overlay instead of persisting a false-only shell.
  const restorePath = await adminJson(baseUrl, token, '/api/groups/batch', 'POST', {
    patch: {
      __operation: 'restore-path',
      path: 'qaLinkDelivery.enabled',
      groupIds: ['10001', '10002', '10005'],
    },
  });
  assert.equal(restorePath.operation, 'restore-path');
  assert.equal(restorePath.updated, 3);
  assert.deepEqual(restorePath.groupIds, ['10001', '10002', '10005']);

  const activeAfterRestore = await adminJson(baseUrl, token, '/api/groups/10001');
  assert.equal(activeAfterRestore.group.qaLinkDelivery.enabled, undefined);
  assert.equal(activeAfterRestore.group.qaLinkDelivery.noticeText, 'active local notice');
  assert.equal(activeAfterRestore.sources['qaLinkDelivery.enabled'], 'global');
  const dormantAfterRestore = await adminJson(baseUrl, token, '/api/groups/10002');
  assert.equal(dormantAfterRestore.useGlobal, true);
  assert.equal(dormantAfterRestore.group.qaLinkDelivery.enabled, undefined);
  assert.equal(dormantAfterRestore.group.qaLinkDelivery.noticeText, 'dormant local notice');
  const removedEmptyOverlay = await adminJson(baseUrl, token, '/api/groups/10005');
  assert.equal(removedEmptyOverlay.configured, false);
  assert.equal(removedEmptyOverlay.useGlobal, true);

  persisted = storageAdapter.loadAllGroupConfigs();
  assert.equal(persisted['10001']?.qaLinkDelivery?.enabled, undefined);
  assert.equal(persisted['10001']?.qaLinkDelivery?.noticeText, 'active local notice');
  assert.equal(persisted['10002']?.qaLinkDelivery?.noticeText, 'dormant local notice');
  assert.equal(persisted['10005'], undefined);

  // The legacy single-group __restorePath HTTP contract must also remove only
  // that field while retaining a historical no-useGlobal overlay.
  const legacyRestore = await adminJson(baseUrl, token, '/api/groups/10004', 'POST', {
    patch: { __restorePath: 'qaLinkDelivery.enabled' },
  });
  assert.equal(legacyRestore.useGlobal, false);
  assert.equal(legacyRestore.group.qaLinkDelivery.enabled, undefined);
  assert.equal(legacyRestore.group.qaLinkDelivery.noticeText, 'legacy local notice');
  assert.equal(legacyRestore.sources['qaLinkDelivery.enabled'], 'global');

  // Broad-form patching compacts only newly introduced values that merely copy
  // the global baseline. Existing explicit equal-to-global ownership remains.
  const compactedNew = await adminJson(baseUrl, token, '/api/groups/10006', 'POST', {
    patch: { qaEnabled: true },
  });
  assert.equal(compactedNew.configured, false);
  assert.equal(compactedNew.useGlobal, true);
  assert.equal(compactedNew.group.qaEnabled, undefined);
  const preservedExplicitEqual = await adminJson(baseUrl, token, '/api/groups/10007', 'POST', {
    patch: { qaEnabled: true },
  });
  assert.equal(preservedExplicitEqual.configured, true);
  assert.equal(preservedExplicitEqual.useGlobal, false);
  assert.equal(preservedExplicitEqual.group.qaEnabled, true);
  assert.equal(preservedExplicitEqual.sources.qaEnabled, 'group');

  // Whole-group inheritance preserves dormant values. Disabling it later may
  // reactivate real dormant data, but must not manufacture a {useGlobal:false}
  // row for a group that has nothing to reactivate.
  const enableInheritance = await adminJson(baseUrl, token, '/api/groups/batch', 'POST', {
    patch: {
      __operation: 'set-inheritance',
      useGlobal: true,
      groupIds: ['10001', '10003', '10005'],
    },
  });
  assert.equal(enableInheritance.operation, 'set-inheritance');
  assert.equal(enableInheritance.useGlobal, true);
  assert.deepEqual(enableInheritance.groupIds, ['10001', '10003']);
  const activeDormant = await adminJson(baseUrl, token, '/api/groups/10001');
  assert.equal(activeDormant.useGlobal, true);
  assert.equal(activeDormant.group.qaLinkDelivery.noticeText, 'active local notice');
  assert.equal(activeDormant.effective.qaLinkDelivery.noticeText, 'global notice');

  const disableInheritance = await adminJson(baseUrl, token, '/api/groups/batch', 'POST', {
    patch: {
      __operation: 'set-inheritance',
      useGlobal: false,
      groupIds: ['10001', '10005', '10008'],
    },
  });
  assert.equal(disableInheritance.operation, 'set-inheritance');
  assert.equal(disableInheritance.useGlobal, false);
  assert.deepEqual(disableInheritance.groupIds, ['10001']);
  const emptyInheritedStillEmpty = await adminJson(baseUrl, token, '/api/groups/10008');
  assert.equal(emptyInheritedStillEmpty.useGlobal, true);
  assert.deepEqual(emptyInheritedStillEmpty.group, { useGlobal: true });

  // Public API inheritance reporting distinguishes no row, explicit whole-group
  // inheritance, and a historical row with no useGlobal marker.
  const noRow = await adminJson(baseUrl, token, '/api/groups/10009');
  assert.equal(noRow.configured, false);
  assert.equal(noRow.useGlobal, true);
  const historicalRow = await adminJson(baseUrl, token, '/api/groups/10004');
  assert.equal(historicalRow.configured, true);
  assert.equal(historicalRow.useGlobal, false);
  const explicitInherited = await adminJson(baseUrl, token, '/api/groups/10008');
  assert.equal(explicitInherited.configured, true);
  assert.equal(explicitInherited.useGlobal, true);
} finally {
  if (runtime) await runtime.close();
  storageAdapter.close();
  configStateService.setConfig(originalConfig);
  contextStateService.setDataDir(originalContext.dataDir);
  contextStateService.setConfigDir(originalContext.configDir);
  contextStateService.setConfigPath(originalContext.configPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('webui unified control panel verification passed');
