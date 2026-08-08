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

class SnowLumaActions implements OneBotActionClient {
  readonly calls: Array<{ action: string; params: unknown }> = [];
  private uploadCount = 0;

  async call(action: string, params: unknown = {}): Promise<unknown> {
    this.calls.push({ action, params });
    if (action === 'upload_group_file') {
      this.uploadCount += 1;
      return { file_id: `qq-file-${this.uploadCount}` };
    }
    if (action === 'delete_group_file') return {};
    throw new Error(`unexpected_action:${action}`);
  }
}

class FlakySnowLumaActions implements OneBotActionClient {
  readonly calls: Array<{ action: string; params: unknown }> = [];
  private uploadCount = 0;

  async call(action: string, params: unknown = {}): Promise<unknown> {
    this.calls.push({ action, params });
    if (action === 'upload_group_file') {
      this.uploadCount += 1;
      if (this.uploadCount === 1) throw new Error('simulated-upload-failure');
      return { file_id: `qq-recovery-${this.uploadCount - 1}` };
    }
    if (action === 'delete_group_file') return {};
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
    const actions = new SnowLumaActions();
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
    const baseEvent = {
      schema: 'target-file-push.v1',
      source_url: 'https://abc.lanzou.com/iRETENTION',
      direct_url: fileServer.url,
    };

    const first = await service.handleEvent({
      ...baseEvent,
      event_id: 'sha256:retention-a',
      fingerprint: 'sha256:file-a',
      file: { name: 'a.7z', stable_id: 'file-a' },
    }, token);
    assert.equal(first.fileId, 'qq-file-1');
    assert.equal(actions.calls.filter(call => call.action === 'delete_group_file').length, 0);

    const second = await service.handleEvent({
      ...baseEvent,
      event_id: 'sha256:retention-b',
      fingerprint: 'sha256:file-b',
      file: { name: 'b.7z', stable_id: 'file-b' },
    }, token);
    assert.equal(second.fileId, 'qq-file-2');

    const deleteCalls = actions.calls.filter(call => call.action === 'delete_group_file');
    assert.equal(deleteCalls.length, 1, 'second successful upload must issue one real SnowLuma delete action');
    assert.deepEqual(deleteCalls[0]?.params, {
      group_id: 960957757,
      file_id: 'qq-file-1',
    });

    const retention = readTargetFileRetentionState(path.join(service.getTempDir(), 'probe.bin'));
    assert.equal(retention.latest?.fileId, 'qq-file-2');
    assert.equal(retention.latest?.fileName, 'b.7z');
    assert.deepEqual(retention.pendingCleanup, [], 'successful SnowLuma delete must drain pending cleanup');
    assert.deepEqual(fs.readdirSync(service.getTempDir()), [], 'successful deliveries must leave no local temp files');

    const failedWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-failed-temp-'));
    try {
      const failedDataDir = path.join(failedWorkDir, 'data');
      const failedConfigPath = path.join(failedWorkDir, 'config.json');
      fs.mkdirSync(failedDataDir, { recursive: true });
      fs.writeFileSync(failedConfigPath, '{}\n', 'utf-8');

      const flakyActions = new FlakySnowLumaActions();
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
        () => failedService.handleEvent({
          ...baseEvent,
          event_id: 'sha256:failed-a',
          fingerprint: 'sha256:failed-file-a',
          file: { name: 'failed-a.7z', stable_id: 'failed-file-a' },
        }, failedToken),
        /snowluma_upload_group_file_failed/,
      );

      const failedStatus = failedService.getLocalStatus();
      const failedLocalPath = String(failedStatus.current?.localPath || '');
      assert.equal(failedStatus.current?.state, 'failed');
      assert.ok(failedLocalPath && fs.existsSync(failedLocalPath), 'current failed event keeps its local file for retry');

      const recovered = await failedService.handleEvent({
        ...baseEvent,
        event_id: 'sha256:failed-b',
        fingerprint: 'sha256:failed-file-b',
        file: { name: 'failed-b.7z', stable_id: 'failed-file-b' },
      }, failedToken);
      assert.equal(recovered.fileId, 'qq-recovery-1');
      assert.equal(fs.existsSync(failedLocalPath), false, 'a different event must remove the superseded failed temp file');
      assert.deepEqual(fs.readdirSync(failedService.getTempDir()), [], 'recovered success leaves no failed temp pile');
    } finally {
      fs.rmSync(failedWorkDir, { recursive: true, force: true });
    }

    console.info('target file SnowLuma retention integration verified');
  } finally {
    await fileServer.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
