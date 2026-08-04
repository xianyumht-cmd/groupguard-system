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
  const themed = applyWebUiTheme(raw);
  assert.match(themed, /id="groupguard-ios-theme-style"/);
  assert.match(themed, /id="groupguard-ios-theme-bootstrap"/);
  assert.match(themed, /id="groupguard-ios-theme-controller"/);
  assert.ok(themed.includes(GROUPGUARD_WEBUI_THEME_STORAGE_KEY));
  assert.ok(themed.includes("['light','☀ 日间']"));
  assert.ok(themed.includes("['system','◐ 跟随']"));
  assert.ok(themed.includes("['dark','☾ 夜间']"));
  assert.ok(themed.includes('prefers-color-scheme: dark'));
  assert.ok(themed.includes('backdrop-filter'));
  assert.ok(themed.includes('mountAdminShell'));
  assert.ok(themed.includes('gg-admin-shell'));
  assert.ok(themed.includes('gg-sidebar'));
  assert.ok(themed.includes('gg-overview'));
  assert.ok(themed.includes("{title:'群管配置'"));
  assert.ok(themed.includes("{title:'服务与风控'"));
  assert.equal(applyWebUiTheme(themed), themed, 'theme injection must be idempotent');
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
  assert.ok(serverSource.includes(`applyWebUiTheme(${renderer})`), `server must theme ${renderer}`);
}
assert.ok(serverSource.includes('applyWebUiTheme(patchQueryPageHtml(renderQueryPage()))'));
assert.ok(serverSource.includes('normalizeQueryOverviewForWebUi(getQueryOverview())'));
assert.ok(serverSource.includes('normalizeQueryOverviewForWebUi(patchQueryConfig('));

console.log('webui professional admin shell verification passed');
