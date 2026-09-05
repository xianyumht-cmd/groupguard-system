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

function encodedImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = buffer.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

async function scanBuffer(buffer: Buffer, maxPixels: number): Promise<boolean> {
  const dimensions = encodedImageDimensions(buffer);
  if (!dimensions) throw new Error('qr_unsupported_or_invalid_image_header');
  const encodedWidth = dimensions.width;
  const encodedHeight = dimensions.height;
  if (!Number.isSafeInteger(encodedWidth) || !Number.isSafeInteger(encodedHeight)
    || encodedWidth <= 0 || encodedHeight <= 0 || encodedWidth * encodedHeight > maxPixels) {
    throw new Error('qr_encoded_pixel_limit');
  }
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
