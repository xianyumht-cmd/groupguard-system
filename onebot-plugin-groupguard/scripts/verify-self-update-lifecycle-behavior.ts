import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SELF_UPDATE_RESTART_EXIT_CODE,
  getSupervisorUpdateState,
  markSupervisorUpdateComplete,
  rollbackPendingSelfUpdate,
  selfUpdateService,
} from '../src/services/self_update_service.ts';

const TARGET_COMMIT = 'cccccccccccccccccccccccccccccccccccccccc';
const WRONG_COMMIT = 'dddddddddddddddddddddddddddddddddddddddd';
const API_TOKEN = 'groupguard-self-update-lifecycle-contract-token-1234567890';
const ARTIFACT_URL = 'https://api.github.com/repos/xianyumht-cmd/groupguard-system/actions/artifacts/67890/zip';
const SIGNED_URL = 'https://signed-artifact.example/lifecycle.zip?sig=lifecycle-test';
const ORIGINAL_RUNTIME = '// original runtime\n';
const CANDIDATE_RUNTIME = '// candidate runtime\n';

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(value.length);
  new Uint8Array(out).set(value);
  return out;
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

function buildValidArchive(): Buffer {
  const serviceContent = Buffer.from(CANDIDATE_RUNTIME, 'utf8');
  const buildInfoContent = Buffer.from(`${JSON.stringify({ commit_sha: TARGET_COMMIT, dirty: false })}\n`, 'utf8');
  const manifestContent = Buffer.from(`${JSON.stringify({
    schema_version: 'groupguard-self-update.v1',
    commit_sha: TARGET_COMMIT,
    files: [
      { path: 'dist/snowluma-service.mjs', sha256: sha256(serviceContent), size: serviceContent.length },
      { path: 'dist/build-info.json', sha256: sha256(buildInfoContent), size: buildInfoContent.length },
    ],
  })}\n`, 'utf8');
  return buildStoredZip([
    { name: 'manifest.json', content: manifestContent },
    { name: 'dist/snowluma-service.mjs', content: serviceContent },
    { name: 'dist/build-info.json', content: buildInfoContent },
  ]);
}

async function waitForState(status: string, expectedError = ''): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const snapshot = await selfUpdateService.getStatus(false);
    if (!snapshot.busy && snapshot.state?.status === status) {
      if (expectedError) assert.equal(snapshot.state.error, expectedError);
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`self-update did not reach state: ${status}`);
}

function writeState(dataDir: string, state: Record<string, unknown>): void {
  const stateDir = path.join(dataDir, 'self-update');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'update-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function verifyManagedRuntimeBoundary(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-managed-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.writeFileSync(managedEntry, ORIGINAL_RUNTIME, 'utf8');

  const previousArgv1 = process.argv[1] || '';
  const previousFetch = globalThis.fetch;
  process.argv[1] = path.join(workDir, 'not-managed.mjs');
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('managed runtime rejection must happen before network access');
  };
  selfUpdateService.configure({
    workDir,
    dataDir,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  try {
    const initial = await selfUpdateService.getStatus(false);
    assert.equal(initial.managedRuntime, false);
    assert.equal(selfUpdateService.startUpdate().accepted, true);
    await waitForState('failed', 'self_update_runtime_entry_outside_managed_dist');
    assert.equal(fetchCalled, false);
    assert.equal(fs.readFileSync(managedEntry, 'utf8'), ORIGINAL_RUNTIME);
  } finally {
    globalThis.fetch = previousFetch;
    process.argv[1] = previousArgv1;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function verifySuccessfulSwitchAndCompletion(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-lifecycle-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.writeFileSync(managedEntry, ORIGINAL_RUNTIME, 'utf8');
  fs.writeFileSync(path.join(workDir, 'dist', 'old-only.txt'), 'old file\n', 'utf8');

  const archive = buildValidArchive();
  const previousArgv1 = process.argv[1] || '';
  const previousToken = process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
  const previousDataDir = process.env.GROUPGUARD_DATA_DIR;
  const previousFetch = globalThis.fetch;
  const previousExit = process.exit;
  const previousCwd = process.cwd();
  let requestedExitCode: number | undefined;

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
      return jsonResponse({ workflow_runs: [{ id: 999, head_sha: TARGET_COMMIT, created_at: '2026-09-15T00:00:00Z' }] });
    }
    if (url.includes('/actions/runs/999/artifacts?')) {
      return jsonResponse({
        artifacts: [{
          id: 67890,
          name: `groupguard-self-update-${TARGET_COMMIT}`,
          expired: false,
          archive_download_url: ARTIFACT_URL,
        }],
      });
    }
    if (url === ARTIFACT_URL) {
      assert.equal(headers.get('authorization'), `Bearer ${API_TOKEN}`);
      return new Response(null, { status: 302, headers: { location: SIGNED_URL } });
    }
    if (url === SIGNED_URL) {
      assert.equal(headers.get('authorization'), null);
      return new Response(toArrayBuffer(archive), {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      });
    }
    throw new Error(`unexpected self-update fetch: ${url}`);
  };

  process.exit = ((code?: string | number | null) => {
    requestedExitCode = Number(code ?? 0);
    return undefined as never;
  }) as typeof process.exit;

  try {
    const initial = await selfUpdateService.getStatus(false);
    assert.equal(initial.managedRuntime, true);
    assert.equal(SELF_UPDATE_RESTART_EXIT_CODE, 75);
    assert.equal(selfUpdateService.startUpdate().accepted, true);
    const switched = await waitForState('restarting');

    assert.equal(fs.readFileSync(managedEntry, 'utf8'), CANDIDATE_RUNTIME);
    assert.equal(fs.existsSync(path.join(workDir, 'dist', 'old-only.txt')), false);
    assert.equal(fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-stage-')), false);

    const rollbackDir = String(switched.state?.rollbackDir || '');
    assert.ok(rollbackDir.startsWith(`${workDir}${path.sep}.groupguard-update-rollback-`));
    assert.equal(fs.readFileSync(path.join(rollbackDir, 'snowluma-service.mjs'), 'utf8'), ORIGINAL_RUNTIME);
    assert.equal(fs.readFileSync(path.join(rollbackDir, 'old-only.txt'), 'utf8'), 'old file\n');

    for (let attempt = 0; attempt < 150 && requestedExitCode === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requestedExitCode, SELF_UPDATE_RESTART_EXIT_CODE);

    process.env.GROUPGUARD_DATA_DIR = dataDir;
    process.chdir(workDir);
    assert.throws(() => markSupervisorUpdateComplete(WRONG_COMMIT), /self_update_restart_commit_mismatch/);
    assert.equal(fs.existsSync(rollbackDir), true, 'commit mismatch must preserve rollback material');

    markSupervisorUpdateComplete(TARGET_COMMIT);
    const completed = getSupervisorUpdateState();
    assert.equal(completed.status, 'complete');
    assert.equal(completed.phase, 'complete');
    assert.equal(completed.rollbackDir, '');
    assert.equal(completed.cleanupError, '');
    assert.equal(fs.existsSync(rollbackDir), false, 'verified updated worker must clean the old dist');
    assert.equal(fs.readFileSync(managedEntry, 'utf8'), CANDIDATE_RUNTIME);
  } finally {
    process.chdir(previousCwd);
    process.exit = previousExit;
    globalThis.fetch = previousFetch;
    process.argv[1] = previousArgv1;
    if (previousToken === undefined) delete process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN;
    else process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN = previousToken;
    if (previousDataDir === undefined) delete process.env.GROUPGUARD_DATA_DIR;
    else process.env.GROUPGUARD_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifyRollbackBehavior(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-rollback-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const distDir = path.join(workDir, 'dist');
  const rollbackDir = path.join(workDir, '.groupguard-update-rollback-test');
  const outsideDir = path.join(tempRoot, 'outside-rollback');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(rollbackDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'snowluma-service.mjs'), CANDIDATE_RUNTIME, 'utf8');
  fs.writeFileSync(path.join(rollbackDir, 'snowluma-service.mjs'), ORIGINAL_RUNTIME, 'utf8');

  const previousDataDir = process.env.GROUPGUARD_DATA_DIR;
  const previousCwd = process.cwd();
  process.env.GROUPGUARD_DATA_DIR = dataDir;

  try {
    process.chdir(workDir);
    writeState(dataDir, { appRoot: workDir, rollbackDir, targetCommit: TARGET_COMMIT, status: 'restarting' });
    assert.equal(rollbackPendingSelfUpdate('readiness_timeout'), true);
    assert.equal(fs.readFileSync(path.join(distDir, 'snowluma-service.mjs'), 'utf8'), ORIGINAL_RUNTIME);
    assert.equal(fs.existsSync(rollbackDir), false);
    assert.equal(fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-failed-')), false);
    const rolledBack = getSupervisorUpdateState();
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(rolledBack.phase, 'rolled_back');
    assert.equal(rolledBack.rollbackDir, '');
    assert.equal(rolledBack.error, 'readiness_timeout');

    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'snowluma-service.mjs'), '// outside rollback\n', 'utf8');
    writeState(dataDir, { appRoot: workDir, rollbackDir: outsideDir, targetCommit: TARGET_COMMIT, status: 'restarting' });
    assert.equal(rollbackPendingSelfUpdate('must_not_escape'), false);
    assert.equal(fs.readFileSync(path.join(distDir, 'snowluma-service.mjs'), 'utf8'), ORIGINAL_RUNTIME);
    assert.equal(fs.existsSync(outsideDir), true);
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.GROUPGUARD_DATA_DIR;
    else process.env.GROUPGUARD_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await verifyManagedRuntimeBoundary();
await verifySuccessfulSwitchAndCompletion();
verifyRollbackBehavior();

console.log('self-update lifecycle behavior verification passed');
