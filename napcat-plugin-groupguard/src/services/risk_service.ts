import { authManager } from '../auth';
import { DEFAULT_MSG_FILTER, RISK_CONTROL_MENU } from '../config';
import { isAdminOrOwner, saveConfig, sendGroupScene, sendPrivateScene } from '../commands/common';
import { authStateService } from '../core/state-services/auth_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import type { CommandExecutionContext } from './command_service_types';

function getConfig() {
  return configStateService.getConfig();
}

function ensureGroupSettings(groupId: string) {
  const config = getConfig();
  if (!config.groups[groupId]) config.groups[groupId] = { ...configStateService.resolveGroupSettings(groupId) };
  return config.groups[groupId];
}

export async function executeRiskCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, ctx } = input;
  if (event.message_type === 'private') {
    if (!authStateService.isOwner(userId)) return true;
    if (text === '开启调试') { getConfig().debug = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '调试模式已开启'); return true; }
    if (text === '关闭调试') { getConfig().debug = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '调试模式已关闭'); return true; }
    if (text === '开启随机后缀') { getConfig().global.randomSuffix = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '全局随机后缀已开启'); return true; }
    if (text === '关闭随机后缀') { getConfig().global.randomSuffix = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '全局随机后缀已关闭'); return true; }
    if (text === '开启纯文本回复') { getConfig().global.disableReplyTemplate = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '纯文本回复模式已开启（关闭人格与模板包装）'); return true; }
    if (text === '关闭纯文本回复') { getConfig().global.disableReplyTemplate = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '纯文本回复模式已关闭（恢复人格与模板包装）'); return true; }
    if (text === '开启全局自身撤回') {
      getConfig().global.autoRecallSelf = true;
      getConfig().global.autoRecallSelfDelay = 60;
      getConfig().global.selfRecall = {
        enabled: true,
        mode: 'fixed',
        fixedDelay: 60,
        minDelay: 45,
        maxDelay: 90,
        jitter: 0
      };
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', '全局自身撤回已开启，默认延迟60秒');
      return true;
    }
    if (text === '关闭全局自身撤回') {
      getConfig().global.autoRecallSelf = false;
      getConfig().global.selfRecall = {
        enabled: false,
        mode: 'fixed',
        fixedDelay: 60,
        minDelay: 45,
        maxDelay: 90,
        jitter: 0
      };
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', '全局自身撤回已关闭');
      return true;
    }
    if (text === '开启撤回管理员消息') { getConfig().global.allowRecallAdminMessage = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已允许自动撤回管理员消息'); return true; }
    if (text === '关闭撤回管理员消息') { getConfig().global.allowRecallAdminMessage = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已禁止自动撤回管理员消息'); return true; }
    if (text === '开启撤回群主消息') { getConfig().global.allowRecallOwnerMessage = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已允许自动撤回群主消息'); return true; }
    if (text === '关闭撤回群主消息') { getConfig().global.allowRecallOwnerMessage = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已禁止自动撤回群主消息'); return true; }
    if (text === '开启管理员保护') { getConfig().global.protectAdminActions = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已开启管理员保护'); return true; }
    if (text === '关闭管理员保护') { getConfig().global.protectAdminActions = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已关闭管理员保护'); return true; }
    if (text === '开启群主保护') { getConfig().global.protectOwnerActions = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已开启群主保护'); return true; }
    if (text === '关闭群主保护') { getConfig().global.protectOwnerActions = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '已关闭群主保护'); return true; }
    if (text === '开启自动风控收敛') { getConfig().global.autoRiskControl = true; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '自动风控收敛已开启'); return true; }
    if (text === '关闭自动风控收敛') { getConfig().global.autoRiskControl = false; saveConfig(ctx); await sendPrivateScene(userId, 'action_success', '自动风控收敛已关闭'); return true; }
    if (text.startsWith('设置随机延迟 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 3) { await sendPrivateScene(userId, 'command_format_error', '格式：设置随机延迟 <最小ms> <最大ms>', { example: '设置随机延迟 100 800' }); return true; }
      const min = parseInt(parts[1]);
      const max = parseInt(parts[2]);
      if (isNaN(min) || isNaN(max)) { await sendPrivateScene(userId, 'command_format_error', '请输入有效的数字'); return true; }
      getConfig().global.randomDelayMin = min;
      getConfig().global.randomDelayMax = max;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `全局随机延迟已设置为 ${min}-${max}ms`);
      return true;
    }
    if (text.startsWith('设置发送队列模式 ')) {
      const mode = text.slice('设置发送队列模式 '.length).trim();
      if (mode !== '全局' && mode !== '分群') { await sendPrivateScene(userId, 'command_format_error', '格式：设置发送队列模式 全局/分群', { example: '设置发送队列模式 全局' }); return true; }
      getConfig().global.queueMode = mode === '全局' ? 'global' : 'group';
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `发送队列模式已设置为：${mode}`);
      return true;
    }
    if (text.startsWith('设置发送并发 ')) {
      const n = parseInt(text.slice('设置发送并发 '.length).trim());
      if (isNaN(n) || n < 1 || n > 20) { await sendPrivateScene(userId, 'invalid_range', '并发范围：1-20', { example: '设置发送并发 4' }); return true; }
      getConfig().global.queueConcurrency = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `发送并发已设置为：${n}`);
      return true;
    }
    if (text.startsWith('设置全局限流 ')) {
      const n = parseInt(text.slice('设置全局限流 '.length).trim());
      if (isNaN(n) || n < 1) { await sendPrivateScene(userId, 'invalid_range', '请输入大于0的数字（单位：条/分钟）', { example: '设置全局限流 180' }); return true; }
      getConfig().global.globalMaxPerMinute = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `全局发送限流已设置为：${n}条/分钟`);
      return true;
    }
    if (text.startsWith('设置问答冷却 ')) {
      const n = parseInt(text.slice('设置问答冷却 '.length).trim());
      if (isNaN(n) || n < 0 || n > 3600) { await sendPrivateScene(userId, 'invalid_range', '冷却范围：0-3600 秒', { example: '设置问答冷却 30' }); return true; }
      getConfig().global.qaCooldownSeconds = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `问答冷却已设置为：${n}秒`);
      return true;
    }
    if (text.startsWith('设置用户冷却 ')) {
      const n = parseInt(text.slice('设置用户冷却 '.length).trim());
      if (isNaN(n) || n < 0 || n > 3600) { await sendPrivateScene(userId, 'invalid_range', '冷却范围：0-3600 秒', { example: '设置用户冷却 12' }); return true; }
      getConfig().global.qaUserCooldownSeconds = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `同用户冷却已设置为：${n}秒`);
      return true;
    }
    if (text.startsWith('设置分级冷却 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await sendPrivateScene(userId, 'command_format_error', '格式：设置分级冷却 <低> <中> <高>', { example: '设置分级冷却 15 30 60' }); return true; }
      const low = parseInt(parts[1]);
      const medium = parseInt(parts[2]);
      const high = parseInt(parts[3]);
      if ([low, medium, high].some(n => isNaN(n) || n < 0 || n > 3600)) { await sendPrivateScene(userId, 'invalid_range', '范围：0-3600 秒'); return true; }
      getConfig().global.qaTierCooldownLow = low;
      getConfig().global.qaTierCooldownMedium = medium;
      getConfig().global.qaTierCooldownHigh = high;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `分级冷却已设置：低${low}s / 中${medium}s / 高${high}s`);
      return true;
    }
    if (text.startsWith('设置群熔断 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await sendPrivateScene(userId, 'command_format_error', '格式：设置群熔断 <窗口秒> <阈值> <熔断秒>', { example: '设置群熔断 60 45 90' }); return true; }
      const windowSec = parseInt(parts[1]);
      const threshold = parseInt(parts[2]);
      const cooldownSec = parseInt(parts[3]);
      if ([windowSec, threshold, cooldownSec].some(n => isNaN(n) || n <= 0)) { await sendPrivateScene(userId, 'invalid_range', '请输入大于0的整数'); return true; }
      getConfig().global.groupFuseWindowSeconds = windowSec;
      getConfig().global.groupFuseThreshold = threshold;
      getConfig().global.groupFuseCooldownSeconds = cooldownSec;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `群熔断已设置：窗口${windowSec}s 阈值${threshold} 熔断${cooldownSec}s`);
      return true;
    }
    if (text.startsWith('设置回复概率 ')) {
      const n = parseInt(text.slice('设置回复概率 '.length).trim());
      if (isNaN(n) || n < 0 || n > 100) { await sendPrivateScene(userId, 'invalid_range', '概率范围：0-100', { example: '设置回复概率 80' }); return true; }
      getConfig().global.replyProbability = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `回复概率已设置为：${n}%`);
      return true;
    }
    if (text.startsWith('设置回复模板 ')) {
      const rawTpl = text.slice('设置回复模板 '.length).trim();
      const arr = rawTpl.split('|').map(s => s.trim()).filter(Boolean);
      if (!arr.length) { await sendPrivateScene(userId, 'command_format_error', '格式：设置回复模板 模板1|模板2（模板需包含 {msg}）'); return true; }
      const valid = arr.filter(s => s.includes('{msg}'));
      if (!valid.length) { await sendPrivateScene(userId, 'command_format_error', '模板必须包含 {msg} 占位符'); return true; }
      getConfig().global.replyTemplatePool = valid;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `回复模板已更新，共${valid.length}条`, { total: valid.length });
      return true;
    }
    if (text.startsWith('设置动作限流 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 3) { await sendPrivateScene(userId, 'command_format_error', '格式：设置动作限流 <窗口秒> <阈值>', { example: '设置动作限流 60 30' }); return true; }
      const windowSec = parseInt(parts[1]);
      const limit = parseInt(parts[2]);
      if (isNaN(windowSec) || isNaN(limit) || windowSec < 1 || limit < 1) { await sendPrivateScene(userId, 'invalid_range', '请输入大于0的整数'); return true; }
      getConfig().global.actionRateWindowSeconds = windowSec;
      getConfig().global.actionRateLimit = limit;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `动作限流已设置：窗口${windowSec}s 阈值${limit}`);
      return true;
    }
    if (text.startsWith('设置撤回去重 ')) {
      const n = parseInt(text.slice('设置撤回去重 '.length).trim());
      if (isNaN(n) || n < 1 || n > 600) { await sendPrivateScene(userId, 'invalid_range', '范围：1-600 秒', { example: '设置撤回去重 20' }); return true; }
      getConfig().global.recallDedupSeconds = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `撤回去重窗口已设置为 ${n} 秒`);
      return true;
    }
    if (text.startsWith('设置风险阈值 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await sendPrivateScene(userId, 'command_format_error', '格式：设置风险阈值 <预警分> <保护分> <衰减秒>', { example: '设置风险阈值 3 8 300' }); return true; }
      const warn = parseInt(parts[1]);
      const protect = parseInt(parts[2]);
      const decay = parseInt(parts[3]);
      if ([warn, protect, decay].some(n => isNaN(n) || n < 1) || protect <= warn) { await sendPrivateScene(userId, 'invalid_range', '参数无效，需保护分大于预警分且都大于0'); return true; }
      getConfig().global.riskWarnScore = warn;
      getConfig().global.riskProtectScore = protect;
      getConfig().global.riskDecaySeconds = decay;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `风险阈值已设置：预警${warn} 保护${protect} 衰减${decay}s`);
      return true;
    }
    if (text.startsWith('设置处罚速率 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await sendPrivateScene(userId, 'command_format_error', '格式：设置处罚速率 <踢/分> <禁言/分> <撤回/分>', { example: '设置处罚速率 3 5 60' }); return true; }
      const kick = parseInt(parts[1]);
      const ban = parseInt(parts[2]);
      const recall = parseInt(parts[3]);
      if ([kick, ban, recall].some(n => isNaN(n) || n < 1)) { await sendPrivateScene(userId, 'invalid_range', '请输入大于0的整数'); return true; }
      getConfig().global.maxKickPerMinute = kick;
      getConfig().global.maxBanPerMinute = ban;
      getConfig().global.maxRecallPerMinute = recall;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `处罚速率已设置：踢${kick}/分 禁言${ban}/分 撤回${recall}/分`);
      return true;
    }
    if (text.startsWith('设置动作延迟 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 5) { await sendPrivateScene(userId, 'command_format_error', '格式：设置动作延迟 <踢最小秒> <踢最大秒> <撤回最小秒> <撤回最大秒>', { example: '设置动作延迟 5 20 1 3' }); return true; }
      const kickMin = parseFloat(parts[1]);
      const kickMax = parseFloat(parts[2]);
      const recallMin = parseFloat(parts[3]);
      const recallMax = parseFloat(parts[4]);
      if ([kickMin, kickMax, recallMin, recallMax].some(n => Number.isNaN(n) || n < 0)) { await sendPrivateScene(userId, 'invalid_range', '请输入大于等于0的数字'); return true; }
      getConfig().global.kickDelayMinSeconds = kickMin;
      getConfig().global.kickDelayMaxSeconds = Math.max(kickMin, kickMax);
      getConfig().global.recallDelayMinSeconds = recallMin;
      getConfig().global.recallDelayMaxSeconds = Math.max(recallMin, recallMax);
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `动作延迟已设置：踢${getConfig().global.kickDelayMinSeconds}-${getConfig().global.kickDelayMaxSeconds}s 撤回${getConfig().global.recallDelayMinSeconds}-${getConfig().global.recallDelayMaxSeconds}s`);
      return true;
    }
    if (text.startsWith('设置黑名单动作 ')) {
      const modeRaw = text.slice('设置黑名单动作 '.length).trim();
      let mode: 'recall' | 'ban' | 'kick' | 'kick_and_block' | null = null;
      if (modeRaw === '撤回') mode = 'recall';
      if (modeRaw === '禁言') mode = 'ban';
      if (modeRaw === '踢出') mode = 'kick';
      if (modeRaw === '踢出并拉黑') mode = 'kick_and_block';
      if (!mode) { await sendPrivateScene(userId, 'invalid_range', '可选：撤回/禁言/踢出/踢出并拉黑', { example: '设置黑名单动作 踢出并拉黑' }); return true; }
      getConfig().global.blacklistAction = mode;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `黑名单动作已设置为：${modeRaw}`);
      return true;
    }
    if (text.startsWith('设置黑名单禁言 ')) {
      const n = parseInt(text.slice('设置黑名单禁言 '.length).trim());
      if (isNaN(n) || n < 1 || n > 1440) { await sendPrivateScene(userId, 'invalid_range', '范围：1-1440 分钟', { example: '设置黑名单禁言 30' }); return true; }
      getConfig().global.blacklistBanMinutes = n;
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `黑名单禁言时长已设置为 ${n} 分钟`);
      return true;
    }
    if (text === '开启黑名单前置' || text === '关闭黑名单前置') {
      getConfig().global.blacklistCheckBeforeCommand = text === '开启黑名单前置';
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', text === '开启黑名单前置' ? '已开启黑名单前置检测' : '已关闭黑名单前置检测');
      return true;
    }
    if (text === '查看发送策略') {
      const g = getConfig().global;
      await sendPrivateScene(
        userId,
        'raw_text',
        `发送策略：\n队列模式: ${g.queueMode === 'global' ? '全局' : '分群'}\n发送并发: ${g.queueConcurrency || 1}\n全局限流: ${(g.globalMaxPerMinute || 180)}条/分钟\n问答冷却: ${(g.qaCooldownSeconds ?? 30)}秒\n同用户冷却: ${(g.qaUserCooldownSeconds ?? 12)}秒\n分级冷却: 低${g.qaTierCooldownLow ?? 15}/中${g.qaTierCooldownMedium ?? 30}/高${g.qaTierCooldownHigh ?? 60}\n群熔断: 窗口${g.groupFuseWindowSeconds ?? 60}s 阈值${g.groupFuseThreshold ?? 45} 熔断${g.groupFuseCooldownSeconds ?? 90}s\n回复概率: ${(g.replyProbability ?? 100)}%\n纯文本回复: ${g.disableReplyTemplate ? '开启' : '关闭'}\n模板池: ${(g.replyTemplatePool || ['{msg}']).join(' | ')}\n撤回管理员消息: ${g.allowRecallAdminMessage ? '允许' : '禁止'}\n撤回群主消息: ${g.allowRecallOwnerMessage ? '允许' : '禁止'}\n管理员保护: ${g.protectAdminActions === false ? '关闭' : '开启'}\n群主保护: ${g.protectOwnerActions === false ? '关闭' : '开启'}\n动作限流: 窗口${g.actionRateWindowSeconds ?? 60}s 阈值${g.actionRateLimit ?? 30}\n撤回去重: ${g.recallDedupSeconds ?? 20}s\n自动风控收敛: ${g.autoRiskControl === false ? '关闭' : '开启'}\n风险阈值: 预警${g.riskWarnScore ?? 3} 保护${g.riskProtectScore ?? 8} 衰减${g.riskDecaySeconds ?? 300}s\n处罚速率: 踢${g.maxKickPerMinute ?? 3}/分 禁言${g.maxBanPerMinute ?? 5}/分 撤回${g.maxRecallPerMinute ?? 60}/分\n黑名单动作: ${g.blacklistAction === 'ban' ? '禁言' : g.blacklistAction === 'kick' ? '踢出' : g.blacklistAction === 'kick_and_block' ? '踢出并拉黑' : '撤回'}\n黑名单前置: ${g.blacklistCheckBeforeCommand === false ? '关闭' : '开启'}\n黑名单踢出延迟: ${(g.blacklistKickDelayMinSeconds ?? g.kickDelayMinSeconds ?? 5)}-${(g.blacklistKickDelayMaxSeconds ?? g.kickDelayMaxSeconds ?? 20)}s\n动作延迟: 踢${g.kickDelayMinSeconds ?? 5}-${g.kickDelayMaxSeconds ?? 20}s 撤回${g.recallDelayMinSeconds ?? 1}-${g.recallDelayMaxSeconds ?? 3}s`
      );
      return true;
    }
    return false;
  }

  if (!authManager.getGroupLicense(groupId)) return false;
  if (text === '风控设置' || text === '安全设置') {
    const selfId = String((event as any).self_id || '');
    const nodes = [
      { type: 'node', data: { nickname: '🛡️ 风控配置', user_id: selfId, content: [{ type: 'text', data: { text: RISK_CONTROL_MENU } }] } }
    ];
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', forwardNodes: nodes, force: true, applyTemplate: true });
    return true;
  }
  if (text.startsWith('设置权限缓存 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const seconds = parseInt(text.slice(7));
    if (isNaN(seconds) || seconds < 0) { await sendGroupScene(groupId, 'invalid_range', '请输入有效的秒数 (0=关闭)', { example: '设置权限缓存 60' }); return true; }
    ensureGroupSettings(groupId).adminCacheSeconds = seconds;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已设置管理员权限缓存时间为 ${seconds} 秒`, { seconds });
    return true;
  }
  if (text.startsWith('开启宵禁 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const parts = text.split(/\s+/);
    if (parts.length < 3) { await sendGroupScene(groupId, 'command_format_error', '格式：开启宵禁 00:00 06:00', { example: '开启宵禁 00:00 06:00' }); return true; }
    const gs = ensureGroupSettings(groupId);
    gs.curfewEnabled = true;
    gs.curfewStart = parts[1];
    gs.curfewEnd = parts[2];
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已开启宵禁：每天 ${gs.curfewStart} 至 ${gs.curfewEnd} 全员禁言`);
    return true;
  }
  if (text === '关闭宵禁') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const gs = ensureGroupSettings(groupId);
    gs.curfewEnabled = false;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '已关闭宵禁');
    return true;
  }
  if (text === '开启刷屏检测' || text === '关闭刷屏检测') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    ensureGroupSettings(groupId).spamDetect = text === '开启刷屏检测';
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启刷屏检测' ? '已开启刷屏检测' : '已关闭刷屏检测');
    return true;
  }
  if (text.startsWith('设置复读阈值 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const val = parseInt(text.slice(7).trim());
    if (isNaN(val) || val < 0) { await sendGroupScene(groupId, 'invalid_range', '请输入有效的数字 (0表示关闭)', { example: '设置复读阈值 3' }); return true; }
    ensureGroupSettings(groupId).repeatThreshold = val;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已设置复读阈值: ${val} (连续${val}条相同内容触发检测)`, { val });
    return true;
  }
  if (text.startsWith('设置刷屏窗口 ') || text.startsWith('设置刷屏阈值 ') || text.startsWith('设置刷屏禁言 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const v = parseInt(text.slice(7).trim());
    if (isNaN(v) || v < 1) { await sendGroupScene(groupId, 'invalid_range', '请输入有效数字（至少1）'); return true; }
    const gs = ensureGroupSettings(groupId);
    if (text.startsWith('设置刷屏窗口 ')) gs.spamWindow = v;
    else if (text.startsWith('设置刷屏阈值 ')) gs.spamThreshold = v;
    else gs.spamBanMinutes = v;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '刷屏参数已更新');
    return true;
  }
  if (text === '开启入群验证' || text === '关闭入群验证' || text === '开启自动审批' || text === '关闭自动审批' || text === '开启退群拉黑' || text === '关闭退群拉黑') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const gs = ensureGroupSettings(groupId);
    if (text === '开启入群验证') gs.enableVerify = true;
    if (text === '关闭入群验证') gs.enableVerify = false;
    if (text === '开启自动审批') gs.autoApprove = true;
    if (text === '关闭自动审批') gs.autoApprove = false;
    if (text === '开启退群拉黑') gs.leaveBlacklist = true;
    if (text === '关闭退群拉黑') gs.leaveBlacklist = false;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '设置已更新');
    return true;
  }
  if (text.startsWith('设置入群暗号 ') || text.startsWith('设置暗号 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const passphrase = text.startsWith('设置入群暗号 ') ? text.slice(7).trim() : text.slice(5).trim();
    if (!passphrase) { await sendGroupScene(groupId, 'command_format_error', '暗号不能为空'); return true; }
    ensureGroupSettings(groupId).entryPassphrase = passphrase;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已设置入群暗号为：「${passphrase}」`);
    return true;
  }
  if (text === '关闭入群暗号' || text === '开启暗号回落' || text === '关闭暗号回落') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const gs = ensureGroupSettings(groupId);
    if (text === '关闭入群暗号') gs.entryPassphrase = '';
    if (text === '开启暗号回落') gs.enableAutoApproveAfterPassphraseOff = true;
    if (text === '关闭暗号回落') gs.enableAutoApproveAfterPassphraseOff = false;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '设置已更新');
    return true;
  }
  if (text.startsWith('开启功能 ') || text.startsWith('关闭功能 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const isEnable = text.startsWith('开启功能 ');
    const feature = text.slice(5).trim();
    const gs = ensureGroupSettings(groupId);
    switch (feature) {
      case '问答': gs.disableQA = !isEnable; break;
      case '签到': gs.disableSignin = !isEnable; break;
      case '抽奖': gs.disableLottery = !isEnable; break;
      case '邀请统计': gs.disableInvite = !isEnable; break;
      case '入群欢迎': gs.disableWelcome = !isEnable; break;
      case '活跃统计': gs.disableActivity = !isEnable; break;
      case '战绩查询': gs.disableLolQuery = !isEnable; break;
      case '自动同意': gs.autoApprove = isEnable; break;
      case '入群验证': gs.enableVerify = isEnable; break;
      case '刷屏检测': gs.spamDetect = isEnable; break;
      case '退群拉黑': gs.leaveBlacklist = isEnable; break;
      case '暗号回落': gs.enableAutoApproveAfterPassphraseOff = isEnable; break;
      case '管理员保护': gs.protectAdminActions = isEnable; break;
      case '群主保护': gs.protectOwnerActions = isEnable; break;
      case '自动风控收敛': gs.autoRiskControl = isEnable; break;
      default:
        await sendGroupScene(groupId, 'not_found', '未知功能。支持：问答、签到、抽奖、邀请统计、入群欢迎、活跃统计、战绩查询、自动同意、入群验证、刷屏检测、退群拉黑、暗号回落、管理员保护、群主保护、自动风控收敛');
        return true;
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已${isEnable ? '开启' : '关闭'}功能：${feature}`);
    return true;
  }
  if (text.startsWith('屏蔽 ') || text.startsWith('取消屏蔽 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const isBlock = text.startsWith('屏蔽 ');
    const type = text.slice(isBlock ? 3 : 5).trim();
    const gs = ensureGroupSettings(groupId);
    if (!gs.msgFilter) gs.msgFilter = { ...DEFAULT_MSG_FILTER, ...(getConfig().global.msgFilter || {}) };
    const msgFilter = gs.msgFilter || { ...DEFAULT_MSG_FILTER };
    switch (type) {
      case '图片': msgFilter.blockImage = isBlock; break;
      case '视频': msgFilter.blockVideo = isBlock; break;
      case '语音': msgFilter.blockRecord = isBlock; break;
      case '链接': msgFilter.blockUrl = isBlock; break;
      case '二维码': msgFilter.blockQr = isBlock; break;
      case '名片': msgFilter.blockContact = isBlock; break;
      case '小程序': msgFilter.blockLightApp = isBlock; break;
      case '转发': msgFilter.blockForward = isBlock; break;
      default: await sendGroupScene(groupId, 'not_found', '未知类型。支持：图片、视频、语音、链接、二维码、名片、小程序、转发'); return true;
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已${isBlock ? '屏蔽' : '取消屏蔽'}：${type}`);
    return true;
  }
  if (text === '开启二维码撤回' || text === '关闭二维码撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const groupSettings = ensureGroupSettings(groupId);
    if (!groupSettings.msgFilter) groupSettings.msgFilter = { ...DEFAULT_MSG_FILTER, ...(getConfig().global.msgFilter || {}) };
    const msgFilter = groupSettings.msgFilter || { ...DEFAULT_MSG_FILTER };
    msgFilter.blockQr = text === '开启二维码撤回';
    groupSettings.msgFilter = msgFilter;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启二维码撤回' ? '已开启二维码撤回' : '已关闭二维码撤回');
    return true;
  }
  return false;
}
