import assert from 'node:assert/strict';
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
const OTHER_COMMIT = 'dddddddddddddddddddddddddddddddddddddddd';
const ORIGINAL_RUNTIME = '// original runtime\n';
const CANDIDATE_RUNTIME = '// candidate runtime\n';

function writeState(dataDir: string, value: Record<string, unknown>): void {
  const stateDir = path.join(dataDir, 'self-update');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'update-state.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

async function verifyManagedRuntimeGuard(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-managed-runtime-'));
  const workDir = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const managedEntry = path.join(workDir, 'dist', 'snowluma-service.mjs');
  fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(managedEntry, ORIGINAL_RUNTIME, 'utf8');

  const previousArgv1 = process.argv[1] || '';
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.argv[1] = path.join(workDir, 'not-managed-entry.mjs');
  selfUpdateService.configure({
    workDir,
    dataDir,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network_must_not_be_reached');
  };

  try {
    const before = await selfUpdateService.getStatus(false);
    assert.equal(before.managedRuntime, false, 'status must expose an unmanaged runtime entry');

    const started = selfUpdateService.startUpdate();
    assert.equal(started.accepted, true);
    await waitForFailedUpdate('self_update_runtime_entry_outside_managed_dist');

    assert.equal(fetchCalls, 0, 'managed-runtime guard must fail before GitHub discovery/download');
    assert.equal(fs.readFileSync(managedEntry, 'utf8'), ORIGINAL_RUNTIME, 'managed-runtime rejection must preserve dist');
    assert.equal(
      fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-stage-')),
      false,
      'managed-runtime rejection must not create a staging directory',
    );
    assert.equal(
      fs.readdirSync(workDir).some((name) => name.startsWith('.groupguard-update-rollback-')),
      false,
      'managed-runtime rejection must not create a rollback directory',
    );

    process.argv[1] = managedEntry;
    const after = await selfUpdateService.getStatus(false);
    assert.equal(after.managedRuntime, true, 'status must recognize the exact managed dist entry');
  } finally {
    globalThis.fetch = previousFetch;
    process.argv[1] = previousArgv1;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifySupervisorCommitCompletion(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-complete-'));
  const appRoot = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const rollbackDir = path.join(appRoot, `.groupguard-update-rollback-${TARGET_COMMIT.slice(0, 12)}-fixture`);
  fs.mkdirSync(rollbackDir, { recursive: true });
  fs.writeFileSync(path.join(rollbackDir, 'snowluma-service.mjs'), ORIGINAL_RUNTIME, 'utf8');
  writeState(dataDir, {
    status: 'restarting',
    phase: 'restarting',
    targetCommit: TARGET_COMMIT,
    appRoot,
    rollbackDir,
  });

  const previousDataDir = process.env.GROUPGUARD_DATA_DIR;
  const previousCwd = process.cwd();
  process.env.GROUPGUARD_DATA_DIR = dataDir;
  process.chdir(appRoot);

  try {
    assert.throws(
      () => markSupervisorUpdateComplete(OTHER_COMMIT),
      /self_update_restart_commit_mismatch/,
      'supervisor must not accept a worker with the wrong commit',
    );
    assert.equal(fs.existsSync(rollbackDir), true, 'commit mismatch must preserve rollback state');

    markSupervisorUpdateComplete(TARGET_COMMIT);
    const state = getSupervisorUpdateState();
    assert.equal(state.status, 'complete');
    assert.equal(state.phase, 'complete');
    assert.equal(state.rollbackDir, '');
    assert.equal(state.cleanupError, '');
    assert.equal(fs.existsSync(rollbackDir), false, 'verified worker must clean the owned rollback directory');
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.GROUPGUARD_DATA_DIR;
    else process.env.GROUPGUARD_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifySupervisorRollback(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-self-update-rollback-'));
  const appRoot = path.join(tempRoot, 'app');
  const dataDir = path.join(tempRoot, 'data');
  const distDir = path.join(appRoot, 'dist');
  const rollbackDir = path.join(appRoot, `.groupguard-update-rollback-${TARGET_COMMIT.slice(0, 12)}-fixture`);
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(rollbackDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'snowluma-service.mjs'), CANDIDATE_RUNTIME, 'utf8');
  fs.writeFileSync(path.join(rollbackDir, 'snowluma-service.mjs'), ORIGINAL_RUNTIME, 'utf8');
  writeState(dataDir, {
    status: 'restarting',
    phase: 'restarting',
    targetCommit: TARGET_COMMIT,
    appRoot,
    rollbackDir,
  });

  const previousDataDir = process.env.GROUPGUARD_DATA_DIR;
  const previousCwd = process.cwd();
  process.env.GROUPGUARD_DATA_DIR = dataDir;
  process.chdir(appRoot);

  try {
    const rolledBack = rollbackPendingSelfUpdate('fixture_startup_failure');
    assert.equal(rolledBack, true, 'owned rollback state must restore the previous dist');
    assert.equal(fs.readFileSync(path.join(distDir, 'snowluma-service.mjs'), 'utf8'), ORIGINAL_RUNTIME);
    assert.equal(fs.existsSync(rollbackDir), false, 'rollback directory must be consumed');
    assert.equal(
      fs.readdirSync(appRoot).some((name) => name.startsWith('.groupguard-update-failed-')),
      false,
      'temporary failed candidate directory must be removed after rollback',
    );
    const state = getSupervisorUpdateState();
    assert.equal(state.status, 'rolled_back');
    assert.equal(state.phase, 'rolled_back');
    assert.equal(state.rollbackDir, '');
    assert.equal(state.error, 'fixture_startup_failure');

    const outsideRollback = path.join(tempRoot, '.groupguard-update-rollback-outside');
    fs.mkdirSync(outsideRollback, { recursive: true });
    fs.writeFileSync(path.join(outsideRollback, 'snowluma-service.mjs'), ORIGINAL_RUNTIME, 'utf8');
    writeState(dataDir, {
      status: 'restarting',
      phase: 'restarting',
      targetCommit: TARGET_COMMIT,
      appRoot,
      rollbackDir: outsideRollback,
    });
    fs.writeFileSync(path.join(distDir, 'snowluma-service.mjs'), CANDIDATE_RUNTIME, 'utf8');

    const rejected = rollbackPendingSelfUpdate('must_not_apply');
    assert.equal(rejected, false, 'rollback path outside the app-owned prefix must fail closed');
    assert.equal(fs.readFileSync(path.join(distDir, 'snowluma-service.mjs'), 'utf8'), CANDIDATE_RUNTIME);
    assert.equal(fs.existsSync(outsideRollback), true, 'rejected external rollback path must not be mutated');
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.GROUPGUARD_DATA_DIR;
    else process.env.GROUPGUARD_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

assert.equal(SELF_UPDATE_RESTART_EXIT_CODE, 75, 'supervisor restart exit code is a stable process contract');
await verifyManagedRuntimeGuard();
verifySupervisorCommitCompletion();
verifySupervisorRollback();
console.log('self-update supervisor behavior verification passed');
