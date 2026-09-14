import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { downloadTargetFile } from '../src/services/target_file_push_delivery.ts';
import { prepareTargetFileDownloadHop } from '../src/services/target_file_push_download_security.ts';

async function listen(body: Buffer): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/start') {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
      res.statusCode = 302;
      res.setHeader('location', `http://redirect.invalid:${address.port}/file`);
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(body.length));
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  const previousAllowPrivate = process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS;
  const originalLookup = dns.lookup;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-dns-pin-'));
  let server: Awaited<ReturnType<typeof listen>> | null = null;

  try {
    delete process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS;

    await assert.rejects(
      () => prepareTargetFileDownloadHop(
        new URL('https://rebind.example/file'),
        async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      ),
      /target_file_push_private_download_forbidden/,
      'a hostname with any private DNS answer must fail closed',
    );

    const publicOnly = await prepareTargetFileDownloadHop(
      new URL('https://public.example/file'),
      async () => [{ address: '93.184.216.34', family: 4 }],
    );
    assert.deepEqual(publicOnly.addresses, [{ address: '93.184.216.34', family: 4 }]);
    assert.ok(publicOnly.dispatcher, 'validated hostname downloads must receive a pinned dispatcher');
    await publicOnly.dispatcher?.close();

    const payload = Buffer.from('dns-pinning-regression-payload');
    server = await listen(payload);
    process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS = '1';

    const lookupHosts: string[] = [];
    (dns as any).lookup = async (hostname: string, options: any) => {
      assert.equal(options?.all, true);
      lookupHosts.push(String(hostname));
      if (hostname !== 'rebind.invalid' && hostname !== 'redirect.invalid') {
        throw new Error(`unexpected_test_lookup:${hostname}`);
      }
      return [{ address: '127.0.0.1', family: 4 }];
    };

    const localPath = await downloadTargetFile({
      eventId: 'dns-rebinding-regression',
      fileName: 'package.zip',
      directUrl: `http://rebind.invalid:${server.port}/start`,
      tempDir,
      maxFileSizeMb: 1,
    });

    assert.equal(fs.readFileSync(localPath).toString('utf-8'), payload.toString('utf-8'));
    assert.deepEqual(
      lookupHosts,
      ['rebind.invalid', 'redirect.invalid'],
      'each redirect hop must resolve exactly once before fetch; the socket must reuse the pinned answer instead of resolving again',
    );
    assert.deepEqual(
      fs.readdirSync(tempDir).filter(name => name.endsWith('.part')),
      [],
      'DNS-pinned download must preserve existing partial-file cleanup guarantees',
    );

    console.log('target file DNS pinning verification passed');
  } finally {
    (dns as any).lookup = originalLookup;
    if (previousAllowPrivate === undefined) delete process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS;
    else process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS = previousAllowPrivate;
    try { await server?.close(); } catch { /* noop */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
