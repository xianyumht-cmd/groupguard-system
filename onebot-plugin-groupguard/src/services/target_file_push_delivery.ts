import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HostProfile } from '../hosts/host_profile';

export function safeTargetFileName(value: unknown): string {
  let name = path.basename(String(value ?? '').trim().replace(/\\/g, '/'));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || name === '.' || name === '..') name = 'download.bin';
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 24);
    const base = path.basename(name, path.extname(name)).slice(0, Math.max(1, 180 - ext.length));
    name = `${base}${ext}`;
  }
  return name;
}

export async function downloadTargetFile(options: {
  eventId: string;
  fileName: string;
  directUrl: string;
  tempDir: string;
  maxFileSizeMb: number;
}): Promise<string> {
  fs.mkdirSync(options.tempDir, { recursive: true });
  const prefix = crypto.createHash('sha256').update(options.eventId).digest('hex').slice(0, 16);
  const finalPath = path.join(options.tempDir, `${prefix}-${safeTargetFileName(options.fileName)}`);
  const partPath = `${finalPath}.part`;
  try { fs.unlinkSync(partPath); } catch { /* noop */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let handle: fs.promises.FileHandle | null = null;
  try {
    const response = await fetch(options.directUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'GroupGuard-TargetFilePush/1.0',
        accept: '*/*',
      },
    });
    if (!response.ok) throw new Error(`文件下载失败 HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) throw new Error('直链返回了网页而不是文件，请重新解析直链');
    const declared = Number(response.headers.get('content-length') || 0);
    const maxBytes = options.maxFileSizeMb * 1024 * 1024;
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`文件超过 ${options.maxFileSizeMb} MB 限制`);
    if (!response.body) throw new Error('文件下载响应没有内容');

    handle = await fs.promises.open(partPath, 'w', 0o600);
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const data = Buffer.from(chunk.value);
      total += data.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* noop */ }
        throw new Error(`文件超过 ${options.maxFileSizeMb} MB 限制`);
      }
      await handle.write(data);
    }
    if (total <= 0) throw new Error('下载到的文件为空');
    await handle.close();
    handle = null;
    await fs.promises.rename(partPath, finalPath);
    await fs.promises.chmod(finalPath, 0o644);
    return finalPath;
  } finally {
    clearTimeout(timer);
    try { await handle?.close(); } catch { /* noop */ }
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch { /* noop */ }
  }
}

type TargetRetentionRecord = {
  targetGroupId: string;
  targetFolderId: string;
  fileId: string;
  fileName: string;
  uploadedAt: number;
  queuedAt?: number;
  attempts?: number;
  lastError?: string;
};

type TargetRetentionState = {
  version: 1;
  latest: TargetRetentionRecord | null;
  pendingCleanup: TargetRetentionRecord[];
};

const TARGET_RETENTION_VERSION = 1 as const;
const TARGET_DELETE_VERIFY_DELAYS_MS = [0, 1500, 5000] as const;
const targetRetentionTails = new Map<string, Promise<void>>();

function emptyTargetRetentionState(): TargetRetentionState {
  return { version: TARGET_RETENTION_VERSION, latest: null, pendingCleanup: [] };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveTargetFileRetentionStatePath(localPath: string): string {
  const override = String(process.env.TARGET_FILE_PUSH_TARGET_STATE_PATH || '').trim();
  if (override) return path.resolve(override);
  const tempDir = path.dirname(path.resolve(localPath));
  return path.join(path.dirname(tempDir), 'target-file-push-target-state.json');
}

function normalizeRetentionRecord(value: unknown): TargetRetentionRecord | null {
  if (!isRecord(value)) return null;
  const targetGroupId = String(value.targetGroupId || '').trim();
  const targetFolderId = String(value.targetFolderId || '/').trim() || '/';
  const fileId = String(value.fileId || '').trim();
  const fileName = safeTargetFileName(value.fileName);
  if (!targetGroupId || !fileId) return null;
  return {
    targetGroupId,
    targetFolderId,
    fileId,
    fileName,
    uploadedAt: Math.max(0, Number(value.uploadedAt || 0) || 0),
    queuedAt: Math.max(0, Number(value.queuedAt || 0) || 0) || undefined,
    attempts: Math.max(0, Number(value.attempts || 0) || 0) || undefined,
    lastError: String(value.lastError || '').slice(0, 240) || undefined,
  };
}

function loadTargetRetentionState(filePath: string): TargetRetentionState {
  if (!fs.existsSync(filePath)) return emptyTargetRetentionState();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!isRecord(raw) || raw.version !== TARGET_RETENTION_VERSION || !Array.isArray(raw.pendingCleanup)) {
    throw new Error('target_file_push_target_state_invalid');
  }
  const latest = normalizeRetentionRecord(raw.latest);
  const pendingCleanup = raw.pendingCleanup
    .map(normalizeRetentionRecord)
    .filter((item): item is TargetRetentionRecord => item !== null);
  return { version: TARGET_RETENTION_VERSION, latest, pendingCleanup };
}

function saveTargetRetentionState(filePath: string, state: TargetRetentionState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* noop */ }
    throw error;
  }
}

function sameTargetFile(a: TargetRetentionRecord, b: TargetRetentionRecord): boolean {
  return a.targetGroupId === b.targetGroupId
    && a.targetFolderId === b.targetFolderId
    && a.fileId === b.fileId;
}

function alreadyGoneReason(reason: unknown): boolean {
  const text = String(reason || '').toLowerCase();
  return text.includes('not found')
    || text.includes('不存在')
    || text.includes('已删除')
    || text.includes('already deleted')
    || text.includes('file not exist');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deleteTargetFile(hostProfile: HostProfile, record: TargetRetentionRecord): Promise<boolean> {
  let lastReason = '';
  for (let index = 0; index < TARGET_DELETE_VERIFY_DELAYS_MS.length; index += 1) {
    const delay = TARGET_DELETE_VERIFY_DELAYS_MS[index];
    if (delay > 0) await sleep(delay);
    try {
      const result = await hostProfile.deleteGroupFile({
        groupId: record.targetGroupId,
        fileId: record.fileId,
        folderId: record.targetFolderId || '/',
      });
      if (result.state === 'success' && result.data?.confirmed !== false) return true;
      lastReason = String(result.reason || result.state || 'delete_unconfirmed');
      if (alreadyGoneReason(lastReason)) return true;
    } catch (error) {
      lastReason = String((error as Error)?.message || error);
      if (alreadyGoneReason(lastReason)) return true;
    }
  }
  record.attempts = Math.max(0, Number(record.attempts || 0)) + 1;
  record.lastError = lastReason.slice(0, 240) || 'target_file_delete_failed';
  return false;
}

async function retryPendingTargetCleanup(
  hostProfile: HostProfile,
  state: TargetRetentionState,
): Promise<boolean> {
  if (!state.pendingCleanup.length) return false;
  const retained: TargetRetentionRecord[] = [];
  let changed = false;
  for (const record of state.pendingCleanup) {
    if (state.latest && sameTargetFile(record, state.latest)) {
      changed = true;
      continue;
    }
    if (await deleteTargetFile(hostProfile, record)) {
      changed = true;
      continue;
    }
    retained.push(record);
  }
  state.pendingCleanup = retained;
  return changed;
}

async function serializedTargetRetention<T>(statePath: string, task: () => Promise<T>): Promise<T> {
  const previous = targetRetentionTails.get(statePath) || Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.then(() => undefined, () => undefined);
  targetRetentionTails.set(statePath, tail);
  void tail.finally(() => {
    if (targetRetentionTails.get(statePath) === tail) targetRetentionTails.delete(statePath);
  });
  return run;
}

export function readTargetFileRetentionState(localPath: string): TargetRetentionState {
  return loadTargetRetentionState(resolveTargetFileRetentionStatePath(localPath));
}

export async function uploadTargetFile(options: {
  hostProfile: HostProfile;
  targetGroupId: string;
  targetFolderId: string;
  localPath: string;
  fileName: string;
}): Promise<string> {
  const statePath = resolveTargetFileRetentionStatePath(options.localPath);
  return serializedTargetRetention(statePath, async () => {
    const state = loadTargetRetentionState(statePath);
    if (await retryPendingTargetCleanup(options.hostProfile, state)) saveTargetRetentionState(statePath, state);

    const result = await options.hostProfile.uploadGroupFile({
      groupId: options.targetGroupId,
      source: options.localPath,
      fileName: safeTargetFileName(options.fileName),
      folderId: options.targetFolderId || '/',
    });
    if (result.state !== 'success' || !result.data?.fileId) {
      throw new Error(`群文件上传失败:${result.reason || result.state}`);
    }

    const uploaded: TargetRetentionRecord = {
      targetGroupId: options.targetGroupId,
      targetFolderId: options.targetFolderId || '/',
      fileId: result.data.fileId,
      fileName: safeTargetFileName(options.fileName),
      uploadedAt: Date.now(),
    };
    const previous = state.latest;
    state.latest = uploaded;
    if (previous && !sameTargetFile(previous, uploaded)) {
      const exists = state.pendingCleanup.some(item => sameTargetFile(item, previous));
      if (!exists) {
        state.pendingCleanup.push({
          ...previous,
          queuedAt: Date.now(),
          attempts: 0,
          lastError: '',
        });
      }
    }

    // Persist the new file as the authoritative latest target before deleting
    // the previous one. A crash can therefore leave an old file pending, but
    // can never delete the only successfully uploaded latest file.
    saveTargetRetentionState(statePath, state);
    await retryPendingTargetCleanup(options.hostProfile, state);
    saveTargetRetentionState(statePath, state);
    return uploaded.fileId;
  });
}
