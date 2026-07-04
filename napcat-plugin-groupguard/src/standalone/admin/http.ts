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

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += String(chunk);
      if (body.length > 5 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
