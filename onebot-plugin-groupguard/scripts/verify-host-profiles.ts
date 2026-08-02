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
    get_group_msg_history: { data: { messages: [{ message_id: 1 }] } },
  });
  const snowluma = new SnowLumaProfile(actions);
  assert.equal((await snowluma.getGroupFileUrl({ groupId: '123', fileId: 'source', busid: 7 })).state, 'success');
  assert.equal((await snowluma.uploadGroupFile({ groupId: '456', source: 'https://example.test/file', fileName: 'x.7z' })).state, 'success');
  assert.equal((await snowluma.getGroupMessageHistory({ groupId: '456' })).state, 'success');
  assert.equal((await snowluma.listGroupFiles({ groupId: '456' })).state, 'indeterminate');
  assert.equal((await snowluma.deleteGroupFile({ groupId: '456', fileId: 'target-file' })).state, 'indeterminate');
  assert.equal(actions.calls.some(call => call.action === 'delete_group_file'), false);

  const unknownUrl = new SnowLumaProfile(new FakeActions({ get_group_file_url: { data: {} } }));
  assert.equal((await unknownUrl.getGroupFileUrl({ groupId: '1', fileId: 'f' })).state, 'indeterminate');

  const unknownList = normalizeVerifiedSnowLumaFileList({ data: { unexpected: [] } }, { complete: true });
  assert.equal(unknownList.state, 'indeterminate');
  const noEvidence = normalizeVerifiedSnowLumaFileList({ data: { files: [] } }, null);
  assert.equal(noEvidence.state, 'indeterminate');
  const verifiedList = normalizeVerifiedSnowLumaFileList({ data: { files: [{ file_id: 'f1', file_name: 'a.7z', file_size: 10 }] } }, { complete: true });
  assert.equal(verifiedList.state, 'success');
  assert.equal(verifiedList.data?.complete, true);
  assert.equal(verifiedList.data?.files[0]?.fileId, 'f1');

  console.info('host profile contracts verified');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
