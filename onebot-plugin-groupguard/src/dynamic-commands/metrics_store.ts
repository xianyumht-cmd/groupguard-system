import { promises as fs } from 'fs';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';
import type { DynamicCommandMetricSnapshot } from './types';

const METRICS_STORE_PATH = path.resolve(process.cwd(), 'data', 'dynamic-command-metrics.json');
const METRICS_STORE_BACKUP_PATH = `${METRICS_STORE_PATH}.bak`;
const METRICS_STORE_TEMP_PATH = `${METRICS_STORE_PATH}.tmp`;

let initialized = false;
let initializePromise: Promise<void> | null = null;
let writePromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const persistedMetrics = new Map<string, DynamicCommandMetricSnapshot>();

async function readSnapshotFile(filePath: string): Promise<Record<string, DynamicCommandMetricSnapshot> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, DynamicCommandMetricSnapshot>;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      loggingStateService.warn(`[DynamicCommandMetricsStore] read failed path=${filePath} error=${error}`);
    }
    return null;
  }
}

async function loadLastValidSnapshot(): Promise<void> {
  const primary = await readSnapshotFile(METRICS_STORE_PATH);
  const backup = await readSnapshotFile(METRICS_STORE_BACKUP_PATH);
  const source = primary || backup || {};
  for (const [commandId, metric] of Object.entries(source)) {
    if (!metric || typeof metric !== 'object') continue;
    persistedMetrics.set(commandId, metric);
  }
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        await loadLastValidSnapshot();
      } finally {
        initialized = true;
        initializePromise = null;
      }
    })();
  }
  await initializePromise;
}

async function flushNow(): Promise<void> {
  await ensureInitialized();
  const payload = Object.fromEntries(persistedMetrics.entries());
  try {
    await fs.mkdir(path.dirname(METRICS_STORE_PATH), { recursive: true });
    try {
      await fs.copyFile(METRICS_STORE_PATH, METRICS_STORE_BACKUP_PATH);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        loggingStateService.warn(`[DynamicCommandMetricsStore] backup failed: ${error}`);
      }
    }
    await fs.writeFile(METRICS_STORE_TEMP_PATH, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(METRICS_STORE_TEMP_PATH, METRICS_STORE_PATH);
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandMetricsStore] flush failed: ${error}`);
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAllMetrics();
  }, 500);
}

export async function initializeMetricsStore(): Promise<void> {
  await ensureInitialized();
}

export async function saveMetrics(commandId: string, metrics: DynamicCommandMetricSnapshot): Promise<void> {
  try {
    await ensureInitialized();
    persistedMetrics.set(commandId, metrics);
    scheduleFlush();
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandMetricsStore] save failed: ${error}`);
  }
}

export async function loadMetrics(commandId: string): Promise<DynamicCommandMetricSnapshot | null> {
  try {
    await ensureInitialized();
    return persistedMetrics.get(commandId) || null;
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandMetricsStore] loadMetrics failed: ${error}`);
    return null;
  }
}

export async function loadAllMetrics(): Promise<Record<string, DynamicCommandMetricSnapshot>> {
  await ensureInitialized();
  return Object.fromEntries(persistedMetrics.entries());
}

export async function flushAllMetrics(): Promise<void> {
  if (writePromise) return writePromise;
  writePromise = (async () => {
    await flushNow();
    writePromise = null;
  })();
  await writePromise;
}
