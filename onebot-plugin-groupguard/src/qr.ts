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
}

type QrCacheEntry = { value: boolean; expiresAt: number };

const qrCache = new Map<string, QrCacheEntry>();
let activeScans = 0;
const waiters: Array<() => void> = [];

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
    cacheSeconds: Math.max(0, Math.min(86400, Number(options.cacheSeconds ?? 300)))
  };
}

async function acquire(limit: number): Promise<void> {
  if (activeScans < limit) {
    activeScans += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeScans += 1;
}

function release(): void {
  activeScans = Math.max(0, activeScans - 1);
  const next = waiters.shift();
  if (next) next();
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
    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > options.maxBytes) {
      loggingStateService.info(`[QR] skipped downloaded_bytes=${arrayBuffer.byteLength} max=${options.maxBytes}`);
      return null;
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

async function scanBuffer(buffer: Buffer): Promise<boolean> {
  const image = await Jimp.read(buffer);
  if (scanImage(image)) return true;

  const processed = image.clone();
  processed.greyscale().contrast(0.5).normalize();
  if (scanImage(processed)) return true;

  const { width, height } = image.bitmap;
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

  await acquire(options.concurrency);
  try {
    const result = await withTimeout((async () => {
      const buffer = await readImageBuffer(url, options);
      if (!buffer) return false;
      return scanBuffer(buffer);
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
