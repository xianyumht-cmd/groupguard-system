import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getBuildInfo } from '../build_info';

const REPOSITORY = 'xianyumht-cmd/groupguard-system';
const WORKFLOW_FILE = 'groupguard-build.yml';
const ARTIFACT_PREFIX = 'groupguard-self-update-';
const UPDATE_SCHEMA = 'groupguard-self-update.v1';
const TOKEN_FILE = 'github-actions-token.txt';
const STATE_FILE = 'update-state.json';
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 160 * 1024 * 1024;
export const SELF_UPDATE_RESTART_EXIT_CODE = 75;

type UpdateLogger = Pick<Console, 'info' | 'warn' | 'error'>;

type SelfUpdateState = {
  status?: string;
  phase?: string;
  message?: string;
  error?: string;
  currentCommit?: string;
  targetCommit?: string;
  workflowRunId?: number;
  artifactId?: number;
  artifactName?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  appRoot?: string;
  rollbackDir?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  rollbackAt?: string;
  cleanupError?: string;
};

type SelfUpdateConfig = {
  workDir: string;
  dataDir: string;
  logger?: UpdateLogger;
};

type UpdateManifest = {
  schema_version: string;
  commit_sha: string;
  created_at_utc?: string;
  files: Array<{ path: string; sha256: string; size: number }>;
};

type UpdateCandidate = {
  runId: number;
  commit: string;
  artifactId: number;
  artifactName: string;
  archiveDownloadUrl: string;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeCommit(value: unknown): string {
  const text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(text) ? text : '';
}

function safePathEntry(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new Error('self_update_archive_path_invalid');
  const pieces = normalized.split('/').filter(Boolean);
  if (!pieces.length || pieces.some((piece) => piece === '.' || piece === '..')) throw new Error('self_update_archive_path_invalid');
  return pieces.join('/');
}

function sha256Buffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function listRegularFiles(rootDir: string): string[] {
  const root = path.resolve(rootDir);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('self_update_candidate_symlink_rejected');
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) throw new Error('self_update_candidate_entry_invalid');
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

function isManagedRuntimeEntry(workDir: string): boolean {
  const rawEntry = String(process.argv[1] || '').trim();
  if (!rawEntry) return false;
  return path.resolve(rawEntry) === path.join(path.resolve(workDir), 'dist', 'snowluma-service.mjs');
}

function removeOwnedUpdateDir(workDir: string, candidate: string, prefix: string): void {
  const appRoot = path.resolve(workDir);
  const target = path.resolve(candidate);
  if (!target.startsWith(`${appRoot}${path.sep}${prefix}`)) throw new Error('self_update_cleanup_path_guard');
  fs.rmSync(target, { recursive: true, force: true });
}

function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dirPath, 0o700); } catch { /* best effort */ }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensurePrivateDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
}

function readJsonObject(filePath: string): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveDataDir(): string {
  return path.resolve(process.env.GROUPGUARD_DATA_DIR || path.join(process.cwd(), 'data'));
}

function statePathFor(dataDir: string): string {
  return path.join(dataDir, 'self-update', STATE_FILE);
}

function tokenPathFor(dataDir: string): string {
  return path.join(dataDir, 'self-update', TOKEN_FILE);
}

function readToken(dataDir: string): { token: string; source: 'environment' | 'file' | 'none' } {
  const envToken = String(process.env.GROUPGUARD_UPDATE_GITHUB_TOKEN || '').trim();
  if (envToken) return { token: envToken, source: 'environment' };
  try {
    const token = fs.readFileSync(tokenPathFor(dataDir), 'utf-8').trim();
    if (token) return { token, source: 'file' };
  } catch { /* no token file */ }
  return { token: '', source: 'none' };
}

function updateState(dataDir: string, patch: Partial<SelfUpdateState>): SelfUpdateState {
  const filePath = statePathFor(dataDir);
  const current = readJsonObject(filePath) as SelfUpdateState;
  const next = { ...current, ...patch, updatedAt: nowIso() };
  writeJsonAtomic(filePath, next);
  return next;
}

async function githubJson(url: string, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'GroupGuard-Self-Updater/1',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 404 && !token) throw new Error('private_repository_update_token_required');
  if (!response.ok) throw new Error(`github_api_http_${response.status}`);
  return response.json();
}

async function findLatestCandidate(token: string): Promise<UpdateCandidate> {
  const runsUrl = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&event=push&status=success&per_page=10`;
  const runsPayload = await githubJson(runsUrl, token);
  const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
  for (const run of runs) {
    const runId = Number(run?.id || 0);
    const commit = safeCommit(run?.head_sha);
    if (!runId || !commit) continue;
    const artifactsPayload = await githubJson(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100`, token);
    const artifacts = Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [];
    const wantedName = `${ARTIFACT_PREFIX}${commit}`;
    const artifact = artifacts.find((item: any) => item?.expired !== true && String(item?.name || '') === wantedName);
    if (!artifact) continue;
    const artifactId = Number(artifact.id || 0);
    const archiveDownloadUrl = String(artifact.archive_download_url || '').trim();
    if (!artifactId || !archiveDownloadUrl.startsWith(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts/`)) continue;
    return {
      runId,
      commit,
      artifactId,
      artifactName: wantedName,
      archiveDownloadUrl,
      createdAt: String(run.created_at || ''),
    };
  }
  throw new Error('self_update_artifact_not_found_on_recent_main_builds');
}

async function downloadArtifact(candidate: UpdateCandidate, token: string, onProgress: (received: number, total: number) => void): Promise<Buffer> {
  // GitHub's Actions artifact endpoint is a JSON REST endpoint that returns a
  // short-lived 302 download URL. Request that redirect explicitly, then fetch
  // the signed URL without forwarding the repository token across origins.
  const redirectResponse = await fetch(candidate.archiveDownloadUrl, {
    redirect: 'manual',
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'GroupGuard-Self-Updater/1',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (redirectResponse.status !== 302) {
    throw new Error(`self_update_artifact_http_${redirectResponse.status}`);
  }
  const location = String(redirectResponse.headers.get('location') || '').trim();
  if (!location) throw new Error('self_update_artifact_redirect_missing');
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(location, candidate.archiveDownloadUrl);
  } catch {
    throw new Error('self_update_artifact_redirect_invalid');
  }
  if (downloadUrl.protocol !== 'https:') throw new Error('self_update_artifact_redirect_insecure');

  const response = await fetch(downloadUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': 'GroupGuard-Self-Updater/1',
    },
  });
  if (!response.ok) throw new Error(`self_update_artifact_http_${response.status}`);
  const total = Number(response.headers.get('content-length') || 0);
  if (total > MAX_ARCHIVE_BYTES) throw new Error('self_update_artifact_too_large');
  if (!response.body) throw new Error('self_update_artifact_empty');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    received += value.byteLength;
    if (received > MAX_ARCHIVE_BYTES) throw new Error('self_update_artifact_too_large');
    chunks.push(Buffer.from(value));
    onProgress(received, total);
  }
  if (!received) throw new Error('self_update_artifact_empty');
  return Buffer.concat(chunks, received);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('self_update_zip_eocd_missing');
}

function extractArtifactZip(buffer: Buffer, destination: string): void {
  const eocd = findEndOfCentralDirectory(buffer);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > 20_000 || centralOffset + centralSize > buffer.length) throw new Error('self_update_zip_central_directory_invalid');
  let offset = centralOffset;
  let extractedTotal = 0;
  ensurePrivateDir(destination);
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('self_update_zip_entry_invalid');
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');
    offset += 46 + nameLength + extraLength + commentLength;
    const directory = rawName.endsWith('/');
    const name = safePathEntry(rawName);
    if (directory) continue;
    if (name !== 'manifest.json' && !name.startsWith('dist/')) throw new Error('self_update_zip_unexpected_entry');
    const unixType = (externalAttributes >>> 16) & 0o170000;
    if (unixType === 0o120000) throw new Error('self_update_zip_symlink_rejected');
    if (uncompressedSize > MAX_FILE_BYTES) throw new Error('self_update_zip_file_too_large');
    extractedTotal += uncompressedSize;
    if (extractedTotal > MAX_EXTRACTED_BYTES) throw new Error('self_update_zip_expanded_too_large');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('self_update_zip_local_header_invalid');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('self_update_zip_data_truncated');
    const compressed = buffer.subarray(dataStart, dataEnd);
    let content: Buffer;
    if (compression === 0) content = Buffer.from(compressed);
    else if (compression === 8) content = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_FILE_BYTES });
    else throw new Error('self_update_zip_compression_unsupported');
    if (content.length !== uncompressedSize) throw new Error('self_update_zip_size_mismatch');
    const output = path.resolve(destination, name);
    const root = `${path.resolve(destination)}${path.sep}`;
    if (!output.startsWith(root)) throw new Error('self_update_zip_path_escape');
    ensurePrivateDir(path.dirname(output));
    fs.writeFileSync(output, content, { mode: 0o600 });
  }
}

function validateManifest(stagingRoot: string, expectedCommit: string): UpdateManifest {
  const manifestPath = path.join(stagingRoot, 'manifest.json');
  const raw = readJsonObject(manifestPath) as Partial<UpdateManifest>;
  if (raw.schema_version !== UPDATE_SCHEMA) throw new Error('self_update_manifest_schema_invalid');
  const commit = safeCommit(raw.commit_sha);
  if (!commit || commit !== expectedCommit) throw new Error('self_update_manifest_commit_mismatch');
  if (!Array.isArray(raw.files) || !raw.files.length) throw new Error('self_update_manifest_files_missing');
  const seen = new Set<string>();
  for (const item of raw.files) {
    const relative = safePathEntry(String(item?.path || ''));
    if (!relative.startsWith('dist/')) throw new Error('self_update_manifest_path_invalid');
    if (seen.has(relative)) throw new Error('self_update_manifest_duplicate_path');
    seen.add(relative);
    const expectedHash = String(item?.sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('self_update_manifest_hash_invalid');
    const expectedSize = Number(item?.size);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_FILE_BYTES) throw new Error('self_update_manifest_size_invalid');
    const filePath = path.resolve(stagingRoot, relative);
    if (!filePath.startsWith(`${path.resolve(stagingRoot)}${path.sep}`) || !fs.statSync(filePath).isFile()) throw new Error('self_update_manifest_file_missing');
    if (fs.statSync(filePath).size !== expectedSize) throw new Error('self_update_manifest_file_size_mismatch');
    if (sha256File(filePath) !== expectedHash) throw new Error('self_update_manifest_file_hash_mismatch');
  }
  const distRoot = path.join(stagingRoot, 'dist');
  if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) throw new Error('self_update_candidate_layout_invalid');
  const actualFiles = listRegularFiles(distRoot).map(relative => `dist/${relative}`);
  const manifestFiles = Array.from(seen).sort();
  if (actualFiles.length !== manifestFiles.length || actualFiles.some((item, index) => item !== manifestFiles[index])) {
    throw new Error('self_update_manifest_file_set_mismatch');
  }
  const requiredEntry = path.join(stagingRoot, 'dist', 'snowluma-service.mjs');
  const buildInfoPath = path.join(stagingRoot, 'dist', 'build-info.json');
  if (!fs.existsSync(requiredEntry) || !fs.existsSync(buildInfoPath)) throw new Error('self_update_candidate_layout_invalid');
  const buildInfo = readJsonObject(buildInfoPath);
  if (safeCommit(buildInfo.commit_sha) !== expectedCommit || buildInfo.dirty === true) throw new Error('self_update_candidate_build_info_invalid');
  return raw as UpdateManifest;
}

class SelfUpdateService {
  private config: SelfUpdateConfig | null = null;
  private active: Promise<void> | null = null;
  private lastProgressWrite = 0;

  configure(config: SelfUpdateConfig): void {
    this.config = { ...config, workDir: path.resolve(config.workDir), dataDir: path.resolve(config.dataDir) };
    ensurePrivateDir(path.join(this.config.dataDir, 'self-update'));
  }

  private requireConfig(): SelfUpdateConfig {
    if (!this.config) throw new Error('self_update_service_not_configured');
    return this.config;
  }

  saveToken(token: string): { ok: true; configured: boolean; source: string } {
    const { dataDir } = this.requireConfig();
    const value = String(token || '').trim();
    const filePath = tokenPathFor(dataDir);
    ensurePrivateDir(path.dirname(filePath));
    if (!value) {
      try { fs.rmSync(filePath, { force: true }); } catch { /* noop */ }
      const current = readToken(dataDir);
      return { ok: true, configured: Boolean(current.token), source: current.source };
    }
    if (value.length < 20 || value.length > 512 || /\s/.test(value)) throw new Error('self_update_token_invalid');
    const temp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${value}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
    return { ok: true, configured: true, source: 'file' };
  }

  async getStatus(refresh = false): Promise<Record<string, any>> {
    const { dataDir, workDir } = this.requireConfig();
    const tokenInfo = readToken(dataDir);
    const current = getBuildInfo();
    const state = readJsonObject(statePathFor(dataDir));
    const base: Record<string, any> = {
      ok: true,
      repository: REPOSITORY,
      workflow: WORKFLOW_FILE,
      currentCommit: String(current.commit_sha || 'unknown'),
      currentVersion: String(current.version || 'unknown'),
      tokenConfigured: Boolean(tokenInfo.token),
      tokenSource: tokenInfo.source,
      busy: Boolean(this.active),
      writable: this.isAppWritable(workDir),
      managedRuntime: isManagedRuntimeEntry(workDir),
      state,
    };
    if (!refresh) return base;
    try {
      const candidate = await findLatestCandidate(tokenInfo.token);
      return { ...base, latest: candidate, updateAvailable: safeCommit(current.commit_sha) !== candidate.commit };
    } catch (error) {
      return { ...base, latestError: String((error as Error)?.message || error), updateAvailable: false };
    }
  }

  startUpdate(): { ok: true; accepted: boolean; state: SelfUpdateState } {
    const { dataDir } = this.requireConfig();
    if (this.active) return { ok: true, accepted: false, state: readJsonObject(statePathFor(dataDir)) as SelfUpdateState };
    const state = updateState(dataDir, {
      status: 'queued', phase: 'queued', message: '更新任务已进入队列。', error: '', startedAt: nowIso(), completedAt: '', rollbackAt: ''
    });
    this.active = this.performUpdate().finally(() => { this.active = null; });
    return { ok: true, accepted: true, state };
  }

  private isAppWritable(workDir: string): boolean {
    try {
      fs.accessSync(workDir, fs.constants.W_OK);
      return fs.statSync(workDir).isDirectory();
    } catch {
      return false;
    }
  }

  private assertAppWriteProbe(workDir: string): void {
    const probe = path.join(workDir, `.groupguard-update-write-probe-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'ok', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    } catch {
      throw new Error('self_update_app_root_not_writable');
    } finally {
      try { fs.rmSync(probe, { force: true }); } catch { /* best effort */ }
    }
  }

  private async performUpdate(): Promise<void> {
    const config = this.requireConfig();
    const { workDir, dataDir, logger = console } = config;
    const current = safeCommit(getBuildInfo().commit_sha);
    const tokenInfo = readToken(dataDir);
    let stageRoot = '';
    try {
      if (!isManagedRuntimeEntry(workDir)) throw new Error('self_update_runtime_entry_outside_managed_dist');
      this.assertAppWriteProbe(workDir);
      updateState(dataDir, { status: 'running', phase: 'discovering', message: '正在查找 main 最近成功构建。', currentCommit: current || 'unknown' });
      const candidate = await findLatestCandidate(tokenInfo.token);
      if (candidate.commit === current) {
        updateState(dataDir, { status: 'current', phase: 'complete', message: '当前已经是最新成功构建。', targetCommit: candidate.commit, completedAt: nowIso(), error: '' });
        return;
      }
      updateState(dataDir, {
        status: 'downloading', phase: 'downloading', message: '正在下载预编译更新包。', targetCommit: candidate.commit,
        workflowRunId: candidate.runId, artifactId: candidate.artifactId, artifactName: candidate.artifactName, downloadedBytes: 0, totalBytes: 0,
      });
      const archive = await downloadArtifact(candidate, tokenInfo.token, (received, total) => {
        const now = Date.now();
        if (now - this.lastProgressWrite < 500 && received !== total) return;
        this.lastProgressWrite = now;
        updateState(dataDir, { downloadedBytes: received, totalBytes: total });
      });
      updateState(dataDir, { status: 'running', phase: 'extracting', message: '正在解压并校验候选构建。', downloadedBytes: archive.length, totalBytes: archive.length });
      stageRoot = path.join(workDir, `.groupguard-update-stage-${candidate.commit.slice(0, 12)}-${Date.now()}`);
      fs.rmSync(stageRoot, { recursive: true, force: true });
      extractArtifactZip(archive, stageRoot);
      updateState(dataDir, { phase: 'verifying', message: '正在验证构建提交与文件哈希。' });
      validateManifest(stageRoot, candidate.commit);
      const distDir = path.join(workDir, 'dist');
      const stageDist = path.join(stageRoot, 'dist');
      if (!fs.existsSync(path.join(distDir, 'snowluma-service.mjs'))) throw new Error('self_update_current_dist_invalid');
      const rollbackDir = path.join(workDir, `.groupguard-update-rollback-${candidate.commit.slice(0, 12)}-${Date.now()}`);
      updateState(dataDir, { phase: 'switching', message: '候选校验通过，正在原子切换 dist。', appRoot: workDir, rollbackDir });
      fs.renameSync(distDir, rollbackDir);
      try {
        fs.renameSync(stageDist, distDir);
      } catch (error) {
        fs.renameSync(rollbackDir, distDir);
        throw error;
      } finally {
        fs.rmSync(stageRoot, { recursive: true, force: true });
        stageRoot = '';
      }
      updateState(dataDir, { status: 'restarting', phase: 'restarting', message: 'dist 已切换，正在由 GroupGuard supervisor 拉起新版本。', appRoot: workDir, rollbackDir, targetCommit: candidate.commit, error: '', cleanupError: '' });
      logger.info(`[GroupGuard:SelfUpdate] switched dist target=${candidate.commit}; requesting supervised restart`);
      setTimeout(() => process.exit(SELF_UPDATE_RESTART_EXIT_CODE), 700).unref();
    } catch (error) {
      if (stageRoot) {
        try { removeOwnedUpdateDir(workDir, stageRoot, '.groupguard-update-stage-'); } catch { /* guarded best effort */ }
      }
      const message = String((error as Error)?.message || error).slice(0, 500);
      logger.error(`[GroupGuard:SelfUpdate] failed: ${message}`);
      updateState(dataDir, { status: 'failed', phase: 'failed', message: '更新失败，当前运行版本未被确认替换。', error: message });
    }
  }
}

export const selfUpdateService = new SelfUpdateService();

export function getSupervisorUpdateState(): SelfUpdateState {
  return readJsonObject(statePathFor(resolveDataDir())) as SelfUpdateState;
}

export function markSupervisorUpdateComplete(commit: string): void {
  const dataDir = resolveDataDir();
  const state = getSupervisorUpdateState();
  const expected = safeCommit(state.targetCommit);
  const actual = safeCommit(commit);
  if (!expected || actual !== expected) throw new Error('self_update_restart_commit_mismatch');
  const expectedAppRoot = path.resolve(process.cwd());
  const appRoot = path.resolve(String(state.appRoot || ''));
  let rollbackDir = String(state.rollbackDir || '');
  let cleanupError = '';
  if (rollbackDir) {
    if (appRoot !== expectedAppRoot) {
      cleanupError = 'self_update_rollback_cleanup_app_root_mismatch';
    } else {
      try {
        removeOwnedUpdateDir(appRoot, rollbackDir, '.groupguard-update-rollback-');
        rollbackDir = '';
      } catch (error) {
        cleanupError = String((error as Error)?.message || error).slice(0, 300);
      }
    }
  }
  updateState(dataDir, {
    status: 'complete', phase: 'complete', message: cleanupError ? '新版本已启动；旧版本目录清理失败，可稍后人工清理。' : '新版本已启动并通过提交校验。',
    completedAt: nowIso(), error: '', rollbackDir, cleanupError
  });
}

export function rollbackPendingSelfUpdate(reason: string): boolean {
  const dataDir = resolveDataDir();
  const state = getSupervisorUpdateState();
  const appRoot = path.resolve(String(state.appRoot || ''));
  const rollbackDir = path.resolve(String(state.rollbackDir || ''));
  const expectedAppRoot = path.resolve(process.cwd());
  if (!appRoot || appRoot !== expectedAppRoot) return false;
  if (!rollbackDir.startsWith(`${appRoot}${path.sep}.groupguard-update-rollback-`)) return false;
  const distDir = path.join(appRoot, 'dist');
  if (!fs.existsSync(rollbackDir) || !fs.existsSync(path.join(rollbackDir, 'snowluma-service.mjs'))) return false;
  const failedDir = path.join(appRoot, `.groupguard-update-failed-${Date.now()}`);
  try {
    if (fs.existsSync(distDir)) fs.renameSync(distDir, failedDir);
    fs.renameSync(rollbackDir, distDir);
    fs.rmSync(failedDir, { recursive: true, force: true });
    updateState(dataDir, { status: 'rolled_back', phase: 'rolled_back', message: '新版本启动失败，已自动恢复上一版 dist。', rollbackAt: nowIso(), error: String(reason || 'restart_failed').slice(0, 500), rollbackDir: '', cleanupError: '' });
    return true;
  } catch (error) {
    updateState(dataDir, { status: 'rollback_failed', phase: 'rollback_failed', message: '自动回滚失败，需要人工处理。', rollbackAt: nowIso(), error: String((error as Error)?.message || error).slice(0, 500) });
    return false;
  }
}
