import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selfUpdateService } from '../src/services/self_update_service.ts';

const TARGET_COMMIT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const API_TOKEN = 'groupguard-self-update-archive-contract-token-1234567890';
const ARTIFACT_URL = 'https://api.github.com/repos/xianyumht-cmd/groupguard-system/actions/artifacts/54321/zip';
const SIGNED_URL = 'https://signed-artifact.example/archive.zip?sig=archive-test';
const ORIGINAL_RUNTIME = '// original managed runtime\n';

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function buildStoredZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = entry.content;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
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

async function verifyArchiveRejection(input: {
  archive: Buffer;
  expectedError: string;
  escapedRelativePath?: string;
}): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-archive-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(managedEntry, ORIGINAL_RUNTIME, 'utf8');

  const previousArgv1 = process.argv[1] || '';
  const previousToken = process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
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
    if (url.includes('/actions/workflows/groupguard-build.yml/runs?')) {
      assert.equal(headers.get('authorization'), `Bearer ${API_TOKEN}`);
      return jsonResponse({
        workflow_runs: [{ id: 888, head_sha: TARGET_COMMIT, created_at: '2026-09-15T00:00:00Z' }],
      });
    }
    if (url.includes('/actions/runs/888/artifacts?')) {
      assert.equal(headers.get('authorization'), `Bearer ${API_TOKEN}`);
      return jsonResponse({
        artifacts: [{
          id: 54321,
          name: `groupguard-self-update-${TARGET_COMMIT}`,
          expired: false,
          archive_download_url: ARTIFACT_URL,
        }],
      });
    }
    if (url === ARTIFACT_URL) {
      return new Response(null, { status: 302, headers: { location: SIGNED_URL } });
    }
    if (url === SIGNED_URL) {
      assert.equal(headers.get('authorization'), null);
      return new Response(input.archive, {
        status: 200,
        headers: { 'content-length': String(input.archive.length) },
      });
    }
    throw new Error(`unexpected self-update fetch: ${url}`);
  };

  try {
    const started = selfUpdateService.startUpdate();
    assert.equal(started.accepted, true);
    await waitForFailedUpdate(input.expectedError);

    assert.equal(fs.readFileSync(managedEntry, 'utf8'), ORIGINAL_RUNTIME, 'failed validation must preserve the active dist');
    assert.equal(
      fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-stage-')),
      false,
      'failed validation must clean its staging directory',
    );
    assert.equal(
      fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-rollback-')),
      false,
      'validation failures must happen before rollback/switch state is created',
    );
    if (input.escapedRelativePath) {
      assert.equal(fs.existsSync(path.join(workDir, input.escapedRelativePath)), false, 'archive traversal must not write outside staging');
    }
  } finally {
    globalThis.fetch = previousFetch;
    process.argv[1] = previousArgv1;
    if (previousToken === undefined) delete process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
    else process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN = previousToken;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const serviceContent = Buffer.from('// candidate runtime\n', 'utf8');
const buildInfoContent = Buffer.from(`${JSON.stringify({ commit_sha: TARGET_COMMIT, dirty: false })}\n`, 'utf8');

await verifyArchiveRejection({
  archive: buildStoredZip([
    { name: '../escaped.txt', content: Buffer.from('escape attempt', 'utf8') },
  ]),
  expectedError: 'self_update_archive_path_invalid',
  escapedRelativePath: 'escaped.txt',
});

const badHashManifest = Buffer.from(`${JSON.stringify({
  schema_version: 'groupguard-self-update.v1',
  commit_sha: TARGET_COMMIT,
  files: [
    { path: 'dist/snowluma-service.mjs', sha256: '0'.repeat(64), size: serviceContent.length },
    { path: 'dist/build-info.json', sha256: sha256(buildInfoContent), size: buildInfoContent.length },
  ],
})}\n`, 'utf8');

await verifyArchiveRejection({
  archive: buildStoredZip([
    { name: 'manifest.json', content: badHashManifest },
    { name: 'dist/snowluma-service.mjs', content: serviceContent },
    { name: 'dist/build-info.json', content: buildInfoContent },
  ]),
  expectedError: 'self_update_manifest_file_hash_mismatch',
});

const validListedManifest = Buffer.from(`${JSON.stringify({
  schema_version: 'groupguard-self-update.v1',
  commit_sha: TARGET_COMMIT,
  files: [
    { path: 'dist/snowluma-service.mjs', sha256: sha256(serviceContent), size: serviceContent.length },
    { path: 'dist/build-info.json', sha256: sha256(buildInfoContent), size: buildInfoContent.length },
  ],
})}\n`, 'utf8');

await verifyArchiveRejection({
  archive: buildStoredZip([
    { name: 'manifest.json', content: validListedManifest },
    { name: 'dist/snowluma-service.mjs', content: serviceContent },
    { name: 'dist/build-info.json', content: buildInfoContent },
    { name: 'dist/unlisted-extra.txt', content: Buffer.from('must be rejected', 'utf8') },
  ]),
  expectedError: 'self_update_manifest_file_set_mismatch',
});

console.log('self-update archive behavior verification passed');
