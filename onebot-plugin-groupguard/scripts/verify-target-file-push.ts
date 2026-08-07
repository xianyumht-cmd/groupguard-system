import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { HostOperationResult, HostProfile } from '../src/hosts/host_profile.ts';
import {
  normalizeTargetFilePushConfig,
  resolveTargetFilePushConfigDir,
} from '../src/services/target_file_push_config.ts';
import { targetFilePushCallbackToken } from '../src/services/target_file_push_credentials.ts';
import { TargetFilePushService } from '../src/services/target_file_push_service.ts';
import { renderTargetFilePushPage } from '../src/standalone/admin/target_file_push_page.ts';

function success<T>(data: T): HostOperationResult<T> {
  return { state: 'success', data };
}

function hostProfile(upload: (source: string, fileName: string) => Promise<HostOperationResult<{ fileId: string }>>): HostProfile {
  return {
    id: 'test',
    capabilities: {
      selfMessageEvents: 'supported',
      messageHistory: 'unsupported',
      groupFileUrl: 'unsupported',
      groupFileUpload: 'supported',
      groupFileList: 'unsupported',
      groupFileDelete: 'unsupported',
    },
    actions: { call: async () => ({}) },
    getGroupFileUrl: async () => ({ state: 'unsupported', reason: 'test' }),
    uploadGroupFile: async (request) => upload(request.source, request.fileName),
    listGroupFiles: async () => ({ state: 'unsupported', reason: 'test' }),
    deleteGroupFile: async () => ({ state: 'unsupported', reason: 'test' }),
    getGroupMessageHistory: async () => ({ state: 'unsupported', reason: 'test' }),
  };
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
    url: `http://127.0.0.1:${address.port}/package.zip`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  assert.throws(
    () => normalizeTargetFilePushConfig({ enabled: true, sourceUrl: 'https://example.com/a.zip', targetGroupId: '123', apiBaseUrl: 'http://127.0.0.1:5001', callbackBaseUrl: 'http://127.0.0.1:6108' }),
    /蓝奏/,
  );
  assert.throws(
    () => normalizeTargetFilePushConfig({ enabled: true, sourceUrl: 'https://abc.lanzou.com/iTEST', targetGroupId: 'group', apiBaseUrl: 'http://127.0.0.1:5001', callbackBaseUrl: 'http://127.0.0.1:6108' }),
    /群号/,
  );

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-target-file-push-'));
  const dataDir = path.join(workDir, 'data');
  const configPath = path.join(workDir, 'config.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath, '{}\n', 'utf-8');

  const payload = Buffer.from('target-file-push-regression-payload');
  const fileServer = await listen(payload);
  let uploadCount = 0;
  let uploadObservedLocalFile = false;
  const service = new TargetFilePushService();
  service.bindRuntime({
    hostProfile: hostProfile(async (source, fileName) => {
      uploadCount += 1;
      uploadObservedLocalFile = fs.existsSync(source);
      assert.equal(fs.readFileSync(source).toString('utf-8'), payload.toString('utf-8'));
      assert.equal(fileName, 'package.zip');
      return success({ fileId: 'qq-file-1' });
    }),
    workDir,
    dataDir,
    configPath,
    log: () => undefined,
  });
  service.saveConfig({
    enabled: true,
    sourceUrl: 'https://abc.lanzou.com/iTEST',
    targetGroupId: '12345678',
    apiBaseUrl: 'http://127.0.0.1:5001',
    callbackBaseUrl: 'http://127.0.0.1:6108',
    checkIntervalSeconds: 300,
    maxFileSizeMb: 32,
    targetFolderId: '/',
  });
  const secretDir = resolveTargetFilePushConfigDir(configPath);
  const callbackToken = targetFilePushCallbackToken(secretDir);
  assert.ok(callbackToken.length >= 32);

  const event = {
    schema: 'target-file-push.v1',
    event_id: 'sha256:event-a',
    source_url: 'https://abc.lanzou.com/iTEST',
    fingerprint: 'sha256:file-v2',
    direct_url: fileServer.url,
    file: { name: 'package.zip', size: '32 B', stable_id: 'file-v2' },
  };

  const first = await service.handleEvent(event, callbackToken);
  assert.equal(first.ok, true);
  assert.equal(first.uploaded, true);
  assert.equal(first.deduplicated, false);
  assert.equal(first.cleanupPending, false);
  assert.equal(first.fileId, 'qq-file-1');
  assert.equal(uploadCount, 1);
  assert.equal(uploadObservedLocalFile, true, 'QQ upload must receive a real local path');
  assert.deepEqual(fs.readdirSync(service.getTempDir()), [], 'successful upload removes local temp file');

  const duplicate = await service.handleEvent(event, callbackToken);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(uploadCount, 1, 'same event id must never upload twice');

  await assert.rejects(
    () => service.handleEvent({ ...event, event_id: 'sha256:event-b' }, 'wrong-token'),
    /unauthorized/,
  );

  const failDir = path.join(workDir, 'failed-case');
  const failDataDir = path.join(failDir, 'data');
  const failConfigPath = path.join(failDir, 'config.json');
  fs.mkdirSync(failDataDir, { recursive: true });
  fs.writeFileSync(failConfigPath, '{}\n', 'utf-8');
  const failing = new TargetFilePushService();
  failing.bindRuntime({
    hostProfile: hostProfile(async () => ({ state: 'failed', reason: 'simulated-upload-failure' })),
    workDir: failDir,
    dataDir: failDataDir,
    configPath: failConfigPath,
    log: () => undefined,
  });
  failing.saveConfig({
    enabled: true,
    sourceUrl: 'https://abc.lanzou.com/iTEST',
    targetGroupId: '12345678',
    apiBaseUrl: 'http://127.0.0.1:5001',
    callbackBaseUrl: 'http://127.0.0.1:6108',
    maxFileSizeMb: 32,
  });
  const failToken = targetFilePushCallbackToken(resolveTargetFilePushConfigDir(failConfigPath));
  await assert.rejects(
    () => failing.handleEvent({ ...event, event_id: 'sha256:event-fail' }, failToken),
    /群文件上传失败/,
  );
  const failedStatus = failing.getLocalStatus();
  assert.equal(failedStatus.completedCount, 0, 'failed upload must not be marked complete');
  assert.equal(failedStatus.current?.state, 'failed');
  assert.ok(failedStatus.current?.localPath && fs.existsSync(failedStatus.current.localPath), 'failed upload keeps downloaded file for retry');

  const page = renderTargetFilePushPage();
  assert.match(page, /定向文件推送/);
  assert.match(page, /person setting url/);
  assert.match(page, /person setting group/);
  assert.match(page, /上传成功后立即删除临时文件/);
  assert.match(page, /\/api\/target-file-push\/check/);
  assert.match(page, /\/api\/target-file-push\/rebaseline/);

  await fileServer.close();
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log('target file push verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
