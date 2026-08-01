// NapCat 群管插件
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path from 'path';
import type { PluginConfig, GroupGuardSettings } from './types';
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

export let plugin_config_ui: PluginConfigSchema = [];
let configFlushTimer: NodeJS.Timeout | null = null;

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

function getContextPathValue(ctx: NapCatPluginContext, key: string): string {
  const value = (ctx as any)?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveRuntimePaths(ctx: NapCatPluginContext) {
  const configPath = path.resolve(
    process.env.GROUPGUARD_CONFIG_PATH
    || getContextPathValue(ctx, 'configPath')
    || path.join(process.cwd(), 'config.json')
  );
  const configDir = path.dirname(configPath);
  const workDir = path.resolve(getContextPathValue(ctx, 'workDir') || configDir);
  const dataDir = path.resolve(
    process.env.GROUPGUARD_DATA_DIR
    || getContextPathValue(ctx, 'dataDir')
    || path.join(configDir, 'data')
  );
  const backupDir = path.resolve(
    process.env.GROUPGUARD_BACKUP_DIR
    || getContextPathValue(ctx, 'backupDir')
    || path.join(workDir, 'backups')
  );
  const dynamicCommandsConfigPath = path.resolve(
    process.env.DYNAMIC_COMMANDS_CONFIG_PATH
    || getContextPathValue(ctx, 'dynamicCommandsConfigPath')
    || path.join(configDir, 'dynamic-commands', 'commands.json')
  );
  return { workDir, configPath, configDir, dataDir, backupDir, dynamicCommandsConfigPath };
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

// ========== 插件初始化 ==========
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  if (!ctx || !ctx.actions || !ctx.NapCatConfig || !ctx.pluginManager?.config) {
    throw new Error('incompatible_runtime_context');
  }
  contextStateService.setLogger(ctx.logger);
  contextStateService.setActions({
    call: (actionName: string, params: unknown = {}) => ctx.actions.call(
      actionName, params as never, ctx.adapterName, ctx.pluginManager.config
    )
  });
  contextStateService.setHostProfileId('legacy-napcat-bridge');
  const runtimePaths = resolveRuntimePaths(ctx);
  (ctx as any).configPath = runtimePaths.configPath;
  contextStateService.setWorkDir(runtimePaths.workDir);
  contextStateService.setConfigPath(runtimePaths.configPath);
  contextStateService.setConfigDir(runtimePaths.configDir);
  contextStateService.setDataDir(runtimePaths.dataDir);
  contextStateService.setBackupDir(runtimePaths.backupDir);
  contextStateService.setDynamicCommandsConfigPath(runtimePaths.dynamicCommandsConfigPath);
  loggingStateService.info('群管插件正在初始化...');
  await initCommandValidation();

  plugin_config_ui = ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html(`
      <div style="padding:16px;background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(30,41,59,0.1));border:1px solid rgba(59,130,246,0.3);border-radius:12px;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="width:36px;height:36px;background:rgba(59,130,246,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;">🛡️</div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:600;">群管插件 v${identityStateService.getVersion()}</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">onebot-plugin-groupguard</p>
          </div>
        </div>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
          请前往 <a href="#" onclick="window.open(window.location.origin+'/plugin/onebot-plugin-groupguard/page/config','_blank');return false;" style="color:#3B82F6;font-weight:600;">WebUI 控制台</a> 进行详细配置；
          <a href="#" onclick="window.open(window.location.origin+'/plugin/onebot-plugin-groupguard/webui/send-wrapper.html','_blank');return false;" style="color:#3B82F6;font-weight:600;">全局消息包装</a> 可切换合并转发发送。
        </p>
      </div>
    `),
    ctx.NapCatConfig.text('licenseKey', '授权密钥', '', '专业版/企业版授权密钥'),
    ctx.NapCatConfig.text('ownerQQs', '主人QQ号（逗号分隔）', '', '拥有最高权限的QQ号'),
    ctx.NapCatConfig.boolean('debug', '调试模式', false, '显示详细日志'),
  );

  // 加载主配置
  if (fs.existsSync(ctx.configPath)) {
    let raw: PluginConfig;
    try {
      raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8')) as PluginConfig;
    } catch (error) {
      const backupPath = backupInvalidConfig(ctx.configPath, runtimePaths.backupDir);
      const backupHint = backupPath ? `，原文件已备份到 ${backupPath}` : '';
      loggingStateService.error(`主配置 JSON 无法解析，插件已停止初始化以防默认配置覆盖原文件${backupHint}: ${error}`);
      throw new Error('invalid_groupguard_config_json', { cause: error });
    }

    try {
      configStateService.setConfig(normalizePluginConfig(raw));
      syncAuditRetentionPolicy(configStateService.getConfig());

      storageAdapter.init(contextStateService.getConfigDir());
      bindAuditRetentionLogger();
      syncAuditRetentionPolicy(configStateService.getConfig());
      storageAdapter.migrateFromJson(contextStateService.getConfigDir(), configStateService.getConfig().groups || {});
      const loadedGroups = storageAdapter.loadAllGroupConfigs();
      configStateService.getConfig().groups = Object.entries(loadedGroups).reduce((acc, [gid, groupSettings]) => {
        acc[gid] = normalizeGroupSettings(groupSettings);
        return acc;
      }, {} as Record<string, GroupGuardSettings>);

      saveConfig(ctx);

    } catch (e) {
      loggingStateService.error(`加载配置出错，插件已停止初始化: ${e}`);
      throw e;
    }
  }

  // 初始化数据库
  await initDB();
  initInviteService(contextStateService.getConfigDir());
  startSelfRecallRecovery();

  // 初始化授权
  authManager.init();

  // 定时保存任务 (5分钟一次，减少 I/O)
  if (configFlushTimer) clearInterval(configFlushTimer);
  configFlushTimer = setInterval(() => {
    try { saveConfig(ctx); } catch (error) { loggingStateService.error(`后台保存配置失败: ${error}`); }
    // 顺便清理缓存
    contextStateService.cleanCache();
  }, 300000);

  registerRoutes(ctx);

  // 获取机器人QQ号
  try {
    const loginInfo = await contextStateService.getActions()?.call('get_login_info', {}) as { user_id?: number | string; } | undefined;
    contextStateService.setBotId(loginInfo?.user_id ? String(loginInfo.user_id) : '');
    if (identityStateService.getBotId()) loggingStateService.info(`机器人QQ: ${identityStateService.getBotId()}`);
  } catch { /* ignore */ }

  loggingStateService.info('群管插件初始化完成');
};

// ========== 路由注册 ==========
function registerRoutes (ctx: NapCatPluginContext): void {
  return registerRuntimeRoutes(ctx, collectPersonaAuditForConfig);
}

// ========== 配置管理 ==========
export const plugin_get_config = async (): Promise<PluginConfig> => configStateService.getConfig();
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
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
};

// ========== 插件清理 ==========
const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  loggingStateService.info('群管插件正在卸载...');
  if (configFlushTimer) {
    clearInterval(configFlushTimer);
    configFlushTimer = null;
  }
  authManager.cleanup();
  stopSelfRecallRecovery();
  configStateService.getConfig();
  const { pluginState } = await import('./state');
  pluginState.clearSelfRecallTimers();
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
};

// ========== 消息处理 ==========
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  await handlePluginMessage(ctx, event);
};

// ========== 事件处理 ==========
const plugin_onevent: PluginModule['plugin_onevent'] = async (ctx: NapCatPluginContext, event: unknown) => {
  await handlePluginEvent(ctx, event);
};

export { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup };
