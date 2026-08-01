import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { PluginConfig, GroupGuardSettings } from '../types';
import { configStateService } from '../core/state-services/config_state_service';
import { contextStateService } from '../core/state-services/context_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { runtimeControlService } from '../core/state-services/runtime_control_service';
import { sessionStateService } from '../core/state-services/session_state_service';
import { DEFAULT_PLUGIN_CONFIG, normalizeGroupSettings, normalizePluginConfig } from '../config';
import { storageAdapter } from '../storage_adapter';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { getReplyTemplateCatalog } from '../reply_generator';
import { getGuardRuntimeSnapshot } from '../services/action_guard_service';
import { getActionQueueTaskSnapshot, getActionQueueTaskTrace } from '../services/action_queue_service';
import { getSubGameplayResourceOverview, verifySubGameplayResourceIntegrity } from '../services/sub_gameplay_resources';
import { auditReplyTemplates } from '../reply_template_audit';
import { BUILTIN_REPLY_SCENE_TEMPLATES } from '../reply_templates';
import { saveConfig } from '../commands';
import {
  getActiveCommands,
  getCommandMetricsView,
  getCircuitBreakerHotspots,
  getErrorMetricsView,
  getPluginDebugSnapshot,
  getPluginMetricsView,
  getPluginRegistrySnapshot,
  getRegistryVersion,
  getRuntimeMetricsSnapshot,
  getSlowestCommands,
  getSystemHealthOverview,
  getTopFailingCommands
} from '../dynamic-commands/command_observability';
import { getCommandHealthReport } from '../dynamic-commands/command_health_service';
import {
  getCommandPluginRecord,
  refreshCommandPluginRegistry
} from '../dynamic-commands/command_plugin_registry';
import {
  setCommandPluginRuntimeConfig,
  setCommandPluginEnabled
} from '../dynamic-commands/command_plugin_store';
import { refreshDynamicCommandRegistry } from '../dynamic-commands/command_registry';
import { getRuntimeSchemaCatalog } from './command_schema_catalog';
import { saveConfigStrict } from '../commands/common';

function validatePluginRuntimeConfig(input: unknown): { ok: true; value: Record<string, unknown>; } | { ok: false; message: string; } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'invalid_plugin_runtime_config' };
  }
  const runtimeConfig = input as Record<string, unknown>;
  if (runtimeConfig.daily_limit !== undefined && typeof runtimeConfig.daily_limit !== 'number') {
    return { ok: false, message: 'invalid_daily_limit' };
  }
  if (runtimeConfig.allowed_users !== undefined && (!Array.isArray(runtimeConfig.allowed_users) || runtimeConfig.allowed_users.some((item) => typeof item !== 'string'))) {
    return { ok: false, message: 'invalid_allowed_users' };
  }
  if (runtimeConfig.allowed_groups !== undefined && (!Array.isArray(runtimeConfig.allowed_groups) || runtimeConfig.allowed_groups.some((item) => typeof item !== 'string'))) {
    return { ok: false, message: 'invalid_allowed_groups' };
  }
  return { ok: true, value: runtimeConfig };
}

function syncAuditRetentionPolicyFromConfig(config: PluginConfig): void {
  const global = config.global || {};
  storageAdapter.setAuditRetentionPolicy({
    maxAgeDays: global.auditRetentionMaxAgeDays,
    maxRows: global.auditRetentionMaxRows
  });
  storageAdapter.setActionQueueEventRetentionPolicy({
    maxAgeDays: global.actionQueueEventRetentionMaxAgeDays,
    maxRows: global.actionQueueEventRetentionMaxRows
  });
}

function bindAuditRetentionLogger(): void {
  storageAdapter.setAuditRetentionLogHandler((event) => {
    loggingStateService.info(`审计保留清理: deleted=${event.deleted} maxAgeDays=${event.maxAgeDays} maxRows=${event.maxRows}`);
  });
  storageAdapter.setActionQueueEventRetentionLogHandler((event) => {
    loggingStateService.info(`动作历史保留清理: deleted=${event.deleted} maxAgeDays=${event.maxAgeDays} maxRows=${event.maxRows}`);
  });
}

function extractQueueTaskIdsFromAuditPayload(payloadText: string): string[] {
  try {
    const payload = JSON.parse(String(payloadText || '{}'));
    const ids: string[] = [];
    const push = (value: unknown) => {
      const text = String(value || '').trim();
      if (text && !ids.includes(text)) ids.push(text);
    };
    push(payload?.queueTaskId);
    if (Array.isArray(payload?.actions)) {
      for (const action of payload.actions) push(action?.queueTaskId);
    }
    return ids;
  } catch {
    return [];
  }
}

export function registerRuntimeRoutes(
  ctx: NapCatPluginContext,
  collectPersonaAuditForConfig: (config: PluginConfig) => any
): void {
  const router = (ctx as any).router;
  if (!router || typeof router.getNoAuth !== 'function' || typeof router.postNoAuth !== 'function') {
    loggingStateService.warn('runtime_routes_unavailable');
    return;
  }
  bindAuditRetentionLogger();
  const healGroupSettings = (input: any): { settings: GroupGuardSettings; fixes: string[] } => {
    const fixes: string[] = [];
    const normalized = normalizeGroupSettings((input || {}) as GroupGuardSettings) as any;
    const dedupStringArray = (value: any, key: string): string[] => {
      const before = Array.isArray(value) ? value.length : 0;
      const arr = Array.isArray(value) ? value.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
      const deduped = Array.from(new Set(arr));
      if (before !== deduped.length) fixes.push(`${key} 已去重/清洗`);
      return deduped;
    };
    normalized.targetUsers = dedupStringArray(normalized.targetUsers, 'targetUsers');
    normalized.groupBlacklist = dedupStringArray(normalized.groupBlacklist, 'groupBlacklist');
    normalized.rejectKeywords = dedupStringArray(normalized.rejectKeywords, 'rejectKeywords');
    normalized.filterKeywords = dedupStringArray(normalized.filterKeywords, 'filterKeywords');
    if (Array.isArray(normalized.qaList)) {
      const qaBefore = normalized.qaList.length;
      normalized.qaList = normalized.qaList
        .filter((q: any) => q && typeof q.keyword === 'string' && typeof q.reply === 'string')
        .map((q: any) => ({
          keyword: String(q.keyword).trim(),
          reply: String(q.reply),
          mode: q.mode === 'contains' || q.mode === 'regex' ? q.mode : 'exact'
        }))
        .filter((q: any) => q.keyword);
      if (qaBefore !== normalized.qaList.length) fixes.push('qaList 已修复无效条目');
    } else {
      normalized.qaList = [];
    }
    normalized.useGlobal = false;
    return { settings: normalized as GroupGuardSettings, fixes };
  };

  if (router.static) router.static('/webui', 'webui');

  if (router.page) {
    router.page({ path: 'config', title: '群管配置', icon: '🛡️', htmlFile: 'webui/config.html', description: '群管插件配置面板' });
    loggingStateService.info('插件页面已注册: 群管配置');
  }

  const chunkedGlobalFields = new Map<string, { field: string; total: number; chunks: string[]; createdAt: number }>();
  const saveNormalizedConfig = (config: PluginConfig): { ok: true } | { ok: false; blocked: true; audit: any } => {
    const newConfig = normalizePluginConfig(config);
    const audit = collectPersonaAuditForConfig(newConfig);
    const strictMode = newConfig?.global?.personaAuditStrictMode === true;
    if (strictMode && audit.summary.high > 0) {
      return { ok: false, blocked: true, audit };
    }

    configStateService.setConfig(newConfig);
    syncAuditRetentionPolicyFromConfig(newConfig);
    if (audit.summary.total > 0) {
      loggingStateService.warn(`浜烘牸妯℃澘瀹¤鎻愮ず: high=${audit.summary.high} medium=${audit.summary.medium} low=${audit.summary.low}`);
    }

    if (ctx?.configPath) {
      saveConfigStrict(ctx);
    }
    return { ok: true };
  };

  router.getNoAuth('/config', (_req: any, res: any) => {
    res.json({ code: 0, data: configStateService.getConfig(), version: identityStateService.getVersion() });
  });

  router.postNoAuth('/config', (req: any, res: any) => {
    try {
      const body = req.body || {};
      const newConfig = normalizePluginConfig({ ...configStateService.getConfig(), ...body });
      const audit = collectPersonaAuditForConfig(newConfig);
      const strictMode = newConfig?.global?.personaAuditStrictMode === true;
      if (strictMode && audit.summary.high > 0) {
        res.json({
          code: -2,
          message: `已阻断保存：检测到 ${audit.summary.high} 条高风险人格模板问题`,
          data: { audit }
        });
        return;
      }

      configStateService.setConfig(newConfig);
      syncAuditRetentionPolicyFromConfig(newConfig);
      if (audit.summary.total > 0) {
        loggingStateService.warn(`人格模板审计提示: high=${audit.summary.high} medium=${audit.summary.medium} low=${audit.summary.low}`);
      }

      if (ctx?.configPath) {
        saveConfigStrict(ctx);
      }
      res.json({ code: 0, message: '配置已保存' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.postNoAuth('/config/patch', (req: any, res: any) => {
    try {
      const body = req.body || {};
      const current = configStateService.getConfig();
      const draft: PluginConfig = {
        ...current,
        global: { ...(current.global || {}) },
        groups: { ...(current.groups || {}) }
      };

      if (body.topLevel && typeof body.topLevel === 'object' && !Array.isArray(body.topLevel)) {
        Object.assign(draft, body.topLevel);
      }

      if (body.global && typeof body.global === 'object' && !Array.isArray(body.global)) {
        draft.global = { ...(draft.global || {}), ...body.global };
      }

      const groupId = String(body.groupId || '').trim();
      if (groupId) {
        draft.groups = { ...(draft.groups || {}) };
        if (body.useGlobal === true) {
          draft.groups[groupId] = { useGlobal: true } as GroupGuardSettings;
        } else if (body.group && typeof body.group === 'object' && !Array.isArray(body.group)) {
          draft.groups[groupId] = {
            ...((draft.groups || {})[groupId] || {}),
            ...body.group,
            useGlobal: false
          } as GroupGuardSettings;
        }
      }

      const newConfig = normalizePluginConfig(draft);
      const audit = collectPersonaAuditForConfig(newConfig);
      const strictMode = newConfig?.global?.personaAuditStrictMode === true;
      if (strictMode && audit.summary.high > 0) {
        res.json({
          code: -2,
          message: `宸查樆鏂繚瀛橈細妫€娴嬪埌 ${audit.summary.high} 鏉￠珮椋庨櫓浜烘牸妯℃澘闂`,
          data: { audit }
        });
        return;
      }

      configStateService.setConfig(newConfig);
      syncAuditRetentionPolicyFromConfig(newConfig);
      if (audit.summary.total > 0) {
        loggingStateService.warn(`浜烘牸妯℃澘瀹¤鎻愮ず: high=${audit.summary.high} medium=${audit.summary.medium} low=${audit.summary.low}`);
      }

      if (ctx?.configPath) {
        saveConfigStrict(ctx);
      }
      res.json({ code: 0, message: '閰嶇疆宸蹭繚瀛?' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.postNoAuth('/config/global-field-chunk', (req: any, res: any) => {
    try {
      const body = req.body || {};
      const field = String(body.field || '').trim();
      if (!['replySceneTemplates', 'qaList'].includes(field)) {
        res.status(400).json({ code: -1, message: 'invalid_field' });
        return;
      }

      const token = String(body.token || '').trim();
      const total = Number(body.total);
      const index = Number(body.index);
      const chunk = String(body.chunk || '');
      if (!token || !Number.isInteger(total) || !Number.isInteger(index) || total < 1 || total > 200 || index < 0 || index >= total) {
        res.status(400).json({ code: -1, message: 'invalid_chunk' });
        return;
      }

      for (const [key, entry] of chunkedGlobalFields.entries()) {
        if (Date.now() - entry.createdAt > 10 * 60 * 1000) chunkedGlobalFields.delete(key);
      }

      const groupId = String(body.groupId || '').trim();
      const key = `${groupId || 'global'}:${field}:${token}`;
      const entry = chunkedGlobalFields.get(key) || { field, total, chunks: new Array(total).fill(''), createdAt: Date.now() };
      if (entry.field !== field || entry.total !== total) {
        res.status(400).json({ code: -1, message: 'chunk_session_mismatch' });
        return;
      }

      entry.chunks[index] = chunk;
      chunkedGlobalFields.set(key, entry);
      if (entry.chunks.some((part) => !part)) {
        res.json({ code: 0, message: 'chunk_received', data: { received: entry.chunks.filter(Boolean).length, total } });
        return;
      }

      const raw = entry.chunks.join('');
      chunkedGlobalFields.delete(key);
      const parsed = raw ? JSON.parse(raw) : {};
      const current = configStateService.getConfig();
      const draft: PluginConfig = {
        ...current,
        global: { ...(current.global || {}) },
        groups: { ...(current.groups || {}) }
      };
      if (groupId) {
        draft.groups[groupId] = {
          ...((draft.groups || {})[groupId] || {}),
          [field]: parsed,
          useGlobal: false
        } as GroupGuardSettings;
      } else {
        draft.global = { ...(draft.global || {}), [field]: parsed };
      }
      const saved = saveNormalizedConfig(draft);
      if (!saved.ok) {
        res.json({
          code: -2,
          message: `宸查樆鏂繚瀛橈細妫€娴嬪埌 ${saved.audit.summary.high} 鏉￠珮椋庨櫓浜烘牸妯℃澘闂`,
          data: { audit: saved.audit }
        });
        return;
      }

      res.json({ code: 0, message: 'field_saved' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.getNoAuth('/groups', async (_req: any, res: any) => {
    try {
      const result = await contextStateService.getActions()?.call('get_group_list', {});
      res.json({ code: 0, data: result || [] });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.getNoAuth('/group-config/export', (req: any, res: any) => {
    try {
      const groupId = String(req.query?.group_id || '').trim();
      if (!groupId) {
        res.json({ code: -1, message: '缺少 group_id' });
        return;
      }
      const custom = configStateService.getGroupSettings(groupId);
      const base = custom && custom.useGlobal === false ? custom : { ...configStateService.resolveGroupSettings(groupId), useGlobal: false };
      const healed = healGroupSettings(base);
      res.json({
        code: 0,
        data: {
          meta: { sourceGroupId: groupId, exportedAt: Date.now(), version: identityStateService.getVersion() },
          settings: healed.settings,
          fixes: healed.fixes
        }
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.postNoAuth('/group-config/import', (req: any, res: any) => {
    try {
      const body = req.body || {};
      const targetGroupId = String(body.targetGroupId || '').trim();
      if (!targetGroupId) {
        res.json({ code: -1, message: '缺少 targetGroupId' });
        return;
      }
      const mode = body.mode === 'merge' ? 'merge' : 'overwrite';
      const incoming = body.settings || {};
      const healedIncoming = healGroupSettings(incoming);
      const current = configStateService.getGroupSettings(targetGroupId) || {};
      const finalSettings = mode === 'merge'
        ? healGroupSettings({ ...current, ...healedIncoming.settings, useGlobal: false })
        : healedIncoming;
      configStateService.setGroupSettings(targetGroupId, finalSettings.settings);
      saveConfig(ctx);
      res.json({
        code: 0,
        message: '分群配置导入成功',
        data: {
          targetGroupId,
          mode,
          fixes: finalSettings.fixes
        }
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/sessions', (_req: any, res: any) => {
    const list = Array.from(sessionStateService.values()).map(s => ({
      userId: s.userId, groupId: s.groupId, expression: s.expression,
      attempts: s.attempts, maxAttempts: s.maxAttempts, createdAt: s.startTime,
      remainingMs: Math.max(0, s.startTime + configStateService.resolveGroupSettings(s.groupId).verifyTimeout * 1000 - Date.now()),
    }));
    res.json({ code: 0, data: list });
  });

  router.getNoAuth('/logs', (_req: any, res: any) => {
    res.json({ code: 0, data: loggingStateService.getLogBuffer() });
  });

  router.getNoAuth('/audit-events', async (req: any, res: any) => {
    try {
      const rawType = String(req.query?.event_type || '').trim();
      const eventType = rawType === 'risk_signal' || rawType === 'risk_assessment' || rawType === 'policy_decision' || rawType === 'manual_policy_action'
        ? rawType
        : undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const data = await groupguardRepository.queryAuditEvents({
        groupId: String(req.query?.group_id || '').trim() || undefined,
        userId: String(req.query?.user_id || '').trim() || undefined,
        eventType,
        limit,
        offset
      });
      res.json({ code: 0, data });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/audit-events/stats', async (req: any, res: any) => {
    try {
      const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours || 24)));
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 10)));
      const data = await groupguardRepository.getAuditStats({
        sinceMs: Date.now() - hours * 60 * 60 * 1000,
        limit
      });
      res.json({ code: 0, data: { ...data, hours } });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/audit-events/user-profile', async (req: any, res: any) => {
    try {
      const userId = String(req.query?.user_id || '').trim();
      if (!userId) {
        res.status(400).json({ code: -1, message: 'missing_user_id' });
        return;
      }
      const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours || 24)));
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
      const data = await groupguardRepository.getAuditUserProfile({
        userId,
        sinceMs: Date.now() - hours * 60 * 60 * 1000,
        limit
      });
      res.json({ code: 0, data: { ...data, hours } });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/action-queue/task-status', async (req: any, res: any) => {
    try {
      const taskId = String(req.query?.task_id || '').trim();
      if (!taskId) {
        res.status(400).json({ code: -1, message: 'missing_task_id' });
        return;
      }
      const data = await getActionQueueTaskSnapshot(taskId);
      res.json({ code: 0, data });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/action-queue/task-trace', async (req: any, res: any) => {
    try {
      const taskId = String(req.query?.task_id || '').trim();
      if (!taskId) {
        res.status(400).json({ code: -1, message: 'missing_task_id' });
        return;
      }
      const data = await getActionQueueTaskTrace(taskId);
      res.json({ code: 0, data });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/action-queue/events/stats', async (req: any, res: any) => {
    try {
      const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours || 24)));
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 10)));
      const data = await groupguardRepository.getActionQueueEventStats({
        sinceMs: Date.now() - hours * 60 * 60 * 1000,
        limit
      });
      res.json({ code: 0, data: { ...data, hours } });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/action-queue/trace-search', async (req: any, res: any) => {
    try {
      const kind = String(req.query?.kind || 'task_id').trim();
      const value = String(req.query?.value || '').trim();
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
      if (!value) {
        res.status(400).json({ code: -1, message: 'missing_value' });
        return;
      }
      if (kind === 'correlation_id') {
        const auditPage = await groupguardRepository.queryAuditEvents({ correlationId: value, limit: 100, offset: 0 });
        const taskIds: string[] = [];
        for (const event of auditPage.rows || []) {
          for (const taskId of extractQueueTaskIdsFromAuditPayload(event.payload)) {
            if (!taskIds.includes(taskId)) taskIds.push(taskId);
          }
        }
        const candidates = [];
        for (const taskId of taskIds.slice(0, limit)) {
          const rows = await groupguardRepository.getActionQueueEventsByTaskId(taskId, 100);
          const latest = rows[rows.length - 1];
          candidates.push({
            taskId,
            actionId: latest?.actionId || undefined,
            taskType: latest?.taskType || '',
            groupId: latest?.groupId || '',
            userId: latest?.userId,
            messageId: latest?.messageId,
            lastEvent: latest?.event || '',
            code: latest?.code || undefined,
            ok: latest?.ok,
            reason: latest?.reason || undefined,
            count: rows.length,
            updatedAt: latest?.createdAt || 0
          });
        }
        res.json({ code: 0, data: { query: { correlationId: value, limit }, candidates } });
        return;
      }
      const query: any = { limit };
      if (kind === 'task_id') query.taskId = value;
      else if (kind === 'action_id') query.actionId = value;
      else if (kind === 'group_id') query.groupId = value;
      else if (kind === 'user_id') query.userId = value;
      else if (kind === 'message_id') query.messageId = value;
      else if (kind === 'event') query.event = value;
      else {
        res.status(400).json({ code: -1, message: 'invalid_kind' });
        return;
      }
      const data = await groupguardRepository.searchActionQueueEvents(query);
      res.json({ code: 0, data });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/bot-antirisk/send-stats', async (req: any, res: any) => {
    try {
      const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours || 24)));
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 10)));
      const data = await groupguardRepository.getBotSendStats({
        sinceMs: Date.now() - hours * 60 * 60 * 1000,
        limit
      });
      res.json({ code: 0, data: { ...data, hours } });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.postNoAuth('/logs/clear', (_req: any, res: any) => {
    runtimeControlService.clearLogs();
    res.json({ code: 0, message: '日志已清除' });
  });

  router.getNoAuth('/activity', async (req: any, res: any) => {
    const groupId = req.query?.group_id || '';
    if (groupId) {
      const stats = await groupguardRepository.getAllActivity(groupId);
      res.json({ code: 0, data: stats || {} });
    } else {
      const groups = new Set<string>();
      const config = configStateService.getConfig();
      Object.keys(config.groups || {}).forEach(gid => groups.add(String(gid)));
      Object.keys(config.licenses || {}).forEach(gid => groups.add(String(gid)));
      const all: Record<string, any> = {};
      for (const gid of groups) {
        const stats = await groupguardRepository.getAllActivity(gid);
        if (stats && Object.keys(stats).length) all[gid] = stats;
      }
      res.json({ code: 0, data: all });
    }
  });

  router.getNoAuth('/sub-gameplay/overview', async (req: any, res: any) => {
    try {
      const groupId = String(req.query?.group_id || '').trim();
      if (!groupId) {
        res.status(400).json({ code: -1, message: 'missing_group_id' });
        return;
      }
      const limit = Math.max(3, Math.min(50, Number(req.query?.limit || 10)));
      const importedResources = getSubGameplayResourceOverview('', 12);
      res.json({
        code: 0,
        data: {
          groupId,
          masterServant: {
            goldRank: storageAdapter.listSubPlayersByRank(groupId, 'gold', limit),
            valueRank: storageAdapter.listSubPlayersByRank(groupId, 'value', limit),
            levelRank: storageAdapter.listSubPlayersByRank(groupId, 'level', limit)
          },
          racing: {
            winsRank: storageAdapter.listSubRacingPlayersByRank(groupId, 'wins', limit),
            championsRank: storageAdapter.listSubRacingPlayersByRank(groupId, 'champions', limit)
          },
          resources: storageAdapter.listSubResources(groupId),
          importedResources: {
            root: importedResources.root,
            generatedAt: importedResources.manifest?.generatedAt || '',
            summary: importedResources.manifest?.summary || null,
            samples: importedResources.entries
          },
          recentEvents: storageAdapter.listSubGameplayEvents(groupId, Math.max(20, limit))
        }
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/sub-gameplay/resources', async (req: any, res: any) => {
    try {
      const module = String(req.query?.module || '').trim();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)));
      const q = String(req.query?.q || '').trim();
      const collection = String(req.query?.collection || '').trim();
      const mediaType = String(req.query?.mediaType || '').trim();
      const sourceRelation = String(req.query?.sourceRelation || '').trim();
      const overview = getSubGameplayResourceOverview(module, limit, q, collection, mediaType, sourceRelation);
      const integrity = verifySubGameplayResourceIntegrity();
      res.json({
        code: 0,
        data: {
          root: overview.root,
          generatedAt: overview.manifest?.generatedAt || '',
          modules: overview.manifest?.modules || [],
          summary: overview.manifest?.summary || null,
          integrity,
          entries: overview.entries
        }
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  router.getNoAuth('/presets', (_req: any, res: any) => {
    res.json({ code: 0, data: configStateService.getPresets() || [] });
  });

  router.postNoAuth('/presets', (req: any, res: any) => {
    try {
      configStateService.setPresets(req.body?.presets || []);
      saveConfig(ctx);
      res.json({ code: 0, message: '预设已保存' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.getNoAuth('/persona/templates', (_req: any, res: any) => {
    const catalog = getReplyTemplateCatalog();
    res.json({ code: 0, data: catalog });
  });

  router.getNoAuth('/persona/audit', (_req: any, res: any) => {
    res.json({ code: 0, data: collectPersonaAuditForConfig(configStateService.getConfig()) });
  });

  router.postNoAuth('/persona/audit/preview', (req: any, res: any) => {
    const body = req.body || {};
    const previewGlobal = { ...(configStateService.getConfig().global || {}), ...(body.global || {}) };
    const report = auditReplyTemplates(BUILTIN_REPLY_SCENE_TEMPLATES, previewGlobal as any);
    res.json({ code: 0, data: { report } });
  });

  router.getNoAuth('/runtime', async (_req: any, res: any) => {
    const g = configStateService.getConfig().global || {};
    const storage = storageAdapter.getStorageStatus();
    const schema = await getRuntimeSchemaCatalog();
    res.json({
      code: 0,
      data: {
        storage,
        sendPolicy: {
          queueMode: g.queueMode || 'group',
          queueConcurrency: g.queueConcurrency || 2,
          globalMaxPerMinute: g.globalMaxPerMinute || 180,
          replyProbability: g.replyProbability ?? 100,
          disableReplyTemplate: !!g.disableReplyTemplate,
          autoRandomPersona: !!g.autoRandomPersona,
          replyTemplatePoolSize: Array.isArray(g.replyTemplatePool) ? g.replyTemplatePool.length : 0
        },
        riskPolicy: {
          qaCooldownSeconds: g.qaCooldownSeconds ?? 30,
          qaUserCooldownSeconds: g.qaUserCooldownSeconds ?? 12,
          qaTierCooldownLow: g.qaTierCooldownLow ?? 15,
          qaTierCooldownMedium: g.qaTierCooldownMedium ?? 30,
          qaTierCooldownHigh: g.qaTierCooldownHigh ?? 60,
          groupFuseWindowSeconds: g.groupFuseWindowSeconds ?? 60,
          groupFuseThreshold: g.groupFuseThreshold ?? 45,
          groupFuseCooldownSeconds: g.groupFuseCooldownSeconds ?? 90,
          allowRecallAdminMessage: !!g.allowRecallAdminMessage,
          allowRecallOwnerMessage: !!g.allowRecallOwnerMessage,
          protectAdminActions: g.protectAdminActions !== false,
          protectOwnerActions: g.protectOwnerActions !== false,
          actionRateWindowSeconds: g.actionRateWindowSeconds ?? 60,
          actionRateLimit: g.actionRateLimit ?? 30,
          recallDedupSeconds: g.recallDedupSeconds ?? 20,
          autoRiskControl: g.autoRiskControl !== false,
          personaAuditStrictMode: g.personaAuditStrictMode === true
        },
        featureFlags: {
          disableQA: !!g.disableQA,
          disableSignin: !!g.disableSignin,
          disableLottery: !!g.disableLottery,
          disableInvite: !!g.disableInvite,
          disableActivity: !!g.disableActivity,
          spamDetect: !!g.spamDetect,
          enableVerify: !!g.enableVerify
        },
        guardRuntime: getGuardRuntimeSnapshot(),
        personaAudit: collectPersonaAuditForConfig(configStateService.getConfig()),
        dynamicCommands: {
          registryVersion: getRegistryVersion(),
          overview: getSystemHealthOverview(),
          activeCommands: getActiveCommands(),
          schema,
          topFailingCommands: getTopFailingCommands(5),
          slowestCommands: getSlowestCommands(5),
          breakerHotspots: getCircuitBreakerHotspots()
        }
      }
    });
  });

  router.getNoAuth('/runtime/plugins', (_req: any, res: any) => {
    res.json({ code: 0, data: getPluginRegistrySnapshot() });
  });

  router.getNoAuth('/runtime/plugins/:id', (req: any, res: any) => {
    const pluginId = String(req.params?.id || '').trim();
    const record = getCommandPluginRecord(pluginId);
    if (!record) {
      res.json({ code: -1, message: 'plugin_not_found' });
      return;
    }
    res.json({
      code: 0,
      data: {
        id: record.plugin.definition.id,
        metadata: record.plugin.metadata,
        source: record.plugin.source,
        enabled: record.enabled,
        runtimeConfig: record.runtimeConfig,
        effectiveConfig: record.effectiveConfig,
        defaultConfig: record.plugin.defaultConfig || {},
        schema: record.schema,
        definition: record.plugin.definition
      }
    });
  });

  router.postNoAuth('/runtime/plugins/:id/enable', (req: any, res: any) => {
    const pluginId = String(req.params?.id || '').trim();
    const record = getCommandPluginRecord(pluginId);
    if (!record) {
      res.json({ code: -1, message: 'plugin_not_found' });
      return;
    }
    setCommandPluginEnabled(pluginId, true);
    refreshCommandPluginRegistry();
    refreshDynamicCommandRegistry();
    res.json({ code: 0, data: { id: pluginId, enabled: true } });
  });

  router.postNoAuth('/runtime/plugins/:id/disable', (req: any, res: any) => {
    const pluginId = String(req.params?.id || '').trim();
    const record = getCommandPluginRecord(pluginId);
    if (!record) {
      res.json({ code: -1, message: 'plugin_not_found' });
      return;
    }
    setCommandPluginEnabled(pluginId, false);
    refreshCommandPluginRegistry();
    refreshDynamicCommandRegistry();
    res.json({ code: 0, data: { id: pluginId, enabled: false } });
  });

  router.postNoAuth('/runtime/plugins/:id/config', (req: any, res: any) => {
    const pluginId = String(req.params?.id || '').trim();
    const record = getCommandPluginRecord(pluginId);
    if (!record) {
      res.json({ code: -1, message: 'plugin_not_found' });
      return;
    }
    const validation = validatePluginRuntimeConfig(req.body?.runtimeConfig);
    if (!validation.ok) {
      res.json({ code: -1, message: validation.message });
      return;
    }
    setCommandPluginRuntimeConfig(pluginId, validation.value);
    refreshCommandPluginRegistry();
    refreshDynamicCommandRegistry();
    res.json({
      code: 0,
      data: {
        id: pluginId,
        runtimeConfig: getCommandPluginRecord(pluginId)?.runtimeConfig || {},
        effectiveConfig: getCommandPluginRecord(pluginId)?.effectiveConfig || {}
      }
    });
  });

  router.getNoAuth('/runtime/schema', async (_req: any, res: any) => {
    res.json({ code: 0, data: await getRuntimeSchemaCatalog() });
  });

  router.getNoAuth('/runtime/health', (_req: any, res: any) => {
    res.json({
      code: 0,
      data: {
        overview: getSystemHealthOverview(),
        commands: getCommandHealthReport(),
        breakerHotspots: getCircuitBreakerHotspots()
      }
    });
  });

  router.getNoAuth('/runtime/metrics', (_req: any, res: any) => {
    res.json({ code: 0, data: getRuntimeMetricsSnapshot() });
  });

  router.getNoAuth('/runtime/metrics/plugins', (_req: any, res: any) => {
    res.json({ code: 0, data: getPluginMetricsView() });
  });

  router.getNoAuth('/runtime/metrics/commands', (_req: any, res: any) => {
    res.json({ code: 0, data: getCommandMetricsView() });
  });

  router.getNoAuth('/runtime/metrics/errors', (_req: any, res: any) => {
    res.json({ code: 0, data: getErrorMetricsView() });
  });

  router.getNoAuth('/runtime/debug/plugin/:id', (req: any, res: any) => {
    const commandId = String(req.params?.id || '').trim();
    const snapshot = getPluginDebugSnapshot(commandId);
    if (!snapshot) {
      res.json({ code: -1, message: 'plugin_not_found' });
      return;
    }
    res.json({ code: 0, data: snapshot });
  });

  router.postNoAuth('/runtime/risk-toggle', (req: any, res: any) => {
    const key = String(req?.body?.key || '');
    const enabled = !!req?.body?.enabled;
    const config = configStateService.getConfig();
    if (!config.global) config.global = { ...DEFAULT_PLUGIN_CONFIG.global };
    if (key === 'spamDetect') config.global.spamDetect = enabled;
    if (key === 'enableVerify') config.global.enableVerify = enabled;
    saveConfig(ctx);
    res.json({ code: 0, data: { key, enabled } });
  });

  loggingStateService.info('WebUI 路由已注册');
}
