import assert from 'node:assert/strict';
import { GenericOneBotProfile } from '../src/hosts/generic_onebot_profile';
import { SnowLumaProfile, normalizeVerifiedSnowLumaFileList } from '../src/hosts/snowluma_profile';
import type { OneBotActionClient } from '../src/protocol/onebot11/action_client';

class FakeActions implements OneBotActionClient {
  calls: Array<{ action: string; params: unknown }> = [];
  private readonly responses: Record<string, unknown>;
  constructor(responses: Record<string, unknown> = {}) {
    this.responses = responses;
  }
  async call(action: string, params: unknown = {}): Promise<unknown> {
    this.calls.push({ action, params });
    const response = this.responses[action];
    if (response instanceof Error) throw response;
    return response;
  }
}

async function run(): Promise<void> {
  const generic = new GenericOneBotProfile(new FakeActions());
  assert.equal(generic.capabilities.groupFileDelete, 'unsupported');
  assert.equal((await generic.deleteGroupFile({ groupId: '1', fileId: 'f' })).state, 'unsupported');

  const actions = new FakeActions({
    get_group_file_url: { data: { url: 'https://example.test/file' } },
    upload_group_file: { data: { file_id: 'target-file' } },
    get_group_root_files: {
      data: {
        files: [{ file_id: 'root-1', file_name: 'root.7z', file_size: 10, upload_time: 123 }],
        folders: [],
      },
    },
    get_group_files_by_folder: {
      data: {
        files: [{ file_id: 'child-1', file_name: 'child.7z', file_size: 20, upload_time: 456 }],
        folders: [],
      },
    },
    delete_group_file: {},
    get_group_msg_history: { data: { messages: [{ message_id: 1 }] } },
  });
  const snowluma = new SnowLumaProfile(actions);
  assert.equal(snowluma.capabilities.groupFileList, 'supported');
  assert.equal(snowluma.capabilities.groupFileDelete, 'supported');
  assert.equal((await snowluma.getGroupFileUrl({ groupId: '123', fileId: 'source', busid: 7 })).state, 'success');
  assert.equal((await snowluma.uploadGroupFile({ groupId: '456', source: 'https://example.test/file', fileName: 'x.7z' })).state, 'success');
  assert.equal((await snowluma.getGroupMessageHistory({ groupId: '456' })).state, 'success');

  const rootList = await snowluma.listGroupFiles({ groupId: '456', folderId: '/' });
  assert.equal(rootList.state, 'success');
  assert.equal(rootList.data?.complete, true);
  assert.equal(rootList.data?.files[0]?.fileId, 'root-1');
  assert.equal(rootList.data?.files[0]?.uploadTime, 123);
  assert.deepEqual(actions.calls.find(call => call.action === 'get_group_root_files')?.params, {
    group_id: 456,
  });

  const childList = await snowluma.listGroupFiles({ groupId: '456', folderId: '/folder-1' });
  assert.equal(childList.state, 'success');
  assert.equal(childList.data?.files[0]?.fileId, 'child-1');
  assert.deepEqual(actions.calls.find(call => call.action === 'get_group_files_by_folder')?.params, {
    group_id: 456,
    folder_id: '/folder-1',
  });

  const deleted = await snowluma.deleteGroupFile({
    groupId: '456',
    fileId: 'target-file',
    folderId: '/ignored-by-snowluma-contract',
    busid: 102,
  });
  assert.equal(deleted.state, 'success');
  assert.equal(deleted.data?.confirmed, true);
  const deleteCall = actions.calls.find(call => call.action === 'delete_group_file');
  assert.deepEqual(deleteCall?.params, {
    group_id: 456,
    file_id: 'target-file',
  }, 'SnowLuma v1.12.4 delete_group_file must receive only group_id + file_id');

  const failedDelete = new SnowLumaProfile(new FakeActions({
    delete_group_file: new Error('simulated-delete-failure'),
  }));
  const failedDeleteResult = await failedDelete.deleteGroupFile({ groupId: '456', fileId: 'target-file' });
  assert.equal(failedDeleteResult.state, 'failed');
  assert.match(String(failedDeleteResult.reason || ''), /snowluma_delete_group_file_failed/);

  const failedList = new SnowLumaProfile(new FakeActions({
    get_group_root_files: new Error('simulated-list-failure'),
  }));
  const failedListResult = await failedList.listGroupFiles({ groupId: '456', folderId: '/' });
  assert.equal(failedListResult.state, 'failed');
  assert.match(String(failedListResult.reason || ''), /snowluma_group_file_list_failed/);

  const unknownUrl = new SnowLumaProfile(new FakeActions({ get_group_file_url: { data: {} } }));
  assert.equal((await unknownUrl.getGroupFileUrl({ groupId: '1', fileId: 'f' })).state, 'indeterminate');

  const unknownList = normalizeVerifiedSnowLumaFileList({ data: { unexpected: [] } }, { complete: true });
  assert.equal(unknownList.state, 'indeterminate');
  const noEvidence = normalizeVerifiedSnowLumaFileList({ data: { files: [] } }, null);
  assert.equal(noEvidence.state, 'indeterminate');
  const verifiedList = normalizeVerifiedSnowLumaFileList({ data: { files: [{ file_id: 'f1', file_name: 'a.7z', file_size: 10, upload_time: 789 }] } }, { complete: true });
  assert.equal(verifiedList.state, 'success');
  assert.equal(verifiedList.data?.complete, true);
  assert.equal(verifiedList.data?.files[0]?.fileId, 'f1');
  assert.equal(verifiedList.data?.files[0]?.uploadTime, 789);

  console.info('host profile contracts verified');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
