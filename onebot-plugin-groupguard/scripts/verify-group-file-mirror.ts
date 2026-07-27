import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GroupFileMirrorService,
  extractFileSegmentsFromMessage,
  fileEventMatchesRule,
  normalizeGroupFileMirrorConfig,
  type GroupFileMirrorRule,
} from '../src/services/group_file_mirror_service.ts';
import {
  GroupFileMirrorConfigError,
  normalizeGroupFileMirrorWebInput,
} from '../src/standalone/admin/group_file_mirror_api.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timeout: ${message}`);
}

async function verifyRuntimeForwarding(rule: GroupFileMirrorRule): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-file-message-forward-'));
  const configPath = path.join(tempDir, 'config', 'group-file-mirror.json');
  const statePath = path.join(tempDir, 'data', 'group-file-mirror-state.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ enabled: true, rules: [rule] }, null, 2)}\n`,
    'utf-8',
  );

  const previousConfigPath = process.env.GROUP_FILE_MIRROR_CONFIG_PATH;
  const previousStatePath = process.env.GROUP_FILE_MIRROR_STATE_PATH;
  process.env.GROUP_FILE_MIRROR_CONFIG_PATH = configPath;
  process.env.GROUP_FILE_MIRROR_STATE_PATH = statePath;

  const calls: Array<{ action: string; params: any }> = [];
  let forwardedSequence = 0;
  let resolveFirstForward!: (value: any) => void;
  const firstForwardResponse = new Promise<any>(resolve => {
    resolveFirstForward = resolve;
  });

  const service = new GroupFileMirrorService();
  service.bindRuntime({
    callAction: async (action, params) => {
      calls.push({ action, params });
      if (action === 'send_group_forward_msg') {
        forwardedSequence += 1;
        if (forwardedSequence === 1) return firstForwardResponse;
        return {
          data: {
            message_id: -2000 - forwardedSequence,
            res_id: `forward-${forwardedSequence}`,
            forward_id: `forward-${forwardedSequence}`,
          },
        };
      }
      if (action === 'delete_msg') return { data: {} };
      throw new Error(`unexpected action: ${action}`);
    },
    workDir: tempDir,
    dataDir: path.join(tempDir, 'data'),
    configPath: path.join(tempDir, 'config.json'),
    log: () => undefined,
  });

  try {
    service.observeEvent({
      post_type: 'message',
      message_type: 'group',
      group_id: 1334664,
      user_id: 2854196310,
      message_id: -1001,
      message: [{
        type: 'file',
        data: { file_id: 'source-file-1', file: 'first.7z', file_size: 1024 },
      }],
    });

    await waitFor(
      () => calls.some(item => item.action === 'send_group_forward_msg'),
      'first merged-forward action is called',
    );

    assert.deepEqual(calls[0], {
      action: 'send_group_forward_msg',
      params: {
        group_id: 16461612,
        messages: [{
          type: 'node',
          data: { id: -1001 },
        }],
        source: '群文件消息',
        summary: '查看文件消息',
        prompt: '[文件消息]',
        news: [{ text: 'first.7z' }],
      },
    }, 'the original file message is referenced through one-node merged forwarding');

    assert.equal(service.shouldBypassGlobalSelfRecall({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 16461612,
      user_id: 755396669,
      self_id: 755396669,
      message_id: -2001,
      message: [{ type: 'forward', data: { id: 'forward-1' } }],
    }), true, 'a target message_sent racing ahead of the action response bypasses global self-recall');

    assert.equal(service.shouldBypassGlobalSelfRecall({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 999999,
      user_id: 755396669,
      self_id: 755396669,
      message_id: -9001,
      message: [{ type: 'forward', data: { id: 'unrelated' } }],
    }), false, 'unrelated merged-forward messages are not exempted');

    resolveFirstForward({
      data: {
        message_id: -2001,
        res_id: 'forward-1',
        forward_id: 'forward-1',
      },
    });

    await waitFor(() => fs.existsSync(statePath), 'first forwarded state is persisted');
    let state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(state.rules['mirror-a'].current.sourceMessageId, '-1001');
    assert.equal(state.rules['mirror-a'].current.targetMessageId, '-2001');
    assert.equal(state.rules['mirror-a'].current.sourceFileName, 'first.7z');

    assert.equal(service.shouldBypassGlobalSelfRecall({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 16461612,
      user_id: 755396669,
      self_id: 755396669,
      message_id: -2001,
      message: [{ type: 'forward', data: { id: 'forward-1' } }],
    }), true, 'persisted current file-forward messages remain outside global self-recall');

    service.observeEvent({
      post_type: 'message',
      message_type: 'group',
      group_id: 1334664,
      user_id: 2854196310,
      message_id: -1002,
      message: [{
        type: 'file',
        data: { file_id: 'source-file-2', file: 'second.7z', file_size: 2048 },
      }],
    });

    await waitFor(
      () => calls.some(item => item.action === 'delete_msg' && item.params?.message_id === -2001),
      'previous file-forward message is recalled by the mirror-owned path',
    );

    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(state.rules['mirror-a'].current.sourceMessageId, '-1002');
    assert.equal(state.rules['mirror-a'].current.targetMessageId, '-2002');
    assert.deepEqual(state.rules['mirror-a'].pendingCleanup, []);

    service.observeEvent({
      post_type: 'notice',
      notice_type: 'group_recall',
      group_id: 1334664,
      message_id: -1002,
    });

    await waitFor(
      () => calls.some(item => item.action === 'delete_msg' && item.params?.message_id === -2002),
      'source recall removes the current target message through the mirror-owned path',
    );

    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(state.rules['mirror-a'].current, undefined);
    assert.deepEqual(state.rules['mirror-a'].pendingCleanup, []);

    assert.equal(calls.some(item => item.action === 'forward_group_single_msg'), false);
    assert.equal(calls.some(item => item.action === 'get_group_file_url'), false);
    assert.equal(calls.some(item => item.action === 'upload_group_file'), false);
    assert.equal(calls.some(item => item.action === 'delete_group_file'), false);
  } finally {
    if (previousConfigPath === undefined) delete process.env.GROUP_FILE_MIRROR_CONFIG_PATH;
    else process.env.GROUP_FILE_MIRROR_CONFIG_PATH = previousConfigPath;
    if (previousStatePath === undefined) delete process.env.GROUP_FILE_MIRROR_STATE_PATH;
    else process.env.GROUP_FILE_MIRROR_STATE_PATH = previousStatePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const fresh = normalizeGroupFileMirrorConfig(undefined);
  assert.equal(fresh.enabled, false, 'fresh config stays disabled');
  assert.deepEqual(fresh.rules, [], 'fresh config has no active rules');

  const normalized = normalizeGroupFileMirrorConfig({
    enabled: true,
    rules: [
      {
        id: 'mirror-a',
        source_group_id: 1334664,
        target_group_id: '16461612',
        source_uploader_ids: [2854196310, '2854196310', ''],
        file_name_pattern: '\\.7z$',
        max_file_size_mb: 100,
        retry_count: 3,
        targetFolderId: '/',
        deletePreviousTargetFile: true,
        messageLookupAttempts: 6,
      },
      {
        id: 'invalid-same-group',
        sourceGroupId: '100',
        targetGroupId: '100',
      },
    ],
  });

  assert.equal(normalized.enabled, true, 'total switch is normalized');
  assert.equal(normalized.rules.length, 1, 'same source and target group is rejected');
  const rule = normalized.rules[0];
  assert.equal(rule.sourceGroupId, '1334664');
  assert.equal(rule.targetGroupId, '16461612');
  assert.deepEqual(rule.sourceUploaderIds, ['2854196310'], 'sender IDs are deduplicated');
  assert.equal(rule.fileNamePattern, '\\.7z$');
  assert.equal(rule.keepLatestOnly, true, 'latest-only defaults on');
  assert.equal(rule.recallPreviousTargetMessage, true, 'target message recall defaults on');
  assert.equal(rule.syncSourceRecall, true, 'source recall sync defaults on');
  assert.equal(rule.retryCount, 3);
  assert.equal('targetFolderId' in rule, false, 'obsolete upload folder setting is discarded');
  assert.equal('deletePreviousTargetFile' in rule, false, 'obsolete target-file deletion setting is discarded');

  const canonical = extractFileSegmentsFromMessage({
    message: [{
      type: 'file',
      data: {
        file: 'new-package.7z',
        file_id: 'file-canonical',
        file_size: 15204352,
      },
    }],
  });
  assert.deepEqual(canonical, [{
    fileId: 'file-canonical',
    fileName: 'new-package.7z',
    fileSize: 15204352,
  }], 'SnowLuma canonical file message segment is parsed');

  const legacy = extractFileSegmentsFromMessage({
    message: [
      { type: 'file', data: { id: 'file-legacy', name: 'legacy.7z', size: 2048 } },
      { type: 'text', data: { text: 'ignored' } },
    ],
  });
  assert.deepEqual(legacy, [{
    fileId: 'file-legacy',
    fileName: 'legacy.7z',
    fileSize: 2048,
  }], 'legacy SnowLuma file fields are parsed');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'gEKVklo-UtBeN.7z',
    size: 15 * 1024 * 1024,
  }), true, 'matching sender and archive are accepted');

  assert.equal(fileEventMatchesRule(rule, '1334664', '999', {
    name: 'gEKVklo-UtBeN.7z',
    size: 15 * 1024 * 1024,
  }), false, 'other senders are rejected');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'readme.txt',
    size: 1024,
  }), false, 'filename pattern is enforced');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'large.7z',
    size: 101 * 1024 * 1024,
  }), false, 'maximum file size is enforced');

  const noSenderFilter: GroupFileMirrorRule = {
    ...rule,
    id: 'mirror-all-senders',
    sourceUploaderIds: [],
  };
  assert.equal(fileEventMatchesRule(noSenderFilter, '1334664', '999', {
    name: 'allowed.7z',
    size: 1024,
  }), true, 'empty sender filter accepts any sender');

  const invalidRegex = normalizeGroupFileMirrorConfig({
    enabled: true,
    rules: [{ sourceGroupId: '1', targetGroupId: '2', fileNamePattern: '[' }],
  });
  assert.equal(invalidRegex.rules[0]?.fileNamePattern, '', 'invalid regular expressions are safely disabled');

  const webConfig = normalizeGroupFileMirrorWebInput({
    enabled: true,
    rules: [{
      name: '中文转发规则',
      enabled: true,
      sourceGroupId: '1334664',
      targetGroupId: '16461612',
      sourceUploaderText: '2854196310，2854196310',
      fileMode: 'sevenZip',
      maxFileSizeMb: 256,
      targetFolderId: '/',
      deletePreviousTargetFile: false,
    }],
  });
  assert.equal(webConfig.enabled, true, 'WebUI total switch is saved');
  assert.equal(webConfig.rules.length, 1, 'WebUI rule is accepted');
  assert.equal(webConfig.rules[0].id, '中文转发规则');
  assert.equal(webConfig.rules[0].fileNamePattern, '\\.7z$');
  assert.deepEqual(webConfig.rules[0].sourceUploaderIds, ['2854196310']);
  assert.equal(webConfig.rules[0].keepLatestOnly, true, 'WebUI cannot disable latest-only behavior');
  assert.equal(webConfig.rules[0].recallPreviousTargetMessage, true, 'WebUI cannot disable old message recall');
  assert.equal(webConfig.rules[0].syncSourceRecall, true, 'WebUI cannot disable source recall sync');
  assert.equal('targetFolderId' in webConfig.rules[0], false);
  assert.equal('deletePreviousTargetFile' in webConfig.rules[0], false);

  const archiveConfig = normalizeGroupFileMirrorWebInput({
    enabled: false,
    rules: [{ name: '压缩包规则', sourceGroupId: '1', targetGroupId: '2', fileMode: 'archive' }],
  });
  assert.equal(archiveConfig.rules[0].fileNamePattern, '\\.(7z|zip|rar)$');

  assert.throws(() => normalizeGroupFileMirrorWebInput({
    enabled: true,
    rules: [{ name: '错误规则', sourceGroupId: '100', targetGroupId: '100', fileMode: 'all' }],
  }), (error: unknown) => error instanceof GroupFileMirrorConfigError && error.message.includes('不能相同'));

  assert.throws(() => normalizeGroupFileMirrorWebInput({
    enabled: true,
    rules: [
      { name: '正向', sourceGroupId: '100', targetGroupId: '200', fileMode: 'all' },
      { name: '反向', sourceGroupId: '200', targetGroupId: '100', fileMode: 'all' },
    ],
  }), (error: unknown) => error instanceof GroupFileMirrorConfigError && error.message.includes('互相转发'));

  const html = renderGroupFileMirrorPage();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /群文件消息转发设置/);
  assert.match(html, /监控群号/);
  assert.match(html, /接收群号/);
  assert.match(html, /外部上传机器人的 QQ/);
  assert.match(html, /不需要群文件上传权限/);
  assert.match(html, /不重新上传群文件/);
  assert.match(html, /保存全部设置/);
  assert.doesNotMatch(html, /接收群文件夹位置/);
  assert.doesNotMatch(html, /自动删除旧群文件/);

  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/group_file_mirror_service.ts'),
    'utf-8',
  );
  assert.match(serviceSource, /send_group_forward_msg/);
  assert.match(serviceSource, /shouldBypassGlobalSelfRecall/);
  assert.match(serviceSource, /文件转发专用撤回通道/);
  assert.match(serviceSource, /'delete_msg'/);
  assert.doesNotMatch(serviceSource, /forward_group_single_msg/);
  assert.doesNotMatch(serviceSource, /get_group_file_url/);
  assert.doesNotMatch(serviceSource, /upload_group_file/);
  assert.doesNotMatch(serviceSource, /delete_group_file/);
  assert.doesNotMatch(serviceSource, /scheduleSelfRecall/);
  assert.doesNotMatch(serviceSource, /processRiskSignal/);
  assert.doesNotMatch(serviceSource, /enqueueSelfRecallAction/);

  const runtimePipelineSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/runtime/runtime_message_pipeline.ts'),
    'utf-8',
  );
  const bypassIndex = runtimePipelineSource.indexOf('groupFileMirrorService.shouldBypassGlobalSelfRecall(event)');
  const globalRecallIndex = runtimePipelineSource.indexOf(
    "runtimeControlService.scheduleSelfRecall(groupId, messageId, 'message_event')",
  );
  assert.ok(bypassIndex >= 0, 'runtime message pipeline checks mirror ownership');
  assert.ok(globalRecallIndex > bypassIndex, 'mirror bypass happens before global self-recall scheduling');

  await verifyRuntimeForwarding(rule);
  console.log('group file merged forwarding and dedicated recall verification passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
