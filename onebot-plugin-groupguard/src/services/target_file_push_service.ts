import fs from 'node:fs';
import path from 'node:path';
import type { HostProfile } from '../hosts/host_profile';
import {
  atomicWriteTargetFilePushJson,
  DEFAULT_TARGET_FILE_PUSH_CONFIG,
  normalizeTargetFilePushConfig,
  resolveTargetFilePushConfigDir,
  type TargetFilePushConfig,
} from './target_file_push_config';
import {
  saveTargetFilePushApiToken,
  targetFilePushApiToken,
  targetFilePushCallbackToken,
  targetFilePushTokenMatches,
} from './target_file_push_credentials';
import { downloadTargetFile, safeTargetFileName, uploadTargetFile } from './target_file_push_delivery';
import { callTargetFilePushInterface } from './target_file_push_interface_client';
import {
  emptyTargetFilePushState,
  loadTargetFilePushState,
  saveTargetFilePushState,
  type TargetFilePushState,
} from './target_file_push_state';

export interface TargetFilePushRuntimeBinding {
  hostProfile: HostProfile;
  workDir: string;
  dataDir: string;
  configPath: string;
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void;
}

const STALE_TEMP_MS = 48 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function stableUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  try {
    const parsed = new URL(text);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return text.split('?', 1)[0].split('#', 1)[0].replace(/\/+$/, '').toLowerCase();
  }
}

export class TargetFilePushService {
  private runtime: TargetFilePushRuntimeBinding | null = null;
  private config: TargetFilePushConfig = { ...DEFAULT_TARGET_FILE_PUSH_CONFIG };
  private state: TargetFilePushState = emptyTargetFilePushState();
  private readonly eventLocks = new Map<string, Promise<Record<string, any>>>();

  bindRuntime(runtime: TargetFilePushRuntimeBinding): void {
    this.runtime = runtime;
    this.loadConfig();
    this.loadState();
    targetFilePushCallbackToken(this.secretDir());
    this.cleanupStaleTempFiles();
  }

  private requireRuntime(): TargetFilePushRuntimeBinding {
    if (!this.runtime) throw new Error('target_file_push_runtime_not_bound');
    return this.runtime;
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    this.runtime?.log(level, `[TargetFilePush] ${message}`);
  }

  private secretDir(): string {
    return resolveTargetFilePushConfigDir(this.requireRuntime().configPath);
  }

  getConfigFilePath(): string {
    const override = String(process.env.TARGET_FILE_PUSH_CONFIG_PATH || '').trim();
    if (override) return path.resolve(override);
    return path.join(this.secretDir(), 'target-file-push.json');
  }

  getStateFilePath(): string {
    const override = String(process.env.TARGET_FILE_PUSH_STATE_PATH || '').trim();
    if (override) return path.resolve(override);
    return path.join(this.requireRuntime().dataDir, 'target-file-push-state.json');
  }

  getTempDir(): string {
    const override = String(process.env.TARGET_FILE_PUSH_TEMP_DIR || '').trim();
    if (override) return path.resolve(override);
    return path.join(this.requireRuntime().dataDir, 'target-file-push-temp');
  }

  private loadConfig(): void {
    const filePath = this.getConfigFilePath();
    try {
      if (!fs.existsSync(filePath)) {
        atomicWriteTargetFilePushJson(filePath, DEFAULT_TARGET_FILE_PUSH_CONFIG);
        this.config = { ...DEFAULT_TARGET_FILE_PUSH_CONFIG };
        return;
      }
      this.config = normalizeTargetFilePushConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (error) {
      this.config = { ...DEFAULT_TARGET_FILE_PUSH_CONFIG };
      this.log('error', `配置读取失败，功能保持关闭: ${String((error as Error)?.message || error)}`);
    }
  }

  private loadState(): void {
    try {
      this.state = loadTargetFilePushState(this.getStateFilePath());
    } catch (error) {
      this.state = emptyTargetFilePushState();
      this.log('error', `状态读取失败，使用空状态且不会覆盖损坏文件: ${String((error as Error)?.message || error)}`);
    }
  }

  private saveState(): void {
    saveTargetFilePushState(this.getStateFilePath(), this.state);
  }

  getConfig(): TargetFilePushConfig {
    this.loadConfig();
    return { ...this.config };
  }

  saveConfig(value: unknown): TargetFilePushConfig {
    const next = normalizeTargetFilePushConfig(value);
    atomicWriteTargetFilePushJson(this.getConfigFilePath(), next);
    this.config = next;
    targetFilePushCallbackToken(this.secretDir());
    return { ...next };
  }

  setApiToken(value: string): void {
    saveTargetFilePushApiToken(this.secretDir(), value);
  }

  getLocalStatus(): Record<string, any> {
    this.loadConfig();
    this.loadState();
    return {
      config: { ...this.config },
      apiTokenConfigured: Boolean(targetFilePushApiToken(this.secretDir())),
      callbackTokenConfigured: Boolean(targetFilePushCallbackToken(this.secretDir())),
      tempDir: this.getTempDir(),
      current: this.state.current,
      completedCount: Object.keys(this.state.completed).length,
      lastSuccessAt: this.state.lastSuccessAt,
      lastErrorAt: this.state.lastErrorAt,
      lastError: this.state.lastError,
    };
  }

  private interfaceCall(pathname: string, method = 'GET', body?: unknown): Promise<Record<string, any>> {
    this.loadConfig();
    return callTargetFilePushInterface({
      config: this.config,
      apiToken: targetFilePushApiToken(this.secretDir()),
      pathname,
      method,
      body,
    });
  }

  async syncInterfaceConfig(): Promise<Record<string, any>> {
    this.loadConfig();
    return this.interfaceCall('/api/v1/target-file-watch/config', 'PUT', {
      enabled: this.config.enabled,
      source_url: this.config.sourceUrl,
      callback_url: this.config.callbackBaseUrl
        ? `${this.config.callbackBaseUrl}/api/target-file-push/event`
        : '',
      callback_token: targetFilePushCallbackToken(this.secretDir()),
      check_interval_seconds: this.config.checkIntervalSeconds,
    });
  }

  getInterfaceStatus(): Promise<Record<string, any>> {
    return this.interfaceCall('/api/v1/target-file-watch/status');
  }

  requestImmediateCheck(): Promise<Record<string, any>> {
    return this.interfaceCall('/api/v1/target-file-watch/check', 'POST', {});
  }

  requestRebaseline(): Promise<Record<string, any>> {
    return this.interfaceCall('/api/v1/target-file-watch/rebaseline', 'POST', {});
  }

  private cleanupStaleTempFiles(): void {
    const dir = this.getTempDir();
    try {
      if (!fs.existsSync(dir)) return;
      const keep = this.state.current?.localPath ? path.resolve(this.state.current.localPath) : '';
      const now = Date.now();
      for (const name of fs.readdirSync(dir)) {
        const filePath = path.join(dir, name);
        try {
          if (keep && path.resolve(filePath) === keep) continue;
          const stat = fs.statSync(filePath);
          if (stat.isFile() && now - stat.mtimeMs > STALE_TEMP_MS) fs.unlinkSync(filePath);
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  async handleEvent(payload: unknown, presentedToken: string): Promise<Record<string, any>> {
    if (!targetFilePushTokenMatches(this.secretDir(), presentedToken)) throw new Error('target_file_push_callback_unauthorized');
    this.loadConfig();
    this.loadState();
    if (!this.config.enabled) throw new Error('target_file_push_disabled');
    if (!isRecord(payload) || payload.schema !== 'target-file-push.v1') throw new Error('target_file_push_invalid_schema');

    const eventId = String(payload.event_id || '').trim();
    const fingerprint = String(payload.fingerprint || '').trim();
    const sourceUrl = String(payload.source_url || '').trim();
    const directUrl = String(payload.direct_url || '').trim();
    const file = isRecord(payload.file) ? payload.file : {};
    const fileName = safeTargetFileName(file.name);
    if (!eventId || eventId.length > 200) throw new Error('target_file_push_invalid_event_id');
    if (!fingerprint || fingerprint.length > 200) throw new Error('target_file_push_invalid_fingerprint');
    if (stableUrl(sourceUrl) !== stableUrl(this.config.sourceUrl)) throw new Error('target_file_push_source_mismatch');
    if (!isHttpUrl(directUrl)) throw new Error('target_file_push_invalid_direct_url');

    const completed = this.state.completed[eventId];
    if (completed) {
      return { ok: true, uploaded: true, deduplicated: true, eventId, fileId: completed.fileId };
    }

    const existing = this.eventLocks.get(eventId);
    if (existing) return existing;
    const task = this.processEvent({ eventId, fingerprint, directUrl, fileName })
      .finally(() => {
        if (this.eventLocks.get(eventId) === task) this.eventLocks.delete(eventId);
      });
    this.eventLocks.set(eventId, task);
    return task;
  }

  private async processEvent(input: { eventId: string; fingerprint: string; directUrl: string; fileName: string }): Promise<Record<string, any>> {
    this.cleanupStaleTempFiles();
    let localPath = '';
    try {
      if (this.state.current?.eventId === input.eventId
        && this.state.current.localPath
        && fs.existsSync(this.state.current.localPath)) {
        localPath = this.state.current.localPath;
      } else {
        this.state.current = {
          eventId: input.eventId,
          fingerprint: input.fingerprint,
          fileName: input.fileName,
          localPath: '',
          state: 'downloading',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          lastError: '',
        };
        this.saveState();
        localPath = await downloadTargetFile({
          eventId: input.eventId,
          fileName: input.fileName,
          directUrl: input.directUrl,
          tempDir: this.getTempDir(),
          maxFileSizeMb: this.config.maxFileSizeMb,
        });
        this.state.current.localPath = localPath;
        this.state.current.state = 'downloaded';
        this.state.current.updatedAt = Date.now();
        this.saveState();
      }

      if (!this.state.current) throw new Error('target_file_push_state_lost');
      this.state.current.state = 'uploading';
      this.state.current.updatedAt = Date.now();
      this.saveState();

      const fileId = await uploadTargetFile({
        hostProfile: this.requireRuntime().hostProfile,
        targetGroupId: this.config.targetGroupId,
        targetFolderId: this.config.targetFolderId,
        localPath,
        fileName: input.fileName,
      });

      const uploadedAt = Date.now();
      this.state.completed[input.eventId] = {
        eventId: input.eventId,
        fingerprint: input.fingerprint,
        fileName: input.fileName,
        fileId,
        uploadedAt,
      };
      this.state.lastSuccessAt = uploadedAt;
      this.state.lastErrorAt = 0;
      this.state.lastError = '';
      this.state.current.state = 'cleanup_pending';
      this.state.current.updatedAt = Date.now();
      this.saveState();

      let cleanupPending = false;
      try {
        fs.unlinkSync(localPath);
        this.state.current = null;
      } catch (error) {
        cleanupPending = true;
        if (this.state.current) {
          this.state.current.state = 'cleanup_pending';
          this.state.current.lastError = `本地临时文件删除失败:${String((error as Error)?.message || error).slice(0, 240)}`;
          this.state.current.updatedAt = Date.now();
        }
      }
      this.saveState();
      this.log('info', `文件已上传 group=${this.config.targetGroupId} file=${input.fileName} event=${input.eventId}`);
      return { ok: true, uploaded: true, deduplicated: false, cleanupPending, eventId: input.eventId, fileId };
    } catch (error) {
      const message = String((error as Error)?.message || error).slice(0, 500);
      this.state.lastErrorAt = Date.now();
      this.state.lastError = message;
      if (this.state.current?.eventId === input.eventId) {
        this.state.current.state = 'failed';
        this.state.current.lastError = message;
        this.state.current.updatedAt = Date.now();
        if (!this.state.current.localPath && localPath) this.state.current.localPath = localPath;
      }
      this.saveState();
      this.log('error', `事件 ${input.eventId} 处理失败: ${message}`);
      throw error;
    }
  }
}

export const targetFilePushService = new TargetFilePushService();
