import { communicationStateService } from '../core/state-services/communication_state_service';

export interface LolImageFetchOptions {
  timeoutMs: number;
  maxBytes?: number;
  fetchFn?: typeof fetch;
}

export interface LolImageDeliveryOptions extends LolImageFetchOptions {
  sendGroupMsg?: (
    groupId: string,
    message: Array<Record<string, unknown>>,
    options: {
      scene: string;
      force: boolean;
      applyTemplate: boolean;
      requireDelivery: boolean;
    }
  ) => Promise<void>;
}

async function cancelResponseBody(response: Response, reason: string): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Cancellation is best effort; the original validation error remains authoritative.
  }
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('image_body_missing');

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel(`image_too_large_${totalBytes}`);
        } catch {
          // Preserve the deterministic size error even if transport cancellation fails.
        }
        throw new Error(`image_too_large_${totalBytes}`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }

  if (!totalBytes) throw new Error('image_size_invalid_0');
  return Buffer.concat(chunks, totalBytes);
}

export async function fetchOneBotImageFile(
  imageUrl: string,
  options: LolImageFetchOptions
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs));
  const maxBytes = Math.max(1, options.maxBytes || 8 * 1024 * 1024);
  try {
    const fetchFn = options.fetchFn || fetch;
    const response = await fetchFn(imageUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'image/*' }
    });
    if (!response.ok) throw new Error(`image_http_${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`image_content_type_${contentType || 'unknown'}`);
    }
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) {
      await cancelResponseBody(response, `image_too_large_${declaredSize}`);
      throw new Error(`image_too_large_${declaredSize}`);
    }
    const bytes = await readResponseBodyWithLimit(response, maxBytes);
    return `base64://${bytes.toString('base64')}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverOneBotImageToGroup(
  groupId: string,
  imageUrl: string,
  options: LolImageDeliveryOptions
): Promise<void> {
  const imageFile = await fetchOneBotImageFile(imageUrl, options);
  const sendGroupMsg = options.sendGroupMsg || communicationStateService.sendGroupMsg.bind(communicationStateService);
  await sendGroupMsg(
    groupId,
    [{ type: 'image', data: { file: imageFile } }],
    {
      scene: 'raw_text',
      force: true,
      applyTemplate: true,
      requireDelivery: true
    }
  );
}
