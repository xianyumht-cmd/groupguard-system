import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selfUpdateService } from '../src/services/self_update_service.ts';

const TARGET_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const API_TOKEN = 'groupguard-self-update-contract-token-1234567890';
const ARTIFACT_URL = 'https://api.github.com/repos/xianyumht-cmd/groupguard-system/actions/artifacts/12345/zip';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitForFailedUpdate(expectedError: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await selfUpdateService.getStatus(false);
    if (!status.busy && status.state?.status === 'failed') {
      assert.equal(status.state.error, expectedError);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`self-update did not reach failed state: ${expectedError}`);
}

async function verifyDownloadBoundary(input: {
  redirectLocation: string;
  expectedError: string;
  expectSignedFetch: boolean;
}): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-contract-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(managedEntry, '// self-update contract fixture\n', 'utf8');

  const previousArgv1 = process.argv[1] || '';
  const previousToken = process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  process.argv[1] = managedEntry;
  process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN = API_TOKEN;
  selfUpdateService.configure({
    workDir,
    dataDir,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  globalThis.fetch = async (request, init = {}) => {
    const url = String(request);
    const headers = new Headers(init.headers);
    calls.push({ url, authorization: headers.get('authorization') });

    if (url.includes('/actions/workflows/groupguard-build.yml/runs?')) {
      return jsonResponse({
        workflow_runs: [{ id: 777, head_sha: TARGET_COMMIT, created_at: '2026-09-15T00:00:00Z' }],
      });
    }
    if (url.includes('/actions/runs/777/artifacts?')) {
      return jsonResponse({
        artifacts: [{
          id: 12345,
          name: `groupguard-self-update-${TARGET_COMMIT}`,
          expired: false,
          archive_download_url: ARTIFACT_URL,
        }],
      });
    }
    if (url === ARTIFACT_URL) {
      assert.equal(init.redirect, 'manual', 'GitHub artifact REST request must not auto-follow redirects');
      assert.equal(headers.get('accept'), 'application/vnd.github+json');
      assert.equal(headers.get('authorization'), `Bearer ${API_TOKEN}`, 'repository token is required on the GitHub REST hop');
      return new Response(null, { status: 302, headers: { location: input.redirectLocation } });
    }
    if (url === input.redirectLocation) {
      assert.equal(input.expectSignedFetch, true, 'an insecure redirect must be rejected before any second-hop request');
      assert.equal(init.redirect, 'follow');
      assert.equal(headers.get('authorization'), null, 'repository token must never be forwarded to the signed artifact host');
      return new Response(Buffer.from('not-a-zip'), {
        status: 200,
        headers: { 'content-length': '9' },
      });
    }
    throw new Error(`unexpected self-update fetch: ${url}`);
  };

  try {
    const started = selfUpdateService.startUpdate();
    assert.equal(started.accepted, true);
    await waitForFailedUpdate(input.expectedError);
    assert.equal(calls[0]?.authorization, `Bearer ${API_TOKEN}`);
    assert.equal(calls[1]?.authorization, `Bearer ${API_TOKEN}`);
    assert.equal(calls[2]?.authorization, `Bearer ${API_TOKEN}`);
    if (input.expectSignedFetch) {
      assert.equal(calls.length, 4);
      assert.equal(calls[3]?.authorization, null);
    } else {
      assert.equal(calls.length, 3, 'insecure redirects must fail before the signed-host fetch');
    }
  } finally {
    globalThis.fetch = previousFetch;
    process.argv[1] = previousArgv1;
    if (previousToken === undefined) delete process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
    else process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN = previousToken;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await verifyDownloadBoundary({
  redirectLocation: 'https://signed-artifact.example/download.zip?sig=test',
  expectedError: 'self_update_zip_eocd_missing',
  expectSignedFetch: true,
});

await verifyDownloadBoundary({
  redirectLocation: 'http://signed-artifact.example/download.zip?sig=test',
  expectedError: 'self_update_artifact_redirect_insecure',
  expectSignedFetch: false,
});

console.log('self-update download behavior verification passed');
