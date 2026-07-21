import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'node:url';
import { sendJson } from './http';

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function parseAuthToken(req: IncomingMessage, url: URL): string {
  const queryToken = url.searchParams.get('token') || '';
  const headerToken = getHeaderValue(req.headers['x-groupguard-token']);
  const auth = getHeaderValue(req.headers.authorization);
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return headerToken || queryToken;
}

export function isTokenMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided || '');
  const right = Buffer.from(expected || '');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createToken(): string {
  return crypto.randomBytes(18).toString('hex');
}

export function requireAuth(req: IncomingMessage, res: ServerResponse, url: URL, expectedToken: string): boolean {
  const provided = parseAuthToken(req, url);
  if (isTokenMatch(provided, expectedToken)) return true;
  sendJson(res, 401, { ok: false, error: 'unauthorized: missing or invalid token' });
  return false;
}
