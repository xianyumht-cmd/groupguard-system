import type { OneBotActionClient } from '../protocol/onebot11/action_client';
import {
  failedHostOperation,
  indeterminateHostOperation,
  type HostGroupFileDeleteRequest,
  type HostGroupFileEntry,
  type HostGroupFileList,
  type HostGroupFileListRequest,
  type HostGroupFileUploadRequest,
  type HostGroupFileUrlRequest,
  type HostMessageHistoryRequest,
  type HostOperationResult,
  type HostProfile,
  type HostProfileCapabilities,
} from './host_profile';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapActionData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.data ?? value.result ?? value;
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function groupParam(value: string): string | number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : value;
}

function actionError(error: unknown): string {
  return String((error as Error)?.message || error || 'unknown_action_error');
}

function normalizeFileEntry(value: unknown): HostGroupFileEntry | null {
  if (!isRecord(value)) return null;
  const fileId = normalizeId(value.file_id ?? value.fileId ?? value.id);
  if (!fileId) return null;
  return {
    fileId,
    fileName: normalizeId(value.file_name ?? value.fileName ?? value.name),
    fileSize: Math.max(0, Number(value.file_size ?? value.fileSize ?? value.size ?? 0) || 0),
    busid: Number.isFinite(Number(value.busid)) ? Number(value.busid) : undefined,
    folderId: normalizeId(value.folder_id ?? value.folderId ?? value.folder) || undefined,
    raw: value,
  };
}

export interface SnowLumaProfileOptions {
  /**
   * Delete/list request and response semantics are deliberately disabled until
   * real SnowLuma captures have been reviewed. Supplying these adapters means
   * the caller owns that evidence and its strict normalization.
   */
  listGroupFiles?: (request: HostGroupFileListRequest, actions: OneBotActionClient) => Promise<HostOperationResult<HostGroupFileList>>;
  deleteGroupFile?: (request: HostGroupFileDeleteRequest, actions: OneBotActionClient) => Promise<HostOperationResult<{ confirmed: boolean }>>;
}

export class SnowLumaProfile implements HostProfile {
  readonly id = 'snowluma';
  readonly capabilities: HostProfileCapabilities;
  readonly actions: OneBotActionClient;
  private readonly options: SnowLumaProfileOptions;

  constructor(actions: OneBotActionClient, options: SnowLumaProfileOptions = {}) {
    this.actions = actions;
    this.options = options;
    this.capabilities = {
      selfMessageEvents: 'supported',
      messageHistory: 'supported',
      groupFileUrl: 'supported',
      groupFileUpload: 'supported',
      groupFileList: options.listGroupFiles ? 'supported' : 'unsupported',
      groupFileDelete: options.deleteGroupFile ? 'supported' : 'unsupported',
    };
  }

  async getGroupFileUrl(request: HostGroupFileUrlRequest): Promise<HostOperationResult<{ url: string }>> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.actions.call('get_group_file_url', {
        group_id: groupParam(request.groupId),
        file_id: request.fileId,
        ...(request.busid === undefined ? {} : { busid: request.busid }),
      });
    } catch (error) {
      return failedHostOperation(`snowluma_get_group_file_url_failed:${actionError(error)}`);
    }
    const data = unwrapActionData(rawResponse);
    const url = isRecord(data) ? normalizeId(data.url) : '';
    if (!/^https?:\/\//i.test(url)) {
      return indeterminateHostOperation('snowluma_get_group_file_url_unrecognized_response', rawResponse);
    }
    return { state: 'success', data: { url }, rawResponse };
  }

  async uploadGroupFile(request: HostGroupFileUploadRequest): Promise<HostOperationResult<{ fileId: string }>> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.actions.call('upload_group_file', {
        group_id: groupParam(request.groupId),
        file: request.source,
        name: request.fileName,
        folder: request.folderId || '/',
        upload_file: true,
      });
    } catch (error) {
      return failedHostOperation(`snowluma_upload_group_file_failed:${actionError(error)}`);
    }
    const data = unwrapActionData(rawResponse);
    const fileId = isRecord(data)
      ? normalizeId(data.file_id ?? data.fileId)
      : '';
    if (!fileId) {
      return indeterminateHostOperation('snowluma_upload_group_file_missing_file_id', rawResponse);
    }
    return { state: 'success', data: { fileId }, rawResponse };
  }

  async listGroupFiles(request: HostGroupFileListRequest): Promise<HostOperationResult<HostGroupFileList>> {
    if (!this.options.listGroupFiles) {
      return indeterminateHostOperation('snowluma_group_file_list_contract_not_verified');
    }
    return this.options.listGroupFiles(request, this.actions);
  }

  async deleteGroupFile(request: HostGroupFileDeleteRequest): Promise<HostOperationResult<{ confirmed: boolean }>> {
    if (!this.options.deleteGroupFile) {
      return indeterminateHostOperation('snowluma_group_file_delete_contract_not_verified');
    }
    return this.options.deleteGroupFile(request, this.actions);
  }

  async getGroupMessageHistory(request: HostMessageHistoryRequest): Promise<HostOperationResult<{ messages: unknown[] }>> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.actions.call('get_group_msg_history', {
        group_id: groupParam(request.groupId),
        message_id: request.anchorMessageId || 0,
        count: Math.max(1, Math.min(100, Number(request.count || 50))),
      });
    } catch (error) {
      return failedHostOperation(`snowluma_get_group_msg_history_failed:${actionError(error)}`);
    }
    const data = unwrapActionData(rawResponse);
    const messages = isRecord(data) && Array.isArray(data.messages)
      ? data.messages
      : [];
    if (!isRecord(data) || !Array.isArray(data.messages)) {
      return indeterminateHostOperation('snowluma_get_group_msg_history_unrecognized_response', rawResponse);
    }
    return { state: 'success', data: { messages }, rawResponse };
  }
}

export function normalizeVerifiedSnowLumaFileList(
  rawResponse: unknown,
  options: { complete: boolean; nextCursor?: string } | null,
): HostOperationResult<HostGroupFileList> {
  if (!options) {
    return indeterminateHostOperation('snowluma_file_list_evidence_missing', rawResponse);
  }
  const data = unwrapActionData(rawResponse);
  if (!isRecord(data) || !Array.isArray(data.files)) {
    return indeterminateHostOperation('snowluma_file_list_unrecognized_response', rawResponse);
  }
  const files: HostGroupFileEntry[] = [];
  for (const item of data.files) {
    const normalized = normalizeFileEntry(item);
    if (!normalized) {
      return indeterminateHostOperation('snowluma_file_list_contains_unrecognized_entry', rawResponse);
    }
    files.push(normalized);
  }
  return {
    state: 'success',
    data: { files, complete: options.complete, nextCursor: options.nextCursor, raw: rawResponse },
    rawResponse,
  };
}
