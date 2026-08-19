import http, { type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { applyWebUiTheme } from '../src/standalone/admin/webui_theme.ts';
import { renderHomePage } from '../src/standalone/admin/static_page.ts';

let server: Server;
let origin = '';

function json(res: http.ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function apiPayload(pathname: string): unknown {
  if (pathname === '/api/readyz') return { ok: true, ready: true };
  if (pathname === '/api/status') return { ok: true, oneBot: { connected: true }, hostProfileId: 'snowluma' };
  if (pathname === '/api/build-info') return { service: 'groupguard', commit_sha: 'configmaturitybrowser', dirty: false };
  if (pathname === '/api/config') return {
    ok: true,
    config: {
      global: { qaLinkDelivery: { enabled: false } },
      groups: {},
    },
  };
  if (pathname === '/api/groups') return { ok: true, groups: [] };
  if (/^\/api\/groups\/\d+$/.test(pathname)) return {
    ok: true,
    groupId: pathname.split('/').pop(),
    group: { useGlobal: false, qaLinkDelivery: { enabled: true } },
    effective: { useGlobal: false, qaLinkDelivery: { enabled: true } },
    sources: { 'qaLinkDelivery.enabled': 'group' },
    useGlobal: false,
  };
  return { ok: true, config: {}, groups: [], list: [], rows: [] };
}

test.beforeAll(async () => {
  const html = applyWebUiTheme(renderHomePage());
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      json(res, apiPayload(url.pathname));
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

test('global config is a distinct operator entry backed by global filter mode', async ({ page }) => {
  await page.goto(`${origin}/#groups`, { waitUntil: 'domcontentloaded' });
  const globalEntry = page.locator('[data-gg-global-config="1"]');
  await expect(globalEntry).toBeVisible();
  await globalEntry.click();
  await expect(globalEntry).toHaveClass(/active/);
  await expect(page.locator('#tab-advanced h2')).toHaveText('全局配置');
  await expect(page.locator('#advancedFilter')).toHaveValue('global.');
  await expect(page.locator('.gg-global-mode-note')).toContainText('全局默认');
});

test('link-prompt bulk repair deletes only the field override so it keeps inheriting', async ({ page }) => {
  let captured: any = null;
  await page.route('**/api/groups/batch**', async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, operation: 'restore-path', path: 'qaLinkDelivery.enabled', updated: 3, targetCount: 5 }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${origin}/#groups`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ggInheritQaLink')).toBeVisible();
  await page.locator('#ggInheritQaLink').click();
  await expect.poll(() => captured).not.toBeNull();
  expect(captured).toEqual({ patch: { __operation: 'restore-path', path: 'qaLinkDelivery.enabled' } });
  await expect(page.locator('#ggConfigMaturityStatus')).toContainText('已恢复继承 3 个群');
});

test('explicit bulk override reports protected dormant legacy rows instead of hiding data loss', async ({ page }) => {
  let captured: any = null;
  await page.route('**/api/groups/batch**', async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        operation: 'set-path',
        path: 'qaEnabled',
        value: false,
        updated: 4,
        targetCount: 6,
        skippedDormant: 2,
        skippedDormantGroupIds: ['10001', '10002'],
      }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${origin}/#groups`, { waitUntil: 'domcontentloaded' });
  await page.locator('#ggBatchField').selectOption('qaEnabled');
  await page.locator('#ggBatchValue').selectOption('false');
  await page.locator('#ggApplyCommonField').click();
  await expect.poll(() => captured).not.toBeNull();
  expect(captured).toEqual({ patch: { __operation: 'set-path', path: 'qaEnabled', value: false } });
  await expect(page.locator('#ggConfigMaturityStatus')).toContainText('休眠历史覆盖');
  await expect(page.locator('#ggConfigMaturityStatus')).toContainText('2 个群');
});
