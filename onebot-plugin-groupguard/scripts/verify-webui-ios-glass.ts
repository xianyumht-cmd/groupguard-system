import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { applyWebUiTheme, GROUPGUARD_WEBUI_THEME_STORAGE_KEY } from '../src/standalone/admin/webui_theme.ts';
import { normalizeQueryOverviewForWebUi, patchQueryPageHtml } from '../src/standalone/admin/query_webui_facade.ts';
import { startSnowLumaAdminServer } from '../src/standalone/admin/server.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderQueryPage } from '../src/standalone/admin/query_page.ts';
import { renderQunGuanjiaPage } from '../src/standalone/admin/qun_guanjia_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

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

// Behavior-level server wiring check. Equivalent refactors inside server.ts must
// remain green as long as the authenticated routes actually serve the themed,
// patched pages to clients.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-webui-behavior-'));
let runtime: ReturnType<typeof startSnowLumaAdminServer> | null = null;
try {
  const port = await findAvailablePort();
  const token = 'webui-behavior-regression-token';
  runtime = startSnowLumaAdminServer({
    ctx: {} as any,
    workDir: tempDir,
    dataDir: tempDir,
    configPath: path.join(tempDir, 'config.json'),
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
} finally {
  if (runtime) await runtime.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// These remaining checks describe the group-API batch mutation wiring rather
// than WebUI page composition. Keep them scoped for a later GG-AUD-004/005
// decision instead of broadening this migration batch.
const groupApiSource = await readFile(new URL('../src/standalone/admin/group_api.ts', import.meta.url), 'utf8');
assert.ok(groupApiSource.includes("operation === 'set-path'"));
assert.ok(groupApiSource.includes("operation === 'restore-path'"));
assert.ok(groupApiSource.includes("operation === 'set-inheritance'"));
assert.ok(groupApiSource.includes('__restorePath'));
assert.ok(groupApiSource.includes('compactNewInheritedValues'));
assert.ok(groupApiSource.includes('skippedDormantGroupIds'));
assert.ok(groupApiSource.includes('isGroupFullyInherited'));

console.log('webui unified control panel verification passed');
