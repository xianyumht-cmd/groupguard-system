import http, { type Server } from 'http';
import { URL } from 'node:url';
import { createToken, requireAuth } from './auth';
import { readBody, send, sendJson } from './http';
import { renderHomePage } from './static_page';
import { renderQaPage } from './qa_page';
import { renderQueryPage } from './query_page';
import { getStatus } from './status_api';
import { getRawConfig, patchRawConfig, saveRawConfig } from './config_api';
import { deleteGroupConfig, getGroupConfig, listGroups, patchGroupConfig, saveGroupConfig } from './group_api';
import { deleteLicense, getLicense, listLicenses, saveLicense } from './license_api';
import { createSnapshot, listBackups } from './backup_api';
import { addQaEntry, deleteQaEntry, listQaEntries, setQaEntryEnabled, updateQaEntry } from './qa_api';
import { getQueryOverview, patchQueryConfig, testQueryEndpoint } from './query_api';
import { getDynamicCommandsConfig, saveDynamicCommandsConfig } from './dynamic_commands_api';
import type { SnowLumaAdminServerOptions, SnowLumaAdminServerRuntime } from './types';

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

function renderMainPage(): string {
  return renderHomePage().replace(
    '<button class="tab" data-tab="query">查询配置</button>',
    '<a class="tablink" id="queryLink" href="/query.html">查询配置</a>'
  );
}

export function startSnowLumaAdminServer(options: SnowLumaAdminServerOptions): SnowLumaAdminServerRuntime {
  const logger = options.logger || console;
  const { host, port, token, tokenFromEnv } = resolveServerConfig(options);

  const server: Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(res, 200, renderMainPage(), 'text/html; charset=utf-8');
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

      if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, { ok: true, config: getRawConfig(options) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config') {
        const payload = JSON.parse(await readBody(req) || '{}');
        saveRawConfig(options, payload.config ?? payload);
        sendJson(res, 200, { ok: true, message: 'config.json 已保存并刷新运行时配置。连接/路径类配置仍需重启服务完全生效。' });
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
