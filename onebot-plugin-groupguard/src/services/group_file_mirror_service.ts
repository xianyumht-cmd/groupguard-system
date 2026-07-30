import fs from 'fs';
import path from 'path';

export interface GroupFileMirrorRule {
  id: string;
  enabled: boolean;
  sourceGroupId: string;
  targetGroupId: string;
  sourceUploaderIds: string[];
  fileNamePattern: string;
  maxFileSizeMb: number;
  targetFolderId: string;
  keepLatestOnly: boolean;
  deletePreviousTargetFile: boolean;
  recallPreviousTargetMessage: boolean;
  syncSourceRecall: boolean;
  retryCount: number;
  retryDelayMs: number;
  messageLookupAttempts: number;
  messageLookupDelayMs: number;
}

export interface GroupFileMirrorConfig {
  enabled: boolean;
  rules: GroupFileMirrorRule[];
}

interface GroupFileDescriptor {
  id: string;
  name: string;
  size: number;
  busid: number;
}

export interface ListedGroupFileDescriptor {
  id: string;
  name: string;
  size: number;
  busid: number;
  uploadTime: number;
}

interface FileMessageDescriptor {
  fileId: string;
  fileName: string;
  fileSize: number;
}

interface MirrorRecord {
  sourceGroupId: string;
  sourceUploaderId: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceBusid: number;
  sourceMessageId: string;
  targetGroupId: string;
  targetFileId: string;
  targetDeleteFileId?: string;
  targetBusid?: number;
  targetMessageId: string;
  mirroredAt: number;
}

interface CleanupRecord {
  targetGroupId: string;
  targetFileId: string;
  targetDeleteFileId?: string;
  targetBusid?: number;
  targetMessageId: string;
  sourceFileName: string;
  sourceFileSize?: number;
  mirroredAt?: number;
  messageRecalled: boolean;
  fileDeleted: boolean;
  queuedAt: number;
}

interface MirrorRuleState {
  current?: MirrorRecord;
  pendingCleanup: CleanupRecord[];
  lastSuccessAt: number;
  lastErrorAt: number;
  lastError: string;
}

interface MirrorStateStore {
  version: 1;
  rules: Record<string, MirrorRuleState>;
}

interface RuntimeBinding {
  callAction: (action: string, params: unknown) => Promise<any>;
  workDir: string;
  dataDir: string;
  configPath: string;
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void;
}

interface RecentFileMessage {
  groupId: string;
  messageId: string;
  senderId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  observedAt: number;
}

const DEFAULT_CONFIG: GroupFileMirrorConfig = {
  enabled: false,
  rules: [],
};

const RECENT_MESSAGE_TTL_MS = 10 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeId).filter(Boolean)));
}

function isValidPattern(pattern: string): boolean {
  if (!pattern) return true;
  try {
    void new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

export function normalizeGroupFileMirrorConfig(value: unknown): GroupFileMirrorConfig {
  const input = isRecord(value) ? value : {};
  const rawRules = Array.isArray(input.rules) ? input.rules : [];
  const seenIds = new Set<string>();
  const rules: GroupFileMirrorRule[] = [];

  for (let index = 0; index < rawRules.length; index += 1) {
    const raw = isRecord(rawRules[index]) ? rawRules[index] : {};
    const sourceGroupId = normalizeId(raw.sourceGroupId ?? raw.source_group_id);
    const targetGroupId = normalizeId(raw.targetGroupId ?? raw.target_group_id);
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) continue;

    const fallbackId = `${sourceGroupId}-to-${targetGroupId}`;
    let id = normalizeId(raw.id) || fallbackId;
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);

    const fileNamePattern = String(raw.fileNamePattern ?? raw.file_name_pattern ?? '').trim();
    rules.push({
      id,
      enabled: raw.enabled !== false,
      sourceGroupId,
      targetGroupId,
      sourceUploaderIds: normalizeStringArray(raw.sourceUploaderIds ?? raw.source_uploader_ids),
      fileNamePattern: isValidPattern(fileNamePattern) ? fileNamePattern : '',
      maxFileSizeMb: clampNumber(raw.maxFileSizeMb ?? raw.max_file_size_mb, 512, 1, 4096),
      targetFolderId: String(raw.targetFolderId ?? raw.target_folder_id ?? '/').trim() || '/',
      keepLatestOnly: raw.keepLatestOnly !== false && raw.keep_latest_only !== false,
      deletePreviousTargetFile: raw.deletePreviousTargetFile !== false && raw.delete_previous_target_file !== false,
      recallPreviousTargetMessage: raw.recallPreviousTargetMessage !== false && raw.recall_previous_target_message !== false,
      syncSourceRecall: raw.syncSourceRecall !== false && raw.sync_source_recall !== false,
      retryCount: clampNumber(raw.retryCount ?? raw.retry_count, 2, 0, 10),
      retryDelayMs: clampNumber(raw.retryDelayMs ?? raw.retry_delay_ms, 1500, 100, 30000),
      messageLookupAttempts: clampNumber(raw.messageLookupAttempts ?? raw.message_lookup_attempts, 6, 0, 30),
      messageLookupDelayMs: clampNumber(raw.messageLookupDelayMs ?? raw.message_lookup_delay_ms, 1000, 100, 10000),
    });
  }

  return {
    enabled: input.enabled === true,
    rules,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function groupParam(value: string): string | number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : value;
}

function unwrapActionData(value: any): any {
  return value?.data ?? value?.result ?? value;
}

function normalizeUploadTime(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number >= 1_000_000_000_000 ? number : number * 1000;
}

export function extractListedGroupFiles(value: unknown): ListedGroupFileDescriptor[] {
  const data = unwrapActionData(value);
  const rawFiles = Array.isArray(data?.files)
    ? data.files
    : Array.isArray((value as any)?.files)
      ? (value as any).files
      : [];

  const files: ListedGroupFileDescriptor[] = [];
  for (const rawValue of rawFiles) {
    const raw = isRecord(rawValue) ? rawValue : {};
    const id = normalizeId(raw.file_id ?? raw.fileId ?? raw.id);
    const name = normalizeId(raw.file_name ?? raw.fileName ?? raw.name);
    if (!id || !name) continue;
    files.push({
      id,
      name,
      size: Math.max(0, Number(raw.file_size ?? raw.fileSize ?? raw.size ?? 0) || 0),
      busid: Math.max(0, Number(raw.busid ?? raw.bus_id ?? 0) || 0),
      uploadTime: normalizeUploadTime(raw.upload_time ?? raw.uploadTime ?? raw.modify_time ?? raw.modifyTime),
    });
  }
  return files;
}

export function selectListedGroupFileForUpload(
  files: ListedGroupFileDescriptor[],
  fileName: string,
  fileSize: number,
  uploadStartedAt: number,
): ListedGroupFileDescriptor | null {
  const matches = files.filter(file => file.name === fileName
    && (fileSize <= 0 || file.size <= 0 || file.size === fileSize));
  if (!matches.length) return null;

  const timed = matches.filter(file => file.uploadTime > 0);
  if (uploadStartedAt > 0 && timed.length) {
    const withinWindow = timed.filter(file => Math.abs(file.uploadTime - uploadStartedAt) <= 5 * 60 * 1000);
    const candidates = withinWindow.length ? withinWindow : timed;
    return candidates.reduce((best, candidate) => (
      Math.abs(candidate.uploadTime - uploadStartedAt) < Math.abs(best.uploadTime - uploadStartedAt)
        ? candidate
        : best
    ));
  }

  if (matches.length === 1) return matches[0];
  return timed.sort((left, right) => right.uploadTime - left.uploadTime)[0] || null;
}

function extractMessageId(message: any): string {
  return normalizeId(message?.message_id ?? message?.messageId ?? message?.id);
}

function extractSenderId(message: any): string {
  return normalizeId(
    message?.user_id
    ?? message?.userId
    ?? message?.sender?.user_id
    ?? message?.sender?.userId
    ?? message?.sender?.uin
    ?? message?.sender_uin,
  );
}

export function extractFileSegmentsFromMessage(message: any): FileMessageDescriptor[] {
  const segments = Array.isArray(message?.message) ? message.message : [];
  const output: FileMessageDescriptor[] = [];
  for (const segment of segments) {
    if (!isRecord(segment) || String(segment.type || '') !== 'file') continue;
    const data = isRecord(segment.data) ? segment.data : {};
    const fileId = normalizeId(data.file_id ?? data.fileId ?? data.id);
    const fileName = normalizeId(data.name ?? data.file_name ?? data.fileName ?? data.filename ?? data.file);
    const fileSize = Math.max(0, Number(data.file_size ?? data.fileSize ?? data.size ?? 0) || 0);
    if (!fileId && !fileName) continue;
    output.push({ fileId, fileName, fileSize });
  }
  return output;
}

export function fileEventMatchesRule(
  rule: GroupFileMirrorRule,
  groupId: string,
  uploaderId: string,
  file: Pick<GroupFileDescriptor, 'name' | 'size'>,
): boolean {
  if (!rule.enabled || rule.sourceGroupId !== groupId) return false;
  if (rule.sourceUploaderIds.length && !rule.sourceUploaderIds.includes(uploaderId)) return false;
  if (file.size > rule.maxFileSizeMb * 1024 * 1024) return false;
  if (rule.fileNamePattern) {
    try {
      if (!new RegExp(rule.fileNamePattern, 'i').test(file.name)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function messageMatchesFile(message: RecentFileMessage, fileId: string, fileName: string, fileSize = 0): boolean {
  if (fileId && message.fileId && fileId === message.fileId) return true;
  if (!fileName || !message.fileName || fileName !== message.fileName) return false;
  return fileSize <= 0 || message.fileSize <= 0 || fileSize === message.fileSize;
}

function isAlreadyGoneError(error: unknown): boolean {
  const text = String((error as Error)?.message || error).toLowerCase();
  return text.includes('not found')
    || text.includes('不存在')
    || text.includes('已删除')
    || text.includes('already deleted')
    || text.includes('message not exist');
}

export class GroupFileMirrorService {
  private runtime: RuntimeBinding | null = null;
  private config: GroupFileMirrorConfig = DEFAULT_CONFIG;
  private configMtimeMs = -1;
  private configErrorSignature = '';
  private state: MirrorStateStore = { version: 1, rules: {} };
  private loadedStatePath = '';
  private readonly recentMessages = new Map<string, RecentFileMessage>();
  private readonly ruleTails = new Map<string, Promise<void>>();

  bindRuntime(runtime: RuntimeBinding): void {
    this.runtime = runtime;
    this.ensureConfigLoaded();
    this.ensureStateLoaded();
  }

  getConfigFilePath(): string {
    const override = String(process.env.GROUP_FILE_MIRROR_CONFIG_PATH || '').trim();
    if (override) return path.resolve(override);
    const baseDir = this.runtime ? path.dirname(this.runtime.configPath) : process.cwd();
    return path.join(baseDir, 'config', 'group-file-mirror.json');
  }

  getStateFilePath(): string {
    const override = String(process.env.GROUP_FILE_MIRROR_STATE_PATH || '').trim();
    if (override) return path.resolve(override);
    const dataDir = String(this.runtime?.dataDir || path.join(process.cwd(), 'data'));
    return path.join(dataDir, 'group-file-mirror-state.json');
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    this.runtime?.log(level, `[GroupFileMirror] ${message}`);
  }

  private ensureConfigLoaded(): void {
    const filePath = this.getConfigFilePath();
    try {
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf-8');
        this.log('info', `已创建默认配置（功能关闭）: ${filePath}`);
      }
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs === this.configMtimeMs) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.config = normalizeGroupFileMirrorConfig(parsed);
      this.configMtimeMs = stat.mtimeMs;
      this.configErrorSignature = '';
      this.log('info', `配置已加载 enabled=${this.config.enabled} rules=${this.config.rules.length}`);
    } catch (error) {
      const signature = String((error as Error)?.message || error);
      if (signature !== this.configErrorSignature) {
        this.configErrorSignature = signature;
        this.log('error', `配置读取失败，继续使用上一份有效配置: ${signature}`);
      }
    }
  }

  private ensureStateLoaded(): void {
    const filePath = this.getStateFilePath();
    if (this.loadedStatePath === filePath) return;
    this.loadedStatePath = filePath;
    this.state = { version: 1, rules: {} };
    try {
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (isRecord(parsed) && isRecord(parsed.rules)) {
        this.state = { version: 1, rules: parsed.rules as Record<string, MirrorRuleState> };
      }
    } catch (error) {
      this.log('warn', `状态文件读取失败，将从空状态继续: ${String(error)}`);
    }
  }

  private saveState(): void {
    this.ensureStateLoaded();
    const filePath = this.getStateFilePath();
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      this.log('error', `状态文件保存失败: ${String(error)}`);
    }
  }

  private getRuleState(ruleId: string): MirrorRuleState {
    this.ensureStateLoaded();
    const current = this.state.rules[ruleId];
    if (!current) {
      this.state.rules[ruleId] = {
        pendingCleanup: [],
        lastSuccessAt: 0,
        lastErrorAt: 0,
        lastError: '',
      };
    } else if (!Array.isArray(current.pendingCleanup)) {
      current.pendingCleanup = [];
    }
    return this.state.rules[ruleId];
  }

  private pruneRecentMessages(): void {
    const cutoff = Date.now() - RECENT_MESSAGE_TTL_MS;
    for (const [key, value] of this.recentMessages.entries()) {
      if (value.observedAt < cutoff) this.recentMessages.delete(key);
    }
  }

  private rememberRecentMessage(message: RecentFileMessage): void {
    this.pruneRecentMessages();
    if (message.fileId) this.recentMessages.set(`${message.groupId}:id:${message.fileId}`, message);
    if (message.fileName) this.recentMessages.set(`${message.groupId}:name:${message.fileName}`, message);
  }

  private findRecentMessage(groupId: string, fileId: string, fileName: string, fileSize = 0): RecentFileMessage | null {
    this.pruneRecentMessages();
    const byId = fileId ? this.recentMessages.get(`${groupId}:id:${fileId}`) : undefined;
    if (byId && messageMatchesFile(byId, fileId, fileName, fileSize)) return byId;
    const byName = fileName ? this.recentMessages.get(`${groupId}:name:${fileName}`) : undefined;
    return byName && messageMatchesFile(byName, fileId, fileName, fileSize) ? byName : null;
  }

  observeEvent(event: unknown): void {
    if (!this.runtime || !isRecord(event)) return;
    this.ensureConfigLoaded();
    if (!this.config.enabled) return;

    const postType = String(event.post_type || '');
    if (postType === 'message' || postType === 'message_sent') {
      this.observeMessage(event);
      return;
    }

    if (postType !== 'notice') return;
    const noticeType = String(event.notice_type || '');
    if (noticeType === 'group_upload') {
      this.observeGroupUpload(event);
      return;
    }
    if (noticeType === 'group_recall') this.observeGroupRecall(event);
  }

  private observeMessage(event: Record<string, any>): void {
    const groupId = normalizeId(event.group_id);
    const messageId = extractMessageId(event);
    if (!groupId || !messageId) return;
    const senderId = extractSenderId(event);
    const files = extractFileSegmentsFromMessage(event);
    if (!files.length) return;

    let changed = false;
    for (const file of files) {
      const recent: RecentFileMessage = {
        groupId,
        messageId,
        senderId,
        fileId: file.fileId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        observedAt: Date.now(),
      };
      this.rememberRecentMessage(recent);

      for (const rule of this.config.rules) {
        const state = this.getRuleState(rule.id);
        const current = state.current;
        if (!current) continue;
        if (groupId === current.sourceGroupId
          && messageMatchesFile(recent, current.sourceFileId, current.sourceFileName, current.sourceFileSize)
          && current.sourceMessageId !== messageId) {
          current.sourceMessageId = messageId;
          changed = true;
        }
        if (groupId === current.targetGroupId
          && messageMatchesFile(recent, current.targetFileId, current.sourceFileName, current.sourceFileSize)
          && current.targetMessageId !== messageId) {
          current.targetMessageId = messageId;
          changed = true;
        }
      }
    }
    if (changed) this.saveState();
  }

  private observeGroupUpload(event: Record<string, any>): void {
    const groupId = normalizeId(event.group_id);
    const uploaderId = normalizeId(event.user_id);
    const rawFile = isRecord(event.file) ? event.file : {};
    const file: GroupFileDescriptor = {
      id: normalizeId(rawFile.id ?? rawFile.file_id),
      name: normalizeId(rawFile.name ?? rawFile.file_name),
      size: Math.max(0, Number(rawFile.size ?? rawFile.file_size ?? 0) || 0),
      busid: Math.max(0, Number(rawFile.busid ?? rawFile.bus_id ?? 102) || 102),
    };
    if (!groupId || !file.id || !file.name) return;

    for (const rule of this.config.rules) {
      if (!fileEventMatchesRule(rule, groupId, uploaderId, file)) continue;
      this.enqueue(rule.id, async () => this.mirrorUpload(rule, uploaderId, file));
    }
  }

  private observeGroupRecall(event: Record<string, any>): void {
    const groupId = normalizeId(event.group_id);
    const messageId = normalizeId(event.message_id);
    if (!groupId || !messageId) return;

    for (const rule of this.config.rules) {
      if (!rule.enabled || !rule.syncSourceRecall || rule.sourceGroupId !== groupId) continue;
      const state = this.getRuleState(rule.id);
      if (!state.current?.sourceMessageId || state.current.sourceMessageId !== messageId) continue;
      this.enqueue(rule.id, async () => this.cleanupCurrentAfterSourceRecall(rule, messageId));
    }
  }

  private enqueue(ruleId: string, task: () => Promise<void>): void {
    const previous = this.ruleTails.get(ruleId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch(error => {
        const state = this.getRuleState(ruleId);
        state.lastErrorAt = Date.now();
        state.lastError = String((error as Error)?.message || error).slice(0, 1000);
        this.saveState();
        this.log('error', `规则 ${ruleId} 执行失败: ${state.lastError}`);
      });
    this.ruleTails.set(ruleId, next);
    void next.finally(() => {
      if (this.ruleTails.get(ruleId) === next) this.ruleTails.delete(ruleId);
    });
  }

  private async callWithRetry(rule: GroupFileMirrorRule, action: string, params: unknown): Promise<any> {
    if (!this.runtime) throw new Error('group_file_mirror_runtime_not_bound');
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= rule.retryCount; attempt += 1) {
      try {
        return await this.runtime.callAction(action, params);
      } catch (error) {
        lastError = error;
        if (attempt >= rule.retryCount) break;
        await sleep(rule.retryDelayMs * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || `action_failed:${action}`));
  }

  private async resolveTargetDeleteFile(
    rule: GroupFileMirrorRule,
    fileName: string,
    fileSize: number,
    uploadStartedAt: number,
    requireUniqueWithoutTimestamp = false,
  ): Promise<ListedGroupFileDescriptor | null> {
    const attempts = Math.max(1, Math.min(rule.messageLookupAttempts || 1, 10));
    const folderId = String(rule.targetFolderId || '/').trim() || '/';
    const action = folderId === '/' ? 'get_group_root_files' : 'get_group_files_by_folder';
    const params: Record<string, unknown> = {
      group_id: groupParam(rule.targetGroupId),
      file_count: 100,
    };
    if (folderId !== '/') {
      params.folder_id = folderId;
      params.folder = folderId;
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await sleep(rule.messageLookupDelayMs);
      try {
        const result = await this.callWithRetry(rule, action, params);
        const files = extractListedGroupFiles(result);
        const matches = files.filter(item => item.name === fileName
          && (fileSize <= 0 || item.size <= 0 || item.size === fileSize));
        if (requireUniqueWithoutTimestamp && uploadStartedAt <= 0 && matches.length !== 1) {
          this.log('warn', `规则 ${rule.id} 无法安全解析旧群文件：同名候选数量=${matches.length} file=${fileName}`);
          return null;
        }
        const selected = selectListedGroupFileForUpload(matches, fileName, fileSize, uploadStartedAt);
        if (selected) return selected;
      } catch (error) {
        this.log('debug', `规则 ${rule.id} 第 ${attempt + 1} 次解析目标群文件删除 ID 失败: ${String(error)}`);
      }
    }
    return null;
  }

  private async mirrorUpload(rule: GroupFileMirrorRule, uploaderId: string, file: GroupFileDescriptor): Promise<void> {
    const state = this.getRuleState(rule.id);
    if (state.current?.sourceFileId === file.id && state.current.sourceGroupId === rule.sourceGroupId) {
      this.log('debug', `规则 ${rule.id} 跳过重复文件 ${file.name} (${file.id})`);
      return;
    }

    await this.cleanupPending(rule, state);

    const sourceUrlResult = await this.callWithRetry(rule, 'get_group_file_url', {
      group_id: groupParam(rule.sourceGroupId),
      file_id: file.id,
      busid: file.busid,
    });
    const sourceUrlData = unwrapActionData(sourceUrlResult);
    const sourceUrl = normalizeId(sourceUrlData?.url ?? sourceUrlResult?.url);
    if (!/^https?:\/\//i.test(sourceUrl)) throw new Error(`未取得可用的群文件下载地址: ${file.name}`);

    const uploadStartedAt = Date.now();
    const uploadResult = await this.callWithRetry(rule, 'upload_group_file', {
      group_id: groupParam(rule.targetGroupId),
      file: sourceUrl,
      name: file.name,
      folder: rule.targetFolderId,
      upload_file: true,
    });
    const uploadData = unwrapActionData(uploadResult);
    const targetUploadFileId = normalizeId(uploadData?.file_id ?? uploadData?.fileId ?? uploadResult?.file_id ?? uploadResult?.fileId);
    if (!targetUploadFileId) throw new Error(`目标群上传成功但未返回 file_id: ${file.name}`);

    const targetDeleteFile = await this.resolveTargetDeleteFile(rule, file.name, file.size, uploadStartedAt);
    if (!targetDeleteFile) {
      this.log('warn', `规则 ${rule.id} 上传成功，但暂未解析到可用于 delete_group_file 的目标文件 ID: ${file.name}`);
    }

    const sourceMessage = this.findRecentMessage(rule.sourceGroupId, file.id, file.name, file.size);
    let targetMessage = this.findRecentMessage(rule.targetGroupId, targetUploadFileId, file.name, file.size);
    if (!targetMessage && rule.messageLookupAttempts > 0) {
      const targetMessageId = await this.findMessageIdInHistory(rule, targetUploadFileId, file.name, file.size);
      if (targetMessageId) {
        targetMessage = {
          groupId: rule.targetGroupId,
          messageId: targetMessageId,
          senderId: '',
          fileId: targetUploadFileId,
          fileName: file.name,
          fileSize: file.size,
          observedAt: Date.now(),
        };
        this.rememberRecentMessage(targetMessage);
      }
    }

    const previous = state.current;
    state.current = {
      sourceGroupId: rule.sourceGroupId,
      sourceUploaderId: uploaderId,
      sourceFileId: file.id,
      sourceFileName: file.name,
      sourceFileSize: file.size,
      sourceBusid: file.busid,
      sourceMessageId: sourceMessage?.messageId || '',
      targetGroupId: rule.targetGroupId,
      targetFileId: targetUploadFileId,
      targetDeleteFileId: targetDeleteFile?.id || '',
      targetBusid: targetDeleteFile?.busid || 0,
      targetMessageId: targetMessage?.messageId || '',
      mirroredAt: Date.now(),
    };
    state.lastSuccessAt = Date.now();
    state.lastErrorAt = 0;
    state.lastError = '';

    if (rule.keepLatestOnly && previous?.targetFileId && previous.targetFileId !== targetUploadFileId) {
      this.queueCleanup(state, previous);
    }
    this.saveState();

    await this.cleanupPending(rule, state);
    this.log('info', `规则 ${rule.id} 已搬运 ${file.name} (${Math.round(file.size / 1024 / 1024 * 100) / 100} MB) ${rule.sourceGroupId} -> ${rule.targetGroupId}`);
  }

  private queueCleanup(state: MirrorRuleState, record: MirrorRecord): void {
    const cleanupFileId = record.targetDeleteFileId || record.targetFileId;
    if (state.pendingCleanup.some(item => item.targetGroupId === record.targetGroupId
      && (item.targetDeleteFileId || item.targetFileId) === cleanupFileId)) return;
    state.pendingCleanup.push({
      targetGroupId: record.targetGroupId,
      targetFileId: record.targetFileId,
      targetDeleteFileId: record.targetDeleteFileId || '',
      targetBusid: record.targetBusid || 0,
      targetMessageId: record.targetMessageId,
      sourceFileName: record.sourceFileName,
      sourceFileSize: record.sourceFileSize,
      mirroredAt: record.mirroredAt,
      messageRecalled: !record.targetMessageId,
      fileDeleted: !cleanupFileId,
      queuedAt: Date.now(),
    });
  }

  private async cleanupPending(rule: GroupFileMirrorRule, state: MirrorRuleState): Promise<void> {
    if (!state.pendingCleanup.length) return;
    const remaining: CleanupRecord[] = [];
    for (const item of state.pendingCleanup) {
      await this.cleanupTarget(rule, item);
      const messageDone = !rule.recallPreviousTargetMessage || item.messageRecalled;
      const fileDone = !rule.deletePreviousTargetFile || item.fileDeleted;
      if (!messageDone || !fileDone) remaining.push(item);
    }
    state.pendingCleanup = remaining;
    this.saveState();
  }

  private async cleanupTarget(rule: GroupFileMirrorRule, item: CleanupRecord): Promise<void> {
    if (rule.recallPreviousTargetMessage && item.targetMessageId && !item.messageRecalled) {
      try {
        await this.callWithRetry(rule, 'delete_msg', { message_id: item.targetMessageId });
        item.messageRecalled = true;
      } catch (error) {
        if (isAlreadyGoneError(error)) item.messageRecalled = true;
        else this.log('warn', `规则 ${rule.id} 撤回旧文件消息失败 message=${item.targetMessageId}: ${String(error)}`);
      }
    }

    if (rule.deletePreviousTargetFile && !item.fileDeleted) {
      let deleteFileId = normalizeId(item.targetDeleteFileId);
      let deleteBusid = Math.max(0, Number(item.targetBusid || 0) || 0);
      if (!deleteFileId) {
        const resolved = await this.resolveTargetDeleteFile(
          rule,
          item.sourceFileName,
          Math.max(0, Number(item.sourceFileSize || 0) || 0),
          Math.max(0, Number(item.mirroredAt || 0) || 0),
          true,
        );
        if (resolved) {
          deleteFileId = resolved.id;
          deleteBusid = resolved.busid;
          item.targetDeleteFileId = resolved.id;
          item.targetBusid = resolved.busid;
        }
      }

      if (!deleteFileId) {
        this.log('warn', `规则 ${rule.id} 暂缓删除旧群文件：无法安全解析 delete_group_file 文件 ID file=${item.sourceFileName}`);
        return;
      }

      const params: Record<string, unknown> = {
        group_id: groupParam(item.targetGroupId),
        file_id: deleteFileId,
      };
      if (deleteBusid > 0) params.busid = deleteBusid;

      try {
        await this.callWithRetry(rule, 'delete_group_file', params);
        item.fileDeleted = true;
      } catch (error) {
        if (isAlreadyGoneError(error)) item.fileDeleted = true;
        else this.log('warn', `规则 ${rule.id} 删除旧群文件失败 file=${deleteFileId} busid=${deleteBusid}: ${String(error)}`);
      }
    }
  }

  private async cleanupCurrentAfterSourceRecall(rule: GroupFileMirrorRule, sourceMessageId: string): Promise<void> {
    const state = this.getRuleState(rule.id);
    const current = state.current;
    if (!current || current.sourceMessageId !== sourceMessageId) return;
    this.queueCleanup(state, current);
    delete state.current;
    this.saveState();
    await this.cleanupPending(rule, state);
    this.log('info', `规则 ${rule.id} 已同步来源撤回 message=${sourceMessageId}`);
  }

  private async findMessageIdInHistory(
    rule: GroupFileMirrorRule,
    targetFileId: string,
    fileName: string,
    fileSize: number,
  ): Promise<string> {
    for (let attempt = 0; attempt < rule.messageLookupAttempts; attempt += 1) {
      await sleep(rule.messageLookupDelayMs);
      try {
        const result = await this.callWithRetry(rule, 'get_group_msg_history', {
          group_id: groupParam(rule.targetGroupId),
          message_id: 0,
          count: 50,
        });
        const data = unwrapActionData(result);
        const messages = Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(result?.messages)
            ? result.messages
            : [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          const files = extractFileSegmentsFromMessage(message);
          if (!files.some(file => {
            if (targetFileId && file.fileId && targetFileId === file.fileId) return true;
            return file.fileName === fileName && (fileSize <= 0 || file.fileSize <= 0 || file.fileSize === fileSize);
          })) continue;
          const messageId = extractMessageId(message);
          if (messageId) return messageId;
        }
      } catch (error) {
        this.log('debug', `规则 ${rule.id} 第 ${attempt + 1} 次查询目标文件消息失败: ${String(error)}`);
      }
    }
    return '';
  }
}

export const groupFileMirrorService = new GroupFileMirrorService();
