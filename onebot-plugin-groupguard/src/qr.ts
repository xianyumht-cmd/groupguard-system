import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';
import { loggingStateService } from './core/state-services/logging_state_service';

export interface QrDetectOptions {
  timeoutMs?: number;
  maxBytes?: number;
  concurrency?: number;
  cacheSeconds?: number;
  maxPixels?: number;
  maxWaiters?: number;
  maxCacheEntries?: number;
}

type QrCacheEntry = { value: boolean; expiresAt: number };

const qrCache = new Map<string, QrCacheEntry>();
let activeScans = 0;
const waiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];

function scanImage(image: any): boolean {
  try {
    const { width, height, data } = image.bitmap;
    const clamped = new Uint8ClampedArray(data);
    const code = jsQR(clamped, width, height, { inversionAttempts: 'attemptBoth' });
    return !!code;
  } catch {
    return false;
  }
}

function normalizeOptions(options: QrDetectOptions = {}): Required<QrDetectOptions> {
  return {
    timeoutMs: Math.max(300, Math.min(30000, Number(options.timeoutMs ?? 3000))),
    maxBytes: Math.max(102400, Math.min(52428800, Number(options.maxBytes ?? 5242880))),
    concurrency: Math.max(1, Math.min(10, Number(options.concurrency ?? 2))),
    cacheSeconds: Math.max(0, Math.min(86400, Number(options.cacheSeconds ?? 300))),
    maxPixels: Math.max(40_000, Math.min(16_000_000, Number(options.maxPixels ?? 4_000_000))),
    maxWaiters: Math.max(1, Math.min(1000, Number(options.maxWaiters ?? 100))),
    maxCacheEntries: Math.max(1, Math.min(10000, Number(options.maxCacheEntries ?? 1000))),
  };
}

async function acquire(limit: number, maxWaiters: number, timeoutMs: number): Promise<void> {
  if (activeScans < limit) {
    activeScans += 1;
    return;
  }
  if (waiters.length >= maxWaiters) throw new Error('qr_waiter_queue_full');
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve: () => { clearTimeout(waiter.timer); resolve(); },
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('qr_waiter_timeout'));
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
  activeScans += 1;
}

function release(): void {
  activeScans = Math.max(0, activeScans - 1);
  const next = waiters.shift();
  if (next) next.resolve();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('qr_detect_timeout')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readImageBuffer(url: string, options: Required<QrDetectOptions>): Promise<Buffer | null> {
  if (url.startsWith('file://')) {
    const filePath = fileURLToPath(url);
    const stat = await fs.stat(filePath);
    if (stat.size > options.maxBytes) {
      loggingStateService.info(`[QR] skipped url=file size=${stat.size} max=${options.maxBytes}`);
      return null;
    }
    return fs.readFile(filePath);
  }

  if (!/^https?:\/\//i.test(url)) {
    loggingStateService.info(`[QR] skipped unsupported_url url=${url.slice(0, 120)}`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`http_${resp.status}`);
    const length = Number(resp.headers.get('content-length') || 0);
    if (length > options.maxBytes) {
      loggingStateService.info(`[QR] skipped content_length=${length} max=${options.maxBytes}`);
      return null;
    }
    if (!resp.body) return null;
    const reader = resp.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const data = Buffer.from(chunk.value);
      total += data.length;
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        loggingStateService.info(`[QR] skipped downloaded_bytes=${total} max=${options.maxBytes}`);
        return null;
      }
      chunks.push(data);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

async function scanBuffer(buffer: Buffer, maxPixels: number): Promise<boolean> {
  const image = await Jimp.read(buffer);
  const { width, height } = image.bitmap;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > maxPixels) {
    throw new Error('qr_decoded_pixel_limit');
  }
  if (scanImage(image)) return true;

  const processed = image.clone();
  processed.greyscale().contrast(0.5).normalize();
  if (scanImage(processed)) return true;

  let scaled: any = null;
  if (width > 1200 || height > 1200) scaled = image.clone().resize({ w: Math.max(1, Math.floor(width / 2)) });
  else if (width < 200 || height < 200) scaled = image.clone().scale(2);

  if (scaled) {
    if (scanImage(scaled)) return true;
    scaled.greyscale().contrast(0.4).normalize();
    if (scanImage(scaled)) return true;
  }
  return false;
}

export async function detectQrCode(url: string, rawOptions: QrDetectOptions = {}): Promise<boolean> {
  if (!url) return false;
  const options = normalizeOptions(rawOptions);
  const cacheKey = `${url}|${options.maxBytes}`;
  const cached = qrCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    loggingStateService.debug(`[QR] cache_hit result=${cached.value} url=${url.slice(0, 120)}`);
    return cached.value;
  }

  const now = Date.now();
  for (const [key, entry] of qrCache.entries()) if (entry.expiresAt <= now) qrCache.delete(key);
  while (qrCache.size >= options.maxCacheEntries) {
    const oldest = qrCache.keys().next().value as string | undefined;
    if (!oldest) break;
    qrCache.delete(oldest);
  }

  await acquire(options.concurrency, options.maxWaiters, options.timeoutMs);
  try {
    const result = await withTimeout((async () => {
      const buffer = await readImageBuffer(url, options);
      if (!buffer) return false;
      return scanBuffer(buffer, options.maxPixels);
    })(), options.timeoutMs);
    if (options.cacheSeconds > 0) qrCache.set(cacheKey, { value: result, expiresAt: Date.now() + options.cacheSeconds * 1000 });
    loggingStateService.info(`[QR] detected=${result} url=${url.slice(0, 120)}`);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    loggingStateService.info(`[QR] failed reason=${reason} url=${url.slice(0, 120)}`);
    if (options.cacheSeconds > 0) qrCache.set(cacheKey, { value: false, expiresAt: Date.now() + Math.min(options.cacheSeconds, 30) * 1000 });
    return false;
  } finally {
    release();
  }
}
