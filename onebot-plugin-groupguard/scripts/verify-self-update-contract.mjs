import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./internal/ts-extension-loader.mjs', import.meta.url);
const { selfUpdateService } = await import('../src/services/self_update_service.ts');

const root = path.resolve(import.meta.dirname, '..');
const notifier = fs.readFileSync(path.join(root, 'src/services/lol_patch_notifier.ts'), 'utf8');
const updater = fs.readFileSync(path.join(root, 'src/services/self_update_service.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/standalone/admin/server.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/standalone/admin/static_page.ts'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/standalone/snowluma_service.ts'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '../.github/workflows/groupguard-build.yml'), 'utf8');

assert.ok(notifier.includes('resolveLolPatchNotificationGroupIds'));
assert.ok(notifier.includes('configuredAuthorizedGroupIds'));
assert.ok(!notifier.includes('groupIds: authorizedGroupIds()'));
assert.ok(page.includes('LOL版本更新通知（@全体）'));
assert.ok(page.includes('lolPatchNotifyGroupIds'));
assert.ok(page.includes('系统更新'));
assert.ok(page.includes('/api/self-update/apply'));
assert.ok(page.includes('受管运行入口'));
assert.ok(page.includes('!data.managedRuntime'));
assert.ok(server.includes('self_update_confirmation_required'));
assert.ok(server.includes('/api/self-update/status'));
assert.ok(updater.includes('xianyumht-cmd/groupguard-system'));
assert.ok(updater.includes('groupguard-build.yml'));
assert.ok(updater.includes('private_repository_update_token_required'));
assert.ok(updater.includes('self_update_zip_path_escape'));
assert.ok(updater.includes('self_update_manifest_file_hash_mismatch'));
assert.ok(updater.includes('self_update_manifest_file_set_mismatch'));
assert.ok(updater.includes('self_update_runtime_entry_outside_managed_dist'));
assert.ok(updater.includes('managedRuntime: isManagedRuntimeEntry(workDir)'));
assert.ok(updater.includes('.groupguard-update-stage-'));
assert.ok(updater.includes('.groupguard-update-rollback-'));
assert.ok(updater.includes('SELF_UPDATE_RESTART_EXIT_CODE = 75'));
assert.ok(service.includes('GROUPGUARD_SERVICE_WORKER'));
assert.ok(service.includes('rollbackPendingSelfUpdate'));
assert.ok(workflow.includes('groupguard-self-update-'));
assert.ok(workflow.includes('groupguard-self-update.v1'));

const TARGET_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const API_TOKEN = 'groupguard-self-update-contract-token-1234567890';
const ARTIFACT_URL = 'https://api.github.com/repos/xianyumht-cmd/groupguard-system/actions/artifacts/12345/zip';

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitForFailedUpdate(expectedError) {
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

async function verifyDownloadBoundary({ redirectLocation, expectedError, expectSignedFetch }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-contract-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(managedEntry, '// self-update contract fixture\n', 'utf8');

  const previousArgv1 = process.argv[1];
  const previousToken = process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  const calls = [];
  process.argv[1] = managedEntry;
  process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN = API_TOKEN;
  selfUpdateService.configure({
    workDir,
    dataDir,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({
      url,
      redirect: init.redirect || '',
      authorization: headers.get('authorization'),
      accept: headers.get('accept'),
    });

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
      return new Response(null, { status: 302, headers: { location: redirectLocation } });
    }
    if (url === redirectLocation) {
      assert.equal(expectSignedFetch, true, 'an insecure redirect must be rejected before any second-hop request');
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
    await waitForFailedUpdate(expectedError);
    assert.equal(calls[0]?.authorization, `Bearer ${API_TOKEN}`);
    assert.equal(calls[1]?.authorization, `Bearer ${API_TOKEN}`);
    assert.equal(calls[2]?.authorization, `Bearer ${API_TOKEN}`);
    if (expectSignedFetch) {
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

console.log('verify-self-update-contract: ok');
