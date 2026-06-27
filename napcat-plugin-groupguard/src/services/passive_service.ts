import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { authStateService } from '../core/state-services/auth_state_service';
import { cacheStateService } from '../core/state-services/cache_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { checkFeatureGate } from '../core/feature_gate';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { detectQrCode } from '../qr';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { createRiskSignal } from '../risk/signals';
import { processRiskSignal } from '../risk/policy_engine';
import { enqueueMiscAction } from './action_queue_service';

const antiRecallDigest = new Map<string, Map<string, { count: number; lastUserId: string; }>>();
let antiRecallDigestTimerReady = false;
let antiRecallDigestTimer: NodeJS.Timeout | null = null;

const activityMem = new Map<string, any>();
const activityDirty = new Set<string>();
let activityFlushTimerReady = false;
let activityFlushTimer: NodeJS.Timeout | null = null;
const MAX_ACTIVITY_MEM = 2000;
const ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

function ensureAntiRecallDigestTimer(): void {
  if (antiRecallDigestTimerReady) return;
  antiRecallDigestTimerReady = true;
  antiRecallDigestTimer = setInterval(() => {
    void flushAntiRecallDigest();
  }, 30000);
}

async function flushAntiRecallDigest(): Promise<void> {
  const batches = Array.from(antiRecallDigest.entries());
  antiRecallDigest.clear();
  for (const [owner, groupMap] of batches) {
    const rows = Array.from(groupMap.entries()).sort((a, b) => b[1].count - a[1].count);
    if (!rows.length) continue;
    const total = rows.reduce((acc, [, v]) => acc + v.count, 0);
    const lines = rows.slice(0, 20).map(([gid, v]) => `群${gid}: ${v.count}条（最近QQ:${v.lastUserId || '-'})`);
    await send({
      channel: 'private',
      targetId: owner,
      scene: 'raw_text',
      message: `🔔 防撤回聚合通知\n30秒内共 ${total} 条撤回事件\n${lines.join('\n')}`,
      force: true,
      applyTemplate: false
    });
  }
}

function digestAntiRecall(owner: string, groupId: string, userId: string): void {
  const map = antiRecallDigest.get(owner) || new Map<string, { count: number; lastUserId: string; }>();
  const current = map.get(groupId) || { count: 0, lastUserId: '' };
  current.count += 1;
  current.lastUserId = userId;
  map.set(groupId, current);
  antiRecallDigest.set(owner, map);
}

function ensureActivityFlushTimer(): void {
  if (activityFlushTimerReady) return;
  activityFlushTimerReady = true;
  activityFlushTimer = setInterval(() => {
    void flushActivityBatch();
  }, 5000);
}

function activityKey(groupId: string, userId: string): string {
  return `${groupId}:${userId}`;
}

async function flushActivityBatch(): Promise<void> {
  if (!activityDirty.size) return;
  const keys = Array.from(activityDirty);
  activityDirty.clear();
  for (const key of keys) {
    const activity = activityMem.get(key);
    if (!activity) continue;
    const sep = key.indexOf(':');
    if (sep <= 0) continue;
    const groupId = key.slice(0, sep);
    const userId = key.slice(sep + 1);
    await groupguardRepository.updateActivity(groupId, userId, activity);
  }
}

export async function executeHandleAntiRecall(groupId: string, messageId: string, operatorId: string): Promise<void> {
  const config = configStateService.getConfig();
  if (operatorId === identityStateService.getBotId()) return;
  if (!config.antiRecallGroups.includes(groupId) && !config.globalAntiRecall) return;
  ensureAntiRecallDigestTimer();
  const cached = cacheStateService.getMessageCacheEntry(messageId);
  const recalledUser = cached?.userId || operatorId;
  const owners = config.ownerQQs.split(',').map(s => s.trim()).filter(Boolean);
  for (const owner of owners) {
    digestAntiRecall(owner, groupId, recalledUser);
  }
}

export function executeCacheMessage(messageId: string, userId: string, groupId: string, raw: string, segments?: any[]): void {
  const config = configStateService.getConfig();
  if (!config.antiRecallGroups.includes(groupId) && !config.globalAntiRecall) return;
  cacheStateService.setMessageCacheEntry(messageId, { userId, groupId, raw, segments: segments || [], time: Date.now() });
}

export async function executeHandleEmojiReact(groupId: string, userId: string, messageId: string, selfId: string): Promise<void> {
  const config = configStateService.getConfig();
  if (config.globalEmojiReact) {
    await enqueueMiscAction({
      groupId,
      action: 'set_msg_emoji_like',
      params: { message_id: messageId, emoji_id: '76' },
      reason: 'emoji_react_global',
      dedupKey: `${groupId}:emoji:${messageId}`,
      maxRetries: 1
    });
    return;
  }
  const targets = config.emojiReactGroups[groupId];
  if (!targets || !targets.length) return;
  const shouldReact = targets.includes(userId) || (targets.includes('self') && userId === selfId);
  if (!shouldReact) return;
  await enqueueMiscAction({
    groupId,
    action: 'set_msg_emoji_like',
    params: { message_id: messageId, emoji_id: '76' },
    reason: 'emoji_react_target',
    dedupKey: `${groupId}:emoji:${messageId}`,
    maxRetries: 1
  });
}

export async function executeHandleCardLockCheck(groupId: string, userId: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = configStateService.getConfig().cardLocks[key];
  if (lockedCard === undefined) return;
  const info = await communicationStateService.callApi('get_group_member_info', { group_id: groupId, user_id: userId, no_cache: true }) as any;
  const currentCard = info?.card || '';
  if (currentCard !== lockedCard) {
    await enqueueMiscAction({
      groupId,
      action: 'set_group_card',
      params: { group_id: groupId, user_id: userId, card: lockedCard },
      reason: 'card_lock_check',
      dedupKey: `${groupId}:card:${userId}`,
      maxRetries: 2
    });
    loggingStateService.debug(`名片锁定: ${userId} 在群 ${groupId} 名片被还原为 ${lockedCard}`);
  }
}

export async function executeHandleCardLockOnMessage(groupId: string, userId: string, senderCard: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = configStateService.getConfig().cardLocks[key];
  if (lockedCard === undefined) return;
  const currentCard = senderCard || '';
  if (currentCard !== lockedCard) {
    loggingStateService.info(`[MsgCheck] 监测到 ${userId} 名片异常(当前: "${currentCard}", 锁定: "${lockedCard}")，正在修正...`);
    await enqueueMiscAction({
      groupId,
      action: 'set_group_card',
      params: { group_id: groupId, user_id: userId, card: lockedCard },
      reason: 'card_lock_msg',
      dedupKey: `${groupId}:card:${userId}`,
      maxRetries: 2
    });
  }
}

export async function executeHandleAutoRecall(groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const targets = settings.targetUsers || [];
  if (!targets.includes(userId)) return false;
  const handled = await processRiskSignal(createRiskSignal({
    kind: 'target_user_message',
    groupId,
    userId,
    messageId,
    reason: 'target_user',
    severity: 'medium',
    evidence: { source: 'targetUsers' }
  }));
  loggingStateService.debug(`针对撤回信号: 群 ${groupId} 用户 ${userId} 消息 ${messageId} handled=${handled}`);
  return handled;
}

export async function executeSendWelcomeMessage(groupId: string, userId: string): Promise<void> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const tpl = (settings.welcomeMessage !== undefined && settings.welcomeMessage !== '') ? settings.welcomeMessage : (configStateService.getConfig().welcomeMessage || '');
  if (tpl) {
    const msg = tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    await send({
      channel: 'group',
      targetId: groupId,
      scene: 'raw_text',
      segments: [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ` ${msg}` } }
      ],
      force: true,
      applyTemplate: true
    });
  }
  if (settings.joinPrivateEnabled === true) {
    const dmTpl = String(settings.joinPrivateMessage || '欢迎加入，进群后请先阅读群公告与群规。');
    const dm = dmTpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    await send({ channel: 'private', targetId: userId, scene: 'raw_text', message: dm, force: true, applyTemplate: false });
  }
}

export async function executeHandleMsgTypeFilter(groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[]): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const filter = settings.msgFilter || configStateService.getConfig().msgFilter;
  if (!filter) return false;
  const types = (messageSegments || []).map((s: any) => s.type);
  let blocked = false;
  let reason = '';
  if (filter.blockVideo && types.includes('video')) { blocked = true; reason = '视频'; }
  else if (filter.blockImage && types.includes('image')) { blocked = true; reason = '图片'; }
  else if (filter.blockRecord && types.includes('record')) { blocked = true; reason = '语音'; }
  else if (filter.blockForward && types.includes('forward')) { blocked = true; reason = '合并转发'; }
  else if (filter.blockLightApp && (raw.includes('[CQ:json,') || raw.includes('[CQ:xml,'))) { blocked = true; reason = '小程序卡片'; }
  else if (filter.blockContact && (raw.includes('"app":"com.tencent.contact.lua"') || raw.includes('"app":"com.tencent.qq.checkin"') || types.includes('contact'))) { blocked = true; reason = '名片分享'; }
  else if (filter.blockUrl) {
    const plainText = raw.replace(/\[CQ:[^\]]+\]/g, '');
    const urlPattern = /https?:\/\/\S+|www\.\S+|[a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.(?:com|cn|net|org|io|cc|co|me|top|xyz|info|dev|app|site|vip|pro|tech|cloud|link|fun|icu|club|ltd|live|tv|asia|biz|wang|mobi|online|shop|store|work)\b/i;
    if (urlPattern.test(plainText)) { blocked = true; reason = '链接'; }
  }
  if (!blocked && filter.blockQr) {
    const images = messageSegments.filter((s: any) => s.type === 'image');
    for (const img of images) {
      const url = img.url || img.file;
      if (url && (url.startsWith('http') || url.startsWith('file://'))) {
        try {
          const hasQr = await detectQrCode(url);
          if (hasQr) {
            blocked = true;
            reason = '二维码';
            break;
          }
        } catch {}
      }
    }
  }
  if (!blocked) return false;
  const handled = await processRiskSignal(createRiskSignal({
    kind: 'media_filter',
    groupId,
    userId,
    messageId,
    reason: `msg_filter_${reason}`,
    severity: reason === '二维码' || reason === '链接' ? 'high' : 'medium',
    evidence: { mediaType: reason, actionReason: `msg_filter_${reason}` }
  }));
  loggingStateService.info(`消息类型过滤信号: 群 ${groupId} 用户 ${userId} 发送${reason} handled=${handled}`);
  return handled;
}

export async function executeHandleBlacklist(groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const isGlobalBlack = authStateService.isBlacklisted(userId);
  const isGroupBlack = (settings.groupBlacklist || []).includes(userId);
  if (isGlobalBlack || isGroupBlack) {
    const handled = await processRiskSignal(createRiskSignal({
      kind: 'blacklist_message',
      groupId,
      userId,
      messageId,
      reason: 'blacklist',
      severity: 'critical',
      evidence: {
        global: isGlobalBlack,
        group: isGroupBlack,
        mode: settings.blacklistAction || 'recall'
      }
    }));
    loggingStateService.debug(`黑名单信号: 群 ${groupId} 用户 ${userId} handled=${handled}`);
    return handled;
  }
  return false;
}

export async function executeHandleFilterKeywords(groupId: string, userId: string, messageId: string, raw: string, ctx: NapCatPluginContext): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const groupKw = settings.filterKeywords || [];
  const globalKw = configStateService.getConfig().filterKeywords || [];
  const allKw = [...new Set([...groupKw, ...globalKw])];
  if (!allKw.length) return false;

  // 修改：转小写匹配
  const lowerRaw = raw.toLowerCase();
  const matched = allKw.find(k => lowerRaw.includes(k.toLowerCase()));

  if (!matched) return false;
  loggingStateService.info(`违禁词拦截: 群 ${groupId} 用户 ${userId} 触发「${matched}」`);
  const level = settings.filterPunishLevel || 1;
  const banMin = (groupKw && groupKw.length) ? (settings.filterBanMinutes || 10) : (configStateService.getConfig().filterBanMinutes || 10);
  return processRiskSignal(createRiskSignal({
    kind: 'keyword_filter',
    groupId,
    userId,
    messageId,
    reason: 'keyword_filter',
    severity: level >= 4 ? 'critical' : level >= 3 ? 'high' : level >= 2 ? 'medium' : 'low',
    evidence: { matched, level, banMinutes: banMin }
  }), ctx);
}

export async function executeHandleSpamDetect(groupId: string, userId: string, raw: string = ''): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const config = configStateService.getConfig();
  const spamOn = settings.spamDetect !== undefined ? settings.spamDetect : config.spamDetect;
  if (!spamOn) return false;
  const windowMs = ((settings.spamWindow !== undefined ? settings.spamWindow : config.spamWindow) || 10) * 1000;
  const threshold = (settings.spamThreshold !== undefined ? settings.spamThreshold : config.spamThreshold) || 10;
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  let timestamps = cacheStateService.getSpamCacheEntry(key) || [];
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < windowMs);
  cacheStateService.setSpamCacheEntry(key, timestamps);
  if (timestamps.length >= threshold) {
    const banMin = (settings.spamBanMinutes !== undefined ? settings.spamBanMinutes : config.spamBanMinutes) || 5;
    const handled = await processRiskSignal(createRiskSignal({
      kind: 'spam_rate',
      groupId,
      userId,
      reason: 'spam_rate',
      severity: 'high',
      evidence: { windowSeconds: windowMs / 1000, threshold, banMinutes: banMin }
    }));
    if (!handled) return false;
    cacheStateService.deleteSpamCacheEntry(key);
    cacheStateService.deleteRepeatCacheEntry(key);
    loggingStateService.info(`刷屏检测: 群 ${groupId} 用户 ${userId} 在 ${windowMs / 1000}s 内发送 ${threshold} 条消息`);
    return true;
  }
  const repeatLimit = settings.repeatThreshold || 0;
  if (repeatLimit > 0 && raw) {
    const repeatKey = `${groupId}:${userId}`;
    const lastMsg = cacheStateService.getRepeatCacheEntry(repeatKey);
    if (lastMsg && lastMsg.content === raw) {
      lastMsg.count++;
      if (lastMsg.count >= repeatLimit) {
        const banMin = (settings.spamBanMinutes || 5);
        const handled = await processRiskSignal(createRiskSignal({
          kind: 'spam_repeat',
          groupId,
          userId,
          reason: 'spam_repeat',
          severity: 'medium',
          evidence: { repeatLimit, banMinutes: banMin }
        }));
        if (!handled) return false;
        cacheStateService.deleteRepeatCacheEntry(repeatKey);
        return true;
      }
    } else {
      cacheStateService.setRepeatCacheEntry(repeatKey, { content: raw, count: 1 });
    }
  }
  return false;
}

export async function executeHandleQA(groupId: string, userId: string, raw: string): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  if (settings.disableQA) return false;
  const gate = await checkFeatureGate({
    featureType: 'qa',
    featureKey: 'qa.auto_reply',
    groupId,
    userId,
    messageType: 'group',
    source: 'passive',
    scope: 'group',
    requiresLicense: true,
    permission: 'all',
    passiveReply: true,
    botSend: true
  });
  if (!gate.allowed) return false;
  const config = configStateService.getConfig();
  const isGroupCustom = config.groups[groupId] && !config.groups[groupId].useGlobal;
  const qaList = isGroupCustom ? (settings.qaList || []) : (config.qaList || []);
  if (!qaList.length) return false;

  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const normalizedText = text.toLowerCase();
  if (text.startsWith('删问') || text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('删除问答')) return false;

  // 修改：统一文本小写
  const lowerText = text.toLowerCase();

  for (const qa of qaList) {
    let matched = false;
    const keyword = String(qa.keyword || '');
    const normalizedKeyword = keyword.toLowerCase();
    const lowerKeyword = normalizedKeyword;
    if (qa.mode === 'exact') matched = normalizedText === normalizedKeyword;
    else if (qa.mode === 'contains') matched = normalizedText.includes(normalizedKeyword);
    else if (qa.mode === 'regex') { try { matched = new RegExp(keyword, 'i').test(text); } catch {} }
    if (!matched) continue;

    const now = Date.now();
    const baseCooldown = settings.qaCooldownSeconds ?? config.global.qaCooldownSeconds ?? 30;
    const userCooldown = settings.qaUserCooldownSeconds ?? config.global.qaUserCooldownSeconds ?? 12;
    const highPatterns = settings.qaHighRiskPatterns ?? config.global.qaHighRiskPatterns ?? [];
    const mediumPatterns = settings.qaMediumRiskPatterns ?? config.global.qaMediumRiskPatterns ?? [];

    // 修改：使用已定义的 lowerText 和 lowerKeyword 进行风险检测
    const hitHigh = highPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    const hitMedium = !hitHigh && mediumPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    
    const tierCooldown = hitHigh
      ? (settings.qaTierCooldownHigh ?? config.global.qaTierCooldownHigh ?? 60)
      : hitMedium
        ? (settings.qaTierCooldownMedium ?? config.global.qaTierCooldownMedium ?? 30)
        : (settings.qaTierCooldownLow ?? config.global.qaTierCooldownLow ?? 15);

    const groupKeywordKey = `${groupId}:${qa.mode}:${qa.keyword}`;
    const groupUserKey = `${groupId}:user:${userId}`;
    const groupUserKeywordKey = `${groupId}:user:${userId}:${qa.mode}:${qa.keyword}`;
    const lastGroupKeywordTs = cacheStateService.getQaCooldown(groupKeywordKey) || 0;
    const lastGroupUserTs = cacheStateService.getQaCooldown(groupUserKey) || 0;
    const lastGroupUserKeywordTs = cacheStateService.getQaCooldown(groupUserKeywordKey) || 0;

    if (baseCooldown > 0 && now - lastGroupKeywordTs < baseCooldown * 1000) return false;
    if (userCooldown > 0 && now - lastGroupUserTs < userCooldown * 1000) return false;
    if (tierCooldown > 0 && now - lastGroupUserKeywordTs < tierCooldown * 1000) return false;

    cacheStateService.setQaCooldown(groupKeywordKey, now);
    cacheStateService.setQaCooldown(groupUserKey, now);
    cacheStateService.setQaCooldown(groupUserKeywordKey, now);

    const reply = qa.reply.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    if (reply.includes('[CQ:')) await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'text', data: { text: reply } }], force: false, applyTemplate: true });
    else await send({ channel: 'group', targetId: groupId, scene: 'raw_text', message: reply, force: false, applyTemplate: true });
    
    loggingStateService.debug(`问答触发: 群 ${groupId} 用户 ${userId} 匹配 [${qa.mode}]${qa.keyword}`);
    return true;
  }
  return false;
}

export async function executeRecordActivity(groupId: string, userId: string): Promise<void> {
  const settings = configStateService.resolveGroupSettings(groupId);
  if (settings.disableActivity) return;
  ensureActivityFlushTimer();
  const key = activityKey(groupId, userId);
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  let activity = activityMem.get(key);
  if (!activity) {
    activity = await groupguardRepository.getActivityAsync(groupId, userId);
  }
  if (!activity) {
    activity = { msgCount: 0, lastActive: 0, role: 'member', msgCountToday: 0, lastActiveDay: today };
  }
  activity.msgCount++;
  activity.lastActive = now;
  if (activity.lastActiveDay !== today) {
    activity.lastActiveDay = today;
    activity.msgCountToday = 1;
  } else {
    activity.msgCountToday++;
  }
  activityMem.set(key, activity);
  activityDirty.add(key);
  if (activityMem.size > MAX_ACTIVITY_MEM) {
    const nowTs = Date.now();
    const keys = Array.from(activityMem.keys());
    for (let i = 0; i < keys.length - MAX_ACTIVITY_MEM; i += 1) {
      const k = keys[i];
      const v = activityMem.get(k);
      if (!v || (nowTs - (v.lastActive || 0) > ACTIVITY_TTL_MS)) {
        activityMem.delete(k);
      }
    }
  }
}

export function stopPassiveServiceTimers(): void {
  if (antiRecallDigestTimer) {
    clearInterval(antiRecallDigestTimer);
    antiRecallDigestTimer = null;
    antiRecallDigestTimerReady = false;
  }
  if (activityFlushTimer) {
    clearInterval(activityFlushTimer);
    activityFlushTimer = null;
    activityFlushTimerReady = false;
  }
}
