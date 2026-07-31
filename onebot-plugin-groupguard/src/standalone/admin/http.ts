import type { IncomingMessage, ServerResponse } from 'http';

export function sendBuffer(res: ServerResponse, status: number, body: Buffer, contentType = 'application/octet-stream'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

export function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, value: any): void {
  send(res, status, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

export class HttpBodyTooLargeError extends Error {
  readonly statusCode = 413;
  constructor() { super('请求体过大'); }
}

export function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(new HttpBodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, bytes).toString('utf-8'));
    };
    const onError = (error: Error) => fail(error);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
