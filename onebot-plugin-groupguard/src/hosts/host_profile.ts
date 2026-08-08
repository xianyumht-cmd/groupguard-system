import type { OneBotActionClient } from '../protocol/onebot11/action_client';

export type HostCapabilityState = 'supported' | 'unsupported';
export type HostOperationState = 'success' | 'failed' | 'indeterminate' | 'unsupported';

export interface HostOperationResult<T> {
  state: HostOperationState;
  data?: T;
  reason?: string;
  rawResponse?: unknown;
}

export interface HostGroupFileEntry {
  fileId: string;
  fileName: string;
  fileSize: number;
  uploadTime?: number;
  busid?: number;
  folderId?: string;
  raw?: unknown;
}

export interface HostGroupFileList {
  files: HostGroupFileEntry[];
  complete: boolean;
  nextCursor?: string;
  raw?: unknown;
}

export interface HostGroupFileUrlRequest {
  groupId: string;
  fileId: string;
  busid?: number;
}

export interface HostGroupFileUploadRequest {
  groupId: string;
  source: string;
  fileName: string;
  folderId?: string;
}

export interface HostGroupFileListRequest {
  groupId: string;
  folderId?: string;
  cursor?: string;
}

export interface HostGroupFileDeleteRequest {
  groupId: string;
  fileId: string;
  folderId?: string;
  busid?: number;
}

export interface HostMessageHistoryRequest {
  groupId: string;
  anchorMessageId?: string;
  count?: number;
}

export interface HostProfileCapabilities {
  selfMessageEvents: HostCapabilityState;
  messageHistory: HostCapabilityState;
  groupFileUrl: HostCapabilityState;
  groupFileUpload: HostCapabilityState;
  groupFileList: HostCapabilityState;
  groupFileDelete: HostCapabilityState;
}

export interface HostProfile {
  readonly id: string;
  readonly capabilities: HostProfileCapabilities;
  readonly actions: OneBotActionClient;
  getGroupFileUrl(request: HostGroupFileUrlRequest): Promise<HostOperationResult<{ url: string }>>;
  uploadGroupFile(request: HostGroupFileUploadRequest): Promise<HostOperationResult<{ fileId: string }>>;
  listGroupFiles(request: HostGroupFileListRequest): Promise<HostOperationResult<HostGroupFileList>>;
  deleteGroupFile(request: HostGroupFileDeleteRequest): Promise<HostOperationResult<{ confirmed: boolean }>>;
  getGroupMessageHistory(request: HostMessageHistoryRequest): Promise<HostOperationResult<{ messages: unknown[] }>>;
}

export function unsupportedHostOperation<T>(reason: string): HostOperationResult<T> {
  return { state: 'unsupported', reason };
}

export function failedHostOperation<T>(reason: string, rawResponse?: unknown): HostOperationResult<T> {
  return { state: 'failed', reason, rawResponse };
}

export function indeterminateHostOperation<T>(reason: string, rawResponse?: unknown): HostOperationResult<T> {
  return { state: 'indeterminate', reason, rawResponse };
}
