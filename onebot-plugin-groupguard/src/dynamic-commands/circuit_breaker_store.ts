import { promises as fs } from 'fs';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';
import type { DynamicCommandCircuitBreakerSnapshot } from './types';

const CIRCUIT_BREAKER_STORE_PATH = path.resolve(process.cwd(), 'data', 'dynamic-command-circuit-breakers.json');
const CIRCUIT_BREAKER_STORE_BACKUP_PATH = `${CIRCUIT_BREAKER_STORE_PATH}.bak`;
const CIRCUIT_BREAKER_STORE_TEMP_PATH = `${CIRCUIT_BREAKER_STORE_PATH}.tmp`;

let initialized = false;
let initializePromise: Promise<void> | null = null;
let writePromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const persistedStates = new Map<string, DynamicCommandCircuitBreakerSnapshot>();

async function readSnapshotFile(filePath: string): Promise<Record<string, DynamicCommandCircuitBreakerSnapshot> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, DynamicCommandCircuitBreakerSnapshot>;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      loggingStateService.warn(`[DynamicCommandCircuitStore] read failed path=${filePath} error=${error}`);
    }
    return null;
  }
}

async function loadLastValidSnapshot(): Promise<void> {
  const primary = await readSnapshotFile(CIRCUIT_BREAKER_STORE_PATH);
  const backup = await readSnapshotFile(CIRCUIT_BREAKER_STORE_BACKUP_PATH);
  const source = primary || backup || {};
  for (const [commandId, snapshot] of Object.entries(source)) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    persistedStates.set(commandId, snapshot);
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
  const payload = JSON.stringify(Object.fromEntries(persistedStates.entries()), null, 2);
  try {
    await fs.mkdir(path.dirname(CIRCUIT_BREAKER_STORE_PATH), { recursive: true });
    try {
      await fs.copyFile(CIRCUIT_BREAKER_STORE_PATH, CIRCUIT_BREAKER_STORE_BACKUP_PATH);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        loggingStateService.warn(`[DynamicCommandCircuitStore] backup failed: ${error}`);
      }
    }
    await fs.writeFile(CIRCUIT_BREAKER_STORE_TEMP_PATH, payload, 'utf8');
    await fs.rename(CIRCUIT_BREAKER_STORE_TEMP_PATH, CIRCUIT_BREAKER_STORE_PATH);
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandCircuitStore] flush failed: ${error}`);
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAllCircuitBreakerStates();
  }, 500);
}

export async function initializeCircuitBreakerStore(): Promise<void> {
  await ensureInitialized();
}

export async function saveCircuitBreakerState(commandId: string, snapshot: DynamicCommandCircuitBreakerSnapshot): Promise<void> {
  try {
    await ensureInitialized();
    persistedStates.set(commandId, snapshot);
    scheduleFlush();
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandCircuitStore] save failed: ${error}`);
  }
}

export async function loadCircuitBreakerState(commandId: string): Promise<DynamicCommandCircuitBreakerSnapshot | null> {
  try {
    await ensureInitialized();
    return persistedStates.get(commandId) || null;
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandCircuitStore] load failed: ${error}`);
    return null;
  }
}

export async function loadAllCircuitBreakerStates(): Promise<Record<string, DynamicCommandCircuitBreakerSnapshot>> {
  await ensureInitialized();
  return Object.fromEntries(persistedStates.entries());
}

export async function flushAllCircuitBreakerStates(): Promise<void> {
  if (writePromise) return writePromise;
  writePromise = (async () => {
    await flushNow();
    writePromise = null;
  })();
  await writePromise;
}
