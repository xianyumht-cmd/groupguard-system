import http, { type Server } from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import { applyWebUiTheme } from '../src/standalone/admin/webui_theme.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import { renderQaPage } from '../src/standalone/admin/qa_page.ts';
import { renderQueryPage } from '../src/standalone/admin/query_page.ts';
import { renderQunGuanjiaPage } from '../src/standalone/admin/qun_guanjia_page.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';
import { patchQueryPageHtml } from '../src/standalone/admin/query_webui_facade.ts';

const TOKEN = 'browser-acceptance-token';
let server: Server;
let origin = '';

function renderMainPage(): string {
  return renderHomePage()
    .replaceAll('GroupGuard SnowLuma 控制台', '群管系统控制台')
    .replace('用于修改 SnowLuma 独立版群管配置。保存前会自动备份，并刷新运行时配置。', '用于管理机器人群管功能。保存前会自动备份，并立即刷新运行设置。')
    .replace('<button class="tab" data-tab="send">发送与风控</button>', '<button class="tab" data-tab="send">发送与风控</button>\n    <a class="tablink" id="groupFileMirrorLink" href="/group-file-mirror.html">群文件搬运</a>\n    <a class="tablink" id="qunGuanjiaLink" href="/qun-guanjia.html">Q群管家通道</a>')
    .replaceAll('SUB玩法', '娱乐玩法')
    .replaceAll('ELE构建', '构建工具')
    .replace('<option value="free">free</option><option value="pro" selected>pro</option><option value="enterprise">enterprise</option>', '<option value="free">免费版</option><option value="pro" selected>专业版</option><option value="enterprise">企业版</option>');
}

const pageHtml: Record<string, string> = {
  '/': applyWebUiTheme(renderMainPage()),
  '/index.html': applyWebUiTheme(renderMainPage()),
  '/qa.html': applyWebUiTheme(renderQaPage()),
  '/query.html': applyWebUiTheme(patchQueryPageHtml(renderQueryPage())),
  '/qun-guanjia.html': applyWebUiTheme(renderQunGuanjiaPage()),
  '/group-file-mirror.html': applyWebUiTheme(renderGroupFileMirrorPage()),
};

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function queryOverview() {
  return {
    ok: true,
    base: {
      masterEnabled: true,
      queryEnabled: true,
      dynamicCommandEnabled: true,
      defaultOutputFormat: 'forward',
      timeoutSeconds: 20,
    },
    config: {
      lolApiBaseUrl: 'http://127.0.0.1:5001',
      shardQueryOutputFormat: 'image',
      scammerQueryUrls: [],
      lanzouUpdatePush: { enabled: false, groupIds: [], privateUserIds: [] },
    },
    profiles: {},
    rows: [],
    validation: { ok: true, items: [] },
  };
}

function apiPayload(pathname: string): unknown {
  if (pathname === '/api/readyz') return { ok: true, ready: true, readiness: 'ready', status: 'healthy' };
  if (pathname === '/api/status') return {
    ok: true,
    botId: '755396669',
    hostProfileId: 'snowluma',
    dynamicCommandsCount: 3,
    oneBot: { connected: true, status: 'connected' },
    exists: { config: true, sqlite: true, dynamicCommands: true, backupDir: true },
  };
  if (pathname === '/api/build-info') return {
    service: 'groupguard', version: '1.3.0', commit_sha: 'browseracceptance0001',
    build_time_utc: '2026-08-05T00:00:00Z', contract_version: 'groupguard-lol-api.v2',
    config_schema_version: 8, dirty: false, artifact: 'snowluma-service.mjs',
  };
  if (pathname === '/api/config') return { ok: true, config: { global: {}, groups: {}, lanzouUpdatePush: {} } };
  if (pathname === '/api/dynamic-commands') return { ok: true, config: { commands: [] } };
  if (pathname === '/api/groups') return { ok: true, groups: [] };
  if (pathname === '/api/licenses') return { ok: true, licenses: [] };
  if (pathname === '/api/backups') return { ok: true, backups: [] };
  if (pathname === '/api/risk/dashboard') return { ok: true, hours: 24, summary: {}, rows: [] };
  if (pathname === '/api/health') return { ok: true, ready: true, status: 'healthy', checks: [] };
  if (pathname === '/api/qa/groups') return { ok: true, groups: [] };
  if (pathname === '/api/qa') return { ok: true, scope: 'global', total: 0, list: [] };
  if (pathname === '/api/query/overview') return queryOverview();
  if (pathname === '/api/group-file-mirror') return {
    ok: true,
    config: { enabled: false, rules: [] },
    runtime: { active: false, ruleCount: 0 },
  };
  if (pathname === '/api/qun-guanjia/status') return {
    ok: true,
    status: { groupId: '10000', configured: false, connected: false },
  };
  if (pathname === '/api/sub-gameplay/resources') return {
    ok: true, root: '', generatedAt: '', modules: [], summary: null,
    integrity: { ok: true }, entries: [],
  };
  return { ok: true, message: 'browser acceptance mock', config: {}, list: [], rows: [], groups: [] };
}

async function assertShell(page: Page): Promise<void> {
  await expect(page.locator('.gg-control-panel')).toHaveCount(1);
  await expect(page.locator('.gg-sidebar')).toBeVisible();
  await expect(page.locator('.gg-topbar')).toBeVisible();
  await expect(page.locator('.gg-page-header')).toBeVisible();
  await expect(page.locator('.gg-page-body')).toBeVisible();
  await expect(page.locator('.gg-section-header').first()).toBeVisible();
  await expect(page.locator('.gg-section-content').first()).toBeVisible();
  const font = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(font).toContain('Microsoft YaHei');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-gg-theme-mode="system"]')).toHaveAttribute('aria-pressed', 'true');
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      json(res, apiPayload(url.pathname));
      return;
    }
    const html = pageHtml[url.pathname];
    if (!html) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser_acceptance_server_address_unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

for (const [name, path] of [
  ['home', '/'],
  ['qa', '/qa.html'],
  ['query', '/query.html'],
  ['group-file-mirror', '/group-file-mirror.html'],
  ['qun-guanjia', '/qun-guanjia.html'],
] as const) {
  test(`desktop unified shell: ${name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${origin}${path}?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
    await assertShell(page);
    await screenshot(page, `desktop-${name}`);
    expect(pageErrors).toEqual([]);
  });
}

test('home navigation, live dashboard, theme and dirty-state behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/?token=${TOKEN}#groups`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gg-page-heading h1')).toHaveText('分群配置');
  await expect(page.locator('#tab-groups')).toBeVisible();
  await expect(page.locator('.gg-live-dashboard')).toHaveCount(1);
  await expect(page.locator('.gg-system-chip')).not.toHaveClass(/bad/);

  await page.locator('[data-gg-theme-mode="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-gg-theme-mode="dark"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#groupIdInput').fill('960957757');
  await expect(page.locator('.gg-savebar')).toHaveClass(/show/);

  await page.locator('[data-tab="status"]').click();
  await expect(page).toHaveURL(/#status$/);
  await expect(page.locator('.gg-page-heading h1')).toHaveText('运行概览');
});

test('mobile drawer remains usable and closes only after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/qa.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gg-menu-toggle')).toBeVisible();
  await page.locator('.gg-menu-toggle').click();
  await expect(page.locator('body')).toHaveClass(/gg-menu-open/);

  await page.locator('.gg-nav-search input').click();
  await expect(page.locator('body')).toHaveClass(/gg-menu-open/);
  await page.locator('.gg-nav-search input').fill('查询');
  await expect(page.locator('.gg-sidebar')).toBeVisible();

  await page.locator('.gg-mobile-mask').click({ position: { x: 380, y: 40 } });
  await expect(page.locator('body')).not.toHaveClass(/gg-menu-open/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await screenshot(page, 'mobile-qa');
});

test('native destructive confirmation is not duplicated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/?token=${TOKEN}#groups`, { waitUntil: 'domcontentloaded' });
  await page.locator('#groupIdInput').fill('960957757');
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await page.locator('#deleteGroupBtn').click();
  await page.waitForTimeout(150);
  expect(dialogs).toBe(1);
});
