// GroupGuard pure OneBot runtime entry.
import fs from 'fs';
import path from 'path';
import type { PluginConfig, GroupGuardSettings } from './types';
import type { OneBotMessageEvent, OneBotEvent } from './protocol/onebot11/types';
import type { GroupGuardRuntimeContext } from './runtime/runtime_context';
import { normalizeGroupSettings, normalizePluginConfig } from './config';
import { authManager } from './auth';
import { configStateService } from './core/state-services/config_state_service';
import { contextStateService } from './core/state-services/context_state_service';
import { cacheStateService } from './core/state-services/cache_state_service';
import { identityStateService } from './core/state-services/identity_state_service';
import { loggingStateService } from './core/state-services/logging_state_service';
import { initDB } from './db';
import { storageAdapter } from './storage_adapter';
import { clearAllSessions } from './verify';
import { startSelfRecallRecovery, stopSelfRecallRecovery } from './services/action_queue_service';
import { auditReplyTemplates } from './reply_template_audit';
import { BUILTIN_REPLY_SCENE_TEMPLATES } from './reply_templates';
import { flushInviteService, initInviteService, stopInviteService } from './services/invite_service';
import { registerRuntimeRoutes } from './runtime/runtime_routes';
import { handlePluginMessage } from './runtime/runtime_message_pipeline';
import { handlePluginEvent } from './runtime/runtime_event_pipeline';
import { saveConfig, initCommandValidation } from './commands';
import { stopPassiveServiceTimers } from './services/passive_service';
import { stopJoinVerifier } from './join_verifier';

export let plugin_config_ui: unknown[] = [];
let configFlushTimer: NodeJS.Timeout | null = null;
let activeContext: GroupGuardRuntimeContext | null = null;
let initialization: Promise<void> | null = null;
let initialized = false;

function syncAuditRetentionPolicy(config: PluginConfig): void {
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

function backupInvalidConfig(configPath: string, backupDir: string): string | null {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `${path.basename(configPath)}.corrupt-${timestamp}-${process.pid}.bak`
    );
    fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
    return backupPath;
  } catch (error) {
    loggingStateService.error(`备份损坏配置失败: ${error}`);
    return null;
  }
}

function collectPersonaAuditForConfig(config: PluginConfig) {
  const globalAudit = auditReplyTemplates(BUILTIN_REPLY_SCENE_TEMPLATES, config.global);
  const groups = Object.entries(config.groups || {}).map(([groupId, settings]) => {
    const report = auditReplyTemplates(BUILTIN_REPLY_SCENE_TEMPLATES, settings as any);
    return { groupId, report };
  }).filter(item => item.report.issueCount.total > 0);
  const groupIssueCount = groups.reduce((acc, item) => {
    acc.high += item.report.issueCount.high;
    acc.medium += item.report.issueCount.medium;
    acc.low += item.report.issueCount.low;
    acc.total += item.report.issueCount.total;
    return acc;
  }, { high: 0, medium: 0, low: 0, total: 0 });
  return {
    global: globalAudit,
    groups,
    summary: {
      high: globalAudit.issueCount.high + groupIssueCount.high,
      medium: globalAudit.issueCount.medium + groupIssueCount.medium,
      low: globalAudit.issueCount.low + groupIssueCount.low,
      total: globalAudit.issueCount.total + groupIssueCount.total
    }
  };
}

function bindRuntimeContext(ctx: GroupGuardRuntimeContext): void {
  contextStateService.setLogger(ctx.logger);
  contextStateService.setActions(ctx.actions);
  contextStateService.setHostProfileId(ctx.hostProfile.id);
  contextStateService.setWorkDir(ctx.workDir);
  contextStateService.setConfigPath(ctx.configPath);
  contextStateService.setConfigDir(ctx.configDir);
  contextStateService.setDataDir(ctx.dataDir);
  contextStateService.setBackupDir(ctx.backupDir);
  contextStateService.setDynamicCommandsConfigPath(ctx.dynamicCommandsConfigPath);
}

async function initializeOnce(ctx: GroupGuardRuntimeContext): Promise<void> {
  if (!ctx?.actions || !ctx?.hostProfile || !ctx?.logger || !ctx?.configPath) {
    throw new Error('incompatible_groupguard_runtime_context');
  }
  activeContext = ctx;
  bindRuntimeContext(ctx);
  loggingStateService.info(`GroupGuard 正在初始化 hostProfile=${ctx.hostProfile.id}`);
  await initCommandValidation();

  if (fs.existsSync(ctx.configPath)) {
    let raw: PluginConfig;
    try {
      raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8')) as PluginConfig;
    } catch (error) {
      const backupPath = backupInvalidConfig(ctx.configPath, ctx.backupDir);
      const backupHint = backupPath ? `，原文件已备份到 ${backupPath}` : '';
      loggingStateService.error(`主配置 JSON 无法解析，运行时已停止初始化以防默认配置覆盖原文件${backupHint}: ${error}`);
      throw new Error('invalid_groupguard_config_json', { cause: error });
    }

    configStateService.setConfig(normalizePluginConfig(raw));
    syncAuditRetentionPolicy(configStateService.getConfig());
    storageAdapter.init(ctx.configDir);
    bindAuditRetentionLogger();
    syncAuditRetentionPolicy(configStateService.getConfig());
    storageAdapter.migrateFromJson(ctx.configDir, configStateService.getConfig().groups || {});
    const loadedGroups = storageAdapter.loadAllGroupConfigs();
    configStateService.getConfig().groups = Object.entries(loadedGroups).reduce((acc, [gid, groupSettings]) => {
      acc[gid] = normalizeGroupSettings(groupSettings);
      return acc;
    }, {} as Record<string, GroupGuardSettings>);
    saveConfig(ctx);
  }

  await initDB();
  initInviteService(ctx.configDir);
  startSelfRecallRecovery();
  authManager.init();

  if (configFlushTimer) clearInterval(configFlushTimer);
  configFlushTimer = setInterval(() => {
    try { saveConfig(ctx); } catch (error) { loggingStateService.error(`后台保存配置失败: ${error}`); }
    contextStateService.cleanCache();
  }, 300000);

  registerRuntimeRoutes(ctx, collectPersonaAuditForConfig);

  try {
    const loginInfo = await ctx.actions.call('get_login_info', {}) as { user_id?: number | string } | undefined;
    contextStateService.setBotId(loginInfo?.user_id ? String(loginInfo.user_id) : '');
    if (identityStateService.getBotId()) loggingStateService.info(`机器人QQ: ${identityStateService.getBotId()}`);
  } catch (error) {
    loggingStateService.warn(`获取机器人身份失败，连接后将重试: ${String(error)}`);
  }

  initialized = true;
  loggingStateService.info('GroupGuard 初始化完成');
}

export async function initializeGroupGuard(ctx: GroupGuardRuntimeContext): Promise<void> {
  if (initialized) {
    if (activeContext !== ctx) throw new Error('groupguard_runtime_already_initialized');
    return;
  }
  if (initialization) return initialization;
  initialization = initializeOnce(ctx).catch(async (error) => {
    initialized = false;
    try { await shutdownGroupGuard(); } catch { /* best-effort reset */ }
    throw error;
  }).finally(() => {
    initialization = null;
  });
  return initialization;
}

export async function getGroupGuardConfig(): Promise<PluginConfig> {
  return configStateService.getConfig();
}

export async function setGroupGuardConfig(ctx: GroupGuardRuntimeContext, config: PluginConfig): Promise<void> {
  const normalizedConfig = normalizePluginConfig(config);
  const audit = collectPersonaAuditForConfig(normalizedConfig);
  const strictMode = normalizedConfig?.global?.personaAuditStrictMode === true;
  if (strictMode && audit.summary.high > 0) {
    loggingStateService.warn(`已阻断配置写入: 人格模板高风险问题 ${audit.summary.high} 条`);
    return;
  }
  configStateService.setConfig(normalizedConfig);
  syncAuditRetentionPolicy(normalizedConfig);
  if (audit.summary.total > 0) {
    loggingStateService.warn(`人格模板审计提示: high=${audit.summary.high} medium=${audit.summary.medium} low=${audit.summary.low}`);
  }
  saveConfig(ctx);
}

export async function shutdownGroupGuard(): Promise<void> {
  if (!initialized && !activeContext && !configFlushTimer) return;
  loggingStateService.info('GroupGuard 正在停止...');
  initialized = false;
  if (configFlushTimer) {
    clearInterval(configFlushTimer);
    configFlushTimer = null;
  }
  authManager.cleanup();
  stopSelfRecallRecovery();
  try {
    const { pluginState } = await import('./state');
    pluginState.clearSelfRecallTimers();
  } catch { /* runtime may have failed before state initialization */ }
  await flushInviteService();
  stopInviteService();
  stopPassiveServiceTimers();
  stopJoinVerifier();
  clearAllSessions();
  cacheStateService.clearMessageCache();
  cacheStateService.clearSpamCache();
  cacheStateService.clearRepeatCache();
  cacheStateService.clearQaCooldowns();
  cacheStateService.clearAdminCache();
  storageAdapter.close();
  activeContext = null;
}

function requireContext(ctx?: GroupGuardRuntimeContext): GroupGuardRuntimeContext {
  const resolved = ctx || activeContext;
  if (!resolved || !initialized) throw new Error('groupguard_runtime_not_ready');
  return resolved;
}

export async function handleGroupGuardMessage(event: OneBotMessageEvent, ctx?: GroupGuardRuntimeContext): Promise<void> {
  await handlePluginMessage(requireContext(ctx), event);
}

export async function handleGroupGuardEvent(event: OneBotEvent, ctx?: GroupGuardRuntimeContext): Promise<void> {
  await handlePluginEvent(requireContext(ctx), event);
}

export function getGroupGuardRuntimeContext(): GroupGuardRuntimeContext | null {
  return activeContext;
}

// Stable aliases for existing integrations while the runtime entry name migrates.
export const plugin_init = initializeGroupGuard;
export const plugin_get_config = getGroupGuardConfig;
export const plugin_set_config = setGroupGuardConfig;
export const plugin_cleanup = shutdownGroupGuard;
export const plugin_onmessage = async (ctx: GroupGuardRuntimeContext, event: OneBotMessageEvent) => handleGroupGuardMessage(event, ctx);
export const plugin_onevent = async (ctx: GroupGuardRuntimeContext, event: OneBotEvent) => handleGroupGuardEvent(event, ctx);
