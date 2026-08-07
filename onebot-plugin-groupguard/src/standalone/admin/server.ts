import http, { type Server } from 'http';
import fs from 'fs';
import path from 'node:path';
import { URL } from 'node:url';
import { createToken, requireAuth } from './auth';
import { HttpBodyTooLargeError, readBody, send, sendBuffer, sendJson } from './http';
import { renderHomePage } from './static_page';
import { renderQaPage } from './qa_page';
import { renderQueryPage } from './query_page';
import { renderQunGuanjiaPage } from './qun_guanjia_page';
import { renderGroupFileMirrorPage } from './group_file_mirror_page';
import { renderTargetFilePushPage } from './target_file_push_page';
import { applyWebUiTheme } from './webui_theme';
import { normalizeQueryOverviewForWebUi, patchQueryPageHtml } from './query_webui_facade';
import {
  getGroupFileMirrorOverview,
  saveGroupFileMirrorFromWeb,
  GroupFileMirrorConfigError,
} from './group_file_mirror_api';
import {
  checkTargetFilePushNow,
  getTargetFilePushOverview,
  handleTargetFilePushEvent,
  rebaselineTargetFilePush,
  saveTargetFilePushFromWeb,
} from './target_file_push_api';
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
import { qunGuanjiaService } from '../../services/qun_guanjia_service';
import type { SnowLumaAdminServerOptions, SnowLumaAdminServerRuntime } from './types';
import { getBuildInfo } from '../../build_info';

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
  const configuredToken = String(options.token || process.env.GROUPGUARD_WEBUI_TOKEN || '').trim();
  const tokenPath = path.join(options.dataDir, '.groupguard-webui-token');
  let token = configuredToken;
  let tokenSource = configuredToken ? 'configuration' : 'file';
  if (!token) {
    try { token = fs.readFileSync(tokenPath, 'utf-8').trim(); } catch { /* create below */ }
  }
  if (!token) {
    token = createToken();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    tokenSource = 'generated_file';
  }
  if (!token) throw new Error('groupguard_webui_token_unavailable');
  return { host, port, token, tokenSource, tokenPath };
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

function requireNumericGroupId(value: unknown): string {
  const groupId = String(value ?? '').trim();
  if (!/^\d+$/.test(groupId)) throw new Error('请输入有效群号');
  return groupId;
}

function renderMainPage(): string {
  return renderHomePage()
    .replaceAll('GroupGuard SnowLuma 控制台', '群管系统控制台')
    .replace('用于修改 SnowLuma 独立版群管配置。保存前会自动备份，并刷新运行时配置。', '用于管理机器人群管功能。保存前会自动备份，并立即刷新运行设置。')
    .replace('<button class="tab" data-tab="send">发送与风控</button>', '<button class="tab" data-tab="send">发送与风控</button>\n    <a class="tablink" id="groupFileMirrorLink" href="/group-file-mirror.html">群文件搬运</a>\n    <a class="tablink" id="targetFilePushLink" href="/target-file-push.html">定向文件推送</a>\n    <a class="tablink" id="qunGuanjiaLink" href="/qun-guanjia.html">Q群管家通道</a>')
    .replaceAll('SUB玩法', '娱乐玩法')
    .replaceAll('ELE构建', '构建工具')
    .replace('<option value="free">free</option><option value="pro" selected>pro</option><option value="enterprise">enterprise</option>', '<option value="free">免费版</option><option value="pro" selected>专业版</option><option value="enterprise">企业版</option>');
}

export function startSnowLumaAdminServer(options: SnowLumaAdminServerOptions): SnowLumaAdminServerRuntime {
  const logger = options.logger || console;
  const { host, port, token, tokenSource, tokenPath } = resolveServerConfig(options);

  const server: Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    try {
      if (req.method === 'POST' && url.pathname === '/api/target-file-push/event') {
        try {
          const payload = JSON.parse(await readBody(req) || '{}');
          const presentedToken = String(req.headers['x-target-file-token'] || '').trim();
          const result = await handleTargetFilePushEvent(options, payload, presentedToken);
          sendJson(res, 200, result);
        } catch (error) {
          const message = String((error as Error)?.message || error);
          const statusCode = message.includes('unauthorized')
            ? 401
            : message.includes('invalid_') || message.includes('mismatch') || message.includes('disabled')
              ? 400
              : 502;
          sendJson(res, statusCode, { ok: false, error: message.slice(0, 300) });
        }
        return;
      }

      if (!requireAuth(req, res, url, token)) return;

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(res, 200, applyWebUiTheme(renderMainPage()), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/qa.html') {
        send(res, 200, applyWebUiTheme(renderQaPage()), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/query.html') {
        send(res, 200, applyWebUiTheme(patchQueryPageHtml(renderQueryPage())), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/qun-guanjia.html') {
        send(res, 200, applyWebUiTheme(renderQunGuanjiaPage()), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/group-file-mirror.html') {
        send(res, 200, applyWebUiTheme(renderGroupFileMirrorPage()), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/target-file-push.html') {
        send(res, 200, applyWebUiTheme(renderTargetFilePushPage()), 'text/html; charset=utf-8');
        return;
      }

      if (!requireAuth(req, res, url, token)) return;

      if (req.method === 'GET' && url.pathname === '/api/group-file-mirror') {
        sendJson(res, 200, getGroupFileMirrorOverview());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/group-file-mirror') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, saveGroupFileMirrorFromWeb(payload));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/target-file-push') {
        sendJson(res, 200, await getTargetFilePushOverview(options));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/target-file-push') {
        const payload = JSON.parse(await readBody(req) || '{}');
        try {
          sendJson(res, 200, await saveTargetFilePushFromWeb(options, payload));
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String((error as Error)?.message || error).slice(0, 300) });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/target-file-push/check') {
        sendJson(res, 200, await checkTargetFilePushNow(options));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/target-file-push/rebaseline') {
        sendJson(res, 200, await rebaselineTargetFilePush(options));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, getStatus(options));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/build-info') {
        sendJson(res, 200, getBuildInfo());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/livez') {
        sendJson(res, 200, {
          ok: true,
          status: 'alive',
          liveness: 'up',
          checkedAt: Date.now(),
          build: getBuildInfo()
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/readyz') {
        const health = await getHealthDashboard(options);
        const ready = health.ready === true;
        sendJson(res, ready ? 200 : 503, {
          ...health,
          ok: ready,
          readiness: ready ? 'ready' : 'not_ready'
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, await getHealthDashboard(options));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/health/recover-onebot') {
        if (!options.recoverOneBot) {
          sendJson(res, 501, { ok: false, error: 'onebot_recovery_unavailable' });
          return;
        }
        try {
          const oneBot = await options.recoverOneBot();
          sendJson(res, 200, { ok: true, oneBot, health: await getHealthDashboard(options) });
        } catch (error) {
          sendJson(res, 503, {
            ok: false,
            error: 'onebot_recovery_failed',
            detail: String((error as Error)?.message || error).slice(0, 300)
          });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/lanzou-update/event') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const result = await handleLanzouUpdateEvent(options, payload);
        sendJson(res, result.ok ? 200 : result.degraded ? 503 : 400, result);
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

      if (req.method === 'GET' && url.pathname === '/api/qun-guanjia/status') {
        const groupId = requireNumericGroupId(url.searchParams.get('groupId'));
        sendJson(res, 200, { ok: true, status: qunGuanjiaService.getStatus(groupId) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/qun-guanjia/token/clear') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const groupId = requireNumericGroupId(payload.groupId);
        sendJson(res, 200, {
          ok: true,
          message: '本群 Q群管家 token 已清除。',
          status: qunGuanjiaService.clearToken(groupId)
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/qun-guanjia/test') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const groupId = requireNumericGroupId(payload.groupId);
        const text = String(payload.text || '').trim();
        if (!text) throw new Error('测试文本不能为空');
        const result = await qunGuanjiaService.sendText(groupId, text);
        sendJson(res, 200, {
          ok: true,
          message: 'Q群管家测试代发成功。',
          result,
          status: qunGuanjiaService.getStatus(groupId)
        });
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
        sendJson(res, 200, normalizeQueryOverviewForWebUi(getQueryOverview()));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/query/patch') {
        const payload = JSON.parse(await readBody(req) || '{}');
        sendJson(res, 200, normalizeQueryOverviewForWebUi(patchQueryConfig(options, payload.patch || {})));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/query/test') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const result = await testQueryEndpoint(payload);
        sendJson(res, result.ok ? 200 : 502, result);
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
          sendJson(res, 404, { ok: false, error: '资源不存在' });
          return;
        }
        sendBuffer(res, 200, fs.readFileSync(filePath), contentTypeForResource(filePath));
        return;
      }

      sendJson(res, 404, { ok: false, error: '页面或接口不存在' });
    } catch (error) {
      const statusCode = error instanceof HttpBodyTooLargeError ? 413 : error instanceof GroupFileMirrorConfigError ? 400 : 500;
      sendJson(res, statusCode, { ok: false, error: String((error as Error)?.message || error) });
    }
  });

  server.listen(port, host, () => {
    logger.info(`[GroupGuard:SnowLumaWebUI] listening http://${host}:${port}`);
    logger.info(`[GroupGuard:SnowLumaWebUI] authentication token source=${tokenSource}`);
    if (tokenSource === 'generated_file') logger.warn(`[GroupGuard:SnowLumaWebUI] generated token stored with mode 0600 at ${tokenPath}`); else {
      logger.warn('[GroupGuard:SnowLumaWebUI] GROUPGUARD_WEBUI_TOKEN is not configured; using an ephemeral token that is intentionally not logged');
    }
  });

  return {
    host,
    port,
    token,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}