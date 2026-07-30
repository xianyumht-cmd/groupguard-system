export type GroupGuardBotRole = 'full' | 'qa' | 'query';
export type BotRoleIntent = 'query_like' | 'qa_like' | 'moderation_like' | 'welcome_like' | 'self_recall_like' | 'system_like' | 'unknown';
export type BotRoleBlockSource =
  | 'dynamic_command'
  | 'legacy'
  | 'legacy.interaction'
  | 'legacy.qa'
  | 'legacy.moderation'
  | 'legacy.passive'
  | 'passive_service'
  | 'qa_service'
  | 'interaction_service'
  | 'moderation_service'
  | 'runtime_message_pipeline'
  | 'runtime_event_pipeline'
  | 'action_queue'
  | 'send_wrapper';

export interface BotRoleBlockInput {
  rawMessage?: string;
  source: BotRoleBlockSource | string;
  intent?: BotRoleIntent;
  featureType?: string;
  featureKey?: string;
  commandId?: string;
  legacyDomain?: string;
  scene?: string;
  actionType?: string;
}

export interface BotRoleBlockResult {
  blocked: boolean;
  role: GroupGuardBotRole;
  intent: BotRoleIntent;
  source: string;
  reason?: string;
  logLine?: string;
}

let warnedInvalidRole = '';

export function getGroupGuardBotRole(): GroupGuardBotRole {
  const raw = String(process.env.GROUPGUARD_BOT_ROLE || '').trim().toLowerCase();
  if (!raw) return 'full';
  if (raw === 'full' || raw === 'qa' || raw === 'query') return raw;
  if (warnedInvalidRole !== raw) {
    warnedInvalidRole = raw;
    console.warn(`[GroupGuard] invalid GROUPGUARD_BOT_ROLE="${raw}", fallback to full`);
  }
  return 'full';
}

export function getBotRole(): GroupGuardBotRole {
  return getGroupGuardBotRole();
}

export function isQaOnlyBotRole(): boolean {
  return getGroupGuardBotRole() === 'qa';
}

export function isQueryOnlyBotRole(): boolean {
  return getGroupGuardBotRole() === 'query';
}

export function isQaRole(): boolean {
  return isQaOnlyBotRole();
}

export function isQueryRole(): boolean {
  return isQueryOnlyBotRole();
}

function normalizeMessage(rawMessage: unknown): string {
  return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, '').trim().toLowerCase();
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => text.startsWith(prefix.toLowerCase()));
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

export function classifyMessageIntent(rawMessage: unknown): BotRoleIntent {
  const text = normalizeMessage(rawMessage);
  if (!text) return 'unknown';

  const queryPrefixes = [
    '查封号',
    '查战绩',
    '查隐藏',
    '查合集',
    '海符榜',
    '查骗子',
    '举报骗子',
    '查同行',
    '举报同行',
    '设置战绩接口',
    '设置战绩全局开关',
    '设置战绩全局限流',
    '设置战绩分群开关',
    '设置战绩分群限流',
    '设置战绩指令开关',
    '设置lolurl',
    '设置lolkey',
    '设置loltoken',
    '设置封号',
    '删除封号',
    '设置骗子查询接口',
    '添加骗子查询接口',
    '删除骗子查询接口',
    '设置骗子举报接口',
    '设置骗子库限制',
    '设置骗子风控'
  ];
  const queryExact = [
    '封号接口列表',
    '战绩接口状态',
    '战绩配置',
    '骗子接口状态'
  ];
  if (queryExact.includes(text) || startsWithAny(text, queryPrefixes)) {
    return 'query_like';
  }

  const qaPrefixes = [
    '添加问答 ',
    '添加模糊问答 ',
    '添加正则问答 ',
    '删除问答 ',
    '删问',
    '模糊问',
    '精确问',
    '添加拒绝词',
    '添加全局拒绝词',
    '删除拒绝词',
    '删除全局拒绝词'
  ];
  const qaExact = ['问答列表', '拒绝词列表'];
  if (qaExact.includes(text) || startsWithAny(text, qaPrefixes)) {
    return 'qa_like';
  }

  const moderationPrefixes = [
    '警告 ',
    '清除警告 ',
    '查看警告 ',
    '踢出',
    '禁言',
    '解禁',
    '授权头衔',
    '清除头衔',
    '锁定名片',
    '解锁名片',
    '拉黑',
    '取消拉黑',
    '群拉黑',
    '群取消拉黑',
    '白名单',
    '取消白名单',
    '针对',
    '取消针对',
    '添加违禁词',
    '添加全局违禁词',
    '删除违禁词',
    '删除全局违禁词',
    '设置违禁词惩罚',
    '设置违禁词禁言'
  ];
  const moderationExact = [
    '全体禁言',
    '全体解禁',
    '名片锁定列表',
    '开启防撤回',
    '关闭防撤回',
    '防撤回列表',
    '开启回应表情',
    '关闭回应表情',
    '针对列表',
    '清除针对',
    '开启自身撤回',
    '关闭自身撤回',
    '黑名单列表',
    '群黑名单列表',
    '白名单列表',
    '违禁词列表'
  ];
  if (moderationExact.includes(text) || startsWithAny(text, moderationPrefixes)) {
    return 'moderation_like';
  }

  if (includesAny(text, ['欢迎', '入群验证', '进群验证'])) return 'welcome_like';
  if (includesAny(text, ['自撤回', '自身撤回'])) return 'self_recall_like';
  if (includesAny(text, ['菜单', '帮助', '状态', '诊断', '配置路径', '队列日志', '队列状态', '查看sqlite状态', '查看存储状态'])) {
    return 'system_like';
  }
  return 'unknown';
}

function isQueryFeature(input: BotRoleBlockInput): boolean {
  const featureType = String(input.featureType || '').toLowerCase();
  const featureKey = String(input.featureKey || '').toLowerCase();
  const commandId = String(input.commandId || '').toLowerCase();
  const legacyDomain = String(input.legacyDomain || '').toLowerCase();
  if (featureType === 'query' || legacyDomain === 'interaction') return true;
  if (featureKey.startsWith('query.') || featureKey.includes('.query.')) return true;
  return [
    'query',
    'lolban',
    'lol_ban',
    'lolbattle',
    'lol_battle',
    'lolhidden',
    'lol_hidden',
    'lolshard',
    'lol_shard',
    'scammer',
    'peer',
    'video'
  ].some(part => commandId.includes(part) || featureKey.includes(part));
}

function isQaFeature(input: BotRoleBlockInput): boolean {
  const featureType = String(input.featureType || '').toLowerCase();
  const featureKey = String(input.featureKey || '').toLowerCase();
  const commandId = String(input.commandId || '').toLowerCase();
  const legacyDomain = String(input.legacyDomain || '').toLowerCase();
  return featureType === 'qa' || legacyDomain === 'qa' || featureKey.startsWith('qa.') || commandId.includes('.qa') || commandId.includes('group_qa');
}

function isModerationFeature(input: BotRoleBlockInput): boolean {
  const featureType = String(input.featureType || '').toLowerCase();
  const legacyDomain = String(input.legacyDomain || '').toLowerCase();
  const scene = String(input.scene || '').toLowerCase();
  const actionType = String(input.actionType || '').toLowerCase();
  if (featureType === 'moderation' || featureType === 'risk' || featureType === 'welcome' || featureType === 'passive') return true;
  if (legacyDomain === 'moderation' || legacyDomain === 'risk' || legacyDomain === 'passive') return true;
  return ['moderation', 'risk', 'welcome', 'filter', 'blacklist', 'spam', 'recall', 'self_recall', 'ban', 'kick'].some(part => scene.includes(part) || actionType.includes(part));
}

function resolveIntent(input: BotRoleBlockInput): BotRoleIntent {
  if (input.intent && input.intent !== 'unknown') return input.intent;
  if (isQueryFeature(input)) return 'query_like';
  if (isQaFeature(input)) return 'qa_like';
  if (isModerationFeature(input)) {
    const scene = String(input.scene || '').toLowerCase();
    const actionType = String(input.actionType || '').toLowerCase();
    if (scene.includes('welcome')) return 'welcome_like';
    if (scene.includes('self_recall') || actionType.includes('self_recall')) return 'self_recall_like';
    return 'moderation_like';
  }
  return classifyMessageIntent(input.rawMessage);
}

function buildBlock(role: GroupGuardBotRole, input: BotRoleBlockInput, intent: BotRoleIntent, reason: string): BotRoleBlockResult {
  const raw = String(input.rawMessage || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const source = String(input.source || 'unknown');
  return {
    blocked: true,
    role,
    intent,
    source,
    reason,
    logLine: `bot_role_blocked role=${role} intent=${intent} rawMessage=${raw} source=${source}`
  };
}

export function shouldBlockByBotRole(input: BotRoleBlockInput): BotRoleBlockResult {
  const role = getGroupGuardBotRole();
  const intent = resolveIntent(input);
  const source = String(input.source || 'unknown');
  if (role === 'full') return { blocked: false, role, intent, source };

  if (role === 'qa') {
    if (intent === 'query_like' || isQueryFeature(input)) {
      return buildBlock(role, input, 'query_like', 'qa_role_query_blocked');
    }
    if (intent === 'moderation_like' || intent === 'welcome_like' || intent === 'self_recall_like' || isModerationFeature(input)) {
      return buildBlock(role, input, intent, 'qa_role_non_qa_blocked');
    }
    if (String(input.featureType || '').toLowerCase() === 'dynamic' && input.commandId && !isQaFeature(input)) {
      return buildBlock(role, input, intent, 'qa_role_dynamic_non_qa_blocked');
    }
  }

  if (role === 'query') {
    if (intent === 'qa_like' || isQaFeature(input)) {
      return buildBlock(role, input, 'qa_like', 'query_role_qa_blocked');
    }
    if (intent === 'moderation_like' || intent === 'welcome_like' || intent === 'self_recall_like' || isModerationFeature(input)) {
      return buildBlock(role, input, intent, 'query_role_non_query_blocked');
    }
    if (String(input.featureType || '').toLowerCase() === 'dynamic' && input.commandId && !isQueryFeature(input)) {
      return buildBlock(role, input, intent, 'query_role_dynamic_non_query_blocked');
    }
  }

  return { blocked: false, role, intent, source };
}
