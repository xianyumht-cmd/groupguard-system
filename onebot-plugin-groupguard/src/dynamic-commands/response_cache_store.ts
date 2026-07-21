import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';

const RESPONSE_CACHE_STORE_PATH = path.resolve(process.cwd(), 'data', 'dynamic-command-response-cache.json');
const RESPONSE_CACHE_STORE_BACKUP_PATH = `${RESPONSE_CACHE_STORE_PATH}.bak`;
const RESPONSE_CACHE_STORE_TEMP_PATH = `${RESPONSE_CACHE_STORE_PATH}.tmp`;

let initialized = false;
let initializePromise: Promise<void> | null = null;
let writePromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const persistedResponses = new Map<string, string>();
const MAX_CACHE_ENTRIES = 500;

export function buildResponseCacheKey(commandId: string, input: { rawArgument?: string; mappedParameters?: Record<string, string>; }): string {
  const hash = createHash('sha1')
    .update(JSON.stringify({
      rawArgument: input.rawArgument || '',
      mappedParameters: input.mappedParameters || {}
    }))
    .digest('hex');
  return `${commandId}:${hash}`;
}

function isScopedCacheKey(key: string): boolean {
  return key.includes(':');
}

async function readSnapshotFile(filePath: string): Promise<Record<string, string> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      loggingStateService.warn(`[DynamicCommandResponseCache] read failed path=${filePath} error=${error}`);
    }
    return null;
  }
}

async function loadLastValidSnapshot(): Promise<void> {
  const primary = await readSnapshotFile(RESPONSE_CACHE_STORE_PATH);
  const backup = await readSnapshotFile(RESPONSE_CACHE_STORE_BACKUP_PATH);
  const source = primary || backup || {};
  for (const [cacheKey, responseText] of Object.entries(source)) {
    if (typeof responseText !== 'string') continue;
    if (!isScopedCacheKey(cacheKey)) {
      loggingStateService.warn(`[DynamicCommandResponseCache] ignoring legacy unscoped cache key: ${cacheKey}`);
      continue;
    }
    persistedResponses.set(cacheKey, responseText);
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
  try {
    await fs.mkdir(path.dirname(RESPONSE_CACHE_STORE_PATH), { recursive: true });
    try {
      await fs.copyFile(RESPONSE_CACHE_STORE_PATH, RESPONSE_CACHE_STORE_BACKUP_PATH);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        loggingStateService.warn(`[DynamicCommandResponseCache] backup failed: ${error}`);
      }
    }
    await fs.writeFile(
      RESPONSE_CACHE_STORE_TEMP_PATH,
      JSON.stringify(Object.fromEntries(persistedResponses.entries()), null, 2),
      'utf8'
    );
    await fs.rename(RESPONSE_CACHE_STORE_TEMP_PATH, RESPONSE_CACHE_STORE_PATH);
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandResponseCache] flush failed: ${error}`);
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAllCachedResponses();
  }, 500);
}

export async function initializeResponseCacheStore(): Promise<void> {
  await ensureInitialized();
}

export async function saveLastSuccessfulResponse(commandId: string, responseText: string): Promise<void> {
  try {
    await ensureInitialized();
    persistedResponses.set(commandId, responseText);
    if (persistedResponses.size > MAX_CACHE_ENTRIES) {
      const keys = Array.from(persistedResponses.keys());
      for (let i = 0; i < keys.length - MAX_CACHE_ENTRIES; i += 1) {
        persistedResponses.delete(keys[i]);
      }
    }
    scheduleFlush();
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandResponseCache] save failed: ${error}`);
  }
}

export async function loadLastSuccessfulResponse(commandId: string): Promise<string | null> {
  try {
    await ensureInitialized();
    return persistedResponses.get(commandId) || null;
  } catch (error) {
    loggingStateService.warn(`[DynamicCommandResponseCache] load failed: ${error}`);
    return null;
  }
}

export async function flushAllCachedResponses(): Promise<void> {
  if (writePromise) return writePromise;
  writePromise = (async () => {
    await flushNow();
    writePromise = null;
  })();
  await writePromise;
}
