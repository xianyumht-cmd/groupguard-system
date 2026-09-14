import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { HostGroupFileEntry, HostProfile } from '../hosts/host_profile';
import { prepareTargetFileDownloadHop } from './target_file_push_download_security';

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

async function closeDownloadDispatcher(dispatcher: Dispatcher | null): Promise<void> {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    try { await dispatcher.destroy(); } catch { /* noop */ }
  }
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
  let activeDispatcher: Dispatcher | null = null;
  let response: Awaited<ReturnType<typeof undiciFetch>> | null = null;
  try {
    let currentUrl = new URL(options.directUrl);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const hop = await prepareTargetFileDownloadHop(currentUrl);
      activeDispatcher = hop.dispatcher;
      response = await undiciFetch(currentUrl, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'user-agent': 'GroupGuard-TargetFilePush/1.0', accept: '*/*' },
        ...(activeDispatcher ? { dispatcher: activeDispatcher } : {}),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('文件下载重定向缺少 Location');
      if (redirects === 5) throw new Error('文件下载重定向次数过多');
      try { await response.body?.cancel(); } catch { /* noop */ }
      response = null;
      await closeDownloadDispatcher(activeDispatcher);
      activeDispatcher = null;
      currentUrl = new URL(location, currentUrl);
    }
    if (!response) throw new Error('文件下载没有响应');
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
    try { await response?.body?.cancel(); } catch { /* noop */ }
    await closeDownloadDispatcher(activeDispatcher);
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
  lastReconciledAt?: number;
  lastObservedFileCount?: number;
  lastReconcileError?: string;
};

export type TargetRetentionReconcileResult = {
  ok: boolean;
  keptFileId: string;
  keptFileName: string;
  observedBefore: number;
  observedAfter: number;
  deletedCount: number;
  leftoverCount: number;
  adoptedLatest: boolean;
  error: string;
};

const TARGET_RETENTION_VERSION = 1 as const;
const KEEP_VISIBILITY_DELAYS_MS = [0, 700, 1600, 3000] as const;
const VERIFY_DELAYS_MS = [0, 700, 1600, 3000] as const;
const targetRetentionTails = new Map<string, Promise<void>>();

function emptyTargetRetentionState(): TargetRetentionState {
  return {
    version: TARGET_RETENTION_VERSION,
    latest: null,
    pendingCleanup: [],
    lastReconciledAt: 0,
    lastObservedFileCount: 0,
    lastReconcileError: '',
  };
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
  return {
    version: TARGET_RETENTION_VERSION,
    latest,
    pendingCleanup,
    lastReconciledAt: Math.max(0, Number(raw.lastReconciledAt || 0) || 0),
    lastObservedFileCount: Math.max(0, Number(raw.lastObservedFileCount || 0) || 0),
    lastReconcileError: String(raw.lastReconcileError || '').slice(0, 500),
  };
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

function uploadedAtFromEntry(entry: HostGroupFileEntry): number {
  const raw = Math.max(0, Number(entry.uploadTime || 0) || 0);
  if (!raw) return Date.now();
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

function recordFromEntry(
  entry: HostGroupFileEntry,
  targetGroupId: string,
  targetFolderId: string,
  details: Partial<Pick<TargetRetentionRecord, 'queuedAt' | 'attempts' | 'lastError'>> = {},
): TargetRetentionRecord {
  return {
    targetGroupId,
    targetFolderId,
    fileId: entry.fileId,
    fileName: safeTargetFileName(entry.fileName),
    uploadedAt: uploadedAtFromEntry(entry),
    ...details,
  };
}

async function listTargetFolder(
  hostProfile: HostProfile,
  targetGroupId: string,
  targetFolderId: string,
): Promise<HostGroupFileEntry[]> {
  const result = await hostProfile.listGroupFiles({
    groupId: targetGroupId,
    folderId: targetFolderId || '/',
  });
  if (result.state !== 'success' || !result.data) {
    throw new Error(`target_file_group_list_failed:${result.reason || result.state}`);
  }
  if (!result.data.complete) throw new Error('target_file_group_list_incomplete');

  const unique = new Map<string, HostGroupFileEntry>();
  for (const file of result.data.files) {
    if (file.fileId && !unique.has(file.fileId)) unique.set(file.fileId, file);
  }
  return [...unique.values()];
}

async function listUntilKeepVisible(
  hostProfile: HostProfile,
  targetGroupId: string,
  targetFolderId: string,
  keepFileId: string,
): Promise<HostGroupFileEntry[]> {
  let lastError = '';
  for (const delay of KEEP_VISIBILITY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    try {
      const files = await listTargetFolder(hostProfile, targetGroupId, targetFolderId);
      if (files.some(file => file.fileId === keepFileId)) return files;
      lastError = `target_file_latest_not_visible:${keepFileId}`;
    } catch (error) {
      lastError = String((error as Error)?.message || error);
    }
  }
  throw new Error(lastError || 'target_file_latest_not_visible');
}

async function deleteListedTargetFile(
  hostProfile: HostProfile,
  record: TargetRetentionRecord,
): Promise<{ deleted: boolean; error: string }> {
  try {
    const result = await hostProfile.deleteGroupFile({
      groupId: record.targetGroupId,
      fileId: record.fileId,
      folderId: record.targetFolderId || '/',
    });
    if (result.state === 'success' && result.data?.confirmed !== false) return { deleted: true, error: '' };
    const reason = String(result.reason || result.state || 'delete_unconfirmed');
    if (alreadyGoneReason(reason)) return { deleted: true, error: '' };
    return { deleted: false, error: reason.slice(0, 240) };
  } catch (error) {
    const reason = String((error as Error)?.message || error);
    if (alreadyGoneReason(reason)) return { deleted: true, error: '' };
    return { deleted: false, error: reason.slice(0, 240) };
  }
}

async function verifyReconciledFolder(
  hostProfile: HostProfile,
  targetGroupId: string,
  targetFolderId: string,
  keepFileId: string,
): Promise<HostGroupFileEntry[]> {
  let lastFiles: HostGroupFileEntry[] | null = null;
  let lastError = '';
  for (const delay of VERIFY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    try {
      const files = await listTargetFolder(hostProfile, targetGroupId, targetFolderId);
      lastFiles = files;
      const keepPresent = files.some(file => file.fileId === keepFileId);
      const leftovers = files.filter(file => file.fileId !== keepFileId);
      if (keepPresent && leftovers.length === 0) return files;
      lastError = keepPresent
        ? `target_file_reconcile_leftovers:${leftovers.length}`
        : `target_file_reconcile_latest_missing:${keepFileId}`;
    } catch (error) {
      lastError = String((error as Error)?.message || error);
    }
  }
  if (lastFiles) return lastFiles;
  throw new Error(lastError || 'target_file_reconcile_verify_failed');
}

async function reconcileExclusiveTargetFolder(
  hostProfile: HostProfile,
  state: TargetRetentionState,
  keep: TargetRetentionRecord,
  initialFiles: HostGroupFileEntry[],
  adoptedLatest: boolean,
): Promise<TargetRetentionReconcileResult> {
  const targetGroupId = keep.targetGroupId;
  const targetFolderId = keep.targetFolderId || '/';
  const keepPresent = initialFiles.some(file => file.fileId === keep.fileId);
  if (!keepPresent) {
    const error = `target_file_reconcile_latest_missing:${keep.fileId}`;
    state.lastReconciledAt = Date.now();
    state.lastObservedFileCount = initialFiles.length;
    state.lastReconcileError = error;
    return {
      ok: false,
      keptFileId: keep.fileId,
      keptFileName: keep.fileName,
      observedBefore: initialFiles.length,
      observedAfter: initialFiles.length,
      deletedCount: 0,
      leftoverCount: Math.max(0, initialFiles.length - 1),
      adoptedLatest,
      error,
    };
  }

  const unwanted = initialFiles.filter(file => file.fileId !== keep.fileId);
  state.pendingCleanup = unwanted.map(file => recordFromEntry(file, targetGroupId, targetFolderId, {
    queuedAt: Date.now(),
    attempts: 0,
    lastError: '',
  }));

  let issuedDeletes = 0;
  const deleteErrors = new Map<string, string>();
  for (const record of state.pendingCleanup) {
    const result = await deleteListedTargetFile(hostProfile, record);
    record.attempts = Math.max(0, Number(record.attempts || 0)) + 1;
    if (result.deleted) {
      issuedDeletes += 1;
      record.lastError = '';
    } else {
      record.lastError = result.error || 'target_file_delete_failed';
      deleteErrors.set(record.fileId, record.lastError);
    }
  }

  let after: HostGroupFileEntry[];
  try {
    after = await verifyReconciledFolder(hostProfile, targetGroupId, targetFolderId, keep.fileId);
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 500);
    state.lastReconciledAt = Date.now();
    state.lastObservedFileCount = initialFiles.length;
    state.lastReconcileError = message;
    return {
      ok: false,
      keptFileId: keep.fileId,
      keptFileName: keep.fileName,
      observedBefore: initialFiles.length,
      observedAfter: initialFiles.length,
      deletedCount: issuedDeletes,
      leftoverCount: state.pendingCleanup.length,
      adoptedLatest,
      error: message,
    };
  }

  const keepStillPresent = after.some(file => file.fileId === keep.fileId);
  const leftovers = after.filter(file => file.fileId !== keep.fileId);
  state.pendingCleanup = leftovers.map(file => recordFromEntry(file, targetGroupId, targetFolderId, {
    queuedAt: Date.now(),
    attempts: 1,
    lastError: deleteErrors.get(file.fileId) || 'target_file_delete_not_observed',
  }));
  state.lastReconciledAt = Date.now();
  state.lastObservedFileCount = after.length;

  let error = '';
  if (!keepStillPresent) error = `target_file_reconcile_latest_missing:${keep.fileId}`;
  else if (leftovers.length) error = `target_file_reconcile_leftovers:${leftovers.length}`;
  state.lastReconcileError = error;

  return {
    ok: !error,
    keptFileId: keep.fileId,
    keptFileName: keep.fileName,
    observedBefore: initialFiles.length,
    observedAfter: after.length,
    deletedCount: Math.max(0, initialFiles.length - after.length),
    leftoverCount: leftovers.length,
    adoptedLatest,
    error,
  };
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

export async function reconcileTargetFileRetention(options: {
  hostProfile: HostProfile;
  targetGroupId: string;
  targetFolderId: string;
  localPath: string;
}): Promise<TargetRetentionReconcileResult> {
  const statePath = resolveTargetFileRetentionStatePath(options.localPath);
  return serializedTargetRetention(statePath, async () => {
    const state = loadTargetRetentionState(statePath);
    const targetFolderId = options.targetFolderId || '/';
    const files = await listTargetFolder(options.hostProfile, options.targetGroupId, targetFolderId);

    if (!files.length) {
      state.latest = null;
      state.pendingCleanup = [];
      state.lastReconciledAt = Date.now();
      state.lastObservedFileCount = 0;
      state.lastReconcileError = '';
      saveTargetRetentionState(statePath, state);
      return {
        ok: true,
        keptFileId: '',
        keptFileName: '',
        observedBefore: 0,
        observedAfter: 0,
        deletedCount: 0,
        leftoverCount: 0,
        adoptedLatest: false,
        error: '',
      };
    }

    let adoptedLatest = false;
    let keepEntry: HostGroupFileEntry | undefined;
    if (state.latest
      && state.latest.targetGroupId === options.targetGroupId
      && state.latest.targetFolderId === targetFolderId) {
      keepEntry = files.find(file => file.fileId === state.latest?.fileId);
    }

    if (!keepEntry) {
      keepEntry = [...files].sort((a, b) => {
        const timeDiff = Number(b.uploadTime || 0) - Number(a.uploadTime || 0);
        if (timeDiff) return timeDiff;
        return b.fileId.localeCompare(a.fileId);
      })[0];
      adoptedLatest = true;
      state.latest = recordFromEntry(keepEntry, options.targetGroupId, targetFolderId);
    }

    const keep = state.latest as TargetRetentionRecord;
    const result = await reconcileExclusiveTargetFolder(options.hostProfile, state, keep, files, adoptedLatest);
    saveTargetRetentionState(statePath, state);
    return result;
  });
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

    // Safety invariant: never delete any group file before the replacement has
    // uploaded successfully and its file_id has been persisted as authoritative.
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
    saveTargetRetentionState(statePath, state);

    // The target directory is exclusive to this feature. Re-read the real QQ
    // directory, keep the just-uploaded file_id, delete every other file, then
    // re-list to verify the directory converged to exactly one file. Historical
    // pendingCleanup is only compatibility state; successful reconciliation is
    // always derived from the current server listing and replaces stale entries.
    try {
      const files = await listUntilKeepVisible(
        options.hostProfile,
        options.targetGroupId,
        options.targetFolderId || '/',
        uploaded.fileId,
      );
      await reconcileExclusiveTargetFolder(options.hostProfile, state, uploaded, files, false);
    } catch (error) {
      state.lastReconciledAt = Date.now();
      state.lastReconcileError = String((error as Error)?.message || error).slice(0, 500);
    }
    saveTargetRetentionState(statePath, state);
    return uploaded.fileId;
  });
}
