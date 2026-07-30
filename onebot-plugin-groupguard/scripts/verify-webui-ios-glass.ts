import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyWebUiTheme, GROUPGUARD_WEBUI_THEME_STORAGE_KEY } from '../src/standalone/admin/webui_theme.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderQueryPage } from '../src/standalone/admin/query_page.ts';
import { renderQunGuanjiaPage } from '../src/standalone/admin/qun_guanjia_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

const pages = [
  renderHomePage(),
  renderQaPage(),
  renderQueryPage(),
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
  assert.equal(applyWebUiTheme(themed), themed, 'theme injection must be idempotent');
}

assert.throws(() => applyWebUiTheme('<div>invalid</div>'), /webui_theme_invalid_html/);

const serverSource = await readFile(new URL('../src/standalone/admin/server.ts', import.meta.url), 'utf8');
assert.match(serverSource, /applyWebUiTheme/);
for (const renderer of ['renderMainPage()', 'renderQaPage()', 'renderQueryPage()', 'renderQunGuanjiaPage()', 'renderGroupFileMirrorPage()']) {
  assert.ok(serverSource.includes(`applyWebUiTheme(${renderer})`), `server must theme ${renderer}`);
}

const queryPageSource = await readFile(new URL('../src/standalone/admin/query_page.ts', import.meta.url), 'utf8');
assert.equal(queryPageSource.includes('查隐藏'), false, 'retired hidden query must not appear in WebUI');
assert.equal(queryPageSource.includes('lol_hidden'), false, 'retired hidden query key must not appear in WebUI');
for (const mode of ['text', 'forward', 'image']) assert.ok(queryPageSource.includes(mode));
assert.ok(queryPageSource.includes("dynamic:'动态查询默认'"));

const queryApiSource = await readFile(new URL('../src/standalone/admin/query_api.ts', import.meta.url), 'utf8');
assert.equal(queryApiSource.includes("type: 'lol_hidden'"), false, 'retired hidden query must not appear in overview rows');
assert.match(queryApiSource, /global\.lolQueryOutputFormat \|\| 'forward'/);

console.log('webui iOS glass theme verification passed');
