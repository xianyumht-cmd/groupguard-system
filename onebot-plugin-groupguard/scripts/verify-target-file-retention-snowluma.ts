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

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-retention-snowluma-'));
  const dataDir = path.join(workDir, 'data');
  const configPath = path.join(workDir, 'config.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath, '{}\n', 'utf-8');

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

    const token = targetFilePushCallbackToken(resolveTargetFilePushConfigDir(configPath));
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
