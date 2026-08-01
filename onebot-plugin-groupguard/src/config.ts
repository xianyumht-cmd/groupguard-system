// 群管插件配置
import type { PluginConfig, GroupGuardSettings, MsgFilterSettings, SelfRecallPolicy, ActionPrioritySettings, QAEntry, BotAntiRiskScenePolicy, BotAntiRiskSuffixMode, BotAntiRiskLimitFallbackMode, ContentRiskAction, ContentRiskRule, ContentRiskSettings, ContentRiskType, SubGameplaySettings, QaLinkDeliverySettings, OutgoingRiskPackagingSettings, OutgoingRiskUrlMode, BanQueryResultMode, RiskPresetLevel, LanzouUpdatePushSettings } from './types';

export const DEFAULT_MSG_FILTER: MsgFilterSettings = {
  blockVideo: false,
  blockImage: false,
  blockRecord: false,
  blockForward: false,
  blockLightApp: false,
  blockContact: false,
  blockUrl: false,
  blockQr: false,
  blockGroupInvite: false,
  groupInviteDetectUrl: true,
  groupInviteDetectCard: true,
  groupInviteDetectForward: true,
  groupInviteAction: 'recall',
  groupInviteBanMinutes: 10,
};

export const DEFAULT_CONTENT_RISK_RULE: ContentRiskRule = {
  enabled: false,
  action: 'recall',
  banMinutes: 10,
  reason: ''
};

const CONTENT_RISK_TYPES: ContentRiskType[] = ['image', 'video', 'record', 'forward', 'lightApp', 'contact', 'url', 'qr', 'groupInvite'];

export const DEFAULT_CONTENT_RISK: ContentRiskSettings = {
  enabled: false,
  notifyGroup: false,
  logOnly: false,
  rules: CONTENT_RISK_TYPES.reduce((acc, type) => {
    acc[type] = { ...DEFAULT_CONTENT_RISK_RULE };
    return acc;
  }, {} as Record<ContentRiskType, ContentRiskRule>),
  urlAllowlist: [],
  urlBlocklist: [],
  qrDetectTimeoutMs: 3000,
  qrDetectMaxBytes: 5242880,
  qrDetectConcurrency: 2,
  qrCacheSeconds: 300,
  blockGroupInvite: false,
  groupInviteDetectUrl: true,
  groupInviteDetectCard: true,
  groupInviteDetectForward: true,
  groupInviteAction: 'recall',
  groupInviteBanMinutes: 10
};

export const DEFAULT_SUB_GAMEPLAY: SubGameplaySettings = {
  enabled: false,
  commandPrefix: '',
  masterServantEnabled: true,
  racingEnabled: true,
  lightEntertainmentEnabled: true,
  resourceMode: 'off',
  dailyWelfareGold: 1000,
  initialGold: 500,
  initialRacingCoins: 0,
  initialFuel: 100,
  maxFuel: 100,
  duelCostFuel: 10,
  raceCostFuel: 15,
  carCoinExchangeRate: 10,
  fuelExchangeRate: 5,
  pkCooldownSeconds: 30,
  escapeSuccessRate: 18,
  snatchSuccessRate: 45,
  contractTaxRate: 10,
  rankLimit: 10,
  textTemplates: {},
  commandAliases: {}
};

export const DEFAULT_OUTGOING_RISK: OutgoingRiskPackagingSettings = {
  enabled: false,
  urlMode: 'number',
  urlNotice: '链接已做编号化处理，原始地址不由机器人直接发送。',
  urlMaxPerMessage: 20,
  applyToPrivate: true,
  applyToForward: true,
  highRiskScenes: ['qa', 'qa_reply', 'query', 'external_query', 'video_query', 'raw_text'],
  logOnly: false
};

export const DEFAULT_QA_LINK_DELIVERY: QaLinkDeliverySettings = {
  enabled: false,
  noticeText: '已找到资源，稍后发送链接。请不要连续重复触发。',
  delayMinMs: 1000,
  delayMaxMs: 3000,
  wrapInCodeBlock: false
};

export const DEFAULT_LANZOU_MESSAGE_TEMPLATE = '检测到网盘更新：{title}\n{url}';

export const DEFAULT_LANZOU_UPDATE_PUSH: LanzouUpdatePushSettings = {
  enabled: false,
  monitorBaseUrl: '',
  groupIds: [],
  privateUserIds: [],
  targets: [],
  messageTemplate: DEFAULT_LANZOU_MESSAGE_TEMPLATE,
  includeDiffSummary: true
};

export const DEFAULT_GROUP_SETTINGS: GroupGuardSettings = {
  useGlobal: true,
  masterEnabled: true,
  silentMode: 'off',
  activeReplyEnabled: true,
  queryEnabled: true,
  qaEnabled: true,
  dynamicCommandEnabled: true,
  featureSwitches: {},
  subGameplay: { ...DEFAULT_SUB_GAMEPLAY },
  autoApprove: true,
  enableVerify: true,
  verifyTimeout: 300,
  maxAttempts: 5,
  mathMin: 1,
  mathMax: 100,
  targetUsers: [],
  groupBlacklist: [],
  leaveBlacklist: false,
  joinPrivateEnabled: false,
  joinPrivateMessage: '欢迎加入，进群后请先阅读群公告与群规。',
  disableWelcome: false,
  warningLimit: 3,
  warningAction: 'ban',
  curfewEnabled: false,
  curfewStart: '00:00',
  curfewEnd: '06:00',
  messageReward: 0,
  signinMin: 10,
  signinMax: 50,
  invitePoints: 20,
  inviteQueryPermission: 'all',
  lotteryCost: 50,
  lotteryReward: 200,
  autoRecallSelf: true,
  autoRecallSelfDelay: 60,
  autoRecallSelfProbability: 100,
  selfRecall: {
    enabled: true,
    probability: 100,
    mode: 'fixed',
    fixedDelay: 60,
    minDelay: 45,
    maxDelay: 90,
    jitter: 0,
  },
  randomSuffix: false,
  botAntiRiskSuffixMode: 'punctuation',
  botAntiRiskScenePolicies: {},
  botAntiRiskLimitFallbackMode: 'drop',
  qaLinkDelivery: { ...DEFAULT_QA_LINK_DELIVERY },
  outgoingRisk: { ...DEFAULT_OUTGOING_RISK },
  banQueryResultMode: 'short',
  banQueryUserCooldownSeconds: 10,
  banQueryGroupRateLimitPerMinute: 6,
  riskPresetLevel: 'balanced',
  randomDelayMin: 500,
  randomDelayMax: 1500,
  queueMode: 'group',
  queueConcurrency: 2,
  globalMaxPerMinute: 180,
  rateLimitEnqueue: true,
  replyProbability: 100,
  disableReplyTemplate: false,
  replyTemplatePool: ['{msg}'],
  qaCooldownSeconds: 30,
  qaUserCooldownSeconds: 12,
  qaTierCooldownLow: 15,
  qaTierCooldownMedium: 30,
  qaTierCooldownHigh: 60,
  qaHighRiskPatterns: ['广告', '引流', '赌博', '色情', '二维码', '进群'],
  qaMediumRiskPatterns: ['签到', '抽奖', '积分', '菜单', '帮助'],
  groupFuseWindowSeconds: 60,
  groupFuseThreshold: 45,
  groupFuseCooldownSeconds: 90,
  maxQueueSizeGlobal: 3000,
  maxQueueSizePerGroup: 120,
  disableQA: false,
  disableSignin: false,
  disableLottery: false,
  disableInvite: false,
  disableActivity: false,
  disableLolQuery: false,
  lolQueryGlobalRateLimitPerMinute: 120,
  lolQueryGlobalMinIntervalSeconds: 1,
  lolQueryRequestTimeoutSeconds: 20,
  lolQueryGroupRateLimitPerMinute: 20,
  lolQueryGroupMinIntervalSeconds: 2,
  lolQueryDailyLimit: 200,
  lolQueryOutputFormat: 'forward',
  lolQueryCommandSwitch: {
    battleQuery: true,
    banQuery: true,
  },
  allowRecallAdminMessage: false,
  allowRecallOwnerMessage: false,
  protectAdminActions: true,
  protectOwnerActions: true,
  actionRateWindowSeconds: 60,
  actionRateLimit: 30,
  recallDedupSeconds: 20,
  autoRiskControl: true,
  riskWarnScore: 3,
  riskProtectScore: 8,
  riskDecaySeconds: 300,
  personaAuditStrictMode: false,
  auditRetentionMaxAgeDays: 30,
  auditRetentionMaxRows: 20000,
  actionQueueEventRetentionMaxAgeDays: 7,
  actionQueueEventRetentionMaxRows: 50000,
  replyPersonaDefault: 'formal',
  autoRandomPersona: false,
  replyPersonaByScene: {},
  replySceneTemplates: {},
  actionQueueConcurrency: 2,
  actionTimeoutMs: 8000,
  maxActionQueueSizeGlobal: 5000,
  maxActionQueueSizePerGroup: 200,
  actionDedupSeconds: 20,
  maxKickPerMinute: 3,
  maxBanPerMinute: 5,
  maxRecallPerMinute: 60,
  maxMiscPerMinute: 120,
  actionPriority: {
    ban: 4,
    kick: 3,
    recall: 2,
    self_recall: 1,
  },
  recallDelayMinSeconds: 1,
  recallDelayMaxSeconds: 3,
  banDelayMinSeconds: 3,
  banDelayMaxSeconds: 8,
  kickDelayMinSeconds: 5,
  kickDelayMaxSeconds: 20,
  miscDelayMinSeconds: 0.3,
  miscDelayMaxSeconds: 1.2,
  blacklistAction: 'recall',
  blacklistBanMinutes: 30,
  blacklistKickRejectAddRequest: true,
  blacklistKickDelayMinSeconds: 5,
  blacklistKickDelayMaxSeconds: 20,
  blacklistCheckBeforeCommand: true,
  msgFilter: { ...DEFAULT_MSG_FILTER },
  contentRisk: JSON.parse(JSON.stringify(DEFAULT_CONTENT_RISK)),
};

function normalizeNumber(value: any, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item: any) => String(item || '').trim()).filter(Boolean)));
}

function normalizeUrlString(value: any, fallback = ''): string {
  const text = String(value || '').trim().replace(/\/+$/, '');
  return text || fallback;
}

function normalizeLanzouUpdatePush(value: any): LanzouUpdatePushSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const targets = Array.isArray(input.targets)
    ? input.targets
      .filter((target: any) => target && typeof target === 'object')
      .map((target: any) => ({
        type: target.type === 'private' ? 'private' : 'group',
        groupId: String(target.groupId || target.group_id || '').trim(),
        userId: String(target.userId || target.user_id || '').trim(),
        enabled: target.enabled !== false
      }))
      .filter((target: any) => target.type === 'private' ? Boolean(target.userId) : Boolean(target.groupId))
    : [];
  return {
    enabled: input.enabled === true,
    monitorBaseUrl: normalizeUrlString(input.monitorBaseUrl || input.monitor_base_url, DEFAULT_LANZOU_UPDATE_PUSH.monitorBaseUrl),
    groupIds: normalizeStringArray(input.groupIds || input.group_ids),
    privateUserIds: normalizeStringArray(input.privateUserIds || input.private_user_ids),
    targets,
    messageTemplate: String(input.messageTemplate || input.message_template || DEFAULT_LANZOU_UPDATE_PUSH.messageTemplate).trim() || DEFAULT_LANZOU_UPDATE_PUSH.messageTemplate,
    includeDiffSummary: input.includeDiffSummary !== false && input.include_diff_summary !== false
  };
}

function normalizeContentRiskAction(value: any, fallback: ContentRiskAction = 'recall'): ContentRiskAction {
  return value === 'recall'
    || value === 'recall_warn'
    || value === 'recall_ban'
    || value === 'recall_kick'
    || value === 'recall_blacklist'
    ? value
    : fallback;
}

function normalizeMsgFilter(input: any): MsgFilterSettings {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    blockVideo: src.blockVideo === true,
    blockImage: src.blockImage === true,
    blockRecord: src.blockRecord === true,
    blockForward: src.blockForward === true,
    blockLightApp: src.blockLightApp === true,
    blockContact: src.blockContact === true,
    blockUrl: src.blockUrl === true,
    blockQr: src.blockQr === true,
    blockGroupInvite: src.blockGroupInvite === true,
    groupInviteDetectUrl: src.groupInviteDetectUrl !== false,
    groupInviteDetectCard: src.groupInviteDetectCard !== false,
    groupInviteDetectForward: src.groupInviteDetectForward !== false,
    groupInviteAction: normalizeContentRiskAction(src.groupInviteAction, 'recall'),
    groupInviteBanMinutes: normalizeNumber(src.groupInviteBanMinutes, 10, 1, 1440)
  };
}

function legacyRuleEnabled(type: ContentRiskType, filter: MsgFilterSettings): boolean {
  if (type === 'image') return filter.blockImage === true;
  if (type === 'video') return filter.blockVideo === true;
  if (type === 'record') return filter.blockRecord === true;
  if (type === 'forward') return filter.blockForward === true;
  if (type === 'lightApp') return filter.blockLightApp === true;
  if (type === 'contact') return filter.blockContact === true;
  if (type === 'url') return filter.blockUrl === true;
  if (type === 'qr') return filter.blockQr === true;
  if (type === 'groupInvite') return filter.blockGroupInvite === true;
  return false;
}

function normalizeContentRisk(input: any, legacyFilter: MsgFilterSettings): ContentRiskSettings {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const srcRules = src.rules && typeof src.rules === 'object' && !Array.isArray(src.rules) ? src.rules : {};
  const rules = CONTENT_RISK_TYPES.reduce((acc, type) => {
    const rawRule = srcRules[type] && typeof srcRules[type] === 'object' && !Array.isArray(srcRules[type]) ? srcRules[type] : {};
    const legacyEnabled = legacyRuleEnabled(type, legacyFilter);
    const actionFallback = type === 'groupInvite'
      ? normalizeContentRiskAction(src.groupInviteAction || legacyFilter.groupInviteAction, 'recall')
      : 'recall';
    acc[type] = {
      enabled: rawRule.enabled === true || legacyEnabled,
      action: normalizeContentRiskAction(rawRule.action, actionFallback),
      banMinutes: normalizeNumber(rawRule.banMinutes, type === 'groupInvite' ? (src.groupInviteBanMinutes ?? legacyFilter.groupInviteBanMinutes ?? 10) : 10, 1, 1440),
      reason: String(rawRule.reason || '')
    };
    return acc;
  }, {} as Record<ContentRiskType, ContentRiskRule>);
  const anyLegacyEnabled = CONTENT_RISK_TYPES.some(type => legacyRuleEnabled(type, legacyFilter));
  return {
    enabled: src.enabled === true || anyLegacyEnabled,
    notifyGroup: src.notifyGroup === true,
    logOnly: src.logOnly === true,
    rules,
    urlAllowlist: normalizeStringArray(src.urlAllowlist),
    urlBlocklist: normalizeStringArray(src.urlBlocklist),
    qrDetectTimeoutMs: normalizeNumber(src.qrDetectTimeoutMs, 3000, 300, 30000),
    qrDetectMaxBytes: normalizeNumber(src.qrDetectMaxBytes, 5242880, 102400, 52428800),
    qrDetectConcurrency: normalizeNumber(src.qrDetectConcurrency, 2, 1, 10),
    qrCacheSeconds: normalizeNumber(src.qrCacheSeconds, 300, 0, 86400),
    blockGroupInvite: src.blockGroupInvite === true || legacyFilter.blockGroupInvite === true || rules.groupInvite.enabled === true,
    groupInviteDetectUrl: src.groupInviteDetectUrl !== false && legacyFilter.groupInviteDetectUrl !== false,
    groupInviteDetectCard: src.groupInviteDetectCard !== false && legacyFilter.groupInviteDetectCard !== false,
    groupInviteDetectForward: src.groupInviteDetectForward !== false && legacyFilter.groupInviteDetectForward !== false,
    groupInviteAction: normalizeContentRiskAction(src.groupInviteAction || legacyFilter.groupInviteAction, rules.groupInvite.action),
    groupInviteBanMinutes: normalizeNumber(src.groupInviteBanMinutes ?? legacyFilter.groupInviteBanMinutes, rules.groupInvite.banMinutes ?? 10, 1, 1440)
  };
}

function normalizeSelfRecall(settings: GroupGuardSettings): SelfRecallPolicy {
  const base = settings.selfRecall || ({} as SelfRecallPolicy);
  const legacyEnabled = settings.autoRecallSelf === true;
  const legacyDelay = normalizeNumber(settings.autoRecallSelfDelay, 60, 0, 300);
  const legacyProbability = normalizeNumber(settings.autoRecallSelfProbability, 100, 0, 100);
  const enabled = base.enabled !== undefined ? base.enabled === true : legacyEnabled;
  const probability = normalizeNumber(base.probability, legacyProbability, 0, 100);
  const mode = base.mode === 'random' ? 'random' : 'fixed';
  const fixedDelay = normalizeNumber(base.fixedDelay, legacyDelay, 0, 300);
  const minDelay = normalizeNumber(base.minDelay, Math.max(0, fixedDelay - 15), 0, 300);
  const maxDelay = normalizeNumber(base.maxDelay, Math.max(minDelay, fixedDelay + 30), minDelay, 300);
  const jitter = normalizeNumber(base.jitter, 0, 0, 300);
  return { enabled, probability, mode, fixedDelay, minDelay, maxDelay, jitter };
}

function normalizeActionPriority(settings: GroupGuardSettings): ActionPrioritySettings {
  const src = settings.actionPriority || ({} as ActionPrioritySettings);
  const d = DEFAULT_GROUP_SETTINGS.actionPriority as ActionPrioritySettings;
  return {
    ban: normalizeNumber(src.ban, d.ban),
    kick: normalizeNumber(src.kick, d.kick),
    recall: normalizeNumber(src.recall, d.recall),
    self_recall: normalizeNumber(src.self_recall, d.self_recall),
  };
}

function normalizeSuffixMode(value: any, fallback: BotAntiRiskSuffixMode = 'global'): BotAntiRiskSuffixMode {
  if (value === 'invisible') return 'none';
  return value === 'mixed' || value === 'punctuation' || value === 'none' || value === 'global' ? value : fallback;
}

function normalizeLimitFallbackMode(value: any, fallback: BotAntiRiskLimitFallbackMode = 'drop'): BotAntiRiskLimitFallbackMode {
  return value === 'forward' || value === 'drop' ? value : fallback;
}

function normalizeOutgoingRiskUrlMode(value: any, fallback: OutgoingRiskUrlMode = 'number'): OutgoingRiskUrlMode {
  return value === 'off' || value === 'number' || value === 'mask' || value === 'drop' ? value : fallback;
}

function normalizeBanQueryResultMode(value: any, fallback: BanQueryResultMode = 'short'): BanQueryResultMode {
  return value === 'short' || value === 'image' || value === 'text' ? value : fallback;
}

function normalizeRiskPresetLevel(value: any, fallback: RiskPresetLevel = 'balanced'): RiskPresetLevel {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive' ? value : fallback;
}

function normalizeOutgoingRisk(input: any): OutgoingRiskPackagingSettings {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: src.enabled === true,
    urlMode: normalizeOutgoingRiskUrlMode(src.urlMode, DEFAULT_OUTGOING_RISK.urlMode),
    urlNotice: String(src.urlNotice ?? DEFAULT_OUTGOING_RISK.urlNotice),
    urlMaxPerMessage: normalizeNumber(src.urlMaxPerMessage, DEFAULT_OUTGOING_RISK.urlMaxPerMessage, 1, 100),
    applyToPrivate: src.applyToPrivate !== false,
    applyToForward: src.applyToForward !== false,
    highRiskScenes: src.highRiskScenes === undefined ? [...DEFAULT_OUTGOING_RISK.highRiskScenes] : normalizeStringArray(src.highRiskScenes),
    logOnly: src.logOnly === true
  };
}

function normalizeQaLinkDelivery(input: any): QaLinkDeliverySettings {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const min = normalizeNumber(src.delayMinMs, DEFAULT_QA_LINK_DELIVERY.delayMinMs, 0, 60000);
  const max = normalizeNumber(src.delayMaxMs, DEFAULT_QA_LINK_DELIVERY.delayMaxMs, min, 60000);
  return {
    enabled: src.enabled === true,
    noticeText: String(src.noticeText ?? DEFAULT_QA_LINK_DELIVERY.noticeText).trim() || DEFAULT_QA_LINK_DELIVERY.noticeText,
    delayMinMs: min,
    delayMaxMs: max,
    wrapInCodeBlock: src.wrapInCodeBlock === true
  };
}

function normalizeBotAntiRiskScenePolicies(input: any): Record<string, BotAntiRiskScenePolicy> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, BotAntiRiskScenePolicy> = {};
  for (const [scene, raw] of Object.entries(input)) {
    const key = String(scene || '').trim();
    if (!key || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as any;
    const policy: BotAntiRiskScenePolicy = {};
    if (item.delayMinMs !== undefined) policy.delayMinMs = normalizeNumber(item.delayMinMs, 0, 0, 60000);
    if (item.delayMaxMs !== undefined) policy.delayMaxMs = normalizeNumber(item.delayMaxMs, policy.delayMinMs ?? 0, policy.delayMinMs ?? 0, 60000);
    if (item.replyProbability !== undefined) policy.replyProbability = normalizeNumber(item.replyProbability, 100, 0, 100);
    if (item.suffixMode !== undefined) policy.suffixMode = normalizeSuffixMode(item.suffixMode, 'global');
    out[key] = policy;
  }
  return out;
}

function normalizeStringRecordArray(input: any): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    const values = Array.isArray(value)
      ? value.map(item => String(item || '').trim()).filter(Boolean)
      : String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);
    if (values.length) out[normalizedKey] = Array.from(new Set(values));
  }
  return out;
}

function normalizeStringRecord(input: any): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = String(value ?? '');
  }
  return out;
}

function normalizeSubGameplay(input: any): SubGameplaySettings {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const d = DEFAULT_SUB_GAMEPLAY;
  return {
    enabled: src.enabled === true,
    commandPrefix: String(src.commandPrefix ?? d.commandPrefix).trim(),
    masterServantEnabled: src.masterServantEnabled !== false,
    racingEnabled: src.racingEnabled !== false,
    lightEntertainmentEnabled: src.lightEntertainmentEnabled !== false,
    resourceMode: src.resourceMode === 'light' || src.resourceMode === 'all' ? src.resourceMode : d.resourceMode,
    dailyWelfareGold: normalizeNumber(src.dailyWelfareGold, d.dailyWelfareGold, 0, 100000000),
    initialGold: normalizeNumber(src.initialGold, d.initialGold, 0, 100000000),
    initialRacingCoins: normalizeNumber(src.initialRacingCoins, d.initialRacingCoins, 0, 100000000),
    initialFuel: normalizeNumber(src.initialFuel, d.initialFuel, 0, 1000000),
    maxFuel: normalizeNumber(src.maxFuel, d.maxFuel, 1, 1000000),
    duelCostFuel: normalizeNumber(src.duelCostFuel, d.duelCostFuel, 0, 1000000),
    raceCostFuel: normalizeNumber(src.raceCostFuel, d.raceCostFuel, 0, 1000000),
    carCoinExchangeRate: normalizeNumber(src.carCoinExchangeRate, d.carCoinExchangeRate, 1, 1000000),
    fuelExchangeRate: normalizeNumber(src.fuelExchangeRate, d.fuelExchangeRate, 1, 1000000),
    pkCooldownSeconds: normalizeNumber(src.pkCooldownSeconds, d.pkCooldownSeconds, 0, 86400),
    escapeSuccessRate: normalizeNumber(src.escapeSuccessRate, d.escapeSuccessRate, 0, 100),
    snatchSuccessRate: normalizeNumber(src.snatchSuccessRate, d.snatchSuccessRate, 0, 100),
    contractTaxRate: normalizeNumber(src.contractTaxRate, d.contractTaxRate, 0, 90),
    rankLimit: normalizeNumber(src.rankLimit, d.rankLimit, 3, 50),
    textTemplates: normalizeStringRecord(src.textTemplates),
    commandAliases: normalizeStringRecordArray(src.commandAliases)
  };
}

export function normalizeGroupSettings(input: GroupGuardSettings): GroupGuardSettings {
  const merged: GroupGuardSettings = {
    ...JSON.parse(JSON.stringify(DEFAULT_GROUP_SETTINGS)),
    ...(input || {}),
  };
  merged.msgFilter = normalizeMsgFilter(merged.msgFilter);
  merged.contentRisk = normalizeContentRisk((merged as any).contentRisk, merged.msgFilter);
  merged.selfRecall = normalizeSelfRecall(merged);
  merged.masterEnabled = merged.masterEnabled !== false;
  merged.silentMode = merged.silentMode === 'noPassiveReply' || merged.silentMode === 'noBotSend' ? merged.silentMode : 'off';
  merged.activeReplyEnabled = merged.activeReplyEnabled !== false;
  merged.queryEnabled = merged.queryEnabled !== false;
  merged.qaEnabled = merged.disableQA === true ? false : merged.qaEnabled !== false;
  merged.dynamicCommandEnabled = merged.dynamicCommandEnabled !== false;
  merged.featureSwitches = merged.featureSwitches && typeof merged.featureSwitches === 'object' && !Array.isArray(merged.featureSwitches)
    ? Object.entries(merged.featureSwitches).reduce((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (normalizedKey) acc[normalizedKey] = value !== false;
      return acc;
    }, {} as Record<string, boolean>)
    : {};
  merged.subGameplay = normalizeSubGameplay((merged as any).subGameplay);
  merged.botAntiRiskSuffixMode = normalizeSuffixMode(merged.botAntiRiskSuffixMode, 'punctuation');
  merged.botAntiRiskScenePolicies = normalizeBotAntiRiskScenePolicies(merged.botAntiRiskScenePolicies);
  merged.botAntiRiskLimitFallbackMode = normalizeLimitFallbackMode(merged.botAntiRiskLimitFallbackMode, 'drop');
  merged.qaLinkDelivery = normalizeQaLinkDelivery((merged as any).qaLinkDelivery);
  merged.outgoingRisk = normalizeOutgoingRisk((merged as any).outgoingRisk);
  merged.banQueryResultMode = normalizeBanQueryResultMode(merged.banQueryResultMode, 'short');
  merged.banQueryUserCooldownSeconds = normalizeNumber(merged.banQueryUserCooldownSeconds, 10, 0, 3600);
  merged.banQueryGroupRateLimitPerMinute = normalizeNumber(merged.banQueryGroupRateLimitPerMinute, 6, 1, 1000);
  merged.riskPresetLevel = normalizeRiskPresetLevel(merged.riskPresetLevel, 'balanced');
  merged.autoRecallSelf = merged.selfRecall.enabled;
  merged.autoRecallSelfDelay = merged.selfRecall.mode === 'fixed'
    ? merged.selfRecall.fixedDelay
    : normalizeNumber((merged.selfRecall.minDelay + merged.selfRecall.maxDelay) / 2, 60, 0, 300);
  merged.autoRecallSelfProbability = merged.selfRecall.probability;
  merged.actionPriority = normalizeActionPriority(merged);
  merged.actionQueueConcurrency = normalizeNumber(merged.actionQueueConcurrency, 2, 1, 20);
  merged.maxActionQueueSizeGlobal = normalizeNumber(merged.maxActionQueueSizeGlobal, 5000, 200);
  merged.maxActionQueueSizePerGroup = normalizeNumber(merged.maxActionQueueSizePerGroup, 200, 20);
  merged.actionTimeoutMs = normalizeNumber(merged.actionTimeoutMs, 8000, 1000);
  merged.maxRecallPerMinute = normalizeNumber(merged.maxRecallPerMinute, 60, 1);
  merged.maxKickPerMinute = normalizeNumber(merged.maxKickPerMinute, 3, 1);
  merged.maxBanPerMinute = normalizeNumber(merged.maxBanPerMinute, 5, 1);
  merged.disableWelcome = merged.disableWelcome === true;
  merged.disableLolQuery = merged.disableLolQuery === true;
  merged.lolQueryGlobalRateLimitPerMinute = normalizeNumber(merged.lolQueryGlobalRateLimitPerMinute, 120, 1, 5000);
  merged.lolQueryGlobalMinIntervalSeconds = normalizeNumber(merged.lolQueryGlobalMinIntervalSeconds, 1, 0, 600);
  merged.lolQueryRequestTimeoutSeconds = normalizeNumber(merged.lolQueryRequestTimeoutSeconds, 20, 3, 120);
  merged.lolQueryGroupRateLimitPerMinute = normalizeNumber(merged.lolQueryGroupRateLimitPerMinute, 20, 1, 1000);
  merged.lolQueryGroupMinIntervalSeconds = normalizeNumber(merged.lolQueryGroupMinIntervalSeconds, 2, 0, 600);
  merged.lolQueryDailyLimit = normalizeNumber(merged.lolQueryDailyLimit, 200, 1, 100000);
  merged.lolQueryOutputFormat = merged.lolQueryOutputFormat === 'text' || merged.lolQueryOutputFormat === 'image' || merged.lolQueryOutputFormat === 'card'
    ? merged.lolQueryOutputFormat
    : 'forward';
  const switchInput = merged.lolQueryCommandSwitch || {};
  merged.lolQueryCommandSwitch = {
    battleQuery: (switchInput as any).battleQuery !== false,
    banQuery: (switchInput as any).banQuery !== false,
  };
  merged.inviteQueryPermission = merged.inviteQueryPermission === 'admin' || merged.inviteQueryPermission === 'owner' ? merged.inviteQueryPermission : 'all';
  merged.blacklistAction = merged.blacklistAction === 'ban' || merged.blacklistAction === 'kick' || merged.blacklistAction === 'kick_and_block' ? merged.blacklistAction : 'recall';
  merged.blacklistKickDelayMinSeconds = normalizeNumber(merged.blacklistKickDelayMinSeconds, merged.kickDelayMinSeconds ?? 5, 0);
  merged.blacklistKickDelayMaxSeconds = normalizeNumber(merged.blacklistKickDelayMaxSeconds, merged.kickDelayMaxSeconds ?? 20, merged.blacklistKickDelayMinSeconds);
  return merged;
}

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  configVersion: 8,
  licenseKey: '',
  debug: false,
  ownerQQs: '',
  licenses: {},
  global: { ...DEFAULT_GROUP_SETTINGS, useGlobal: false },
  groups: {},
  antiRecallGroups: [],
  globalAntiRecall: false,
  globalEmojiReact: false,
  emojiReactGroups: {},
  cardLocks: {},
  blacklist: [],
  whitelist: [],
  filterKeywords: [],
  filterPunishLevel: 1,
  filterBanMinutes: 10,
  welcomeMessage: '欢迎 {user} 加入本群！',
  spamWindow: 10,
  spamThreshold: 10,
  spamDetect: false,
  spamBanMinutes: 5,
  leaveBlacklist: false,
  lolToken: '',
  lolQueryUrl: '',
  lolAuthKey: '',
  lolBanPrimaryUrl: '',
  lolBanBackupUrls: [],
  lolApiBaseUrl: '',
  eleBuildApiBaseUrl: '',
  shardDataUrl: '',
  shardHeroListUrl: 'https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js',
  shardImageUrlTemplate: '',
  shardQueryOutputFormat: 'image',
  scammerQueryUrls: [],
  scammerReportUrl: '',
  scammerMaxRecords: 5000,
  scammerMaxEvidenceLength: 500,
  scammerMaxRecentReportsPerQQ: 10,
  scammerQueryUserCooldownSeconds: 10,
  scammerQueryGroupRateLimitPerMinute: 20,
  scammerQueryCacheSeconds: 300,
  scammerReportUserCooldownSeconds: 60,
  scammerReportGroupRateLimitPerMinute: 5,
  scammerReportUserDailyLimit: 20,
  scammerReportDedupHours: 24,
  lanzouUpdatePush: { ...DEFAULT_LANZOU_UPDATE_PUSH },
  msgFilter: { ...DEFAULT_MSG_FILTER },
  contentRisk: JSON.parse(JSON.stringify(DEFAULT_CONTENT_RISK)),
  qaList: [],
  rejectKeywords: [],
  presets: [],
};


export function normalizePluginConfig(input: PluginConfig): PluginConfig {
  const merged: PluginConfig = {
    ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)),
    ...(input || {}),
  };
  const rawInputVersion = Number((input as any)?.configVersion);
  const inputVersion = Number.isFinite(rawInputVersion) && rawInputVersion > 0 ? rawInputVersion : 1;
  if (inputVersion < 2) {
    merged.global = {
      ...(merged.global || {}),
      auditRetentionMaxAgeDays: (merged.global as any)?.auditRetentionMaxAgeDays || 30,
      auditRetentionMaxRows: (merged.global as any)?.auditRetentionMaxRows || 20000
    };
  }
  if (inputVersion < 3) {
    merged.global = {
      ...(merged.global || {}),
      actionQueueEventRetentionMaxAgeDays: (merged.global as any)?.actionQueueEventRetentionMaxAgeDays || 7,
      actionQueueEventRetentionMaxRows: (merged.global as any)?.actionQueueEventRetentionMaxRows || 50000
    };
  }
  if (inputVersion < 4) {
    merged.global = {
      ...(merged.global || {}),
      botAntiRiskSuffixMode: normalizeSuffixMode((merged.global as any)?.botAntiRiskSuffixMode, 'punctuation'),
      botAntiRiskScenePolicies: (merged.global as any)?.botAntiRiskScenePolicies || {}
    };
  }
  if (inputVersion < 5) {
    merged.global = {
      ...(merged.global || {}),
      botAntiRiskLimitFallbackMode: (merged.global as any)?.botAntiRiskLimitFallbackMode || 'drop'
    };
  }
  merged.msgFilter = normalizeMsgFilter((merged as any).msgFilter);
  merged.lanzouUpdatePush = normalizeLanzouUpdatePush((merged as any).lanzouUpdatePush);
  merged.contentRisk = normalizeContentRisk((merged as any).contentRisk, merged.msgFilter);
  if (!(input as any)?.global?.msgFilter && (input as any)?.msgFilter) {
    merged.global = { ...(merged.global || {}), msgFilter: merged.msgFilter };
  }
  if (!(input as any)?.global?.contentRisk && ((input as any)?.contentRisk || (input as any)?.msgFilter)) {
    merged.global = { ...(merged.global || {}), contentRisk: merged.contentRisk };
  }
  merged.configVersion = 8;
  const normalizedQaList: QAEntry[] = Array.isArray(merged.qaList)
    ? merged.qaList
      .filter((qa: any) => qa && typeof qa.keyword === 'string' && typeof qa.reply === 'string')
      .map((qa: any): QAEntry => ({
        keyword: String(qa.keyword),
        reply: String(qa.reply),
        mode: qa.mode === 'contains' || qa.mode === 'regex' ? qa.mode : 'exact'
      }))
    : [];

  merged.qaList = normalizedQaList;
  merged.global = normalizeGroupSettings(merged.global || ({} as GroupGuardSettings));
  merged.global.auditRetentionMaxAgeDays = normalizeNumber(merged.global.auditRetentionMaxAgeDays, 30, 1, 3650);
  merged.global.auditRetentionMaxRows = normalizeNumber(merged.global.auditRetentionMaxRows, 20000, 100, 1000000);
  merged.global.actionQueueEventRetentionMaxAgeDays = normalizeNumber(merged.global.actionQueueEventRetentionMaxAgeDays, 7, 1, 3650);
  merged.global.actionQueueEventRetentionMaxRows = normalizeNumber(merged.global.actionQueueEventRetentionMaxRows, 50000, 100, 1000000);
  merged.shardDataUrl = String(merged.shardDataUrl || '').trim();
  merged.eleBuildApiBaseUrl = String(merged.eleBuildApiBaseUrl || '').trim().replace(/\/+$/, '');
  merged.shardHeroListUrl = String(merged.shardHeroListUrl || '').trim();
  merged.shardImageUrlTemplate = String(merged.shardImageUrlTemplate || '').trim();
  merged.shardQueryOutputFormat = merged.shardQueryOutputFormat === 'text' || merged.shardQueryOutputFormat === 'image'
    ? merged.shardQueryOutputFormat
    : 'image';
  const groups: Record<string, GroupGuardSettings> = {};
  for (const [gid, gs] of Object.entries(merged.groups || {})) {
    const groupInput = gs as GroupGuardSettings;
    const hasQaLinkDelivery = Object.prototype.hasOwnProperty.call(groupInput as any, 'qaLinkDelivery');
    groups[gid] = normalizeGroupSettings(groupInput);
    if (!hasQaLinkDelivery) delete (groups[gid] as any).qaLinkDelivery;
  }
  merged.groups = groups;
  const validUrl = (value: string): boolean => {
    try {
      const sample = String(value || '')
        .replaceAll('{qq}', '123456')
        .replaceAll('{wechat}', 'wxid_test')
        .replaceAll('{wx}', 'wxid_test')
        .replaceAll('{account}', '123456')
        .replaceAll('{identifier}', '123456')
        .replaceAll('{type}', 'qq');
      const parsed = new URL(sample);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };
  const queryUrls = Array.isArray(merged.scammerQueryUrls) ? merged.scammerQueryUrls : [];
  merged.scammerQueryUrls = Array.from(new Set(queryUrls
    .map((value: any) => String(value || '').trim())
    .filter((value: string) => value && validUrl(value))));
  const reportUrl = String(merged.scammerReportUrl || '').trim();
  merged.scammerReportUrl = reportUrl && validUrl(reportUrl) ? reportUrl : '';
  merged.scammerMaxRecords = normalizeNumber(merged.scammerMaxRecords, 5000, 100, 100000);
  merged.scammerMaxEvidenceLength = normalizeNumber(merged.scammerMaxEvidenceLength, 500, 50, 5000);
  merged.scammerMaxRecentReportsPerQQ = normalizeNumber(merged.scammerMaxRecentReportsPerQQ, 10, 1, 50);
  merged.scammerQueryUserCooldownSeconds = normalizeNumber(merged.scammerQueryUserCooldownSeconds, 10, 0, 3600);
  merged.scammerQueryGroupRateLimitPerMinute = normalizeNumber(merged.scammerQueryGroupRateLimitPerMinute, 20, 1, 1000);
  merged.scammerQueryCacheSeconds = normalizeNumber(merged.scammerQueryCacheSeconds, 300, 0, 86400);
  merged.scammerReportUserCooldownSeconds = normalizeNumber(merged.scammerReportUserCooldownSeconds, 60, 0, 86400);
  merged.scammerReportGroupRateLimitPerMinute = normalizeNumber(merged.scammerReportGroupRateLimitPerMinute, 5, 1, 1000);
  merged.scammerReportUserDailyLimit = normalizeNumber(merged.scammerReportUserDailyLimit, 20, 1, 1000);
  merged.scammerReportDedupHours = normalizeNumber(merged.scammerReportDedupHours, 24, 0, 720);
  return merged;
}

// 帮助菜单
export const GROUP_ADMIN_MENU = `群管功能（需管理员权限）
【禁言@某人 分钟】禁言成员
【禁言QQ号 分钟】禁言成员
【解禁@某人】解除禁言
【解禁QQ号】解除禁言
【全体禁言】开启全体禁言
【全体解禁】关闭全体禁言
【踢出@某人】踢出成员
【踢出QQ号】踢出成员
【授予头衔@某人 内容】设置头衔(群主)
【清除头衔@某人】清除头衔(群主)
【锁定名片@某人】锁定群名片
【解锁名片@某人】解锁群名片
【名片锁定列表】查看锁定列表
【警告@某人】警告成员
【查看警告@某人】查看警告记录
【清除警告@某人】清除警告记录
【开启宵禁 开始 结束】开启宵禁(00:00 06:00)
【关闭宵禁】关闭宵禁
【设置欢迎词 内容】设置入群欢迎词
【定时任务 08:00 内容】添加每日定时
【删除定时任务 ID】删除指定任务
【定时列表】查看所有定时任务`;

export const RISK_CONTROL_MENU = `🛡️ 风控与安全设置
----------------
• 开启/关闭刷屏检测
• 设置刷屏阈值 <次数> (默认10)
• 设置刷屏时间 <秒> (默认10)
• 设置复读阈值 <次数> (默认0关闭)
• 开启/关闭自身撤回
• 设置自身撤回时间 <秒>
• 开启/关闭入群验证
• 设置权限缓存 <秒> (默认60)
• 开启/关闭宵禁
• 设置宵禁时间 <开始> <结束>`;

export const AUTH_MENU = `📝 授权管理 (私聊指令)`;

// 移除分散的菜单项
export const INTERACT_MENU = `🎮 互动娱乐...`;

export const ANTI_RECALL_MENU = `防撤回功能(需授权)
【开启防撤回】当前群开启
【关闭防撤回】当前群关闭
【防撤回列表】查看已开启的群`;

export const EMOJI_REACT_MENU = `回应表情功能
【开启回应表情】当前群开启
【关闭回应表情】当前群关闭`;

export const TARGET_MENU = `针对功能（自动撤回）
【针对@某人】针对被@的用户
【针对+QQ号】针对指定QQ
【取消针对@某人】取消针对
【取消针对+QQ号】取消指定QQ
【针对列表】查看当前群针对列表
【清除针对】清除当前群所有针对`;

export const BLACKWHITE_MENU = `黑白名单功能（主人权限）
【拉黑@某人】加入全局黑名单
【拉黑QQ号】加入全局黑名单
【取消拉黑@某人】移出黑名单
【取消拉黑QQ号】移出黑名单
【黑名单列表】查看全局黑名单
【白名单@某人】加入白名单
【白名单QQ号】加入白名单
【取消白名单@某人】移出白名单
【取消白名单QQ号】移出白名单
【白名单列表】查看白名单
【群拉黑@某人】加入本群黑名单
【群拉黑QQ号】加入本群黑名单
【群取消拉黑@某人】移出本群黑名单
【群取消拉黑QQ号】移出本群黑名单
【群黑名单列表】查看本群黑名单`;

export const FILTER_MENU = `违禁词功能（主人权限）
【添加违禁词 词语】添加违禁词
【删除违禁词 词语】删除违禁词
【违禁词列表】查看违禁词列表`;

export const QA_MENU = `问答功能（主人/管理员）
【问答列表】查看当前问答
【添加问答 关键词|回复】添加精确匹配
【添加模糊问答 关键词|回复】添加包含匹配
【添加正则问答 正则|回复】添加正则匹配
【删除问答 关键词】删除指定问答
支持变量: {user}=QQ号 {group}=群号`;

export const REJECT_KW_MENU = `入群审核拒绝关键词（主人权限）
【添加拒绝词 词语】添加拒绝关键词
【删除拒绝词 词语】删除拒绝关键词
【拒绝词列表】查看拒绝关键词列表
入群验证信息包含关键词时自动拒绝`;
