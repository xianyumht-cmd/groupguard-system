import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { SnowLumaProfile } from '../src/hosts/snowluma_profile.ts';
import type { OneBotActionClient } from '../src/protocol/onebot11/action_client.ts';
import { resolveTargetFilePushConfigDir } from '../src/services/target_file_push_config.ts';
import { targetFilePushCallbackToken } from '../src/services/target_file_push_credentials.ts';
import { readTargetFileRetentionState } from '../src/services/target_file_push_delivery.ts';
import { TargetFilePushService } from '../src/services/target_file_push_service.ts';

type FakeGroupFile = {
  file_id: string;
  file_name: string;
  file_size: number;
  upload_time: number;
};

class SnowLumaActions implements OneBotActionClient {
  readonly calls: Array<{ action: string; params: any }> = [];
  readonly files: FakeGroupFile[];
  private uploadCount = 0;

  constructor(initialFiles: FakeGroupFile[] = []) {
    this.files = initialFiles.map(file => ({ ...file }));
  }

  async call(action: string, params: any = {}): Promise<unknown> {
    this.calls.push({ action, params });
    if (action === 'upload_group_file') {
      this.uploadCount += 1;
      const fileId = `qq-file-${this.uploadCount}`;
      this.files.push({
        file_id: fileId,
        file_name: String(params.name || `file-${this.uploadCount}.7z`),
        file_size: 100 + this.uploadCount,
        upload_time: 10_000 + this.uploadCount,
      });
      return { data: { file_id: fileId } };
    }
    if (action === 'get_group_root_files') {
      return { data: { files: this.files.map(file => ({ ...file })), folders: [] } };
    }
    if (action === 'get_group_files_by_folder') {
      return { data: { files: this.files.map(file => ({ ...file })), folders: [] } };
    }
    if (action === 'delete_group_file') {
      const index = this.files.findIndex(file => file.file_id === String(params.file_id || ''));
      if (index >= 0) this.files.splice(index, 1);
      return {};
    }
    throw new Error(`unexpected_action:${action}`);
  }
}

class FlakySnowLumaActions implements OneBotActionClient {
  readonly calls: Array<{ action: string; params: any }> = [];
  readonly files: FakeGroupFile[];
  private uploadCount = 0;

  constructor(initialFiles: FakeGroupFile[] = []) {
    this.files = initialFiles.map(file => ({ ...file }));
  }

  async call(action: string, params: any = {}): Promise<unknown> {
    this.calls.push({ action, params });
    if (action === 'upload_group_file') {
      this.uploadCount += 1;
      if (this.uploadCount === 1) throw new Error('simulated-upload-failure');
      const fileId = `qq-recovery-${this.uploadCount - 1}`;
      this.files.push({
        file_id: fileId,
        file_name: String(params.name || `recovery-${this.uploadCount - 1}.7z`),
        file_size: 200 + this.uploadCount,
        upload_time: 20_000 + this.uploadCount,
      });
      return { data: { file_id: fileId } };
    }
    if (action === 'get_group_root_files') {
      return { data: { files: this.files.map(file => ({ ...file })), folders: [] } };
    }
    if (action === 'get_group_files_by_folder') {
      return { data: { files: this.files.map(file => ({ ...file })), folders: [] } };
    }
    if (action === 'delete_group_file') {
      const index = this.files.findIndex(file => file.file_id === String(params.file_id || ''));
      if (index >= 0) this.files.splice(index, 1);
      return {};
    }
    throw new Error(`unexpected_action:${action}`);
  }
}

async function listen(body: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(body.length));
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return {
    url: `http://127.0.0.1:${address.port}/target.7z`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function configureService(service: TargetFilePushService, configPath: string): string {
  service.saveConfig({
    enabled: true,
    sourceUrl: 'https://abc.lanzou.com/iRETENTION',
    targetGroupId: '960957757',
    targetFolderId: '/',
    apiBaseUrl: 'http://127.0.0.1:5001',
    callbackBaseUrl: 'http://127.0.0.1:6108',
    checkIntervalSeconds: 300,
    maxFileSizeMb: 32,
  });
  return targetFilePushCallbackToken(resolveTargetFilePushConfigDir(configPath));
}

function event(url: string, id: string, name: string) {
  return {
    schema: 'target-file-push.v1',
    source_url: 'https://abc.lanzou.com/iRETENTION',
    direct_url: url,
    event_id: `sha256:${id}`,
    fingerprint: `sha256:${id}-fingerprint`,
    file: { name, stable_id: id },
  };
}

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-retention-snowluma-'));
  const dataDir = path.join(workDir, 'data');
  const configPath = path.join(workDir, 'config.json');
  const tempDir = path.join(dataDir, 'target-file-push-temp');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(configPath, '{}\n', 'utf-8');

  // Fresh service bind must discard recent orphan files that cannot be retried,
  // while a referenced current.localPath is preserved by the state-aware cleanup.
  const orphanPath = path.join(tempDir, 'recent-orphan.7z');
  fs.writeFileSync(orphanPath, 'orphan', 'utf-8');

  const fileServer = await listen(Buffer.from('snowluma-retention-regression'));
  try {
    const actions = new SnowLumaActions([
      { file_id: 'manual-old-1', file_name: 'old-a.7z', file_size: 10, upload_time: 100 },
      { file_id: 'manual-old-2', file_name: 'old-b.7z', file_size: 20, upload_time: 200 },
    ]);
    const service = new TargetFilePushService();
    service.bindRuntime({
      hostProfile: new SnowLumaProfile(actions),
      workDir,
      dataDir,
      configPath,
      log: () => undefined,
    });
    assert.equal(fs.existsSync(orphanPath), false, 'fresh bind must remove untracked temp files immediately');

    const token = configureService(service, configPath);

    const first = await service.handleEvent(event(fileServer.url, 'retention-a', 'a.7z'), token);
    assert.equal(first.fileId, 'qq-file-1');
    assert.deepEqual(actions.files.map(file => file.file_id), ['qq-file-1'], 'first successful upload must reconcile pre-existing root files');

    const firstUploadIndex = actions.calls.findIndex(call => call.action === 'upload_group_file');
    const firstDeleteIndex = actions.calls.findIndex(call => call.action === 'delete_group_file');
    assert.ok(firstUploadIndex >= 0 && firstDeleteIndex > firstUploadIndex, 'no group file may be deleted before replacement upload succeeds');
    const firstDeletes = actions.calls.filter(call => call.action === 'delete_group_file');
    assert.deepEqual(firstDeletes.map(call => call.params.file_id).sort(), ['manual-old-1', 'manual-old-2']);

    const second = await service.handleEvent(event(fileServer.url, 'retention-b', 'b.7z'), token);
    assert.equal(second.fileId, 'qq-file-2');
    assert.deepEqual(actions.files.map(file => file.file_id), ['qq-file-2'], 'second upload must leave exactly the new file in root');

    const retention = readTargetFileRetentionState(path.join(service.getTempDir(), 'probe.bin'));
    assert.equal(retention.latest?.fileId, 'qq-file-2');
    assert.equal(retention.latest?.fileName, 'b.7z');
    assert.deepEqual(retention.pendingCleanup, [], 'live directory reconciliation must replace stale pending state with actual leftovers');
    assert.equal(retention.lastObservedFileCount, 1);
    assert.equal(retention.lastReconcileError, '');
    assert.ok(Number(retention.lastReconciledAt || 0) > 0);
    assert.deepEqual(fs.readdirSync(service.getTempDir()), [], 'successful deliveries must leave no local temp files');

    // Drift created outside GroupGuard must be repaired from the real QQ listing,
    // not from the historical pending queue. A known latest file remains authoritative.
    actions.files.push(
      { file_id: 'manual-drift-1', file_name: 'drift-a.7z', file_size: 30, upload_time: 30_000 },
      { file_id: 'manual-drift-2', file_name: 'drift-b.7z', file_size: 40, upload_time: 40_000 },
    );
    const manual = await service.reconcileTargetFolderNow();
    assert.equal(manual.ok, true);
    assert.equal(manual.keptFileId, 'qq-file-2');
    assert.equal(manual.observedAfter, 1);
    assert.deepEqual(actions.files.map(file => file.file_id), ['qq-file-2']);

    // If local latest state is absent/stale, exclusive-root manual reconciliation
    // adopts the newest real QQ file instead of deleting everything blindly.
    const adoptWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-adopt-'));
    try {
      const adoptDataDir = path.join(adoptWorkDir, 'data');
      const adoptConfigPath = path.join(adoptWorkDir, 'config.json');
      fs.mkdirSync(adoptDataDir, { recursive: true });
      fs.writeFileSync(adoptConfigPath, '{}\n', 'utf-8');
      const adoptActions = new SnowLumaActions([
        { file_id: 'adopt-old', file_name: 'old.7z', file_size: 10, upload_time: 10 },
        { file_id: 'adopt-new', file_name: 'new.7z', file_size: 20, upload_time: 20 },
      ]);
      const adoptService = new TargetFilePushService();
      adoptService.bindRuntime({
        hostProfile: new SnowLumaProfile(adoptActions),
        workDir: adoptWorkDir,
        dataDir: adoptDataDir,
        configPath: adoptConfigPath,
        log: () => undefined,
      });
      configureService(adoptService, adoptConfigPath);
      const adopted = await adoptService.reconcileTargetFolderNow();
      assert.equal(adopted.ok, true);
      assert.equal(adopted.adoptedLatest, true);
      assert.equal(adopted.keptFileId, 'adopt-new');
      assert.deepEqual(adoptActions.files.map(file => file.file_id), ['adopt-new']);
    } finally {
      fs.rmSync(adoptWorkDir, { recursive: true, force: true });
    }

    const failedWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-failed-temp-'));
    try {
      const failedDataDir = path.join(failedWorkDir, 'data');
      const failedConfigPath = path.join(failedWorkDir, 'config.json');
      fs.mkdirSync(failedDataDir, { recursive: true });
      fs.writeFileSync(failedConfigPath, '{}\n', 'utf-8');

      const flakyActions = new FlakySnowLumaActions([
        { file_id: 'safe-existing', file_name: 'safe.7z', file_size: 50, upload_time: 50 },
      ]);
      const failedService = new TargetFilePushService();
      failedService.bindRuntime({
        hostProfile: new SnowLumaProfile(flakyActions),
        workDir: failedWorkDir,
        dataDir: failedDataDir,
        configPath: failedConfigPath,
        log: () => undefined,
      });
      const failedToken = configureService(failedService, failedConfigPath);

      await assert.rejects(
        () => failedService.handleEvent(event(fileServer.url, 'failed-a', 'failed-a.7z'), failedToken),
        /snowluma_upload_group_file_failed/,
      );

      assert.deepEqual(flakyActions.files.map(file => file.file_id), ['safe-existing'], 'failed replacement upload must not delete the existing group file');
      assert.equal(flakyActions.calls.filter(call => call.action === 'delete_group_file').length, 0, 'failed replacement upload must issue no delete action');

      const failedStatus = failedService.getLocalStatus();
      const failedLocalPath = String(failedStatus.current?.localPath || '');
      assert.equal(failedStatus.current?.state, 'failed');
      assert.ok(failedLocalPath && fs.existsSync(failedLocalPath), 'current failed event keeps its local file for retry');

      const recovered = await failedService.handleEvent(event(fileServer.url, 'failed-b', 'failed-b.7z'), failedToken);
      assert.equal(recovered.fileId, 'qq-recovery-1');
      assert.deepEqual(flakyActions.files.map(file => file.file_id), ['qq-recovery-1'], 'recovery upload must reconcile the old safe file only after success');
      assert.equal(fs.existsSync(failedLocalPath), false, 'a different event must remove the superseded failed temp file');
      assert.deepEqual(fs.readdirSync(failedService.getTempDir()), [], 'recovered success leaves no failed temp pile');
    } finally {
      fs.rmSync(failedWorkDir, { recursive: true, force: true });
    }

    console.info('target file SnowLuma exclusive-root reconciliation verified');
  } finally {
    await fileServer.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
