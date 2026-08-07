import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HostProfile } from '../hosts/host_profile';

export function safeTargetFileName(value: unknown): string {
  let name = path.basename(String(value ?? '').trim().replace(/\\/g, '/'));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || name === '.' || name === '..') name = 'download.bin';
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 24);
    const base = path.basename(name, path.extname(name)).slice(0, Math.max(1, 180 - ext.length));
    name = `${base}${ext}`;
  }
  return name;
}

export async function downloadTargetFile(options: {
  eventId: string;
  fileName: string;
  directUrl: string;
  tempDir: string;
  maxFileSizeMb: number;
}): Promise<string> {
  fs.mkdirSync(options.tempDir, { recursive: true });
  const prefix = crypto.createHash('sha256').update(options.eventId).digest('hex').slice(0, 16);
  const finalPath = path.join(options.tempDir, `${prefix}-${safeTargetFileName(options.fileName)}`);
  const partPath = `${finalPath}.part`;
  try { fs.unlinkSync(partPath); } catch { /* noop */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let handle: fs.promises.FileHandle | null = null;
  try {
    const response = await fetch(options.directUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'GroupGuard-TargetFilePush/1.0',
        accept: '*/*',
      },
    });
    if (!response.ok) throw new Error(`文件下载失败 HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) throw new Error('直链返回了网页而不是文件，请重新解析直链');
    const declared = Number(response.headers.get('content-length') || 0);
    const maxBytes = options.maxFileSizeMb * 1024 * 1024;
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`文件超过 ${options.maxFileSizeMb} MB 限制`);
    if (!response.body) throw new Error('文件下载响应没有内容');

    handle = await fs.promises.open(partPath, 'w', 0o600);
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const data = Buffer.from(chunk.value);
      total += data.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* noop */ }
        throw new Error(`文件超过 ${options.maxFileSizeMb} MB 限制`);
      }
      await handle.write(data);
    }
    if (total <= 0) throw new Error('下载到的文件为空');
    await handle.close();
    handle = null;
    await fs.promises.rename(partPath, finalPath);
    return finalPath;
  } finally {
    clearTimeout(timer);
    try { await handle?.close(); } catch { /* noop */ }
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch { /* noop */ }
  }
}

export async function uploadTargetFile(options: {
  hostProfile: HostProfile;
  targetGroupId: string;
  targetFolderId: string;
  localPath: string;
  fileName: string;
}): Promise<string> {
  const result = await options.hostProfile.uploadGroupFile({
    groupId: options.targetGroupId,
    source: options.localPath,
    fileName: safeTargetFileName(options.fileName),
    folderId: options.targetFolderId || '/',
  });
  if (result.state !== 'success' || !result.data?.fileId) {
    throw new Error(`群文件上传失败:${result.reason || result.state}`);
  }
  return result.data.fileId;
}
