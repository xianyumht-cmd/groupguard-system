import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractFileSegmentsFromMessage,
  extractListedGroupFiles,
  fileEventMatchesRule,
  listedGroupFileExists,
  normalizeGroupFileMirrorConfig,
  resolveTargetFileDeletionVerification,
  type GroupFileMirrorRule,
} from '../src/services/group_file_mirror_service.ts';
import {
  buildGroupFileUploadNoticesFromMessage,
  shouldBypassGroupFileMirrorGlobalRecall,
} from '../src/services/group_file_mirror_message_adapter.ts';
import {
  GroupFileMirrorConfigError,
  normalizeGroupFileMirrorWebInput,
} from '../src/standalone/admin/group_file_mirror_api.ts';
import { renderGroupFileMirrorPage } from '../src/standalone/admin/group_file_mirror_page.ts';

function main(): void {
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
        target_folder_id: '/',
        retry_count: 3,
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
  assert.deepEqual(rule.sourceUploaderIds, ['2854196310'], 'uploader IDs are deduplicated');
  assert.equal(rule.fileNamePattern, '\\.7z$');
  assert.equal(rule.keepLatestOnly, true, 'latest-only defaults on');
  assert.equal(rule.deletePreviousTargetFile, true, 'target file cleanup defaults on');
  assert.equal(rule.recallPreviousTargetMessage, true, 'target message recall defaults on');
  assert.equal(rule.syncSourceRecall, true, 'source recall sync defaults on');
  assert.equal(rule.retryCount, 3);

  const listedResponse = {
    data: {
      files: [
        { file_id: '/target-file-a', file_name: 'old.7z', file_size: 4096 },
        { file_id: '/target-file-b', file_name: 'new.7z', file_size: 8192 },
      ],
    },
  };
  assert.deepEqual(extractListedGroupFiles(listedResponse), [
    { id: '/target-file-a', name: 'old.7z', size: 4096 },
    { id: '/target-file-b', name: 'new.7z', size: 8192 },
  ], 'SnowLuma group file list is normalized');
  assert.equal(listedGroupFileExists(listedResponse, '/target-file-a'), true);
  assert.equal(listedGroupFileExists(listedResponse, '/missing-file'), false);

  assert.equal(
    resolveTargetFileDeletionVerification(['absent']),
    'unknown',
    'one missing snapshot never proves deletion',
  );
  assert.equal(
    resolveTargetFileDeletionVerification(['absent', 'absent']),
    'absent',
    'two consecutive missing snapshots confirm deletion',
  );
  assert.equal(
    resolveTargetFileDeletionVerification(['present', 'absent', 'absent']),
    'absent',
    'eventual list propagation can confirm deletion',
  );
  assert.equal(
    resolveTargetFileDeletionVerification(['absent', 'present', 'absent']),
    'unknown',
    'an unstable list never clears pending cleanup',
  );
  assert.equal(
    resolveTargetFileDeletionVerification(['absent', 'absent', 'present']),
    'present',
    'a final present snapshot keeps cleanup pending',
  );
  assert.equal(
    resolveTargetFileDeletionVerification(['unknown', 'absent', 'absent']),
    'absent',
    'two final confirmed absences recover from an earlier read failure',
  );

  const canonical = extractFileSegmentsFromMessage({
    message: [
      {
        type: 'file',
        data: {
          file: 'new-package.7z',
          file_id: 'file-canonical',
          file_size: 15204352,
        },
      },
    ],
  });
  assert.deepEqual(canonical, [{
    fileId: 'file-canonical',
    fileName: 'new-package.7z',
    fileSize: 15204352,
  }], 'SnowLuma canonical file segment is parsed');

  const legacy = extractFileSegmentsFromMessage({
    message: [
      {
        type: 'file',
        data: {
          id: 'file-legacy',
          name: 'legacy.7z',
          size: 2048,
        },
      },
      { type: 'text', data: { text: 'ignored' } },
    ],
  });
  assert.deepEqual(legacy, [{
    fileId: 'file-legacy',
    fileName: 'legacy.7z',
    fileSize: 2048,
  }], 'legacy SnowLuma file fields are parsed');

  const sourceMessage = {
    time: 1785227509,
    self_id: 755396669,
    post_type: 'message',
    message_type: 'group',
    group_id: 1334664,
    user_id: 2854196310,
    message_id: 2107220832,
    message: [{
      type: 'file',
      data: {
        file_id: '/source-file-id',
        name: 'live-package.7z',
        size: 16979859,
      },
    }],
  };
  const synthetic = buildGroupFileUploadNoticesFromMessage(sourceMessage, '755396669');
  assert.equal(synthetic.length, 1, 'ordinary file message produces one synthetic upload notice');
  assert.equal(synthetic[0].notice_type, 'group_upload');
  assert.equal(synthetic[0].group_id, 1334664);
  assert.equal(synthetic[0].user_id, '2854196310');
  assert.equal(synthetic[0].file.id, '/source-file-id');
  assert.equal(synthetic[0].file.name, 'live-package.7z');
  assert.equal(synthetic[0].file.size, 16979859);
  assert.equal(synthetic[0].file.busid, 102);

  assert.deepEqual(buildGroupFileUploadNoticesFromMessage({
    ...sourceMessage,
    user_id: 755396669,
  }, '755396669'), [], 'mirror-created target files never trigger another source upload');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'gEKVklo-UtBeN.7z',
    size: 15 * 1024 * 1024,
  }), true, 'matching uploader and archive are accepted');

  assert.equal(fileEventMatchesRule(rule, '1334664', '999', {
    name: 'gEKVklo-UtBeN.7z',
    size: 15 * 1024 * 1024,
  }), false, 'other uploaders are rejected');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'readme.txt',
    size: 1024,
  }), false, 'filename pattern is enforced');

  assert.equal(fileEventMatchesRule(rule, '1334664', '2854196310', {
    name: 'large.7z',
    size: 101 * 1024 * 1024,
  }), false, 'maximum file size is enforced');

  const noUploaderFilter: GroupFileMirrorRule = {
    ...rule,
    id: 'mirror-all-uploaders',
    sourceUploaderIds: [],
  };
  assert.equal(fileEventMatchesRule(noUploaderFilter, '1334664', '999', {
    name: 'allowed.7z',
    size: 1024,
  }), true, 'empty uploader filter accepts any uploader');

  const invalidRegex = normalizeGroupFileMirrorConfig({
    enabled: true,
    rules: [{
      sourceGroupId: '1',
      targetGroupId: '2',
      fileNamePattern: '[',
    }],
  });
  assert.equal(invalidRegex.rules[0]?.fileNamePattern, '[', 'invalid regular expressions remain visible for diagnosis');
  assert.equal(invalidRegex.rules[0]?.enabled, false, 'invalid regular expressions disable the rule instead of matching every file');

  const webConfig = normalizeGroupFileMirrorWebInput({
    enabled: true,
    rules: [{
      name: '中文搬运规则',
      enabled: true,
      sourceGroupId: '1334664',
      targetGroupId: '16461612',
      sourceUploaderText: '2854196310，2854196310',
      fileMode: 'sevenZip',
      maxFileSizeMb: 256,
      targetFolderId: '/',
      keepLatestOnly: false,
      deletePreviousTargetFile: false,
      recallPreviousTargetMessage: false,
      syncSourceRecall: false,
    }],
  });
  assert.equal(webConfig.enabled, true, 'WebUI total switch is saved');
  assert.equal(webConfig.rules.length, 1, 'WebUI rule is accepted');
  assert.equal(webConfig.rules[0].id, '中文搬运规则');
  assert.equal(webConfig.rules[0].fileNamePattern, '\\.7z$');
  assert.deepEqual(webConfig.rules[0].sourceUploaderIds, ['2854196310']);
  assert.equal(webConfig.rules[0].keepLatestOnly, true, 'WebUI cannot disable latest-only behavior');
  assert.equal(webConfig.rules[0].deletePreviousTargetFile, true, 'WebUI cannot disable old file deletion');
  assert.equal(webConfig.rules[0].recallPreviousTargetMessage, true, 'WebUI cannot disable old message recall');
  assert.equal(webConfig.rules[0].syncSourceRecall, true, 'WebUI cannot disable source recall sync');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-file-mirror-bypass-'));
  const tempConfig = path.join(tempDir, 'group-file-mirror.json');
  const previousConfigPath = process.env.GROUP_FILE_MIRROR_CONFIG_PATH;
  try {
    fs.writeFileSync(tempConfig, `${JSON.stringify(webConfig, null, 2)}\n`, 'utf-8');
    process.env.GROUP_FILE_MIRROR_CONFIG_PATH = tempConfig;

    assert.equal(shouldBypassGroupFileMirrorGlobalRecall({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 16461612,
      user_id: 755396669,
      self_id: 755396669,
      message_id: 736612926,
      message: [{
        type: 'file',
        data: {
          file_id: '/target-file-id',
          name: 'live-package.7z',
          size: 16979859,
        },
      }],
    }), true, 'native target file bypasses the global self-recall scheduler');

    assert.equal(shouldBypassGroupFileMirrorGlobalRecall({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 999999,
      message: [{ type: 'file', data: { name: 'live-package.7z', size: 1024 } }],
    }), false, 'unrelated target groups stay in the normal scheduler');
  } finally {
    if (previousConfigPath === undefined) delete process.env.GROUP_FILE_MIRROR_CONFIG_PATH;
    else process.env.GROUP_FILE_MIRROR_CONFIG_PATH = previousConfigPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const archiveConfig = normalizeGroupFileMirrorWebInput({
    enabled: false,
    rules: [{
      name: '压缩包规则',
      sourceGroupId: '1',
      targetGroupId: '2',
      fileMode: 'archive',
    }],
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
  }), (error: unknown) => error instanceof GroupFileMirrorConfigError && error.message.includes('互相搬运'));

  const html = renderGroupFileMirrorPage();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /群文件搬运设置/);
  assert.match(html, /来源群号/);
  assert.match(html, /接收群号/);
  assert.match(html, /上传文件机器人的 QQ/);
  assert.match(html, /保存全部设置/);
  assert.match(html, /来源群撤回时同步清理/);
  assert.doesNotMatch(html, />Source Group</);
  assert.doesNotMatch(html, />Target Group</);
  assert.doesNotMatch(html, />Save</);

  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/group_file_mirror_service.ts'),
    'utf-8',
  );
  assert.match(serviceSource, /get_group_file_url/);
  assert.match(serviceSource, /upload_group_file/);
  assert.match(serviceSource, /get_group_root_files/);
  assert.match(serviceSource, /get_group_files_by_folder/);
  assert.match(serviceSource, /presence=/);
  assert.match(serviceSource, /delete_group_file/);
  assert.match(serviceSource, /delete_msg/);
  assert.match(serviceSource, /TARGET_FILE_DELETE_VERIFY_DELAYS_MS = \[0, 1500, 5000\]/);
  assert.match(serviceSource, /verifyTargetFileDeletion/);
  assert.match(serviceSource, /删除旧群文件后未确认消失/);
  assert.match(serviceSource, /保留待清理/);
  assert.doesNotMatch(serviceSource, /旧群文件已不在文件库，按已清理处理/);
  assert.doesNotMatch(serviceSource, /send_group_forward_msg/);

  console.log('group file native upload mirror verification passed');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
