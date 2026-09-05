import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
﻿import type { GroupGuardSettings, QAEntry } from '../types';
import { isQueryOnlyBotRole, shouldBlockByBotRole, type BotRoleIntent } from '../core/bot_role';
import { authStateService } from '../core/state-services/auth_state_service';
import { cacheStateService } from '../core/state-services/cache_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { checkFeatureGate } from '../core/feature_gate';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { createRiskSignal } from '../risk/signals';
import { processRiskSignal } from '../risk/policy_engine';
import { countUrlsInText } from './outgoing_risk_packager';
import { enqueueMiscAction } from './action_queue_service';
import { handleContentRiskFilter, recordContentRiskAudit } from './content_risk_service';
import { storageAdapter } from '../storage_adapter';

const antiRecallDigest = new Map<string, Map<string, { count: number; lastUserId: string; }>>();
let antiRecallDigestTimerReady = false;
let antiRecallDigestTimer: NodeJS.Timeout | null = null;

const activityMem = new Map<string, any>();
const activityDirty = new Set<string>();
const activityVersions = new Map<string, number>();
let activityFlushTimerReady = false;
let activityFlushTimer: NodeJS.Timeout | null = null;
const MAX_ACTIVITY_MEM = 2000;
const ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

function loadStoredGroupSettings(groupId: string): GroupGuardSettings | null {
  try {
    const stored = storageAdapter.loadAllGroupConfigs()[groupId];
    return stored || null;
  } catch (error) {
    loggingStateService.debug(`问答读取分群存储失败: group=${groupId} error=${String(error)}`);
    return null;
  }
}

function resolveQaRuntime(
  groupId: string,
  config: ReturnType<typeof configStateService.getConfig>,
  settings: GroupGuardSettings
): { settings: GroupGuardSettings; qaList: QAEntry[]; source: string } {
  const configuredGroup = config.groups[groupId];
  if (configuredGroup && !configuredGroup.useGlobal) {
    return { settings, qaList: settings.qaList || [], source: 'runtime_group' };
  }

  if (!configuredGroup) {
    const stored = loadStoredGroupSettings(groupId);
    if (stored && stored.useGlobal === false) {
      return {
        settings: { ...settings, ...stored },
        qaList: Array.isArray(stored.qaList) ? stored.qaList : [],
        source: 'stored_group'
      };
    }
  }

  return { settings, qaList: config.qaList || [], source: 'global' };
}

function blockPassiveByRole(source: string, rawMessage: string, intent: BotRoleIntent): boolean {
  const block = shouldBlockByBotRole({ source, rawMessage, intent, featureType: intent === 'qa_like' ? 'qa' : 'passive' });
  if (!block.blocked) return false;
  loggingStateService.info(block.logLine || `bot_role_blocked role=${block.role} intent=${intent} rawMessage=${rawMessage} source=${source}`);
  return true;
}

function randomBetween(min: number, max: number): number {
  const safeMin = Math.max(0, Math.floor(Number.isFinite(min) ? min : 0));
  const safeMax = Math.max(safeMin, Math.floor(Number.isFinite(max) ? max : safeMin));
  if (safeMax <= safeMin) return safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function wrapPlainReplyInCodeBlock(reply: string): string {
  const text = String(reply || '').trim();
  if (!text || text.includes('[CQ:')) return reply;
  if (text.includes('```')) return reply;
  return `复制下面内容到浏览器打开：\n\`\`\`text\n${text}\n\`\`\``;
}

function shouldSendQaReply(settings: any): boolean {
  const policies = settings?.botAntiRiskScenePolicies || {};
  const scenePolicy = policies.qa_reply || policies.qa || {};
  const raw = Number(scenePolicy.replyProbability ?? settings?.replyProbability ?? 100);
  const probability = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 100));
  return Math.random() * 100 < probability;
}

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
    const lines = rows.slice(0, 20).map(([gid, v]) => `群 ${gid}：${v.count} 条（最近 QQ：${v.lastUserId || '-'}）`);
    await send({
      channel: 'private',
      targetId: owner,
      scene: 'raw_text',
      message: `🔔 防撤回聚合通知\n30 秒内共 ${total} 条撤回事件\n${lines.join('\n')}`,
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
  for (const key of keys) {
    const activity = activityMem.get(key);
    if (!activity) continue;
    const sep = key.indexOf(':');
    if (sep <= 0) continue;
    const groupId = key.slice(0, sep);
    const userId = key.slice(sep + 1);
    const version = activityVersions.get(key) || 0;
    try {
      await groupguardRepository.updateActivity(groupId, userId, activity);
      if ((activityVersions.get(key) || 0) === version) activityDirty.delete(key);
    } catch (error) {
      activityDirty.add(key);
      loggingStateService.warn(`活动批量保存失败，保留重试 key=${key}: ${String(error)}`);
    }
  }
}

export async function executeHandleAntiRecall(groupId: string, messageId: string, operatorId: string): Promise<void> {
  if (blockPassiveByRole('passive_service', `group=${groupId} message=${messageId}`, 'moderation_like')) return;
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
  if (blockPassiveByRole('passive_service', `group=${groupId} message=${messageId}`, 'moderation_like')) return;
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
  if (blockPassiveByRole('passive_service', `group=${groupId} user=${userId}`, 'moderation_like')) return;
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
    loggingStateService.debug(`鍚嶇墖閿佸畾: ${userId} 鍦ㄧ兢 ${groupId} 鍚嶇墖琚繕鍘熶负 ${lockedCard}`);
  }
}

export async function executeHandleCardLockOnMessage(groupId: string, userId: string, senderCard: string): Promise<void> {
  if (blockPassiveByRole('passive_service', `group=${groupId} user=${userId}`, 'moderation_like')) return;
  const key = `${groupId}:${userId}`;
  const lockedCard = configStateService.getConfig().cardLocks[key];
  if (lockedCard === undefined) return;
  const currentCard = senderCard || '';
  if (currentCard !== lockedCard) {
    loggingStateService.info(`[MsgCheck] 鐩戞祴鍒?${userId} 鍚嶇墖寮傚父(褰撳墠: "${currentCard}", 閿佸畾: "${lockedCard}")锛屾鍦ㄤ慨姝?..`);
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
  if (blockPassiveByRole('passive_service', `group=${groupId} message=${messageId}`, 'moderation_like')) return false;
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
  loggingStateService.debug(`閽堝鎾ゅ洖淇″彿: 缇?${groupId} 鐢ㄦ埛 ${userId} 娑堟伅 ${messageId} handled=${handled}`);
  return handled;
}

export async function executeSendWelcomeMessage(groupId: string, userId: string): Promise<void> {
  if (blockPassiveByRole('passive_service', `group=${groupId} user=${userId}`, 'welcome_like')) return;
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
    const dmTpl = String(settings.joinPrivateMessage || '欢迎加入，请先阅读群公告与群规。');
    const dm = dmTpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    await send({ channel: 'private', targetId: userId, scene: 'raw_text', message: dm, force: true, applyTemplate: false });
  }
}

export async function executeHandleMsgTypeFilter(groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[], ctx?: GroupGuardRuntimeContext): Promise<boolean> {
  return handleContentRiskFilter({ groupId, userId, messageId, raw, messageSegments, ctx });
}

export async function executeHandleBlacklist(groupId: string, userId: string, messageId: string): Promise<boolean> {
  if (blockPassiveByRole('passive_service', `group=${groupId} user=${userId}`, 'moderation_like')) return false;
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
    loggingStateService.debug(`榛戝悕鍗曚俊鍙? 缇?${groupId} 鐢ㄦ埛 ${userId} handled=${handled}`);
    return handled;
  }
  return false;
}

export async function executeHandleFilterKeywords(groupId: string, userId: string, messageId: string, raw: string, ctx: GroupGuardRuntimeContext): Promise<boolean> {
  const settings = configStateService.resolveGroupSettings(groupId);
  const groupKw = settings.filterKeywords || [];
  const globalKw = configStateService.getConfig().filterKeywords || [];
  const allKw = [...new Set([...groupKw, ...globalKw])];
  if (!allKw.length) return false;

  // 淇敼锛氳浆灏忓啓鍖归厤
  const lowerRaw = raw.toLowerCase();
  const matched = allKw.find(k => lowerRaw.includes(k.toLowerCase()));

  if (!matched) return false;
  loggingStateService.info(`[KeywordFilter] group=${groupId} user=${userId} matched=${matched}`);
  const level = settings.filterPunishLevel || 1;
  const banMin = (groupKw && groupKw.length) ? (settings.filterBanMinutes || 10) : (configStateService.getConfig().filterBanMinutes || 10);
  const handled = await processRiskSignal(createRiskSignal({
    kind: 'keyword_filter',
    groupId,
    userId,
    messageId,
    reason: 'keyword_filter',
    severity: level >= 4 ? 'critical' : level >= 3 ? 'high' : level >= 2 ? 'medium' : 'low',
    evidence: { matched, level, banMinutes: banMin }
  }), ctx);
  recordContentRiskAudit({
    groupId,
    userId,
    messageId,
    riskType: 'keyword',
    matchedRule: matched,
    action: level >= 4 ? 'recall_blacklist' : level >= 3 ? 'recall_kick' : level >= 2 ? 'recall_ban' : 'recall',
    handled,
    failedReason: handled ? '' : 'see_policy_decision'
  });
  return handled;
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
    loggingStateService.info(`[SpamDetect] group=${groupId} user=${userId} window=${windowMs / 1000}s threshold=${threshold}`);
    return true;
  }
  const repeatLimit = settings.repeatThreshold || 0;
  if (repeatLimit > 0 && raw) {
    const repeatKey = `${groupId}:${userId}`;
    const lastMsg = cacheStateService.getRepeatCacheEntry(repeatKey);
    if (lastMsg && lastMsg.content === raw) {
      lastMsg.count++;
      lastMsg.time = now;
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
      cacheStateService.setRepeatCacheEntry(repeatKey, { content: raw, count: 1, time: now });
    }
  }
  return false;
}

export async function executeHandleQA(groupId: string, userId: string, raw: string): Promise<boolean> {
  const config = configStateService.getConfig();
  const runtime = resolveQaRuntime(groupId, config, configStateService.resolveGroupSettings(groupId));
  const settings = runtime.settings;
  if (settings.disableQA) return false;
  const qaList = runtime.qaList;
  if (!qaList.length) return false;

  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const normalizedText = text.toLowerCase();
  if (text.startsWith('删问') || text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('删除问答')) return false;

  // 淇敼锛氱粺涓€鏂囨湰灏忓啓
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
    if (isQueryOnlyBotRole()) {
      blockPassiveByRole('passive_service', raw, 'qa_like');
      return false;
    }

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

    const now = Date.now();
    const baseCooldown = settings.qaCooldownSeconds ?? config.global.qaCooldownSeconds ?? 30;
    const userCooldown = settings.qaUserCooldownSeconds ?? config.global.qaUserCooldownSeconds ?? 12;
    const highPatterns = settings.qaHighRiskPatterns ?? config.global.qaHighRiskPatterns ?? [];
    const mediumPatterns = settings.qaMediumRiskPatterns ?? config.global.qaMediumRiskPatterns ?? [];

    // 淇敼锛氫娇鐢ㄥ凡瀹氫箟鐨?lowerText 鍜?lowerKeyword 杩涜椋庨櫓妫€娴?
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

    const reply = qa.reply.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    const linkDelivery = settings.qaLinkDelivery || config.global.qaLinkDelivery;
    const shouldSplitLinkReply = linkDelivery?.enabled === true && countUrlsInText(reply) > 0;
    if (!shouldSendQaReply(settings)) {
      loggingStateService.debug(`问答命中但回复概率未通过，不记录冷却: 群 ${groupId} 用户 ${userId} 匹配 [${qa.mode}]${qa.keyword}`);
      return true;
    }

    cacheStateService.setQaCooldown(groupKeywordKey, now);
    cacheStateService.setQaCooldown(groupUserKey, now);
    cacheStateService.setQaCooldown(groupUserKeywordKey, now);

    if (shouldSplitLinkReply) {
      await send({
        channel: 'group',
        targetId: groupId,
        scene: 'qa_link_notice',
        message: linkDelivery.noticeText,
        force: false,
        applyTemplate: false,
        skipProbability: true
      });
      await sleep(randomBetween(Number(linkDelivery.delayMinMs || 0), Number(linkDelivery.delayMaxMs || 0)));
    }
    const finalReply = shouldSplitLinkReply && linkDelivery?.wrapInCodeBlock === true ? wrapPlainReplyInCodeBlock(reply) : reply;
    if (finalReply.includes('[CQ:')) await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'text', data: { text: finalReply } }], force: false, applyTemplate: true, skipProbability: true });
    else await send({ channel: 'group', targetId: groupId, scene: 'raw_text', message: finalReply, force: false, applyTemplate: true, skipProbability: true });
    
    loggingStateService.debug(`问答触发: 群 ${groupId} 用户 ${userId} 来源 ${runtime.source} 匹配 [${qa.mode}]${qa.keyword}`);
    return true;
  }
  return false;
}

export async function executeRecordActivity(groupId: string, userId: string): Promise<void> {
  if (isQueryOnlyBotRole()) return;
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
  if (!activityMem.has(key) && activityMem.size >= MAX_ACTIVITY_MEM) {
    await flushActivityBatch();
    for (const candidate of activityMem.keys()) {
      if (activityDirty.has(candidate)) continue;
      activityMem.delete(candidate);
      activityVersions.delete(candidate);
      if (activityMem.size < MAX_ACTIVITY_MEM) break;
    }
    if (activityMem.size >= MAX_ACTIVITY_MEM) {
      await groupguardRepository.updateActivity(groupId, userId, activity);
      return;
    }
  }
  activityMem.set(key, activity);
  activityVersions.set(key, (activityVersions.get(key) || 0) + 1);
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

export async function flushPassiveService(): Promise<void> {
  await flushActivityBatch();
  if (activityDirty.size) throw new Error(`activity_flush_incomplete:${activityDirty.size}`);
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
  if (!activityDirty.size) {
    activityMem.clear();
    activityVersions.clear();
  }
}
