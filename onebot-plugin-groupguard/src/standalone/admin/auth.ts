import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'node:url';
import { sendJson } from './http';

export type AuthCredentialSource = 'bearer' | 'x-groupguard-token' | 'cookie' | 'none';

export type ParsedAuthCredential = {
  token: string;
  source: AuthCredentialSource;
};

export type RequireAuthOptions = {
  allowLegacyCookieMigration?: boolean;
};

const ADMIN_SESSION_VERSION = 'v1';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const LEGACY_COOKIE_MIGRATION_WINDOW_MS = 15 * 60 * 1000;

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

function signAdminSessionPayload(payload: string, expectedToken: string): string {
  return crypto.createHmac('sha256', expectedToken).update(payload).digest('base64url');
}

export function createAdminSessionToken(
  expectedToken: string,
  now = Date.now(),
  maxAgeSeconds = ADMIN_SESSION_MAX_AGE_SECONDS,
): string {
  if (!expectedToken) throw new Error('groupguard_webui_token_unavailable');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new Error('invalid_admin_session_max_age');
  const expiresAt = now + maxAgeSeconds * 1000;
  const nonce = crypto.randomBytes(24).toString('base64url');
  const payload = `${ADMIN_SESSION_VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${signAdminSessionPayload(payload, expectedToken)}`;
}

export function isAdminSessionTokenValid(provided: string, expectedToken: string, now = Date.now()): boolean {
  const parts = String(provided || '').split('.');
  if (parts.length !== 4 || parts[0] !== ADMIN_SESSION_VERSION || !expectedToken) return false;
  const expiresAt = Number(parts[1]);
  const nonce = parts[2];
  const signature = parts[3];
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) return false;
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(signature)) return false;
  const payload = `${parts[0]}.${parts[1]}.${nonce}`;
  return isTokenMatch(signature, signAdminSessionPayload(payload, expectedToken));
}

export function buildAdminSessionCookie(expectedToken: string, now = Date.now()): string {
  const sessionToken = createAdminSessionToken(expectedToken, now);
  return `GG_ADMIN_SESSION=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`;
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

export function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  expectedToken: string,
  options: RequireAuthOptions = {},
): boolean {
  const credential = parseAuthCredential(req);
  let authenticated = false;

  if (credential.source === 'cookie') {
    authenticated = isAdminSessionTokenValid(credential.token, expectedToken);
    if (!authenticated && options.allowLegacyCookieMigration === true && isTokenMatch(credential.token, expectedToken)) {
      authenticated = true;
      res.setHeader('set-cookie', buildAdminSessionCookie(expectedToken));
    }
  } else {
    authenticated = isTokenMatch(credential.token, expectedToken);
  }

  if (!authenticated) {
    sendJson(res, 401, { ok: false, error: 'unauthorized: missing or invalid token' });
    return false;
  }

  if (credential.source === 'cookie' && !isSameOriginCookieRequest(req)) {
    sendJson(res, 403, { ok: false, error: 'csrf_origin_mismatch' });
    return false;
  }

  return true;
}
