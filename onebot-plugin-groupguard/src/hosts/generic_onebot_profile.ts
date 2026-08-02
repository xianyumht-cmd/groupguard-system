import type { OneBotActionClient } from '../protocol/onebot11/action_client';
import {
  type HostGroupFileDeleteRequest,
  type HostGroupFileList,
  type HostGroupFileListRequest,
  type HostGroupFileUploadRequest,
  type HostGroupFileUrlRequest,
  type HostMessageHistoryRequest,
  type HostOperationResult,
  type HostProfile,
  type HostProfileCapabilities,
  unsupportedHostOperation,
} from './host_profile';

export interface GenericOneBotExtensions {
  selfMessageEvents?: boolean;
  getGroupFileUrl?: (request: HostGroupFileUrlRequest) => Promise<HostOperationResult<{ url: string }>>;
  uploadGroupFile?: (request: HostGroupFileUploadRequest) => Promise<HostOperationResult<{ fileId: string }>>;
  listGroupFiles?: (request: HostGroupFileListRequest) => Promise<HostOperationResult<HostGroupFileList>>;
  deleteGroupFile?: (request: HostGroupFileDeleteRequest) => Promise<HostOperationResult<{ confirmed: boolean }>>;
  getGroupMessageHistory?: (request: HostMessageHistoryRequest) => Promise<HostOperationResult<{ messages: unknown[] }>>;
}

export class GenericOneBotProfile implements HostProfile {
  readonly id = 'generic-onebot';
  readonly capabilities: HostProfileCapabilities;
  readonly actions: OneBotActionClient;
  private readonly extensions: GenericOneBotExtensions;

  constructor(actions: OneBotActionClient, extensions: GenericOneBotExtensions = {}) {
    this.actions = actions;
    this.extensions = extensions;
    this.capabilities = {
      selfMessageEvents: extensions.selfMessageEvents === true ? 'supported' : 'unsupported',
      messageHistory: extensions.getGroupMessageHistory ? 'supported' : 'unsupported',
      groupFileUrl: extensions.getGroupFileUrl ? 'supported' : 'unsupported',
      groupFileUpload: extensions.uploadGroupFile ? 'supported' : 'unsupported',
      groupFileList: extensions.listGroupFiles ? 'supported' : 'unsupported',
      groupFileDelete: extensions.deleteGroupFile ? 'supported' : 'unsupported',
    };
  }

  getGroupFileUrl(request: HostGroupFileUrlRequest): Promise<HostOperationResult<{ url: string }>> {
    return this.extensions.getGroupFileUrl?.(request)
      ?? Promise.resolve(unsupportedHostOperation('generic_onebot_group_file_url_not_configured'));
  }

  uploadGroupFile(request: HostGroupFileUploadRequest): Promise<HostOperationResult<{ fileId: string }>> {
    return this.extensions.uploadGroupFile?.(request)
      ?? Promise.resolve(unsupportedHostOperation('generic_onebot_group_file_upload_not_configured'));
  }

  listGroupFiles(request: HostGroupFileListRequest): Promise<HostOperationResult<HostGroupFileList>> {
    return this.extensions.listGroupFiles?.(request)
      ?? Promise.resolve(unsupportedHostOperation('generic_onebot_group_file_list_not_configured'));
  }

  deleteGroupFile(request: HostGroupFileDeleteRequest): Promise<HostOperationResult<{ confirmed: boolean }>> {
    return this.extensions.deleteGroupFile?.(request)
      ?? Promise.resolve(unsupportedHostOperation('generic_onebot_group_file_delete_not_configured'));
  }

  getGroupMessageHistory(request: HostMessageHistoryRequest): Promise<HostOperationResult<{ messages: unknown[] }>> {
    return this.extensions.getGroupMessageHistory?.(request)
      ?? Promise.resolve(unsupportedHostOperation('generic_onebot_message_history_not_configured'));
  }
}
