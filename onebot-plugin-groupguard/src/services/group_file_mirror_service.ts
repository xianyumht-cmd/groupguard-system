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
  keepLatestOnly: boolean;
  recallPreviousTargetMessage: boolean;
  syncSourceRecall: boolean;
  retryCount: number;
  retryDelayMs: number;
}

export interface GroupFileMirrorConfig {
  enabled: boolean;
  rules: GroupFileMirrorRule[];
}

export interface FileMessageDescriptor {
  fileId: string;
  fileName: string;
  fileSize: number;
}

interface ForwardRecord {
  sourceGroupId: string;
  sourceUploaderId: string;
  sourceMessageId: string;
  sourceFileName: string;
  sourceFileSize: number;
  targetGroupId: string;
  targetMessageId: string;
  mirroredAt: number;
}

interface CleanupRecord {
  targetGroupId: string;
  targetMessageId: string;
  sourceFileName: string;
  messageRecalled: boolean;
  queuedAt: number;
}

interface MirrorRuleState {
  current?: ForwardRecord;
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

const DEFAULT_CONFIG: GroupFileMirrorConfig = {
  enabled: false,
  rules: [],
};

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
      keepLatestOnly: raw.keepLatestOnly !== false && raw.keep_latest_only !== false,
      recallPreviousTargetMessage: raw.recallPreviousTargetMessage !== false && raw.recall_previous_target_message !== false,
      syncSourceRecall: raw.syncSourceRecall !== false && raw.sync_source_recall !== false,
      retryCount: clampNumber(raw.retryCount ?? raw.retry_count, 2, 0, 10),
      retryDelayMs: clampNumber(raw.retryDelayMs ?? raw.retry_delay_ms, 1500, 100, 30000),
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

function messageParam(value: string): string | number {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function unwrapActionData(value: any): any {
  return value?.data ?? value?.result ?? value;
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
  file: { name: string; size: number },
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

  observeEvent(event: unknown): void {
    if (!this.runtime || !isRecord(event)) return;
    this.ensureConfigLoaded();
    if (!this.config.enabled) return;

    const postType = String(event.post_type || '');
    if (postType === 'message' || postType === 'message_sent') {
      this.observeMessage(event);
      return;
    }

    if (postType === 'notice' && String(event.notice_type || '') === 'group_recall') {
      this.observeGroupRecall(event);
    }
  }

  private observeMessage(event: Record<string, any>): void {
    const groupId = normalizeId(event.group_id);
    const messageId = extractMessageId(event);
    const senderId = extractSenderId(event);
    if (!groupId || !messageId || !senderId) return;

    const files = extractFileSegmentsFromMessage(event);
    if (!files.length) return;

    for (const rule of this.config.rules) {
      const file = files.find(item => fileEventMatchesRule(rule, groupId, senderId, {
        name: item.fileName,
        size: item.fileSize,
      }));
      if (!file) continue;
      this.enqueue(rule.id, async () => this.forwardMessage(rule, senderId, messageId, file));
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

  private async forwardMessage(
    rule: GroupFileMirrorRule,
    uploaderId: string,
    sourceMessageId: string,
    file: FileMessageDescriptor,
  ): Promise<void> {
    const state = this.getRuleState(rule.id);
    if (state.current?.sourceMessageId === sourceMessageId) {
      this.log('debug', `规则 ${rule.id} 跳过重复文件消息 ${sourceMessageId}`);
      return;
    }

    await this.cleanupPending(rule, state);

    const result = await this.callWithRetry(rule, 'forward_group_single_msg', {
      message_id: messageParam(sourceMessageId),
      group_id: groupParam(rule.targetGroupId),
    });
    const data = unwrapActionData(result);
    const targetMessageId = normalizeId(data?.message_id ?? data?.messageId ?? result?.message_id ?? result?.messageId);
    if (!targetMessageId) throw new Error(`文件消息已请求转发但未返回目标 message_id: ${file.fileName}`);

    const previous = state.current;
    state.current = {
      sourceGroupId: rule.sourceGroupId,
      sourceUploaderId: uploaderId,
      sourceMessageId,
      sourceFileName: file.fileName,
      sourceFileSize: file.fileSize,
      targetGroupId: rule.targetGroupId,
      targetMessageId,
      mirroredAt: Date.now(),
    };
    state.lastSuccessAt = Date.now();
    state.lastErrorAt = 0;
    state.lastError = '';

    if (rule.keepLatestOnly && previous?.targetMessageId && previous.targetMessageId !== targetMessageId) {
      this.queueCleanup(state, previous);
    }
    this.saveState();

    await this.cleanupPending(rule, state);
    this.log('info', `规则 ${rule.id} 已转发文件消息 ${file.fileName} ${rule.sourceGroupId} -> ${rule.targetGroupId}`);
  }

  private queueCleanup(state: MirrorRuleState, record: ForwardRecord): void {
    if (state.pendingCleanup.some(item => item.targetGroupId === record.targetGroupId && item.targetMessageId === record.targetMessageId)) return;
    state.pendingCleanup.push({
      targetGroupId: record.targetGroupId,
      targetMessageId: record.targetMessageId,
      sourceFileName: record.sourceFileName,
      messageRecalled: !record.targetMessageId,
      queuedAt: Date.now(),
    });
  }

  private async cleanupPending(rule: GroupFileMirrorRule, state: MirrorRuleState): Promise<void> {
    if (!state.pendingCleanup.length) return;
    const remaining: CleanupRecord[] = [];
    for (const item of state.pendingCleanup) {
      await this.cleanupTargetMessage(rule, item);
      if (rule.recallPreviousTargetMessage && !item.messageRecalled) remaining.push(item);
    }
    state.pendingCleanup = remaining;
    this.saveState();
  }

  private async cleanupTargetMessage(rule: GroupFileMirrorRule, item: CleanupRecord): Promise<void> {
    if (!rule.recallPreviousTargetMessage || !item.targetMessageId || item.messageRecalled) return;
    try {
      await this.callWithRetry(rule, 'delete_msg', { message_id: messageParam(item.targetMessageId) });
      item.messageRecalled = true;
    } catch (error) {
      if (isAlreadyGoneError(error)) item.messageRecalled = true;
      else this.log('warn', `规则 ${rule.id} 撤回旧转发消息失败 message=${item.targetMessageId}: ${String(error)}`);
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
    this.log('info', `规则 ${rule.id} 已同步来源消息撤回 message=${sourceMessageId}`);
  }
}

export const groupFileMirrorService = new GroupFileMirrorService();
