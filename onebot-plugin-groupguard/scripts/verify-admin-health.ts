import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { groupguardRepository } from '../src/repositories/groupguard_repository.ts';
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  isAdminSessionTokenValid,
  LEGACY_COOKIE_MIGRATION_WINDOW_MS,
} from '../src/standalone/admin/auth.ts';
import { startSnowLumaAdminServer } from '../src/standalone/admin/server.ts';

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

function sessionValueFromSetCookie(setCookie: string): string {
  const cookie = String(setCookie || '').split(';')[0];
  assert.match(cookie, /^GG_ADMIN_SESSION=/);
  return decodeURIComponent(cookie.slice('GG_ADMIN_SESSION='.length));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-admin-health-'));
const originalConfig = configStateService.getConfig();
const originalGetBotSendStats = groupguardRepository.getBotSendStats;
let runtime: ReturnType<typeof startSnowLumaAdminServer> | null = null;

try {
  configStateService.setConfig(normalizePluginConfig({
    lanzouUpdatePush: { enabled: false, monitorBaseUrl: '' }
  } as any));
  (groupguardRepository as any).getBotSendStats = async () => ({
    total: 0,
    sent: 0,
    failed: 0,
    dropped: 0,
    selfRecallFailed: 0,
    messageIdMissing: 0,
    topGroups: [],
    byScene: []
  });

  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    lanzouUpdatePush: {
      enabled: true,
      groupIds: ['805402626'],
      messageTemplate: '{title}',
      includeDiffSummary: false
    }
  }), 'utf-8');
  fs.writeFileSync(
    path.join(tempDir, 'lanzou-update-deliveries.json.corrupt-20260726T000000000Z'),
    '{"version":1,"events":',
    'utf-8'
  );

  const connection = {
    status: 'disconnected',
    connected: false,
    started: true,
    reconnectScheduled: true,
    lastError: 'test_transport_down'
  };
  const token = 'admin-health-regression-token';
  const port = await findAvailablePort();
  const serverOptions = {
    ctx: {} as any,
    workDir: tempDir,
    dataDir: tempDir,
    configPath,
    backupDir: path.join(tempDir, 'backups'),
    dynamicCommandsConfigPath: path.join(tempDir, 'dynamic-commands.json'),
    wsUrl: 'ws://127.0.0.1:3001',
    host: '127.0.0.1',
    port,
    token,
    getOneBotStatus: () => ({ ...connection }),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
  };
  runtime = startSnowLumaAdminServer(serverOptions);
  const baseUrl = `http://127.0.0.1:${port}`;
  const authorizedHeaders = { 'x-groupguard-token': token };

  assert.equal(ADMIN_SESSION_MAX_AGE_SECONDS, 8 * 60 * 60);
  assert.equal(LEGACY_COOKIE_MIGRATION_WINDOW_MS, 15 * 60 * 1000);

  const fixedNow = 1_700_000_000_000;
  const shortSession = createAdminSessionToken(token, fixedNow, 1);
  assert.equal(isAdminSessionTokenValid(shortSession, token, fixedNow + 999), true);
  assert.equal(isAdminSessionTokenValid(shortSession, token, fixedNow + 1000), false);
  assert.equal(isAdminSessionTokenValid(shortSession, `${token}-rotated`, fixedNow + 999), false);
  const tamperedSession = `${shortSession.slice(0, -1)}${shortSession.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(isAdminSessionTokenValid(tamperedSession, token, fixedNow), false);
  assert.equal(isAdminSessionTokenValid('not-a-session', token, fixedNow), false);

  const unauthorizedLive = await fetchWithStartupRetry(`${baseUrl}/api/livez`);
  assert.equal(unauthorizedLive.status, 401);
  const unauthorizedReady = await fetch(`${baseUrl}/api/readyz`);
  assert.equal(unauthorizedReady.status, 401);
  const queryTokenApi = await fetch(`${baseUrl}/api/livez?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  assert.equal(queryTokenApi.status, 401, 'query tokens must not authenticate API requests');
  const bootstrap = await fetch(`${baseUrl}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get('location'), '/');
  const sessionCookie = String(bootstrap.headers.get('set-cookie') || '');
  assert.match(sessionCookie, /GG_ADMIN_SESSION=/);
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.match(sessionCookie, new RegExp(`Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`));
  const cookie = sessionCookie.split(';')[0];
  const sessionValue = sessionValueFromSetCookie(sessionCookie);
  assert.notEqual(sessionValue, token, 'browser session credential must not equal the master admin token');
  assert.equal(sessionValue.includes(token), false, 'browser session credential must not embed the master admin token');
  assert.match(sessionValue, /^v1\./);
  assert.equal(isAdminSessionTokenValid(sessionValue, token), true);
  assert.equal(isAdminSessionTokenValid(sessionValue, `${token}-rotated`), false, 'master-token rotation must invalidate existing sessions');

  const cookieLive = await fetch(`${baseUrl}/api/livez`, { headers: { cookie } });
  assert.equal(cookieLive.status, 200);

  const legacyCookie = `GG_ADMIN_SESSION=${encodeURIComponent(token)}`;
  const legacyCookieLive = await fetch(`${baseUrl}/api/livez`, { headers: { cookie: legacyCookie } });
  assert.equal(legacyCookieLive.status, 200, 'legacy master-token cookie must migrate during the short upgrade window');
  const migratedSetCookie = String(legacyCookieLive.headers.get('set-cookie') || '');
  assert.match(migratedSetCookie, /GG_ADMIN_SESSION=/);
  const migratedValue = sessionValueFromSetCookie(migratedSetCookie);
  assert.notEqual(migratedValue, token);
  assert.equal(migratedValue.includes(token), false);
  assert.equal(isAdminSessionTokenValid(migratedValue, token), true);

  await runtime.close();
  runtime = null;
  runtime = startSnowLumaAdminServer(serverOptions);
  const cookieAfterRestart = await fetchWithStartupRetry(`${baseUrl}/api/livez`, { headers: { cookie } });
  assert.equal(cookieAfterRestart.status, 200, 'signed browser session must survive a WebUI service restart with the same master token');

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const sameOriginCookieWrite = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie, origin: baseUrl }
    });
    assert.equal(sameOriginCookieWrite.status, 404, `${method} same-origin cookie write should reach routing`);

    const reverseProxyHttpsOrigin = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie, origin: `https://127.0.0.1:${port}` }
    });
    assert.equal(reverseProxyHttpsOrigin.status, 404, `${method} same-host HTTPS origin should support reverse proxies`);

    const crossOriginCookieWrite = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie, origin: 'https://attacker.example' }
    });
    assert.equal(crossOriginCookieWrite.status, 403, `${method} cross-origin cookie write must fail closed`);
    assert.equal((await crossOriginCookieWrite.json()).error, 'csrf_origin_mismatch');

    const missingOriginCookieWrite = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie }
    });
    assert.equal(missingOriginCookieWrite.status, 403, `${method} cookie write without Origin must fail closed`);
  }

  const nullOriginCookieWrite = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    headers: { cookie, origin: 'null' }
  });
  assert.equal(nullOriginCookieWrite.status, 403, 'opaque/null origins must fail closed for cookie writes');

  const bearerWrite = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://attacker.example' }
  });
  assert.equal(bearerWrite.status, 404, 'explicit Bearer clients must remain compatible without cookie CSRF checks');

  const invalidBearerWithValidCookie = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-token', cookie, origin: baseUrl }
  });
  assert.equal(invalidBearerWithValidCookie.status, 401, 'Bearer precedence must remain fail-closed instead of falling back to cookie');

  const live = await fetch(`${baseUrl}/api/livez`, { headers: authorizedHeaders });
  assert.equal(live.status, 200);
  const liveBody = await live.json();
  assert.equal(liveBody.ok, true);
  assert.equal(liveBody.liveness, 'up');
  assert.equal(liveBody.build?.service, 'groupguard');

  const notReady = await fetch(`${baseUrl}/api/readyz`, { headers: authorizedHeaders });
  assert.equal(notReady.status, 503);
  const notReadyBody = await notReady.json();
  assert.equal(notReadyBody.ok, false);
  assert.equal(notReadyBody.ready, false);
  assert.equal(notReadyBody.readiness, 'not_ready');

  const legacyHealth = await fetch(`${baseUrl}/api/health`, { headers: authorizedHeaders });
  assert.equal(legacyHealth.status, 200);
  const legacyHealthBody = await legacyHealth.json();
  assert.equal(legacyHealthBody.ok, true);
  assert.equal(legacyHealthBody.ready, false);

  connection.status = 'connected';
  connection.connected = true;
  connection.reconnectScheduled = false;
  connection.lastError = '';
  const ready = await fetch(`${baseUrl}/api/readyz`, { headers: authorizedHeaders });
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.ok, true);
  assert.equal(readyBody.ready, true);
  assert.equal(readyBody.readiness, 'ready');
  assert.equal(readyBody.status, 'degraded');
  assert.equal(readyBody.checks?.lanzouDeliveryStore?.status, 'degraded');
  assert.equal(readyBody.capabilities?.updatePushReady, false);

  const degradedCallback = await fetch(`${baseUrl}/api/lanzou-update/event`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'admin-health-corrupt-store',
      type: 'lanzou_update.changed',
      title: 'corrupt store callback'
    })
  });
  assert.equal(degradedCallback.status, 503);
  const degradedCallbackBody = await degradedCallback.json();
  assert.equal(degradedCallbackBody.ok, false);
  assert.equal(degradedCallbackBody.degraded, true);
  assert.equal(degradedCallbackBody.error, 'lanzou_delivery_store_quarantined');

  console.info('admin health endpoint verification passed');
} finally {
  if (runtime) await runtime.close();
  groupguardRepository.getBotSendStats = originalGetBotSendStats;
  configStateService.setConfig(originalConfig);
  fs.rmSync(tempDir, { recursive: true, force: true });
}
