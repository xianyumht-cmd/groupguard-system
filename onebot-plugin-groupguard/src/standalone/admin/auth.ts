import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'node:url';
import { sendJson } from './http';

export type AuthCredentialSource = 'bearer' | 'x-groupguard-token' | 'cookie' | 'none';

export type ParsedAuthCredential = {
  token: string;
  source: AuthCredentialSource;
};

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function parseCookieToken(req: IncomingMessage): string {
  const cookie = getHeaderValue(req.headers.cookie)
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('GG_ADMIN_SESSION='));
  return cookie ? decodeURIComponent(cookie.slice('GG_ADMIN_SESSION='.length)) : '';
}

export function parseAuthCredential(req: IncomingMessage): ParsedAuthCredential {
  const auth = getHeaderValue(req.headers.authorization);
  if (auth.toLowerCase().startsWith('bearer ')) {
    return { token: auth.slice(7).trim(), source: 'bearer' };
  }

  const headerToken = getHeaderValue(req.headers['x-groupguard-token']);
  if (headerToken) return { token: headerToken, source: 'x-groupguard-token' };

  const cookieToken = parseCookieToken(req);
  if (cookieToken) return { token: cookieToken, source: 'cookie' };

  return { token: '', source: 'none' };
}

export function parseAuthToken(req: IncomingMessage, _url: URL): string {
  return parseAuthCredential(req).token;
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

function isStateChangingMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

export function isSameOriginCookieRequest(req: IncomingMessage): boolean {
  if (!isStateChangingMethod(req.method)) return true;

  const origin = getHeaderValue(req.headers.origin).trim();
  const host = getHeaderValue(req.headers.host).trim();
  if (!origin || !host || origin === 'null') return false;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function requireAuth(req: IncomingMessage, res: ServerResponse, _url: URL, expectedToken: string): boolean {
  const credential = parseAuthCredential(req);
  if (!isTokenMatch(credential.token, expectedToken)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized: missing or invalid token' });
    return false;
  }

  if (credential.source === 'cookie' && !isSameOriginCookieRequest(req)) {
    sendJson(res, 403, { ok: false, error: 'csrf_origin_mismatch' });
    return false;
  }

  return true;
}
