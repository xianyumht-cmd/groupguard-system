import fs from 'fs';
import {
  extractFileSegmentsFromMessage,
  groupFileMirrorService,
  normalizeGroupFileMirrorConfig,
  type GroupFileMirrorConfig,
  type GroupFileMirrorRule,
} from './group_file_mirror_service';

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function extractSenderId(event: Record<string, any>): string {
  return normalizeId(
    event.user_id
    ?? event.userId
    ?? event.sender?.user_id
    ?? event.sender?.userId
    ?? event.sender?.uin
    ?? event.sender_uin,
  );
}

/**
 * SnowLuma v1.12.4 does not report group_upload for the external robot's
 * ordinary file-card message. Convert that already-observed message into the
 * notice shape consumed by the native-upload mirror service.
 *
 * The original message must be passed to groupFileMirrorService.observeEvent
 * first so its source message_id is cached before this synthetic notice starts
 * the asynchronous upload task.
 */
export function buildGroupFileUploadNoticesFromMessage(
  event: unknown,
  botId: string,
): Record<string, any>[] {
  if (!isRecord(event)) return [];
  const postType = String(event.post_type || '');
  if (postType !== 'message' && postType !== 'message_sent') return [];

  const groupId = normalizeId(event.group_id);
  const senderId = extractSenderId(event);
  if (!groupId || !senderId) return [];

  // Never turn the mirror's own target-group uploads back into source uploads.
  if (botId && senderId === botId) return [];

  const files = extractFileSegmentsFromMessage(event);
  return files
    .filter(file => file.fileId && file.fileName)
    .map(file => ({
      time: event.time,
      self_id: event.self_id,
      post_type: 'notice',
      notice_type: 'group_upload',
      group_id: event.group_id,
      user_id: senderId,
      file: {
        id: file.fileId,
        file_id: file.fileId,
        name: file.fileName,
        file_name: file.fileName,
        size: file.fileSize,
        file_size: file.fileSize,
        busid: 102,
      },
      _groupguard_synthetic_from_file_message: true,
      _groupguard_source_message_id: event.message_id,
    }));
}

let cachedConfigPath = '';
let cachedConfigMtimeMs = -1;
let cachedConfig: GroupFileMirrorConfig = { enabled: false, rules: [] };

function loadMirrorConfig(): GroupFileMirrorConfig {
  const filePath = groupFileMirrorService.getConfigFilePath();
  try {
    const stat = fs.statSync(filePath);
    if (cachedConfigPath === filePath && cachedConfigMtimeMs === stat.mtimeMs) {
      return cachedConfig;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    cachedConfig = normalizeGroupFileMirrorConfig(parsed);
    cachedConfigPath = filePath;
    cachedConfigMtimeMs = stat.mtimeMs;
  } catch {
    cachedConfig = { enabled: false, rules: [] };
    cachedConfigPath = filePath;
    cachedConfigMtimeMs = -1;
  }
  return cachedConfig;
}

function targetFileMatchesRule(
  rule: GroupFileMirrorRule,
  file: { fileName: string; fileSize: number },
): boolean {
  if (file.fileSize > rule.maxFileSizeMb * 1024 * 1024) return false;
  if (!rule.fileNamePattern) return true;
  try {
    return new RegExp(rule.fileNamePattern, 'i').test(file.fileName);
  } catch {
    return false;
  }
}

/**
 * Native files created by the mirror have their own lifecycle. The caller uses
 * this before runtimeControlService.scheduleSelfRecall, so matching target-group
 * file cards never enter the existing global risk/self-recall queue. Old file
 * cards and files are cleaned only by group_file_mirror_service's direct
 * delete_msg + delete_group_file path.
 *
 * Matching the configured target group + file rule also covers the race where
 * SnowLuma emits message_sent before upload_group_file returns its file_id.
 */
export function shouldBypassGroupFileMirrorGlobalRecall(event: unknown): boolean {
  if (!isRecord(event)) return false;
  const postType = String(event.post_type || '');
  if (postType !== 'message' && postType !== 'message_sent') return false;

  const groupId = normalizeId(event.group_id);
  if (!groupId) return false;

  const files = extractFileSegmentsFromMessage(event);
  if (!files.length) return false;

  const config = loadMirrorConfig();
  if (!config.enabled) return false;

  return config.rules.some(rule => rule.enabled
    && rule.targetGroupId === groupId
    && files.some(file => targetFileMatchesRule(rule, file)));
}
