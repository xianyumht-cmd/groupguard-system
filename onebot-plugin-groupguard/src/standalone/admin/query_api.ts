import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { requestShardDelivery } from '../../dynamic-commands/intranet_query_runtime_plugin';
import { applyPatch } from './object_patch';
import type { SnowLumaAdminServerOptions } from './types';

const MAX_BODY_PREVIEW = 12000;

type QueryType = 'lol_ban' | 'lol_battle' | 'lol_hidden' | 'lol_shard' | 'lol_aram_augments' | 'scammer' | 'peer' | 'ele_build' | 'custom';
const QUERY_TYPE_SET = new Set<QueryType>([
  'lol_ban', 'lol_battle', 'lol_hidden', 'lol_shard', 'lol_aram_augments',
  'scammer', 'peer', 'ele_build', 'custom'
]);

type QueryCommandProfile = {
  outputFormat?: string;
  wrapperMode?: 'global' | 'none' | 'forward';
  enabled?: boolean;
  note?: string;
};

const QUERY_TYPES: Array<{ type: QueryType; name: string; trigger: string; featureKey?: string; dataSource: string; }> = [
  { type: 'lol_ban', name: '查封号', trigger: '查封号', featureKey: 'query.lol_ban', dataSource: 'local-api' },
  { type: 'lol_battle', name: '查战绩', trigger: '查战绩', featureKey: 'query.lol_battle', dataSource: 'local-api' },
  { type: 'lol_hidden', name: '查隐藏', trigger: '查隐藏', featureKey: 'query.lol_hidden', dataSource: 'local-api' },
  { type: 'lol_shard', name: '查合集', trigger: '查合集', featureKey: 'query.lol_shard', dataSource: 'local-api' },
  { type: 'lol_aram_augments', name: '海符榜', trigger: '海符榜', featureKey: 'query.lol_aram_augments', dataSource: 'local-api' },
  { type: 'scammer', name: '骗子查询', trigger: '查骗子', featureKey: 'query.scammer', dataSource: 'external' },
  { type: 'peer', name: '同行查询', trigger: '查同行', featureKey: 'query.peer', dataSource: 'local-db' },
  { type: 'ele_build', name: 'ELE下载', trigger: 'ELE下载', featureKey: 'dynamic.ele_build', dataSource: 'external' }
];

function getConfigAny(): any {
  return configStateService.getConfig() as any;
}

function getGlobalAny(): any {
  return configStateService.getGlobalSettings() as any;
}

function enabledSwitch(map: any, key: string): boolean {
  return !map || map[key] !== false;
}

function maskSecret(text: any): string {
  const s = String(text || '');
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

function getProfiles(config: any): Record<string, QueryCommandProfile> {
  return config.queryCommandProfiles && typeof config.queryCommandProfiles === 'object' && !Array.isArray(config.queryCommandProfiles)
    ? config.queryCommandProfiles
    : {};
}

function getProfile(config: any, type: QueryType): QueryCommandProfile {
  return getProfiles(config)[type] || {};
}

function defaultOutputFor(config: any, global: any, type: QueryType): string {
  if (type === 'lol_shard' || type === 'lol_aram_augments') return 'image';
  if (type === 'lol_ban' || type === 'scammer' || type === 'peer' || type === 'ele_build') return 'text';
  return global.lolQueryOutputFormat || 'forward';
}

function outputFormatFor(config: any, global: any, type: QueryType): string {
  return getProfile(config, type).outputFormat || defaultOutputFor(config, global, type);
}

function wrapperModeFor(config: any, type: QueryType): string {
  return getProfile(config, type).wrapperMode || 'global';
}

function rowUrl(config: any, type: QueryType): string {
  if (type === 'lol_ban') return config.lolApiBaseUrl || config.lolBanPrimaryUrl || '';
  if (type === 'lol_battle') return config.lolApiBaseUrl || '';
  if (type === 'lol_hidden') return config.lolApiBaseUrl || config.lolQueryUrl || '';
  if (type === 'lol_shard') return config.lolApiBaseUrl || '';
  if (type === 'lol_aram_augments') return config.lolApiBaseUrl || '';
  if (type === 'scammer') return Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls[0] || '' : '';
  if (type === 'peer') return '本地数据库';
  if (type === 'ele_build') return config.eleBuildApiBaseUrl || '';
  return '';
}

function isQueryEnabled(config: any, global: any, type: QueryType): boolean {
  const featureSwitches = global.featureSwitches || {};
  const commandSwitch = global.lolQueryCommandSwitch || {};
  const profile = getProfile(config, type);
  if (profile.enabled === false) return false;
  const baseEnabled = global.masterEnabled !== false && global.queryEnabled !== false && global.disableLolQuery !== true;
  if (type === 'lol_ban') return baseEnabled && enabledSwitch(featureSwitches, 'query.lol_ban') && commandSwitch.banQuery !== false;
  if (type === 'lol_battle') return baseEnabled && enabledSwitch(featureSwitches, 'query.lol_battle') && commandSwitch.battleQuery !== false;
  if (type === 'lol_hidden') return baseEnabled && enabledSwitch(featureSwitches, 'query.lol_hidden') && commandSwitch.hiddenQuery !== false;
  if (type === 'lol_shard') return baseEnabled && enabledSwitch(featureSwitches, 'query.lol_shard');
  if (type === 'lol_aram_augments') return baseEnabled && enabledSwitch(featureSwitches, 'query.lol_aram_augments');
  if (type === 'scammer') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.scammer');
  if (type === 'peer') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.peer');
  if (type === 'ele_build') return global.masterEnabled !== false && global.queryEnabled !== false && global.dynamicCommandEnabled !== false;
  return false;
}

function validateUrlValue(label: string, value: any, required = false): string[] {
  const warnings: string[] = [];
  const text = String(value || '').trim();
  if (!text) {
    if (required) warnings.push(`${label} 为空`);
    return warnings;
  }
  if (!/^https?:\/\//i.test(text)) warnings.push(`${label} 不是 http/https 地址`);
  if (/\s/.test(text)) warnings.push(`${label} 包含空白字符`);
  try {
    const u = new URL(text.replaceAll('{qq}', '10000').replaceAll('{query}', 'test').replaceAll('{keyword}', 'test').replaceAll('$qq', '10000'));
    const host = u.hostname.toLowerCase();
    const parts = host.split('.').filter(Boolean);
    const tld = parts[parts.length - 1] || '';
    if (parts.length < 2) warnings.push(`${label} 域名看起来不完整`);
    if (tld.length > 6 && !['localhost'].includes(host)) warnings.push(`${label} 顶级域名 ${tld} 较可疑，请确认是否写完整`);
    if (host.startsWith('m.') && !u.pathname.includes('/')) warnings.push(`${label} 像移动端短域名但缺少路径，请确认是否完整`);
  } catch {
    warnings.push(`${label} URL 格式可能不正确`);
  }
  return warnings;
}

function validateConfig(config: any): { warnings: string[]; errors: string[]; } {
  const warnings: string[] = [];
  const errors: string[] = [];
  warnings.push(...validateUrlValue('查封号兼容备用 URL', config.lolBanPrimaryUrl, false));
  warnings.push(...validateUrlValue('LOL API Base', config.lolApiBaseUrl, false));
  if (!String(config.lolApiBaseUrl || '').trim()) {
    errors.push('LOL API Base 未配置；查封号、查战绩、查合集和海符榜无法使用统一内网服务。');
  }
  warnings.push(...validateUrlValue('战绩查询 URL', config.lolQueryUrl, false));
  if (String(config.shardDataUrl || '').trim() || String(config.shardHeroListUrl || '').trim()) {
    warnings.push('合集数据 URL 与英雄列表 URL 已废弃；真实“查合集”和 WebUI 测试器只使用 LOL API Base。');
  }
  warnings.push(...validateUrlValue('ELE API Base', config.eleBuildApiBaseUrl, false));
  const lanzouTemplate = String(config?.lanzouUpdatePush?.messageTemplate || '');
  if (lanzouTemplate.includes('\uFFFD') || /\?{3,}|(锛|銆|鈥|娴嬪|缃戠|鏇存柊)/.test(lanzouTemplate)) {
    errors.push('蓝奏更新消息模板疑似存在乱码，请重新保存为 UTF-8 中文模板。');
  }
  warnings.push(...validateUrlValue('骗子举报 URL', config.scammerReportUrl, false));
  const scammerUrls = Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls : [];
  scammerUrls.forEach((url: string, index: number) => warnings.push(...validateUrlValue(`骗子查询 URL #${index + 1}`, url, false)));
  return { warnings, errors };
}

export function getQueryOverview() {
  const config = getConfigAny();
  const global = getGlobalAny();
  const featureSwitches = global.featureSwitches || {};
  const commandSwitch = global.lolQueryCommandSwitch || {};
  const profiles = getProfiles(config);
  const rows = QUERY_TYPES.map(item => ({
    type: item.type,
    name: item.name,
    enabled: isQueryEnabled(config, global, item.type),
    featureKey: item.featureKey || '',
    trigger: item.trigger,
    dataSource: item.dataSource,
    url: rowUrl(config, item.type),
    heroListUrl: '',
    backupUrls: item.type === 'lol_ban' && Array.isArray(config.lolBanBackupUrls) ? config.lolBanBackupUrls.length : undefined,
    urlCount: item.type === 'scammer' && Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls.length : undefined,
    outputFormat: outputFormatFor(config, global, item.type),
    defaultOutputFormat: defaultOutputFor(config, global, item.type),
    wrapperMode: wrapperModeFor(config, item.type),
    profile: getProfile(config, item.type)
  }));

  return {
    ok: true,
    base: {
      masterEnabled: global.masterEnabled !== false,
      queryEnabled: global.queryEnabled !== false,
      disableLolQuery: global.disableLolQuery === true,
      dynamicCommandEnabled: global.dynamicCommandEnabled !== false,
      timeoutSeconds: global.lolQueryRequestTimeoutSeconds ?? 20,
      globalMinIntervalSeconds: global.lolQueryGlobalMinIntervalSeconds ?? 1,
      groupMinIntervalSeconds: global.lolQueryGroupMinIntervalSeconds ?? 2,
      globalRateLimitPerMinute: global.lolQueryGlobalRateLimitPerMinute ?? 120,
      groupRateLimitPerMinute: global.lolQueryGroupRateLimitPerMinute ?? 20,
      groupDailyLimit: global.lolQueryDailyLimit ?? 200,
      defaultOutputFormat: global.lolQueryOutputFormat || 'forward',
      wrapperEnabled: global.botSendWrapperEnabled === true,
      wrapperQueryEnabled: global.botSendWrapperQueryEnabled === true,
      wrapperAllEnabled: global.botSendWrapperAllEnabled === true
    },
    rows,
    profiles,
    config: {
      lolApiBaseUrl: config.lolApiBaseUrl || '',
      lolQueryUrl: config.lolQueryUrl || '',
      lolAuthKey: maskSecret(config.lolAuthKey),
      lolBanPrimaryUrl: config.lolBanPrimaryUrl || '',
      lolBanBackupUrls: config.lolBanBackupUrls || [],
      eleBuildApiBaseUrl: config.eleBuildApiBaseUrl || '',
      shardDataUrl: config.shardDataUrl || '',
      shardHeroListUrl: config.shardHeroListUrl || '',
      shardImageUrlTemplate: config.shardImageUrlTemplate || '',
      shardQueryOutputFormat: config.shardQueryOutputFormat || 'image',
      shardLegacyConfigDeprecated: true,
      scammerQueryUrls: config.scammerQueryUrls || [],
      scammerReportUrl: config.scammerReportUrl || '',
      lanzouUpdatePush: {
        enabled: config.lanzouUpdatePush?.enabled === true,
        monitorBaseUrl: config.lanzouUpdatePush?.monitorBaseUrl || '',
        groupIds: Array.isArray(config.lanzouUpdatePush?.groupIds) ? config.lanzouUpdatePush.groupIds : [],
        privateUserIds: Array.isArray(config.lanzouUpdatePush?.privateUserIds) ? config.lanzouUpdatePush.privateUserIds : [],
        messageTemplate: config.lanzouUpdatePush?.messageTemplate || '{message}',
        includeDiffSummary: config.lanzouUpdatePush?.includeDiffSummary !== false
      }
    },
    validation: validateConfig(config),
    featureSwitches,
    commandSwitch
  };
}

export function patchQueryConfig(options: SnowLumaAdminServerOptions, patch: Record<string, any>) {
  const config = getConfigAny();
  const next = applyPatch(config, patch || {});
  configStateService.setConfig(next);
  saveConfigStrict(options.ctx);
  return getQueryOverview();
}

function replaceTemplate(url: string, param: string, extra: Record<string, any> = {}): string {
  let out = String(url || '');
  const map: Record<string, string> = {
    qq: param,
    query: param,
    keyword: param,
    name: param,
    value: param,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v ?? '')]))
  };
  for (const [key, value] of Object.entries(map)) {
    out = out.replaceAll(`{${key}}`, encodeURIComponent(value));
    out = out.replaceAll(`$${key}`, encodeURIComponent(value));
  }
  return out;
}

function addQueryParam(urlText: string, key: string, value: string): string {
  const url = new URL(urlText);
  if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
}

function buildTestUrl(type: QueryType, param: string, payload: any): string {
  const config = getConfigAny();
  const rawCustomUrl = String(payload?.url || '').trim();
  if (type === 'custom') {
    if (!rawCustomUrl) throw new Error('custom 测试必须填写 URL');
    return replaceTemplate(rawCustomUrl, param, payload || {});
  }
  if (type === 'lol_ban') {
    let url = '';
    if (config.lolApiBaseUrl) {
      const base = String(config.lolApiBaseUrl).replace(/\/+$/, '');
      url = `${base}/api/v2/lolban?qq=${encodeURIComponent(param)}&output=json&compat=napcat`;
    } else {
      url = replaceTemplate(config.lolBanPrimaryUrl || '', param);
    }
    if (!url) throw new Error('未配置 lolBanPrimaryUrl 或 lolApiBaseUrl');
    if (!/[?&](qq|uin|account)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'qq', param);
    return url;
  }
  if (type === 'lol_battle') {
    const base = String(config.lolApiBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('未配置 lolApiBaseUrl');
    const url = new URL(`${base}/cross_query`);
    url.searchParams.set('name', param);
    url.searchParams.set('output', 'pretty');
    const region = String(payload?.region || '').trim();
    if (region) url.searchParams.set('region', region);
    return url.toString();
  }
  if (type === 'lol_hidden') {
    let url = replaceTemplate(config.lolQueryUrl || '', param, { type });
    if (!url) throw new Error('未配置 lolQueryUrl');
    if (!/[?&](qq|uin|account|name)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'name', param);
    if (config.lolAuthKey && !/[?&](key|auth|zhanjikey|token)=/.test(url)) url = addQueryParam(url, 'zhanjikey', config.lolAuthKey);
    return url;
  }
  if (type === 'lol_shard') {
    throw new Error('查合集测试必须通过统一内网交付客户端');
  }
  if (type === 'lol_aram_augments') {
    const base = String(config.lolApiBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('未配置 lolApiBaseUrl');
    const url = new URL(`${base}/aram_augments`);
    url.searchParams.set('hero', param);
    url.searchParams.set('output', 'json');
    return url.toString();
  }
  if (type === 'scammer') {
    const urls = Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls : [];
    let url = replaceTemplate(String(payload?.url || urls[0] || ''), param);
    if (!url) throw new Error('未配置 scammerQueryUrls，也未填写测试 URL');
    if (!/[?&](qq|uin|account|keyword)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'qq', param);
    return url;
  }
  if (type === 'peer') {
    throw new Error('同行查询走本地数据库，不使用外部 URL');
  }
  if (type === 'ele_build') {
    const base = String(payload?.url || config.eleBuildApiBaseUrl || 'http://www.ele00001.cc.cd/api').replace(/\/+$/, '');
    return `${base}/build/active/${encodeURIComponent(param)}`;
  }
  throw new Error(`未知查询类型: ${type}`);
}

function normalizeShardPreferred(value: unknown): 'auto' | 'text' | 'image' | 'forward' {
  return value === 'text' || value === 'image' || value === 'forward' ? value : 'auto';
}

function safeAdminError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 300);
}

function shardReplyPreview(plan: Awaited<ReturnType<typeof requestShardDelivery>>['plan']): string {
  if (plan.kind === 'forward') return `查合集预览：合并转发 ${plan.nodes.length} 个节点`;
  const text = plan.segments
    .map((segment) => segment.type === 'text' ? segment.data.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  const images = plan.segments.filter((segment) => segment.type === 'image').length;
  if (text) return text;
  if (images) return `查合集预览：接口返回 ${images} 张图片`;
  return '查合集预览：接口已返回最终交付载荷。';
}

async function testShardDeliveryQuery(param: string, payload: any) {
  const config = getConfigAny();
  const global = getGlobalAny();
  const baseUrl = String(config.lolApiBaseUrl || '').trim();
  if (!baseUrl) throw new Error('未配置 lolApiBaseUrl');
  const timeoutMs = Math.max(3000, Math.min(Number(payload?.timeoutMs || (global.lolQueryRequestTimeoutSeconds || 20) * 1000), 120000));
  const preferred = normalizeShardPreferred(outputFormatFor(config, global, 'lol_shard'));
  const startedAt = Date.now();
  try {
    const { envelope, plan } = await requestShardDelivery({
      baseUrl,
      hero: param,
      preferred,
      timeoutMs,
      requestId: `admin-shard-${Date.now().toString(36)}`
    });
    return {
      ok: envelope.ok,
      error: envelope.ok ? '' : envelope.error?.code || 'delivery_error',
      type: 'lol_shard',
      commandProfile: getProfile(config, 'lol_shard'),
      request: {
        url: '/api/v1/groupguard/query',
        method: 'POST',
        dataSource: 'local-api',
        feature: 'shard',
        hero: param,
        preferred,
        timeoutMs
      },
      response: {
        ok: envelope.ok,
        elapsedMs: Date.now() - startedAt,
        protocol: envelope.protocol,
        deliveryKind: plan.kind,
        segmentTypes: envelope.delivery.segments.map((segment) => segment.type),
        retry: envelope.retry,
        error: envelope.error,
        meta: envelope.meta
      },
      parsedPreview: {
        protocol: envelope.protocol,
        ok: envelope.ok,
        feature: envelope.feature,
        deliveryKind: plan.kind,
        retryAllowed: envelope.retry.allowed,
        errorCode: envelope.error?.code || ''
      },
      finalReplyPreview: shardReplyPreview(plan)
    };
  } catch (error) {
    return {
      ok: false,
      type: 'lol_shard',
      request: {
        url: '/api/v1/groupguard/query',
        method: 'POST',
        dataSource: 'local-api',
        feature: 'shard',
        hero: param,
        preferred,
        timeoutMs
      },
      error: safeAdminError(error),
      elapsedMs: Date.now() - startedAt
    };
  }
}

export async function testQueryEndpoint(payload: any) {
  const rawType = String(payload?.type || 'custom');
  if (!QUERY_TYPE_SET.has(rawType as QueryType)) throw new Error(`未知查询类型: ${rawType}`);
  const type = rawType as QueryType;
  const param = String(payload?.param || '').trim();
  if (!param) throw new Error('测试参数不能为空');
  if (type === 'lol_ban' && !/^\d{5,11}$/.test(param)) throw new Error('查封号测试参数必须是 5-11 位 QQ 号');
  if (type === 'peer') return testPeerLocalQuery(param);
  if (type === 'lol_shard') return testShardDeliveryQuery(param, payload);
  const url = buildTestUrl(type, param, payload);
  const timeoutMs = Math.max(3000, Math.min(Number(payload?.timeoutMs || (getGlobalAny().lolQueryRequestTimeoutSeconds || 20) * 1000), 120000));
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: 'application/json,text/plain,*/*' };
    if (payload?.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)) {
      for (const [k, v] of Object.entries(payload.headers)) if (k) headers[k] = String(v);
    }
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal } as any);
    const body = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch {}
    const preview = body.length > MAX_BODY_PREVIEW ? `${body.slice(0, MAX_BODY_PREVIEW)}\n...<truncated ${body.length - MAX_BODY_PREVIEW} chars>` : body;
    const parsedPreview = summarizeParsedResult(type, parsed, body);
    const finalReplyPreview = response.ok
      ? buildFinalReplyPreview(type, param, parsedPreview, parsed, body)
      : `查询失败：上游 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return {
      ok: response.ok,
      error: response.ok ? '' : `upstream_http_${response.status}`,
      type,
      commandProfile: getProfile(getConfigAny(), type),
      request: { url, timeoutMs },
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Date.now() - startedAt,
        contentType: response.headers.get('content-type') || '',
        bodyPreview: preview,
        json: parsed
      },
      parsedPreview,
      finalReplyPreview
    };
  } catch (error: any) {
    return {
      ok: false,
      type,
      request: { url, timeoutMs },
      error: error?.name === 'AbortError' ? `请求超时 ${timeoutMs}ms` : String(error?.message || error),
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

function testPeerLocalQuery(param: string) {
  const startedAt = Date.now();
  return {
    ok: true,
    type: 'peer',
    commandProfile: getProfile(getConfigAny(), 'peer'),
    request: { dataSource: 'local-db', keyword: param },
    response: {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      note: '同行查询走本地数据库；当前 WebUI 测试器已禁止请求外部接口。下一步需要接入现有本地同行查询函数后显示真实匹配结果。'
    },
    parsedPreview: { dataSource: 'local-db', keyword: param },
    finalReplyPreview: `同行查询：${param}\n数据源：本地数据库\n说明：WebUI 已按本地库处理，不会请求 pianzi.lol。真实匹配结果待接入本地查询函数。`
  };
}

function summarizeParsedResult(type: QueryType, parsed: any, body: string): any {
  if (parsed && typeof parsed === 'object') {
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (type === 'lol_ban') {
      return {
        code: parsed.code ?? parsed.result ?? '',
        msg: parsed.msg ?? parsed.message ?? '',
        qq: data.qq ?? '',
        status: data.return ?? data.status ?? data.ban_status ?? '',
        detail: data.ban_reason ?? data.banmsg ?? data.rammsg ?? parsed.err_msg ?? parsed.msg ?? '',
        banTime: data.ban_time ?? data.banTime ?? '',
        endTime: data.end_time ?? data.endTime ?? '',
        reason: data.ban_reason ?? data.reason ?? ''
      };
    }
    return {
      code: parsed.code ?? parsed.result ?? '',
      msg: parsed.msg ?? parsed.message ?? parsed.err_msg ?? '',
      keys: Object.keys(parsed).slice(0, 20)
    };
  }
  return { textPreview: String(body || '').slice(0, 300) };
}

function buildFinalReplyPreview(type: QueryType, param: string, parsedPreview: any, parsed: any, body: string): string {
  if (type === 'lol_ban') {
    const qq = parsedPreview?.qq || param;
    const status = parsedPreview?.status || parsedPreview?.msg || '未知';
    const lines = [`QQ：${qq}`, `状态：${status}`];
    if (parsedPreview?.endTime) lines.push(`剩余：${parsedPreview.endTime}`);
    if (parsedPreview?.reason) lines.push(`原因：${parsedPreview.reason}`);
    if (parsedPreview?.banTime) lines.push(`封禁时间：${parsedPreview.banTime}`);
    if (!parsedPreview?.endTime && !parsedPreview?.reason && !parsedPreview?.banTime) lines.push(`详情：${parsedPreview?.detail || '无详情'}`);
    return lines.join('\n');
  }
  if (type === 'lol_battle') {
    const msg = parsedPreview?.msg || parsed?.message || parsed?.msg || '接口已返回结果';
    return `查战绩预览：${msg}\n输出格式：${outputFormatFor(getConfigAny(), getGlobalAny(), 'lol_battle')}`;
  }
  if (type === 'lol_hidden') {
    const msg = parsedPreview?.msg || parsed?.message || parsed?.msg || '接口已返回结果';
    return `查隐藏预览：${msg}\n输出格式：${outputFormatFor(getConfigAny(), getGlobalAny(), 'lol_hidden')}`;
  }
  if (type === 'lol_shard') {
    return `查合集预览：统一内网交付客户端已返回。\n输出格式：${outputFormatFor(getConfigAny(), getGlobalAny(), 'lol_shard')}`;
  }
  if (type === 'lol_aram_augments') {
    const hero = parsed?.hero?.title || parsed?.hero?.name || param;
    const rows = Array.isArray(parsed?.rows) ? parsed.rows.length : 0;
    return `海符榜预览：${hero}，推荐 ${rows} 条\n输出格式：image`;
  }
  if (type === 'scammer') {
    const msg = parsedPreview?.msg || parsed?.message || parsed?.msg || String(body || '').slice(0, 160) || '接口已返回结果';
    return `骗子查询预览：${msg}`;
  }
  return parsedPreview?.textPreview || parsedPreview?.msg || String(body || '').slice(0, 300);
}
