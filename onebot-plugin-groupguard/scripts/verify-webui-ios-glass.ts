import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyWebUiTheme, GROUPGUARD_WEBUI_THEME_STORAGE_KEY } from '../src/standalone/admin/webui_theme.ts';
import { normalizeQueryOverviewForWebUi, patchQueryPageHtml } from '../src/standalone/admin/query_webui_facade.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderQueryPage } from '../src/standalone/admin/query_page.ts';
import { renderQunGuanjiaPage } from '../src/standalone/admin/qun_guanjia_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

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
  assert.ok(designed.includes("button.textContent='全局配置'"));
  assert.ok(designed.includes("api('/api/groups/batch','POST'"));
  assert.ok(designed.includes('__restorePath'));
  assert.ok(designed.includes('同步全局链接提示开关到全部群'));
  assert.ok(designed.includes('来源：本群'));
  assert.ok(designed.includes('继承全局配置'));
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

const serverSource = await readFile(new URL('../src/standalone/admin/server.ts', import.meta.url), 'utf8');
for (const renderer of ['renderMainPage()', 'renderQaPage()', 'renderQunGuanjiaPage()', 'renderGroupFileMirrorPage()']) {
  assert.ok(serverSource.includes(`applyWebUiTheme(${renderer})`), `server must design ${renderer}`);
}
assert.ok(serverSource.includes('applyWebUiTheme(patchQueryPageHtml(renderQueryPage()))'));
assert.ok(serverSource.includes('normalizeQueryOverviewForWebUi(getQueryOverview())'));
assert.ok(serverSource.includes('normalizeQueryOverviewForWebUi(patchQueryConfig('));

const compatibilitySource = await readFile(new URL('../src/standalone/admin/webui_theme.ts', import.meta.url), 'utf8');
assert.ok(compatibilitySource.includes("from './control_panel_design'"));
assert.ok(compatibilitySource.includes("from './config_maturity_webui_patch'"));
assert.ok(compatibilitySource.includes('applyControlPanelDesign(page)'));
assert.ok(compatibilitySource.includes('applyConfigMaturityWebUiPatch(withTargetFilePush)'));

const groupApiSource = await readFile(new URL('../src/standalone/admin/group_api.ts', import.meta.url), 'utf8');
assert.ok(groupApiSource.includes("operation === 'set-path'"));
assert.ok(groupApiSource.includes("operation === 'set-inheritance'"));
assert.ok(groupApiSource.includes('__restorePath'));
assert.ok(groupApiSource.includes('compactNewInheritedValues'));

console.log('webui unified control panel verification passed');
