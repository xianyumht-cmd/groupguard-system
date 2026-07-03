import { getCompatibleFetch } from '../dynamic-commands/fetch_compat';
import { configStateService } from '../core/state-services/config_state_service';

export interface EleBuildProgress {
  status: string;
  queuePosition?: number;
  estimatedWaitTime?: number;
  currentStep?: string;
  shareUrl?: string;
  fromCache?: boolean;
}

export interface EleBuildResult {
  jobId: string;
  shareUrl: string;
  fromCache: boolean;
}

interface EleApiEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
}

interface EleActiveBuildData {
  jobId?: string;
  status?: string;
  queuePosition?: number;
  estimatedWaitTime?: number;
  currentStep?: string;
  shareUrl?: string;
  fromCache?: boolean;
}

interface EleStartBuildData extends EleActiveBuildData {
  jobId: string;
}

export const ELE_CARD_KEY_PATTERN = /^[a-fA-F0-9]{32}$/;

const DEFAULT_API_BASE_URL = 'http://www.ele00001.cc.cd/api';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_WAIT_MS = 150_000;
const REQUEST_TIMEOUT_MS = 15_000;

function getApiBaseUrl(): string {
  const configured = String(configStateService.getConfig().eleBuildApiBaseUrl || '').trim();
  return String(configured || process.env.ELE_BUILD_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

export function maskEleCardKey(cardKey: string): string {
  const normalized = cardKey.trim().toLowerCase();
  if (normalized.length <= 12) return '***';
  return `${normalized.slice(0, 6)}...${normalized.slice(-6)}`;
}

export function normalizeEleCardKey(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEleCardKey(cardKey: string): boolean {
  return ELE_CARD_KEY_PATTERN.test(cardKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseActiveBuildData(value: unknown): EleActiveBuildData | null {
  if (!isRecord(value)) return null;
  return {
    jobId: toStringValue(value.jobId),
    status: toStringValue(value.status),
    queuePosition: toNumber(value.queuePosition),
    estimatedWaitTime: toNumber(value.estimatedWaitTime),
    currentStep: toStringValue(value.currentStep),
    shareUrl: toStringValue(value.shareUrl),
    fromCache: value.fromCache === true
  };
}

function parseStartBuildData(value: unknown): EleStartBuildData {
  const parsed = parseActiveBuildData(value);
  if (!parsed?.jobId) {
    throw new Error('服务器未返回任务编号');
  }
  return {
    ...parsed,
    jobId: parsed.jobId
  };
}

async function parseEnvelope(response: Response): Promise<EleApiEnvelope> {
  try {
    return await response.json() as EleApiEnvelope;
  } catch {
    throw new Error('服务器响应解析失败');
  }
}

async function requestJson(pathname: string, init?: RequestInit): Promise<{ response: Response; envelope: EleApiEnvelope; }> {
  const fetch = await getCompatibleFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
      ...init,
      signal: controller.signal
    });
    const envelope = await parseEnvelope(response);
    return { response, envelope };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('请求网站超时，请稍后再试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertApiOk(response: Response, envelope: EleApiEnvelope): void {
  if (response.ok && envelope.code === 0) return;
  if (response.status === 429 && isRecord(envelope.data) && typeof envelope.data.retryAfter === 'number') {
    throw new Error(`下载过于频繁，请 ${envelope.data.retryAfter} 秒后再试`);
  }
  throw new Error(envelope.message || `提交失败（HTTP ${response.status}）`);
}

async function getActiveBuild(cardKey: string): Promise<EleActiveBuildData | null> {
  const { response, envelope } = await requestJson(`/build/active/${encodeURIComponent(cardKey)}`);
  assertApiOk(response, envelope);
  return parseActiveBuildData(envelope.data);
}

async function startBuild(cardKey: string): Promise<EleStartBuildData> {
  const { response, envelope } = await requestJson('/build', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ card_key: cardKey })
  });
  assertApiOk(response, envelope);
  return parseStartBuildData(envelope.data);
}

async function getBuildStatus(jobId: string): Promise<EleBuildProgress> {
  const { response, envelope } = await requestJson(`/build/status/${encodeURIComponent(jobId)}`);
  assertApiOk(response, envelope);
  const data = parseActiveBuildData(envelope.data);
  if (!data?.status) {
    throw new Error('服务器未返回任务状态');
  }
  return {
    status: data.status,
    queuePosition: data.queuePosition,
    estimatedWaitTime: data.estimatedWaitTime,
    currentStep: data.currentStep,
    shareUrl: data.shareUrl
  };
}

function ensureSuccessfulResult(jobId: string, progress: EleActiveBuildData): EleBuildResult | null {
  if (progress.status !== 'success') return null;
  if (!progress.shareUrl) {
    throw new Error('构建完成但未返回分享链接');
  }
  return {
    jobId,
    shareUrl: progress.shareUrl,
    fromCache: progress.fromCache === true
  };
}

async function waitForBuild(jobId: string, options?: {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  onProgress?: (progress: EleBuildProgress) => void;
}): Promise<EleBuildResult> {
  const maxWaitMs = options?.maxWaitMs || DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = options?.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const deadlineAt = Date.now() + maxWaitMs;

  while (Date.now() < deadlineAt) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const progress = await getBuildStatus(jobId);
    options?.onProgress?.(progress);
    const result = ensureSuccessfulResult(jobId, progress);
    if (result) return result;
    if (progress.status === 'failed' || progress.status === 'timeout') {
      throw new Error('构建失败，请稍后重试或联系管理员');
    }
  }

  throw new Error('生成等待超时，请稍后重新查询或重试');
}

export async function buildEleShareLink(cardKey: string, options?: {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  onProgress?: (progress: EleBuildProgress) => void;
}): Promise<EleBuildResult> {
  const normalizedCardKey = normalizeEleCardKey(cardKey);
  if (!isValidEleCardKey(normalizedCardKey)) {
    throw new Error('卡密格式无效（需 32 位十六进制字符）');
  }

  const active = await getActiveBuild(normalizedCardKey);
  if (active?.jobId) {
    const activeResult = ensureSuccessfulResult(active.jobId, active);
    if (activeResult) return activeResult;
    if (active.status === 'failed' || active.status === 'timeout') {
      throw new Error('之前的构建任务已失败，请重试');
    }
    return waitForBuild(active.jobId, options);
  }

  const started = await startBuild(normalizedCardKey);
  const immediateResult = ensureSuccessfulResult(started.jobId, started);
  if (immediateResult) return immediateResult;
  return waitForBuild(started.jobId, options);
}
