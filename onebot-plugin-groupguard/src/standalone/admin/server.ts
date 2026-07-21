import http, { type Server } from 'http';
import fs from 'fs';
import { URL } from 'node:url';
import { createToken, requireAuth } from './auth';
import { readBody, send, sendBuffer, sendJson } from './http';
import { renderHomePage } from './static_page';
import { renderQaPage } from './qa_page';
import { renderQueryPage } from './query_page';
import { getStatus } from './status_api';
import { getRawConfig, patchRawConfig, saveRawConfig } from './config_api';
import { deleteGroupConfig, getGroupConfig, listGroups, patchGroupConfig, saveGroupConfig } from './group_api';
import { deleteLicense, getLicense, listLicenses, saveLicense } from './license_api';
import { createSnapshot, listBackups } from './backup_api';
import { addQaEntry, deleteQaEntry, listQaEntries, listQaGroups, setQaEntryEnabled, updateQaEntry } from './qa_api';
import { getQueryOverview, patchQueryConfig, testQueryEndpoint } from './query_api';
import { getDynamicCommandsConfig, saveDynamicCommandsConfig } from './dynamic_commands_api';
import { handleLanzouUpdateEvent } from './lanzou_update_api';
import { applyRiskPreset, getHealthDashboard, getRiskDashboard } from './risk_ops_api';
import { getSubGameplayResourceFile, getSubGameplayResourceOverview, verifySubGameplayResourceIntegrity } from '../../services/sub_gameplay_resources';
import type { SnowLumaAdminServerOptions, SnowLumaAdminServerRuntime } from './types';

function contentTypeForResource(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function resolveServerConfig(options: SnowLumaAdminServerOptions) {
  const host = options.host || process.env.GROUPGUARD_WEBUI_HOST || '127.0.0.1';
  const parsedPort = options.port || Number(process.env.GROUPGUARD_WEBUI_PORT || 6108);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6108;
  const token = options.token || process.env.GROUPGUARD_WEBUI_TOKEN || createToken();
  const tokenFromEnv = Boolean(options.token || process.env.GROUPGUARD_WEBUI_TOKEN);
  return { host, port, token, tokenFromEnv };
}

function parseGroupPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/groups\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseLicensePath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/licenses\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseQaPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/qa\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function startSnowLumaAdminServer(options: SnowLumaAdminServerOptions): SnowLumaAdminServerRuntime {
  const logger = options.logger || console;
  const { host, port, token, tokenFromEnv } = resolveServerConfig(options);

  const server: Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(res, 200, renderHomePage(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/qa.html') {
        send(res, 200, renderQaPage(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/query.html') {
        send(res, 200, renderQueryPage(), 'text/html; charset=utf-8');
        return;
      }

      if (!requireAuth(req, res, url, token)) return;

      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, getStatus(options));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, await getHealthDashboard(options));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/lanzou-update/event') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const result = await handleLanzouUpdateEvent(options, payload);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/risk/dashboard') {
        sendJson(res, 200, await getRiskDashboard(url.searchParams.get('hours') || 24));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/risk/preset') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, { message: '风险推荐档位已应用。', ...applyRiskPreset(options, payload.level) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, { ok: true, config: getRawConfig(options) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config') {
        const payload = JSON.parse(await readBody(req) || '{}');
        saveRawConfig(options, payload.config ?? payload);
        sendJson(res, 200, { ok: true, message: 'config.json 已保存并刷新运行时配置。连接路径类配置仍需重启服务后完全生效。' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config/patch') {
        const payload = JSON.parse(await readBody(req) || '{}');
        patchRawConfig(options, payload.patch || {});
        sendJson(res, 200, { ok: true, message: '配置字段已保存并刷新运行时配置。' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/groups') {
        sendJson(res, 200, { ok: true, groups: listGroups() });
        return;
      }

      const groupId = parseGroupPath(url.pathname);
      if (groupId && req.method === 'GET') {
        sendJson(res, 200, { ok: true, ...getGroupConfig(groupId) });
        return;
      }

      if (groupId && req.method === 'POST') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const result = payload.group
          ? saveGroupConfig(options, groupId, payload.group)
          : patchGroupConfig(options, groupId, payload.patch || {});
        sendJson(res, 200, { ok: true, message: '本群配置已保存并刷新运行时配置。', ...result });
        return;
      }

      if (groupId && req.method === 'DELETE') {
        const result = deleteGroupConfig(options, groupId);
        sendJson(res, 200, { ok: true, message: '本群专属配置已删除，该群恢复走全局配置。', ...result });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/licenses') {
        sendJson(res, 200, { ok: true, licenses: listLicenses() });
        return;
      }

      const licenseGroupId = parseLicensePath(url.pathname);
      if (licenseGroupId && req.method === 'GET') {
        sendJson(res, 200, { ok: true, license: getLicense(licenseGroupId) });
        return;
      }

      if (licenseGroupId && req.method === 'POST') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, { ok: true, message: '授权已保存。', license: saveLicense(options, licenseGroupId, payload) });
        return;
      }

      if (licenseGroupId && req.method === 'DELETE') {
        sendJson(res, 200, { ok: true, message: '授权已取消。', license: deleteLicense(options, licenseGroupId) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/qa') {
        sendJson(res, 200, { ok: true, ...listQaEntries(url.searchParams.get('scope'), url.searchParams.get('groupId'), url.searchParams.get('q') || '') });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/qa/groups') {
        sendJson(res, 200, { ok: true, groups: listQaGroups() });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/qa') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, { ok: true, message: '问答已新增。', ...addQaEntry(options, payload.scope, payload.groupId, payload) });
        return;
      }

      const qaIndex = parseQaPath(url.pathname);
      if (qaIndex && req.method === 'PATCH') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const message = payload.enabled === false ? '问答已禁用。' : '问答已启用。';
        sendJson(res, 200, { ok: true, message, ...setQaEntryEnabled(options, payload.scope, payload.groupId, qaIndex, payload.enabled) });
        return;
      }

      if (qaIndex && req.method === 'PUT') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, { ok: true, message: '问答已更新。', ...updateQaEntry(options, payload.scope, payload.groupId, qaIndex, payload) });
        return;
      }

      if (qaIndex && req.method === 'DELETE') {
        sendJson(res, 200, { ok: true, message: '问答已删除。', ...deleteQaEntry(options, url.searchParams.get('scope'), url.searchParams.get('groupId'), qaIndex) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/query/overview') {
        sendJson(res, 200, getQueryOverview());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/query/patch') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, patchQueryConfig(options, payload.patch || {}));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/query/test') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, await testQueryEndpoint(payload));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/backups') {
        sendJson(res, 200, { ok: true, backups: listBackups(options) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/backups/snapshot') {
        sendJson(res, 200, { ok: true, message: '快照已创建。', copied: createSnapshot(options) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/dynamic-commands') {
        sendJson(res, 200, { ok: true, config: getDynamicCommandsConfig(options) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/dynamic-commands') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const count = await saveDynamicCommandsConfig(options, payload.config ?? payload);
        sendJson(res, 200, { ok: true, message: `动态命令已保存并重载，当前启用 ${count} 条。`, count });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/sub-gameplay/resources') {
        const module = String(url.searchParams.get('module') || '').trim();
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 120)));
        const q = String(url.searchParams.get('q') || '').trim();
        const collection = String(url.searchParams.get('collection') || '').trim();
        const mediaType = String(url.searchParams.get('mediaType') || '').trim();
        const sourceRelation = String(url.searchParams.get('sourceRelation') || '').trim();
        const overview = getSubGameplayResourceOverview(module, limit, q, collection, mediaType, sourceRelation);
        const integrity = verifySubGameplayResourceIntegrity();
        sendJson(res, 200, {
          ok: true,
          root: overview.root,
          generatedAt: overview.manifest?.generatedAt || '',
          modules: overview.manifest?.modules || [],
          summary: overview.manifest?.summary || null,
          integrity,
          entries: overview.entries
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/sub-gameplay/resource-file') {
        const resourcePath = String(url.searchParams.get('path') || url.searchParams.get('id') || '');
        const filePath = getSubGameplayResourceFile(resourcePath);
        if (!filePath) {
          sendJson(res, 404, { ok: false, error: 'resource_not_found' });
          return;
        }
        sendBuffer(res, 200, fs.readFileSync(filePath), contentTypeForResource(filePath));
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error as Error)?.message || error) });
    }
  });

  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    logger.info(`[GroupGuard:SnowLumaWebUI] listening http://${host}:${port}`);
    logger.info(`[GroupGuard:SnowLumaWebUI] open http://${displayHost}:${port}/?token=${token}`);
    if (!tokenFromEnv) logger.warn(`[GroupGuard:SnowLumaWebUI] GROUPGUARD_WEBUI_TOKEN 未设置，已生成临时 token=${token}`);
  });

  return {
    host,
    port,
    token,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
