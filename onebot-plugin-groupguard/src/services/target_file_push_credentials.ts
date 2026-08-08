import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function writeSecret(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, `${value}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* non-posix */ }
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
  }
}

function readSecret(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8').trim(); } catch { return ''; }
}

export function targetFilePushApiToken(secretDir: string): string {
  return String(
    process.env.TARGET_FILE_PUSH_API_TOKEN
    || process.env.GROUPGUARD_WRITE_TOKEN
    || readSecret(path.join(secretDir, 'target-file-push-api-token'))
    || ''
  ).trim();
}

export function saveTargetFilePushApiToken(secretDir: string, value: string): void {
  const token = String(value || '').trim();
  if (!token) return;
  if (token.length < 12) throw new Error('接口写入 Token 至少需要 12 位');
  writeSecret(path.join(secretDir, 'target-file-push-api-token'), token);
}

export function targetFilePushCallbackToken(secretDir: string): string {
  const filePath = path.join(secretDir, 'target-file-push-callback-token');
  let token = readSecret(filePath);
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    writeSecret(filePath, token);
  }
  return token;
}

export function targetFilePushTokenMatches(secretDir: string, presented: string): boolean {
  const expected = Buffer.from(targetFilePushCallbackToken(secretDir));
  const actual = Buffer.from(String(presented || '').trim());
  return expected.length === actual.length
    && expected.length > 0
    && crypto.timingSafeEqual(expected, actual);
}
