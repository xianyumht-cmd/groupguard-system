import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import type { ContentRiskAction, ContentRiskRule, ContentRiskSettings, ContentRiskType, StandardAuditPayload } from '../types';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { detectQrCode } from '../qr';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { executePolicyActions } from '../risk/policy_engine';
import type { PolicyAction } from '../risk/signals';

interface RiskMatch {
  type: ContentRiskType;
  matchedRule: string;
  detail?: string;
}

interface ActionResult {
  handled: boolean;
  queueTaskIds: string[];
  failedReason: string;
}

const RISK_LABELS: Record<ContentRiskType, string> = {
  image: '图片',
  video: '视频',
  record: '语音',
  forward: '合并转发',
  lightApp: '小程序卡片',
  contact: '名片分享',
  url: '链接',
  qr: '二维码',
  groupInvite: '群邀请'
};

const LEGACY_KEYS: Record<ContentRiskType, string> = {
  image: 'blockImage',
  video: 'blockVideo',
  record: 'blockRecord',
  forward: 'blockForward',
  lightApp: 'blockLightApp',
  contact: 'blockContact',
  url: 'blockUrl',
  qr: 'blockQr',
  groupInvite: 'blockGroupInvite'
};

function getSegmentType(segment: any): string {
  return String(segment?.type || '').trim();
}

function getSegmentData(segment: any): any {
  return segment?.data && typeof segment.data === 'object' ? segment.data : segment || {};
}

function stringifySegments(segments: any[]): string {
  try {
    return JSON.stringify(segments || []);
  } catch {
    return String(segments || '');
  }
}

function normalizeHost(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0];
}

function domainMatches(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedPattern = normalizeHost(pattern);
  return !!normalizedHost && !!normalizedPattern && (normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`));
}

function extractUrls(raw: string, segments: any[]): string[] {
  const text = `${raw || ''}\n${stringifySegments(segments)}`;
  const explicitMatches = text.match(/(?:https?:\/\/|mqqapi:\/\/|www\.)[^\s"'<>\\\]]+/gi) || [];
  const bareDomainMatches = text.match(/\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|top|xyz|vip|club|site|online|io|me|cc|tv|app|dev|edu|gov)(?:\/[^\s"'<>\\\]]*)?/gi) || [];
  const matches = [...explicitMatches, ...bareDomainMatches];
  return Array.from(new Set(matches.map(url => url.replace(/[),，。；;]+$/g, ''))));
}

function hostFromUrl(url: string): string {
  const normalized = url.startsWith('www.') ? `https://${url}` : url;
  try {
    return new URL(normalized).hostname;
  } catch {
    return normalizeHost(url);
  }
}

function isUrlAllowed(url: string, settings: ContentRiskSettings): boolean {
  const host = hostFromUrl(url);
  return (settings.urlAllowlist || []).some(pattern => domainMatches(host, pattern));
}

function isUrlBlockedByList(url: string, settings: ContentRiskSettings): boolean {
  const host = hostFromUrl(url);
  return (settings.urlBlocklist || []).some(pattern => domainMatches(host, pattern) || String(url).toLowerCase().includes(String(pattern).toLowerCase()));
}

function isRuleEnabled(settings: ContentRiskSettings | undefined, type: ContentRiskType): boolean {
  if (!settings || settings.enabled !== true) return false;
  return settings.rules?.[type]?.enabled === true;
}

function detectGroupInvite(raw: string, segments: any[], settings: ContentRiskSettings): RiskMatch | null {
  if (!isRuleEnabled(settings, 'groupInvite') && settings.blockGroupInvite !== true) return null;
  const text = `${raw || ''}\n${stringifySegments(segments)}`.toLowerCase();
  const hasForward = segments.some(segment => getSegmentType(segment) === 'forward');
  const hasCard = segments.some(segment => ['json', 'xml'].includes(getSegmentType(segment))) || raw.includes('[CQ:json,') || raw.includes('[CQ:xml,');
  const hasUrlSignal = /qun\.qq\.com|qm\.qq\.com|mqqapi:\/\/card\/show_pslcard/i.test(text);
  const keywords = [
    'group_code',
    'troop',
    'invite',
    '\u52a0\u7fa4',
    'qq\u7fa4',
    'qq \u7fa4',
    '\u7fa4\u9080\u8bf7',
    '\u9080\u8bf7\u4f60\u52a0\u5165\u7fa4',
    '\u7533\u8bf7\u52a0\u7fa4',
    '加群',
    'qq群',
    'qq 群',
    'qq\u7fa4',
    '群邀请',
    '邀请你加入群',
    '邀请加入群',
    '申请加群'
  ];
  const hasKeyword = keywords.some(keyword => text.includes(keyword.toLowerCase()));
  if (hasUrlSignal && settings.groupInviteDetectUrl !== false) return { type: 'groupInvite', matchedRule: 'group_invite_url', detail: hasUrlSignal ? 'qq_group_invite_url' : '' };
  if (hasCard && settings.groupInviteDetectCard !== false && (hasKeyword || hasUrlSignal)) return { type: 'groupInvite', matchedRule: 'group_invite_card' };
  if (hasForward && settings.groupInviteDetectForward !== false && (hasKeyword || hasUrlSignal)) return { type: 'groupInvite', matchedRule: 'group_invite_forward' };
  if (hasKeyword) return { type: 'groupInvite', matchedRule: 'group_invite_keyword' };
  return null;
}

function detectUrl(raw: string, segments: any[], settings: ContentRiskSettings): RiskMatch | null {
  if (!isRuleEnabled(settings, 'url')) return null;
  const urls = extractUrls(raw, segments).filter(url => !isUrlAllowed(url, settings));
  if (!urls.length) return null;
  const blocklisted = urls.find(url => isUrlBlockedByList(url, settings));
  const matched = blocklisted || urls[0];
  return { type: 'url', matchedRule: blocklisted ? 'url_blocklist' : 'url_any', detail: matched };
}

function detectBySegment(raw: string, segments: any[], settings: ContentRiskSettings): RiskMatch | null {
  const types = (segments || []).map(getSegmentType);
  if (isRuleEnabled(settings, 'forward') && types.includes('forward')) return { type: 'forward', matchedRule: 'segment_forward' };
  if (isRuleEnabled(settings, 'lightApp') && (types.includes('json') || types.includes('xml') || raw.includes('[CQ:json,') || raw.includes('[CQ:xml,'))) return { type: 'lightApp', matchedRule: 'segment_card' };
  if (isRuleEnabled(settings, 'contact') && (types.includes('contact') || raw.includes('"app":"com.tencent.contact.lua"') || raw.includes('"app":"com.tencent.qq.checkin"'))) return { type: 'contact', matchedRule: 'segment_contact' };
  if (isRuleEnabled(settings, 'video') && types.includes('video')) return { type: 'video', matchedRule: 'segment_video' };
  if (isRuleEnabled(settings, 'record') && types.includes('record')) return { type: 'record', matchedRule: 'segment_record' };
  if (isRuleEnabled(settings, 'image') && types.includes('image')) return { type: 'image', matchedRule: 'segment_image' };
  return null;
}

async function detectQr(segments: any[], settings: ContentRiskSettings): Promise<RiskMatch | null> {
  if (!isRuleEnabled(settings, 'qr')) return null;
  const images = (segments || []).filter(segment => getSegmentType(segment) === 'image');
  if (!images.length) return null;
  for (const image of images) {
    const data = getSegmentData(image);
    const url = String(data.url || data.file || image.url || image.file || '');
    if (!url || (!url.startsWith('http') && !url.startsWith('file://'))) {
      loggingStateService.info(`[ContentRisk] qr_skip reason=no_supported_url value=${url.slice(0, 80)}`);
      continue;
    }
    const hasQr = await detectQrCode(url, {
      timeoutMs: settings.qrDetectTimeoutMs,
      maxBytes: settings.qrDetectMaxBytes,
      concurrency: settings.qrDetectConcurrency,
      cacheSeconds: settings.qrCacheSeconds
    });
    if (hasQr) return { type: 'qr', matchedRule: 'qr_image_scan', detail: url };
  }
  return null;
}

async function findRiskMatch(raw: string, segments: any[], settings: ContentRiskSettings): Promise<RiskMatch | null> {
  return detectGroupInvite(raw, segments, settings)
    || detectUrl(raw, segments, settings)
    || await detectQr(segments, settings)
    || detectBySegment(raw, segments, settings);
}

export async function findContentRiskMatchForTest(raw: string, segments: any[], settings: ContentRiskSettings): Promise<RiskMatch | null> {
  return findRiskMatch(raw, segments, settings);
}

function getRule(settings: ContentRiskSettings, type: ContentRiskType): ContentRiskRule {
  const rule = settings.rules?.[type] || { enabled: false, action: 'recall' as ContentRiskAction };
  if (type === 'groupInvite' && settings.groupInviteAction) {
    return {
      ...rule,
      action: rule.action || settings.groupInviteAction,
      banMinutes: rule.banMinutes ?? settings.groupInviteBanMinutes
    };
  }
  return rule;
}

export function recordContentRiskAudit(input: {
  groupId: string;
  userId: string;
  messageId: string;
  riskType: ContentRiskType | 'keyword';
  matchedRule: string;
  action: string;
  handled: boolean;
  queueTaskId?: string;
  failedReason?: string;
  detail?: string;
}): void {
  const createdAt = Date.now();
  const payload: StandardAuditPayload = {
    schemaVersion: 1,
    eventType: 'content_risk',
    correlationId: `content-risk-${createdAt}-${input.groupId}-${input.messageId}`,
    source: 'content_risk_service',
    ruleId: String(input.riskType),
    actionType: input.action,
    decision: input.handled ? 'handled' : 'observed',
    score: 0,
    reason: input.matchedRule,
    queueTaskId: input.queueTaskId || '',
    context: {
      groupId: input.groupId,
      userId: input.userId,
      messageId: input.messageId,
      riskType: input.riskType,
      matchedRule: input.matchedRule,
      action: input.action,
      handled: input.handled,
      queueTaskId: input.queueTaskId || '',
      failedReason: input.failedReason || '',
      detail: input.detail || ''
    },
    legacy: {
      event: 'content_risk',
      groupId: input.groupId,
      userId: input.userId,
      messageId: input.messageId,
      riskType: input.riskType,
      matchedRule: input.matchedRule,
      action: input.action,
      handled: input.handled,
      queueTaskId: input.queueTaskId || '',
      failedReason: input.failedReason || ''
    }
  };
  void groupguardRepository.insertAuditEvent({
    eventType: 'content_risk',
    kind: String(input.riskType),
    groupId: input.groupId,
    userId: input.userId,
    messageId: input.messageId,
    handled: input.handled,
    reason: input.failedReason || input.matchedRule,
    riskScore: 0,
    riskLevel: 'medium',
    payload: JSON.stringify(payload),
    createdAt
  }).catch(error => {
    loggingStateService.warn(`content_risk_audit_failed: ${String(error)}`);
  });
}

async function notifyGroup(groupId: string, message: string): Promise<void> {
  await send({ channel: 'group', targetId: groupId, scene: 'raw_text', message, force: true, applyTemplate: true });
}

async function executeRiskAction(input: {
  groupId: string;
  userId: string;
  messageId: string;
  match: RiskMatch;
  rule: ContentRiskRule;
  settings: ContentRiskSettings;
  ctx?: GroupGuardRuntimeContext;
}): Promise<ActionResult> {
  const queueTaskIds: string[] = [];
  const failed: string[] = [];
  const action = input.rule.action || 'recall';
  const reason = input.rule.reason || `content_risk_${input.match.type}`;
  const addResult = (result: { ok: boolean; code: string; taskId?: string }) => {
    if (result.taskId) queueTaskIds.push(result.taskId);
    if (!result.ok && result.code !== 'scheduled') failed.push(result.code || 'unknown');
  };

  const policyActions: PolicyAction[] = [{
    type: 'recall',
    groupId: input.groupId,
    userId: input.userId,
    messageId: input.messageId,
    reason,
    automatic: true,
    maxRetries: 1
  }];

  const label = RISK_LABELS[input.match.type] || input.match.type;
  if (action === 'recall_ban') {
    const minutes = Math.max(1, Number(input.rule.banMinutes || 10));
    policyActions.push({
      type: 'ban',
      groupId: input.groupId,
      userId: input.userId,
      durationSeconds: minutes * 60,
      reason,
      automatic: true,
      maxRetries: 1
    });
  }
  if (action === 'recall_kick') {
    policyActions.push({
      type: 'kick',
      groupId: input.groupId,
      userId: input.userId,
      reason,
      rejectAddRequest: false,
      automatic: true,
      maxRetries: 1
    });
  }
  if (action === 'recall_blacklist') {
    policyActions.push({
      type: 'add_global_blacklist',
      groupId: input.groupId,
      userId: input.userId,
      reason,
      automatic: true
    });
  }

  const results = await executePolicyActions(policyActions, input.ctx);
  results.forEach(addResult);
  const handled = results.some(result => result.ok || result.code === 'scheduled');
  if (handled && (action === 'recall_warn' || input.settings.notifyGroup)) {
    await notifyGroup(input.groupId, `检测到${label}风险，已处理用户 ${input.userId}`);
  }
  return {
    handled,
    queueTaskIds,
    failedReason: failed.join(',') || ''
  };
}

export async function handleContentRiskFilter(input: {
  groupId: string;
  userId: string;
  messageId: string;
  raw: string;
  messageSegments: any[];
  ctx?: GroupGuardRuntimeContext;
}): Promise<boolean> {
  if (authStateService.isWhitelisted(input.userId)) return false;
  const settings = configStateService.resolveGroupSettings(input.groupId).contentRisk;
  if (!settings || settings.enabled !== true) return false;
  const match = await findRiskMatch(input.raw, input.messageSegments || [], settings);
  if (!match) return false;
  const rule = getRule(settings, match.type);
  const action = rule.action || 'recall';
  if (settings.logOnly === true) {
    recordContentRiskAudit({
      groupId: input.groupId,
      userId: input.userId,
      messageId: input.messageId,
      riskType: match.type,
      matchedRule: match.matchedRule,
      action: 'logOnly',
      handled: false,
      detail: match.detail
    });
    loggingStateService.info(`[ContentRisk] log_only group=${input.groupId} user=${input.userId} type=${match.type} rule=${match.matchedRule}`);
    return false;
  }

  const result = await executeRiskAction({
    groupId: input.groupId,
    userId: input.userId,
    messageId: input.messageId,
    match,
    rule,
    settings,
    ctx: input.ctx
  });
  recordContentRiskAudit({
    groupId: input.groupId,
    userId: input.userId,
    messageId: input.messageId,
    riskType: match.type,
    matchedRule: match.matchedRule,
    action,
    handled: result.handled,
    queueTaskId: result.queueTaskIds.join(','),
    failedReason: result.failedReason,
    detail: match.detail
  });
  loggingStateService.info(`[ContentRisk] hit group=${input.groupId} user=${input.userId} message=${input.messageId} type=${match.type} rule=${match.matchedRule} action=${action} handled=${result.handled} failed=${result.failedReason || '-'}`);
  return true;
}

export function syncLegacyMsgFilterFromContentRisk(settings: any): void {
  const risk = settings?.contentRisk;
  if (!risk || typeof risk !== 'object') return;
  const filter = settings.msgFilter || {};
  for (const type of Object.keys(LEGACY_KEYS) as ContentRiskType[]) {
    const key = LEGACY_KEYS[type];
    filter[key] = risk.enabled === true && risk.rules?.[type]?.enabled === true;
  }
  filter.groupInviteDetectUrl = risk.groupInviteDetectUrl !== false;
  filter.groupInviteDetectCard = risk.groupInviteDetectCard !== false;
  filter.groupInviteDetectForward = risk.groupInviteDetectForward !== false;
  filter.groupInviteAction = risk.groupInviteAction || risk.rules?.groupInvite?.action || 'recall';
  filter.groupInviteBanMinutes = Number(risk.groupInviteBanMinutes || risk.rules?.groupInvite?.banMinutes || 10);
  settings.msgFilter = filter;
}
