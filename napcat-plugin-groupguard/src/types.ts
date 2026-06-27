// 群管插件类型定义

/** 消息类型检测过滤配置 */
export interface MsgFilterSettings {
  /** 自动撤回视频 */
  blockVideo: boolean;
  /** 自动撤回图片 */
  blockImage: boolean;
  /** 自动撤回语音 */
  blockRecord: boolean;
  /** 自动撤回合并转发 */
  blockForward: boolean;
  /** 自动撤回小程序卡片 */
  blockLightApp: boolean;
  /** 自动撤回名片分享 */
  blockContact: boolean;
  /** 自动撤回含链接消息 */
  blockUrl: boolean;
  /** 自动撤回二维码图片 */
  blockQr: boolean;
}

export interface SelfRecallPolicy {
  enabled: boolean;
  mode: 'fixed' | 'random';
  fixedDelay: number;
  minDelay: number;
  maxDelay: number;
  jitter: number;
}

export type BotAntiRiskSuffixMode = 'global' | 'mixed' | 'punctuation' | 'none';
export type BotAntiRiskLimitFallbackMode = 'drop' | 'forward';

export interface BotAntiRiskScenePolicy {
  delayMinMs?: number;
  delayMaxMs?: number;
  replyProbability?: number;
  suffixMode?: BotAntiRiskSuffixMode;
}

export type FeatureType =
  | 'query'
  | 'qa'
  | 'dynamic'
  | 'system'
  | 'risk'
  | 'activity'
  | 'moderation'
  | 'welcome'
  | 'passive';

export type SilentMode = 'off' | 'noPassiveReply' | 'noBotSend';

export type FeatureScope = 'global' | 'group' | 'private' | 'both';

export type FeaturePermission = 'all' | 'admin' | 'owner';

export interface ActionPrioritySettings {
  ban: number;
  kick: number;
  recall: number;
  self_recall: number;
}

export interface PluginConfig {
  configVersion?: number;
  licenseKey?: string;
  debug: boolean;
  ownerQQs: string;
  licenses: Record<string, GroupLicense>;
  global: GroupGuardSettings;
  groups: Record<string, GroupGuardSettings>;
  antiRecallGroups: string[];
  globalAntiRecall: boolean;
  globalEmojiReact: boolean;
  emojiReactGroups: Record<string, string[]>;
  cardLocks: Record<string, string>;
  blacklist: string[];
  whitelist: string[];
  filterKeywords: string[];
  filterPunishLevel: number;
  filterBanMinutes: number;
  welcomeMessage: string;
  spamWindow: number;
  spamThreshold: number;
  spamDetect: boolean;
  spamBanMinutes: number;
  /** 退群自动拉黑 */
  leaveBlacklist: boolean;
  /** LOL战绩查询 Token */
  lolToken?: string;
  /** 自定义战绩查询接口地址 (例如 http://example.com/query.php) */
  lolQueryUrl?: string;
  /** 自定义战绩查询授权码 (zhanjikey) */
  lolAuthKey?: string;
  /** LOL封号主查询接口地址 */
  lolBanPrimaryUrl?: string;
  /** LOL封号备用查询接口地址列表 */
  lolBanBackupUrls?: string[];
  /** 本地 LOL 战绩查询服务地址（如 http://192.168.3.94:5000） */
  lolApiBaseUrl?: string;
  shardDataUrl?: string;
  shardHeroListUrl?: string;
  shardImageUrlTemplate?: string;
  shardQueryOutputFormat?: 'forward' | 'text' | 'image';
  videoApiTemplates?: Record<string, string>;
  scammerQueryUrls?: string[];
  scammerReportUrl?: string;
  scammerMaxRecords?: number;
  scammerMaxEvidenceLength?: number;
  scammerMaxRecentReportsPerQQ?: number;
  scammerQueryUserCooldownSeconds?: number;
  scammerQueryGroupRateLimitPerMinute?: number;
  scammerQueryCacheSeconds?: number;
  scammerReportUserCooldownSeconds?: number;
  scammerReportGroupRateLimitPerMinute?: number;
  scammerReportUserDailyLimit?: number;
  scammerReportDedupHours?: number;
  /** 全局消息类型过滤 */
  msgFilter: MsgFilterSettings;
  /** 全局问答列表 */
  qaList: QAEntry[];
  /** 入群审核拒绝关键词 */
  rejectKeywords: string[];
  /** 预设配置列表 */
  presets: PresetConfig[];
}

export interface ScammerRecord {
  qq: string;
  reportCount: number;
  lastReportContent: string;
  recentReports: string[];
  sources: string[];
  firstReportedAt: number;
  lastReportedAt: number;
  lastCheckedAt: number;
  updatedAt: number;
}

export interface ScammerReportInput {
  qq: string;
  content: string;
  source: string;
  maxEvidenceLength?: number;
  maxRecentReports?: number;
}

export type ContactRiskCategory = 'scammer' | 'peer';
export type ContactIdentifierType = 'qq' | 'wechat';

export interface ContactRiskRecord {
  category: ContactRiskCategory;
  identifierType: ContactIdentifierType;
  identifierValue: string;
  reportCount: number;
  lastReportContent: string;
  recentReports: string[];
  sources: string[];
  firstReportedAt: number;
  lastReportedAt: number;
  lastCheckedAt: number;
  updatedAt: number;
}

export interface ContactRiskReportInput {
  category: ContactRiskCategory;
  identifierType: ContactIdentifierType;
  identifierValue: string;
  content: string;
  source: string;
  maxEvidenceLength?: number;
  maxRecentReports?: number;
}

export interface GroupGuardSettings {
  useGlobal?: boolean;
  masterEnabled?: boolean;
  silentMode?: SilentMode;
  activeReplyEnabled?: boolean;
  queryEnabled?: boolean;
  qaEnabled?: boolean;
  dynamicCommandEnabled?: boolean;
  featureSwitches?: Record<string, boolean>;
  autoApprove: boolean;
  enableVerify: boolean;
  verifyTimeout: number;
  maxAttempts: number;
  mathMin: number;
  mathMax: number;
  targetUsers: string[];
  /** 群独立黑名单 */
  groupBlacklist: string[];
  /** 入群审核拒绝关键词（验证信息包含则拒绝） */
  rejectKeywords?: string[];
  /** 退群自动拉黑（群级别） */
  leaveBlacklist: boolean;
  /** 欢迎词（群级别，空则用全局） */
  welcomeMessage?: string;
  /** 是否禁用入群欢迎 */
  disableWelcome?: boolean;
  joinPrivateEnabled?: boolean;
  joinPrivateMessage?: string;
  /** 违禁词列表（群级别，空则用全局） */
  filterKeywords?: string[];
  /** 违禁词惩罚等级 */
  filterPunishLevel?: number;
  /** 违禁词禁言时长（分钟） */
  filterBanMinutes?: number;
  /** 刷屏检测开关 */
  spamDetect?: boolean;
  /** 刷屏时间窗口（秒） */
  spamWindow?: number;
  /** 刷屏消息阈值 */
  spamThreshold?: number;
  /** 刷屏禁言时长（分钟） */
  spamBanMinutes?: number;
  /** 复读检测阈值（连续N条相同消息） */
  repeatThreshold?: number;
  /** 权限缓存时间 (秒)，0为关闭 */
  adminCacheSeconds?: number;
  /** 群独立消息类型过滤 */
  msgFilter?: MsgFilterSettings;
  /** 群独立问答列表 */
  qaList?: QAEntry[];
  /** 警告上限次数 */
  warningLimit?: number;
  /** 警告惩罚：ban=禁言, kick=踢出 */
  warningAction?: 'ban' | 'kick';
  /** 宵禁开始时间 (HH:mm) */
  curfewStart?: string;
  /** 宵禁结束时间 (HH:mm) */
  curfewEnd?: string;
  /** 是否开启宵禁 */
  curfewEnabled?: boolean;
  /** 定时任务列表 */
  scheduledTasks?: ScheduledTask[];
  /** 发言奖励积分 */
  messageReward?: number;
  /** 签到最小积分 */
  signinMin?: number;
  /** 签到最大积分 */
  signinMax?: number;
  /** 邀请奖励积分 */
  invitePoints?: number;
  /** 邀请查询权限：all=所有成员, admin=管理员, owner=主人 */
  inviteQueryPermission?: 'all' | 'admin' | 'owner';
  /** 抽奖消耗积分 */
  lotteryCost?: number;
  /** 抽奖最大奖励积分 */
  lotteryReward?: number;
  /** 自动撤回机器人自己发的消息 */
  autoRecallSelf?: boolean;
  /** 自动撤回延迟（秒） */
  autoRecallSelfDelay?: number;
  selfRecall?: SelfRecallPolicy;
  /** 随机后缀（防复读风控） */
  randomSuffix?: boolean;
  /** 机器人发送后缀模式 */
  botAntiRiskSuffixMode?: BotAntiRiskSuffixMode;
  /** 机器人发送场景化免风控策略 */
  botAntiRiskScenePolicies?: Record<string, BotAntiRiskScenePolicy>;
  /** 触发发送限流/熔断时的处理：drop=丢弃，forward=合并转发兜底 */
  botAntiRiskLimitFallbackMode?: BotAntiRiskLimitFallbackMode;
  /** 随机延迟发送（毫秒） */
  randomDelayMin?: number;
  randomDelayMax?: number;
  /** 发送队列模式：global=全局队列, group=分群队列 */
  queueMode?: 'global' | 'group';
  /** 发送并发数（同一时间最多发送N条） */
  queueConcurrency?: number;
  /** 每分钟全局最大发送量（TokenBucket） */
  globalMaxPerMinute?: number;
  /** 超限后是否仅排队等待令牌（true=等待，false=直接丢弃） */
  rateLimitEnqueue?: boolean;
  /** 自动回复触发概率（0-100） */
  replyProbability?: number;
  /** 全局关闭回复模板与人格包装（仅保留原始文本） */
  disableReplyTemplate?: boolean;
  /** 自动回复模板池，使用 {msg} 占位 */
  replyTemplatePool?: string[];
  /** 问答关键词冷却（秒） */
  qaCooldownSeconds?: number;
  /** 问答同用户冷却（秒） */
  qaUserCooldownSeconds?: number;
  /** 问答低风险关键词冷却（秒） */
  qaTierCooldownLow?: number;
  /** 问答中风险关键词冷却（秒） */
  qaTierCooldownMedium?: number;
  /** 问答高风险关键词冷却（秒） */
  qaTierCooldownHigh?: number;
  /** 高风险关键词模式（命中即按高风险冷却） */
  qaHighRiskPatterns?: string[];
  /** 中风险关键词模式（命中即按中风险冷却） */
  qaMediumRiskPatterns?: string[];
  /** 同群触发熔断窗口（秒） */
  groupFuseWindowSeconds?: number;
  /** 同群触发熔断阈值（窗口内发送条数） */
  groupFuseThreshold?: number;
  /** 熔断持续时长（秒） */
  groupFuseCooldownSeconds?: number;
  /** 全局发送队列上限 */
  maxQueueSizeGlobal?: number;
  /** 分群发送队列上限 */
  maxQueueSizePerGroup?: number;
  // 新增开关
  /** 是否禁用问答 */
  disableQA?: boolean;
  /** 是否禁用签到 */
  disableSignin?: boolean;
  /** 是否禁用抽奖 */
  disableLottery?: boolean;
  /** 是否禁用邀请统计 */
  disableInvite?: boolean;
  /** 是否禁用活跃统计 */
  disableActivity?: boolean;
  /** 是否禁用战绩查询 */
  disableLolQuery?: boolean;
  /** 战绩查询全局限流（每分钟） */
  lolQueryGlobalRateLimitPerMinute?: number;
  /** 战绩查询全局最小间隔（秒） */
  lolQueryGlobalMinIntervalSeconds?: number;
  /** 战绩查询接口请求超时（秒） */
  lolQueryRequestTimeoutSeconds?: number;
  /** 战绩查询分群限流（每分钟） */
  lolQueryGroupRateLimitPerMinute?: number;
  /** 战绩查询分群最小间隔（秒） */
  lolQueryGroupMinIntervalSeconds?: number;
  lolQueryDailyLimit?: number;
  /** 战绩查询输出格式 */
  lolQueryOutputFormat?: LolQueryOutputFormat;
  /** 战绩查询指令开关 */
  lolQueryCommandSwitch?: LolQueryCommandSwitch;
  /** 是否允许自动撤回管理员消息 */
  allowRecallAdminMessage?: boolean;
  /** 是否允许自动撤回群主消息 */
  allowRecallOwnerMessage?: boolean;
  /** 是否保护管理员不被自动禁言/踢出 */
  protectAdminActions?: boolean;
  /** 是否保护群主不被自动禁言/踢出 */
  protectOwnerActions?: boolean;
  /** 自动管理动作速率窗口（秒） */
  actionRateWindowSeconds?: number;
  /** 自动管理动作速率阈值（窗口内次数） */
  actionRateLimit?: number;
  /** 撤回去重窗口（秒） */
  recallDedupSeconds?: number;
  /** 是否启用自动风控等级收敛 */
  autoRiskControl?: boolean;
  /** 风险预警分数阈值 */
  riskWarnScore?: number;
  /** 风险保护分数阈值 */
  riskProtectScore?: number;
  /** 风险分数衰减周期（秒） */
  riskDecaySeconds?: number;
  /** 人格模板高风险问题是否阻断保存 */
  personaAuditStrictMode?: boolean;
  /** 审计事件保留天数 */
  auditRetentionMaxAgeDays?: number;
  /** 审计事件最多保留条数 */
  auditRetentionMaxRows?: number;
  /** 动作队列历史事件保留天数 */
  actionQueueEventRetentionMaxAgeDays?: number;
  /** 动作队列历史事件最多保留条数 */
  actionQueueEventRetentionMaxRows?: number;

  // ===== 商用入群验证 =====
  /** 入群暗号（为空则关闭） */
  entryPassphrase?: string;
  /** 暗号关闭后是否回落到自动同意（默认开启） */
  enableAutoApproveAfterPassphraseOff?: boolean;
  /** 默认回复人格 */
  replyPersonaDefault?: ReplyPersona;
  /** 是否每次回复随机人格 */
  autoRandomPersona?: boolean;
  /** 场景人格覆盖 */
  replyPersonaByScene?: Record<string, ReplyPersona>;
  /** 场景模板库 */
  replySceneTemplates?: ReplySceneTemplateMap;
  actionQueueConcurrency?: number;
  actionTimeoutMs?: number;
  maxActionQueueSizeGlobal?: number;
  maxActionQueueSizePerGroup?: number;
  actionDedupSeconds?: number;
  maxKickPerMinute?: number;
  maxBanPerMinute?: number;
  maxRecallPerMinute?: number;
  maxMiscPerMinute?: number;
  actionPriority?: ActionPrioritySettings;
  recallDelayMinSeconds?: number;
  recallDelayMaxSeconds?: number;
  banDelayMinSeconds?: number;
  banDelayMaxSeconds?: number;
  kickDelayMinSeconds?: number;
  kickDelayMaxSeconds?: number;
  miscDelayMinSeconds?: number;
  miscDelayMaxSeconds?: number;
  blacklistAction?: 'recall' | 'ban' | 'kick' | 'kick_and_block';
  blacklistBanMinutes?: number;
  blacklistKickRejectAddRequest?: boolean;
  blacklistKickDelayMinSeconds?: number;
  blacklistKickDelayMaxSeconds?: number;
  blacklistCheckBeforeCommand?: boolean;
}

export type ReplyPersona = 'formal' | 'friendly' | 'strict' | 'humor' | 'professional' | 'gentle';

export interface ReplySceneTemplateEntry {
  personaTemplates?: Partial<Record<ReplyPersona, string[]>>;
}

export type ReplySceneTemplateMap = Record<string, ReplySceneTemplateEntry>;
export type LolQueryOutputFormat = 'forward' | 'text' | 'image' | 'card';

export interface LolQueryCommandSwitch {
  battleQuery: boolean;
  banQuery: boolean;
  hiddenQuery: boolean;
}

/** 入群验证日志 */
export interface JoinLogEntry {
  groupId: string;
  userId: string;
  /** 匹配到的验证信息 */
  answer: string;
  /** 是否匹配暗号 */
  passphraseMatched: boolean;
  /** 执行动作：approve | reject */
  action: 'approve' | 'reject';
  /** 详情/理由 */
  reason: string;
  timestamp: number;
}

export type AuditEventType = 'risk_signal' | 'risk_assessment' | 'policy_decision' | 'manual_policy_action';

export interface StandardAuditPayload {
  schemaVersion: 1;
  eventType: AuditEventType;
  correlationId?: string;
  source: string;
  ruleId: string;
  actionType: string;
  decision: string;
  score: number;
  reason: string;
  queueTaskId?: string;
  context?: Record<string, unknown>;
  actions?: Array<Record<string, unknown>>;
  reasons?: string[];
  legacy?: Record<string, unknown>;
}

export interface AuditEventRecord {
  id?: number;
  eventType: AuditEventType;
  kind: string;
  groupId: string;
  userId: string;
  messageId?: string;
  handled: boolean;
  reason: string;
  riskScore?: number;
  riskLevel?: string;
  payload: string;
  createdAt: number;
}

export interface AuditEventQuery {
  groupId?: string;
  userId?: string;
  eventType?: AuditEventType;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditEventPage {
  rows: AuditEventRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AuditRetentionPolicy {
  maxAgeDays?: number;
  maxRows?: number;
}

export interface ActionQueueEventRetentionPolicy {
  maxAgeDays?: number;
  maxRows?: number;
}

export interface AuditStatsQuery {
  sinceMs?: number;
  limit?: number;
}

export interface AuditStatsView {
  sinceMs: number;
  total: number;
  byType: Record<AuditEventType, number>;
  topGroups: Array<{ groupId: string; count: number; }>;
  topUsers: Array<{ userId: string; count: number; }>;
}

export interface ActionQueueEventStatsQuery {
  sinceMs?: number;
  limit?: number;
}

export interface ActionQueueEventStatsView {
  sinceMs: number;
  total: number;
  byEvent: Record<string, number>;
  byTaskType: Record<string, number>;
  topGroups: Array<{ groupId: string; count: number; }>;
  topUsers: Array<{ userId: string; count: number; }>;
  topTasks: Array<{ taskId: string; taskType: string; groupId: string; userId?: string; lastEvent: string; count: number; updatedAt: number; }>;
}

export interface ActionQueueEventSearchQuery {
  taskId?: string;
  actionId?: string;
  groupId?: string;
  userId?: string;
  messageId?: string;
  event?: string;
  limit?: number;
}

export interface ActionQueueTaskSearchCandidate {
  taskId: string;
  actionId?: string;
  taskType: string;
  groupId: string;
  userId?: string;
  messageId?: string;
  lastEvent: string;
  code?: string;
  ok?: boolean;
  reason?: string;
  count: number;
  updatedAt: number;
}

export interface ActionQueueEventSearchView {
  query: ActionQueueEventSearchQuery & { correlationId?: string; };
  candidates: ActionQueueTaskSearchCandidate[];
}

export interface AuditUserProfileQuery {
  userId: string;
  sinceMs?: number;
  limit?: number;
}

export interface AuditUserProfileView {
  userId: string;
  sinceMs: number;
  total: number;
  byType: Record<AuditEventType, number>;
  highestScore: number;
  latestRiskLevel: string;
  groups: Array<{ groupId: string; count: number; }>;
  recentQueueTaskIds: string[];
  recentActions: Array<{ eventType: AuditEventType; actionType: string; decision: string; queueTaskId: string; reason: string; createdAt: number; }>;
  recentEvents: AuditEventRecord[];
}

export interface ScheduledTask {
  id: string;
  cron: string; // 简化版: "HH:mm" 或 "interval:minutes"
  type: 'text' | 'image';
  content: string;
  lastRun?: number;
}

export interface SigninData {
  lastSignin: number; // timestamp
  days: number; // 连续签到天数
  points: number; // 积分
}

export interface InviteData {
  inviterId: string; // 邀请人QQ
  inviteCount: number; // 邀请人数
  invitedUsers: string[]; // 被邀请人QQ列表
}

export interface GroupLicense {
  expireTime: number; // 授权过期时间戳，0表示永久
  level: 'free' | 'pro' | 'enterprise';
}

export interface VerifySession {
  userId: string;
  groupId: string;
  answer: number;
  expression: string;
  attempts: number;
  maxAttempts: number;
  timer: ReturnType<typeof setTimeout>;
  startTime: number;
}

export interface ActivityRecord {
  msgCount: number;
  lastActive: number;
  todayCount: number;
  todayDate: string;
  lastActiveDay?: string;
  msgCountToday?: number;
}

/** 问答条目 */
export interface QAEntry {
  /** 触发关键词 */
  keyword: string;
  /** 回复内容，支持 {user} {group} */
  reply: string;
  /** 匹配模式: exact=精确 contains=包含 regex=正则 */
  mode: 'exact' | 'contains' | 'regex';
}

/** 预设配置模板 */
export interface PresetConfig {
  /** 预设名称 */
  name: string;
  /** 保存的设置快照 */
  settings: GroupGuardSettings;
  /** 全局级别的字段快照 */
  globalFields?: {
    filterKeywords?: string[];
    filterPunishLevel?: number;
    filterBanMinutes?: number;
    blacklist?: string[];
    whitelist?: string[];
    leaveBlacklist?: boolean;
    spamDetect?: boolean;
    spamWindow?: number;
    spamThreshold?: number;
    spamBanMinutes?: number;
    msgFilter?: MsgFilterSettings;
    welcomeMessage?: string;
    qaList?: QAEntry[];
  };
}

export type SelfRecallTaskStatus = 'scheduled' | 'queued' | 'success' | 'failed';

export interface SelfRecallTaskRecord {
  taskId: string;
  groupId: string;
  messageId: string;
  reason: string;
  source: 'send_group_msg' | 'message_event' | 'recovery';
  status: SelfRecallTaskStatus;
  createdAt: number;
  dueAt: number;
  nextRetryAt: number;
  attemptCount: number;
  maxAttempts: number;
  lastCode: string;
  lastError: string;
  updatedAt: number;
}

export interface SelfRecallScheduleInput {
  taskId: string;
  groupId: string;
  messageId: string;
  reason: string;
  source: 'send_group_msg' | 'message_event' | 'recovery';
  dueAt: number;
  maxAttempts: number;
}

export type RecallTaskStatus = 'scheduled' | 'queued' | 'success' | 'failed';

export interface RecallTaskRecord {
  taskId: string;
  groupId: string;
  messageId: string;
  targetUserId: string;
  reason: string;
  status: RecallTaskStatus;
  createdAt: number;
  dueAt: number;
  nextRetryAt: number;
  attemptCount: number;
  maxAttempts: number;
  lastCode: string;
  lastError: string;
  updatedAt: number;
}

export interface RecallTaskScheduleInput {
  taskId: string;
  groupId: string;
  messageId: string;
  targetUserId?: string;
  reason: string;
  dueAt: number;
  maxAttempts: number;
}

export type ActionQueueTaskLookupSource = 'recall_tasks' | 'self_recall_tasks' | 'memory_queue' | 'memory_log' | 'not_found';

export interface ActionQueueTaskLookupResult {
  taskId: string;
  found: boolean;
  source: ActionQueueTaskLookupSource;
  taskType?: string;
  status?: string;
  groupId?: string;
  userId?: string;
  messageId?: string;
  reason?: string;
  createdAt?: number;
  dueAt?: number;
  nextRetryAt?: number;
  attemptCount?: number;
  maxAttempts?: number;
  lastCode?: string;
  lastError?: string;
  updatedAt?: number;
  actionId?: string;
  queuePosition?: number;
  recentLogs?: string[];
  raw?: unknown;
}

export type ActionQueueTraceStage = 'queue_snapshot' | 'risk_signal' | 'risk_assessment' | 'policy_decision' | 'manual_policy_action' | 'audit_event' | 'action_queue_event';

export interface ActionQueueTraceItem {
  ts: number;
  stage: ActionQueueTraceStage;
  title: string;
  detail: string;
  auditEventId?: number;
  eventType?: AuditEventType;
  correlationId?: string;
  queueTaskId?: string;
  actionId?: string;
  code?: string;
  ok?: boolean;
  source?: string;
  raw?: unknown;
}

export interface ActionQueueTaskTraceView {
  taskId: string;
  snapshot: ActionQueueTaskLookupResult | null;
  attribution: {
    summary: string;
    source: string;
    correlationId?: string;
    matchedAuditEvents: number;
    matchedQueueTaskIds: string[];
    anchorEventType?: AuditEventType;
    anchorCreatedAt?: number;
  };
  timeline: ActionQueueTraceItem[];
  relatedAuditEvents: AuditEventRecord[];
  actionEvents?: ActionQueueEventRecord[];
}

export interface ActionQueueEventRecord {
  id?: number;
  taskId: string;
  actionId?: string;
  taskType: string;
  groupId: string;
  userId?: string;
  messageId?: string;
  event: string;
  code?: string;
  ok?: boolean;
  reason?: string;
  attemptCount?: number;
  payload?: string;
  createdAt: number;
}

export interface BotSendEventRecord {
  id?: number;
  groupId: string;
  scene: string;
  messageType: string;
  messageId?: string;
  contentLength: number;
  hasMedia: boolean;
  force: boolean;
  applyTemplate: boolean;
  templateApplied: boolean;
  suffixApplied: boolean;
  suffixMode?: string;
  randomDelayMs: number;
  queuedAt: number;
  sentAt?: number;
  selfRecallDueAt?: number;
  status: 'queued' | 'sent' | 'dropped' | 'failed';
  reason?: string;
  payload?: string;
  createdAt: number;
}

export interface BotSendStatsQuery {
  sinceMs?: number;
  limit?: number;
}

export interface BotSendStatsView {
  sinceMs: number;
  total: number;
  sent: number;
  dropped: number;
  failed: number;
  suffixApplied: number;
  templateApplied: number;
  withSelfRecall: number;
  selfRecallSuccess: number;
  selfRecallFailed: number;
  selfRecallPending: number;
  messageIdMissing: number;
  avgDelayMs: number;
  byScene: Array<{ scene: string; count: number; sent: number; dropped: number; failed: number; }>;
  topGroups: Array<{ groupId: string; count: number; sent: number; dropped: number; failed: number; }>;
  recent: BotSendEventRecord[];
}
