import http, { type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { applyWebUiTheme } from '../src/standalone/admin/webui_theme.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

const TOKEN = 'visual-polish-token';
let server: Server;
let origin = '';

function mainPage(): string {
  return renderHomePage()
    .replaceAll('GroupGuard SnowLuma 控制台', '群管系统控制台')
    .replace('用于修改 SnowLuma 独立版群管配置。保存前会自动备份，并刷新运行时配置。', '用于管理机器人群管功能。保存前会自动备份，并立即刷新运行设置。')
    .replace('<button class="tab" data-tab="send">发送与风控</button>', '<button class="tab" data-tab="send">发送与风控</button>\n    <a class="tablink" id="groupFileMirrorLink" href="/group-file-mirror.html">群文件搬运</a>\n    <a class="tablink" id="qunGuanjiaLink" href="/qun-guanjia.html">Q群管家通道</a>');
}

const html: Record<string, string> = {
  '/': applyWebUiTheme(mainPage()),
  '/qa.html': applyWebUiTheme(renderQaPage()),
  '/group-file-mirror.html': applyWebUiTheme(renderGroupFileMirrorPage()),
};

function payload(pathname: string): unknown {
  if (pathname === '/api/readyz') return { ok: true, ready: true };
  if (pathname === '/api/status') return {
    ok: true,
    botId: '755396669',
    hostProfileId: 'snowluma',
    dynamicCommandsCount: 3,
    oneBot: { connected: true, status: 'connected' },
    exists: { config: true, sqlite: true, dynamicCommands: true, backupDir: true },
  };
  if (pathname === '/api/build-info') return { version: '1.3.0', commit_sha: 'visualpolish0001' };
  if (pathname === '/api/config') return { ok: true, config: { global: {}, groups: {} } };
  if (pathname === '/api/dynamic-commands') return { ok: true, config: { commands: [] } };
  if (pathname === '/api/groups') return { ok: true, groups: [] };
  if (pathname === '/api/licenses') return { ok: true, licenses: [] };
  if (pathname === '/api/backups') return { ok: true, backups: [] };
  if (pathname === '/api/risk/dashboard') return { ok: true, rows: [] };
  if (pathname === '/api/health') return { ok: true, ready: true, checks: [] };
  if (pathname === '/api/qa/groups') return { ok: true, groups: [] };
  if (pathname === '/api/qa') return { ok: true, scope: 'global', total: 0, list: [] };
  if (pathname === '/api/group-file-mirror') return { ok: true, config: { enabled: false, rules: [] }, runtime: { active: false } };
  if (pathname === '/api/sub-gameplay/resources') return { ok: true, modules: [], entries: [], integrity: { ok: true } };
  return { ok: true, config: {}, groups: [], rows: [], list: [] };
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload(url.pathname)));
      return;
    }
    const page = html[url.pathname];
    if (!page) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('visual_polish_server_address_unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('status details are operator-friendly and notice behaves as a toast', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#statusBox')).toContainText('OneBot 状态');
  await expect(page.locator('#statusBox')).toContainText('已连接（connected）');
  await expect(page.locator('#statusBox')).toContainText('配置 正常');
  await expect(page.locator('#statusBox')).not.toContainText('{"connected"');
  await expect(page.locator('[data-tab="status"]')).toHaveText('运行概览');
  const noticePosition = await page.locator('#notice').evaluate((element) => getComputedStyle(element).position);
  expect(noticePosition).toBe('fixed');
  await page.screenshot({ path: test.info().outputPath('desktop-home-polished.png'), fullPage: true });
});

test('group file mirror has distinct information architecture titles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/group-file-mirror.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  const titles = await page.locator('.gg-page-body>.gg-page-section .gg-section-header h2').allTextContents();
  expect(titles.slice(0, 2)).toEqual(['运行设置', '搬运规则']);
  await page.screenshot({ path: test.info().outputPath('desktop-group-file-mirror-polished.png'), fullPage: true });
});

test('closed mobile layout is stable and the compact topbar does not wrap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/qa.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  const topbarHeight = await page.locator('.gg-topbar').evaluate((element) => element.getBoundingClientRect().height);
  expect(topbarHeight).toBeLessThanOrEqual(66);
  const themeWidths = await page.locator('.gg-theme button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  for (const width of themeWidths) expect(width).toBeLessThanOrEqual(32);

  await page.locator('.gg-menu-toggle').click();
  await page.locator('.gg-nav-search input').click();
  await expect(page.locator('body')).toHaveClass(/gg-menu-open/);
  await page.locator('.gg-mobile-mask').click({ position: { x: 380, y: 40 } });
  await expect(page.locator('body')).not.toHaveClass(/gg-menu-open/);
  await page.waitForTimeout(300);
  const sidebarRight = await page.locator('.gg-sidebar').evaluate((element) => element.getBoundingClientRect().right);
  expect(sidebarRight).toBeLessThanOrEqual(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('mobile-qa-closed-polished.png'), fullPage: true });
});
