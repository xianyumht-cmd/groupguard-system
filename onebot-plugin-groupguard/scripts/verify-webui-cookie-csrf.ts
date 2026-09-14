import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startSnowLumaAdminServer } from '../src/standalone/admin/server.ts';

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('webui_csrf_test_port_unavailable'));
        return;
      }
      const port = address.port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { redirect: 'manual', ...init });
  await response.text();
  return response;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-webui-csrf-'));
const port = await reservePort();
const token = '0123456789abcdef0123456789abcdef0123';
const baseUrl = `http://127.0.0.1:${port}`;
const logger = { info() {}, warn() {}, error() {} };

const runtime = startSnowLumaAdminServer({
  ctx: {} as any,
  workDir: tempRoot,
  dataDir: path.join(tempRoot, 'data'),
  configPath: path.join(tempRoot, 'config.json'),
  backupDir: path.join(tempRoot, 'backups'),
  dynamicCommandsConfigPath: path.join(tempRoot, 'dynamic-commands.json'),
  wsUrl: 'ws://127.0.0.1:3001',
  host: '127.0.0.1',
  port,
  token,
  logger,
});

try {
  const cookie = `GG_ADMIN_SESSION=${encodeURIComponent(token)}`;

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const sameOrigin = await request(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(sameOrigin.status, 404, `${method} same-origin cookie request should reach routing`);

    const reverseProxyHttpsOrigin = await request(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      headers: { cookie, origin: `https://127.0.0.1:${port}` },
    });
    assert.equal(reverseProxyHttpsOrigin.status, 404, `${method} same-host HTTPS origin should support reverse proxies`);

    const crossOrigin = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      redirect: 'manual',
      headers: { cookie, origin: 'https://attacker.example' },
    });
    assert.equal(crossOrigin.status, 403, `${method} cross-origin cookie request must fail closed`);
    assert.equal((await crossOrigin.json() as any).error, 'csrf_origin_mismatch');

    const missingOrigin = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
      method,
      redirect: 'manual',
      headers: { cookie },
    });
    assert.equal(missingOrigin.status, 403, `${method} cookie write without Origin must fail closed`);
  }

  const safeCookieGet = await request(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'GET',
    headers: { cookie },
  });
  assert.equal(safeCookieGet.status, 404, 'safe cookie-authenticated GET must not require Origin');

  const bearerWrite = await request(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'https://attacker.example',
    },
  });
  assert.equal(bearerWrite.status, 404, 'explicit Bearer clients must remain compatible without cookie CSRF checks');

  const headerWrite = await request(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    headers: { 'x-groupguard-token': token },
  });
  assert.equal(headerWrite.status, 404, 'explicit X-GroupGuard-Token clients must remain compatible without Origin');

  const nullOrigin = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: 'null' },
  });
  assert.equal(nullOrigin.status, 403, 'opaque/null origins must fail closed for cookie writes');

  const invalidBearerWithValidCookie = await fetch(`${baseUrl}/api/csrf-contract-not-found`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      authorization: 'Bearer wrong-token',
      cookie,
      origin: baseUrl,
    },
  });
  assert.equal(invalidBearerWithValidCookie.status, 401, 'Bearer precedence must remain fail-closed instead of falling back to cookie');

  console.log('webui cookie csrf verification passed');
} finally {
  await runtime.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
