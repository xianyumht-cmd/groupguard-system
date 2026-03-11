import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../state';
import { detectQrCode } from '../qr';
import { saveConfig } from '../commands/common';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { enqueueBanAction, enqueueKickAction, enqueueMiscAction, enqueueRecallAction } from './action_queue_service';

const antiRecallDigest = new Map<string, Map<string, { count: number; lastUserId: string; }>>();
let antiRecallDigestTimerReady = false;

const activityMem = new Map<string, any>();
const activityDirty = new Set<string>();
let activityFlushTimerReady = false;

function randomDelayMs(minMs: number, maxMs: number): number {
  const min = Math.max(0, Math.floor(minMs));
  const max = Math.max(min, Math.floor(maxMs));
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensureAntiRecallDigestTimer(): void {
  if (antiRecallDigestTimerReady) return;
  antiRecallDigestTimerReady = true;
  setInterval(() => {
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
    await pluginState.callApi('send_private_msg', {
      user_id: owner,
      message: [{ type: 'text', data: { text: `🔔 防撤回聚合通知\n30秒内共 ${total} 条撤回事件\n${lines.join('\n')}` } }]
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
  setInterval(() => {
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
  if (operatorId === pluginState.botId) return;
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;
  ensureAntiRecallDigestTimer();
  const cached = pluginState.msgCache.get(messageId);
  const recalledUser = cached?.userId || operatorId;
  const owners = pluginState.config.ownerQQs.split(',').map(s => s.trim()).filter(Boolean);
  for (const owner of owners) {
    digestAntiRecall(owner, groupId, recalledUser);
  }
}

export function executeCacheMessage(messageId: string, userId: string, groupId: string, raw: string, segments?: any[]): void {
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;
  pluginState.msgCache.set(messageId, { userId, groupId, raw, segments: segments || [], time: Date.now() });
  const now = Date.now();
  for (const [k, v] of pluginState.msgCache) {
    if (now - v.time > 600000) pluginState.msgCache.delete(k);
  }
}

export async function executeHandleEmojiReact(groupId: string, userId: string, messageId: string, selfId: string): Promise<void> {
  if (pluginState.config.globalEmojiReact) {
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
  const targets = pluginState.config.emojiReactGroups[groupId];
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
  const lockedCard = pluginState.config.cardLocks[key];
  if (lockedCard === undefined) return;
  const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: userId, no_cache: true }) as any;
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
    pluginState.debug(`名片锁定: ${userId} 在群 ${groupId} 名片被还原为 ${lockedCard}`);
  }
}

export async function executeHandleCardLockOnMessage(groupId: string, userId: string, senderCard: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = pluginState.config.cardLocks[key];
  if (lockedCard === undefined) return;
  const currentCard = senderCard || '';
  if (currentCard !== lockedCard) {
    pluginState.log('info', `[MsgCheck] 监测到 ${userId} 名片异常(当前: "${currentCard}", 锁定: "${lockedCard}")，正在修正...`);
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
  const settings = pluginState.getGroupSettings(groupId);
  const targets = settings.targetUsers || [];
  if (!targets.includes(userId)) return false;
  const result = await enqueueRecallAction({ groupId, messageId, targetUserId: userId, reason: 'target_user', automatic: true, maxRetries: 1 });
  pluginState.debug(`针对撤回: 群 ${groupId} 用户 ${userId} 消息 ${messageId} 结果=${result.code}`);
  return result.ok;
}

export async function executeSendWelcomeMessage(groupId: string, userId: string): Promise<void> {
  const settings = pluginState.getGroupSettings(groupId);
  const tpl = (settings.welcomeMessage !== undefined && settings.welcomeMessage !== '') ? settings.welcomeMessage : (pluginState.config.welcomeMessage || '');
  if (!tpl) return;
  const msg = tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
  await pluginState.sendGroupMsg(groupId, [
    { type: 'at', data: { qq: userId } },
    { type: 'text', data: { text: ` ${msg}` } }
  ]);
}

export async function executeHandleMsgTypeFilter(groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[]): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const filter = settings.msgFilter || pluginState.config.msgFilter;
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
  const result = await enqueueRecallAction({ groupId, messageId, targetUserId: userId, reason: `msg_filter_${reason}`, automatic: true, maxRetries: 1 });
  pluginState.log('info', `消息类型过滤: 群 ${groupId} 用户 ${userId} 发送${reason}，结果：${result.code}`);
  return result.ok;
}

export async function executeHandleBlacklist(groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const isGlobalBlack = pluginState.isBlacklisted(userId);
  const isGroupBlack = (settings.groupBlacklist || []).includes(userId);
  if (isGlobalBlack || isGroupBlack) {
    const mode = settings.blacklistAction || 'recall';
    if (mode === 'ban') {
      const minutes = Math.max(1, Number(settings.blacklistBanMinutes ?? 30));
      const result = await enqueueBanAction({ groupId, userId, durationSeconds: minutes * 60, reason: 'blacklist', automatic: true, maxRetries: 1 });
      pluginState.debug(`黑名单禁言: 群 ${groupId} 用户 ${userId} 结果=${result.code}`);
      return result.ok;
    }
    if (mode === 'kick' || mode === 'kick_and_block') {
      if (mode === 'kick_and_block') {
        if (!pluginState.config.blacklist) pluginState.config.blacklist = [];
        if (!pluginState.config.blacklist.includes(userId)) pluginState.config.blacklist.push(userId);
      }
      const minDelay = Math.max(0, Number(settings.blacklistKickDelayMinSeconds ?? settings.kickDelayMinSeconds ?? 5)) * 1000;
      const maxDelay = Math.max(minDelay, Number(settings.blacklistKickDelayMaxSeconds ?? settings.kickDelayMaxSeconds ?? 20)) * 1000;
      const wait = randomDelayMs(minDelay, maxDelay);
      setTimeout(() => {
        void enqueueKickAction({
          groupId,
          userId,
          reason: mode === 'kick_and_block' ? 'blacklist_kick_and_block' : 'blacklist',
          rejectAddRequest: settings.blacklistKickRejectAddRequest !== false,
          automatic: true,
          maxRetries: 1
        }).then((result) => {
          pluginState.debug(`黑名单踢出: 群 ${groupId} 用户 ${userId} 模式=${mode} 结果=${result.code}`);
        });
      }, wait);
      return true;
    }
    const result = await enqueueRecallAction({ groupId, messageId, targetUserId: userId, reason: 'blacklist', automatic: true, maxRetries: 1 });
    pluginState.debug(`黑名单撤回: 群 ${groupId} 用户 ${userId} 消息 ${messageId} 结果=${result.code}`);
    return result.ok;
  }
  return false;
}

export async function executeHandleFilterKeywords(groupId: string, userId: string, messageId: string, raw: string, ctx: NapCatPluginContext): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const groupKw = settings.filterKeywords || [];
  const globalKw = pluginState.config.filterKeywords || [];
  const allKw = [...new Set([...groupKw, ...globalKw])];
  if (!allKw.length) return false;

  // 修改：转小写匹配
  const lowerRaw = raw.toLowerCase();
  const matched = allKw.find(k => lowerRaw.includes(k.toLowerCase()));

  if (!matched) return false;
  const masked = matched.length > 1 ? matched[0] + '*'.repeat(matched.length - 1) : '*';
  const recallResult = await enqueueRecallAction({ groupId, messageId, targetUserId: userId, reason: 'keyword_filter', automatic: true, maxRetries: 1 });
  pluginState.log('info', `违禁词拦截: 群 ${groupId} 用户 ${userId} 触发「${matched}」`);
  if (!recallResult.ok) return false;
  const level = settings.filterPunishLevel || 1;
  if (level >= 2) {
    const banMin = (groupKw && groupKw.length) ? (settings.filterBanMinutes || 10) : (pluginState.config.filterBanMinutes || 10);
    const banResult = await enqueueBanAction({ groupId, userId, durationSeconds: banMin * 60, reason: 'keyword_filter', automatic: true, maxRetries: 1 });
    if (!banResult.ok) return true;
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 消息已撤回并禁言 ${banMin} 分钟，原因：触发违禁词「${masked}」`);
  }
  if (level >= 3) {
    void enqueueKickAction({ groupId, userId, reason: 'keyword_filter', rejectAddRequest: false, automatic: true, maxRetries: 1 });
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 已被移出群聊，原因：触发违禁词「${masked}」`);
  }
  if (level >= 4) {
    if (!pluginState.config.blacklist) pluginState.config.blacklist = [];
    if (!pluginState.config.blacklist.includes(userId)) {
      pluginState.config.blacklist.push(userId);
      saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 已被加入黑名单，原因：触发违禁词「${masked}」`);
  }
  return true;
}

export async function executeHandleSpamDetect(groupId: string, userId: string, raw: string = ''): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const spamOn = settings.spamDetect !== undefined ? settings.spamDetect : pluginState.config.spamDetect;
  if (!spamOn) return false;
  const windowMs = ((settings.spamWindow !== undefined ? settings.spamWindow : pluginState.config.spamWindow) || 10) * 1000;
  const threshold = (settings.spamThreshold !== undefined ? settings.spamThreshold : pluginState.config.spamThreshold) || 10;
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  let timestamps = pluginState.spamCache.get(key) || [];
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < windowMs);
  pluginState.spamCache.set(key, timestamps);
  if (timestamps.length >= threshold) {
    const banMin = (settings.spamBanMinutes !== undefined ? settings.spamBanMinutes : pluginState.config.spamBanMinutes) || 5;
    const banResult = await enqueueBanAction({ groupId, userId, durationSeconds: banMin * 60, reason: 'spam_rate', automatic: true, maxRetries: 1 });
    if (!banResult.ok) return false;
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 刷屏检测触发（频率），已禁言 ${banMin} 分钟`);
    pluginState.spamCache.delete(key);
    pluginState.repeatCache.delete(key);
    pluginState.log('info', `刷屏检测: 群 ${groupId} 用户 ${userId} 在 ${windowMs / 1000}s 内发送 ${threshold} 条消息`);
    return true;
  }
  const repeatLimit = settings.repeatThreshold || 0;
  if (repeatLimit > 0 && raw) {
    const repeatKey = `${groupId}:${userId}`;
    const lastMsg = pluginState.repeatCache.get(repeatKey);
    if (lastMsg && lastMsg.content === raw) {
      lastMsg.count++;
      if (lastMsg.count >= repeatLimit) {
        const banMin = (settings.spamBanMinutes || 5);
        const banResult = await enqueueBanAction({ groupId, userId, durationSeconds: banMin * 60, reason: 'spam_repeat', automatic: true, maxRetries: 1 });
        if (!banResult.ok) return false;
        await pluginState.sendGroupText(groupId, `⚠️ ${userId} 刷屏检测触发（复读），已禁言 ${banMin} 分钟`);
        pluginState.repeatCache.delete(repeatKey);
        return true;
      }
    } else {
      pluginState.repeatCache.set(repeatKey, { content: raw, count: 1 });
    }
  }
  return false;
}

export async function executeHandleQA(groupId: string, userId: string, raw: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  if (settings.disableQA) return false;
  const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
  const qaList = isGroupCustom ? (settings.qaList || []) : (pluginState.config.qaList || []);
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
    const baseCooldown = settings.qaCooldownSeconds ?? pluginState.config.global.qaCooldownSeconds ?? 30;
    const userCooldown = settings.qaUserCooldownSeconds ?? pluginState.config.global.qaUserCooldownSeconds ?? 12;
    const highPatterns = settings.qaHighRiskPatterns ?? pluginState.config.global.qaHighRiskPatterns ?? [];
    const mediumPatterns = settings.qaMediumRiskPatterns ?? pluginState.config.global.qaMediumRiskPatterns ?? [];

    // 修改：使用已定义的 lowerText 和 lowerKeyword 进行风险检测
    const hitHigh = highPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    const hitMedium = !hitHigh && mediumPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    
    const tierCooldown = hitHigh
      ? (settings.qaTierCooldownHigh ?? pluginState.config.global.qaTierCooldownHigh ?? 60)
      : hitMedium
        ? (settings.qaTierCooldownMedium ?? pluginState.config.global.qaTierCooldownMedium ?? 30)
        : (settings.qaTierCooldownLow ?? pluginState.config.global.qaTierCooldownLow ?? 15);

    const groupKeywordKey = `${groupId}:${qa.mode}:${qa.keyword}`;
    const groupUserKey = `${groupId}:user:${userId}`;
    const groupUserKeywordKey = `${groupId}:user:${userId}:${qa.mode}:${qa.keyword}`;
    const lastGroupKeywordTs = pluginState.qaCooldownMap.get(groupKeywordKey) || 0;
    const lastGroupUserTs = pluginState.qaCooldownMap.get(groupUserKey) || 0;
    const lastGroupUserKeywordTs = pluginState.qaCooldownMap.get(groupUserKeywordKey) || 0;

    if (baseCooldown > 0 && now - lastGroupKeywordTs < baseCooldown * 1000) return false;
    if (userCooldown > 0 && now - lastGroupUserTs < userCooldown * 1000) return false;
    if (tierCooldown > 0 && now - lastGroupUserKeywordTs < tierCooldown * 1000) return false;

    pluginState.qaCooldownMap.set(groupKeywordKey, now);
    pluginState.qaCooldownMap.set(groupUserKey, now);
    pluginState.qaCooldownMap.set(groupUserKeywordKey, now);

    const reply = qa.reply.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    if (reply.includes('[CQ:')) await pluginState.sendGroupMsg(groupId, [{ type: 'text', data: { text: reply } }], { force: false, applyTemplate: true });
    else await pluginState.sendGroupText(groupId, reply, { force: false, applyTemplate: true });
    
    pluginState.debug(`问答触发: 群 ${groupId} 用户 ${userId} 匹配 [${qa.mode}]${qa.keyword}`);
    return true;
  }
  return false;
}

export async function executeRecordActivity(groupId: string, userId: string): Promise<void> {
  const settings = pluginState.getGroupSettings(groupId);
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
}
