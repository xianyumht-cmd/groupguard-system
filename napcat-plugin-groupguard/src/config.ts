// 群管插件配置
import type { PluginConfig, GroupGuardSettings, MsgFilterSettings, SelfRecallPolicy, ActionPrioritySettings, QAEntry, BotAntiRiskScenePolicy, BotAntiRiskSuffixMode, BotAntiRiskLimitFallbackMode } from './types';

export const DEFAULT_MSG_FILTER: MsgFilterSettings = {
  blockVideo: false,
  blockImage: false,
  blockRecord: false,
  blockForward: false,
  blockLightApp: false,
  blockContact: false,
  blockUrl: false,
  blockQr: false,
};

export const DEFAULT_GROUP_SETTINGS: GroupGuardSettings = {
  useGlobal: true,
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
  selfRecall: {
    enabled: true,
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
    hiddenQuery: true,
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
};

function normalizeNumber(value: any, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeSelfRecall(settings: GroupGuardSettings): SelfRecallPolicy {
  const base = settings.selfRecall || ({} as SelfRecallPolicy);
  const legacyEnabled = settings.autoRecallSelf === true;
  const legacyDelay = normalizeNumber(settings.autoRecallSelfDelay, 60, 0, 300);
  const enabled = base.enabled !== undefined ? base.enabled === true : legacyEnabled;
  const mode = base.mode === 'random' ? 'random' : 'fixed';
  const fixedDelay = normalizeNumber(base.fixedDelay, legacyDelay, 0, 300);
  const minDelay = normalizeNumber(base.minDelay, Math.max(0, fixedDelay - 15), 0, 300);
  const maxDelay = normalizeNumber(base.maxDelay, Math.max(minDelay, fixedDelay + 30), minDelay, 300);
  const jitter = normalizeNumber(base.jitter, 0, 0, 300);
  return { enabled, mode, fixedDelay, minDelay, maxDelay, jitter };
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

export function normalizeGroupSettings(input: GroupGuardSettings): GroupGuardSettings {
  const merged: GroupGuardSettings = {
    ...JSON.parse(JSON.stringify(DEFAULT_GROUP_SETTINGS)),
    ...(input || {}),
  };
  merged.selfRecall = normalizeSelfRecall(merged);
  merged.botAntiRiskSuffixMode = normalizeSuffixMode(merged.botAntiRiskSuffixMode, 'punctuation');
  merged.botAntiRiskScenePolicies = normalizeBotAntiRiskScenePolicies(merged.botAntiRiskScenePolicies);
  merged.botAntiRiskLimitFallbackMode = normalizeLimitFallbackMode(merged.botAntiRiskLimitFallbackMode, 'drop');
  merged.autoRecallSelf = merged.selfRecall.enabled;
  merged.autoRecallSelfDelay = merged.selfRecall.mode === 'fixed'
    ? merged.selfRecall.fixedDelay
    : normalizeNumber((merged.selfRecall.minDelay + merged.selfRecall.maxDelay) / 2, 60, 0, 300);
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
    hiddenQuery: (switchInput as any).hiddenQuery !== false,
  };
  merged.inviteQueryPermission = merged.inviteQueryPermission === 'admin' || merged.inviteQueryPermission === 'owner' ? merged.inviteQueryPermission : 'all';
  merged.blacklistAction = merged.blacklistAction === 'ban' || merged.blacklistAction === 'kick' || merged.blacklistAction === 'kick_and_block' ? merged.blacklistAction : 'recall';
  merged.blacklistKickDelayMinSeconds = normalizeNumber(merged.blacklistKickDelayMinSeconds, merged.kickDelayMinSeconds ?? 5, 0);
  merged.blacklistKickDelayMaxSeconds = normalizeNumber(merged.blacklistKickDelayMaxSeconds, merged.kickDelayMaxSeconds ?? 20, merged.blacklistKickDelayMinSeconds);
  return merged;
}

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  configVersion: 4,
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
  lolApiBaseUrl: 'http://192.168.3.94:5000',
  shardDataUrl: 'https://raw.githubusercontent.com/badspacebar/release/master/files/shards.json',
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
  videoApiTemplates: {
    搞笑: 'https://api.pearktrue.cn/api/random_video/?name=搞笑',
    热门: 'https://api.pearktrue.cn/api/random_video/?name=热门'
  },
  msgFilter: { ...DEFAULT_MSG_FILTER },
  qaList: [],
  rejectKeywords: [],
  presets: [],
};


export function normalizePluginConfig(input: PluginConfig): PluginConfig {
  const merged: PluginConfig = {
    ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)),
    ...(input || {}),
  };
  const inputVersion = Number((input as any)?.configVersion || 1);
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
  merged.configVersion = 5;
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
  merged.global.auditRetentionMaxAgeDays = Math.max(1, Math.min(3650, Number(merged.global.auditRetentionMaxAgeDays || 30)));
  merged.global.auditRetentionMaxRows = Math.max(100, Math.min(1000000, Number(merged.global.auditRetentionMaxRows || 20000)));
  merged.global.actionQueueEventRetentionMaxAgeDays = Math.max(1, Math.min(3650, Number(merged.global.actionQueueEventRetentionMaxAgeDays || 7)));
  merged.global.actionQueueEventRetentionMaxRows = Math.max(100, Math.min(1000000, Number(merged.global.actionQueueEventRetentionMaxRows || 50000)));
  merged.shardDataUrl = String(merged.shardDataUrl || '').trim();
  merged.shardHeroListUrl = String(merged.shardHeroListUrl || '').trim();
  merged.shardImageUrlTemplate = String(merged.shardImageUrlTemplate || '').trim();
  merged.shardQueryOutputFormat = merged.shardQueryOutputFormat === 'text' || merged.shardQueryOutputFormat === 'image'
    ? merged.shardQueryOutputFormat
    : 'image';
  const groups: Record<string, GroupGuardSettings> = {};
  for (const [gid, gs] of Object.entries(merged.groups || {})) {
    groups[gid] = normalizeGroupSettings(gs as GroupGuardSettings);
  }
  merged.groups = groups;
  const videoTemplates = merged.videoApiTemplates || {};
  merged.videoApiTemplates = Object.entries(videoTemplates).reduce((acc, [k, v]) => {
    const key = String(k || '').trim();
    const val = String(v || '').trim();
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
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
  merged.scammerMaxRecords = Math.max(100, Math.min(100000, Number(merged.scammerMaxRecords || 5000)));
  merged.scammerMaxEvidenceLength = Math.max(50, Math.min(5000, Number(merged.scammerMaxEvidenceLength || 500)));
  merged.scammerMaxRecentReportsPerQQ = Math.max(1, Math.min(50, Number(merged.scammerMaxRecentReportsPerQQ || 10)));
  merged.scammerQueryUserCooldownSeconds = Math.max(0, Math.min(3600, Number(merged.scammerQueryUserCooldownSeconds ?? 10)));
  merged.scammerQueryGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Number(merged.scammerQueryGroupRateLimitPerMinute ?? 20)));
  merged.scammerQueryCacheSeconds = Math.max(0, Math.min(86400, Number(merged.scammerQueryCacheSeconds ?? 300)));
  merged.scammerReportUserCooldownSeconds = Math.max(0, Math.min(86400, Number(merged.scammerReportUserCooldownSeconds ?? 60)));
  merged.scammerReportGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Number(merged.scammerReportGroupRateLimitPerMinute ?? 5)));
  merged.scammerReportUserDailyLimit = Math.max(1, Math.min(1000, Number(merged.scammerReportUserDailyLimit ?? 20)));
  merged.scammerReportDedupHours = Math.max(0, Math.min(720, Number(merged.scammerReportDedupHours ?? 24)));
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
