import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { applyPatch } from './object_patch';
import type { SnowLumaAdminServerOptions } from './types';

const MAX_BODY_PREVIEW = 12000;

type QueryType = 'lol_ban' | 'lol_battle' | 'lol_hidden' | 'lol_shard' | 'scammer' | 'peer' | 'video' | 'custom';

type QueryCommandProfile = {
  outputFormat?: string;
  wrapperMode?: 'global' | 'none' | 'forward';
  enabled?: boolean;
  note?: string;
};

const QUERY_TYPES: Array<{ type: QueryType; name: string; trigger: string; featureKey?: string; }> = [
  { type: 'lol_ban', name: '查封号', trigger: '查封号', featureKey: 'query.lol_ban' },
  { type: 'lol_battle', name: '查战绩', trigger: '查战绩', featureKey: 'query.lol_battle' },
  { type: 'lol_hidden', name: '查隐藏', trigger: '查隐藏', featureKey: 'query.lol_hidden' },
  { type: 'lol_shard', name: '查合集', trigger: '查合集', featureKey: 'query.lol_shard' },
  { type: 'scammer', name: '骗子查询', trigger: '查骗子', featureKey: 'query.scammer' },
  { type: 'peer', name: '同行查询', trigger: '查同行', featureKey: 'query.peer' },
  { type: 'video', name: '视频接口', trigger: '查视频/视频', featureKey: 'query.video' }
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
  if (type === 'lol_shard') return config.shardQueryOutputFormat || 'image';
  if (type === 'lol_ban' || type === 'scammer' || type === 'peer' || type === 'video') return 'text';
  return global.lolQueryOutputFormat || 'forward';
}

function outputFormatFor(config: any, global: any, type: QueryType): string {
  return getProfile(config, type).outputFormat || defaultOutputFor(config, global, type);
}

function wrapperModeFor(config: any, type: QueryType): string {
  return getProfile(config, type).wrapperMode || 'global';
}

function rowUrl(config: any, type: QueryType): string {
  if (type === 'lol_ban') return config.lolBanPrimaryUrl || '';
  if (type === 'lol_battle') return config.lolQueryUrl || config.lolApiBaseUrl || '';
  if (type === 'lol_hidden') return config.lolApiBaseUrl || config.lolQueryUrl || '';
  if (type === 'lol_shard') return config.shardDataUrl || '';
  if (type === 'scammer' || type === 'peer') return Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls[0] || '' : '';
  if (type === 'video') {
    const templates = config.videoApiTemplates && typeof config.videoApiTemplates === 'object' ? config.videoApiTemplates : {};
    return Object.values(templates)[0] ? String(Object.values(templates)[0]) : '';
  }
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
  if (type === 'scammer') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.scammer');
  if (type === 'peer') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.peer');
  if (type === 'video') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.video');
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
    new URL(text.replaceAll('{qq}', '10000').replaceAll('{query}', 'test').replaceAll('{keyword}', 'test').replaceAll('$qq', '10000'));
  } catch {
    warnings.push(`${label} URL 格式可能不正确`);
  }
  return warnings;
}

function validateConfig(config: any): { warnings: string[]; errors: string[]; } {
  const warnings: string[] = [];
  const errors: string[] = [];
  warnings.push(...validateUrlValue('查封号主 URL', config.lolBanPrimaryUrl, true));
  warnings.push(...validateUrlValue('LOL API Base', config.lolApiBaseUrl, false));
  warnings.push(...validateUrlValue('战绩查询 URL', config.lolQueryUrl, false));
  warnings.push(...validateUrlValue('合集数据 URL', config.shardDataUrl, true));
  warnings.push(...validateUrlValue('英雄列表 URL', config.shardHeroListUrl, false));
  warnings.push(...validateUrlValue('风险举报 URL', config.scammerReportUrl, false));
  const riskUrls = Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls : [];
  riskUrls.forEach((url: string, index: number) => warnings.push(...validateUrlValue(`风险查询 URL #${index + 1}`, url, false)));
  const templates = config.videoApiTemplates;
  if (templates && (typeof templates !== 'object' || Array.isArray(templates))) {
    errors.push('videoApiTemplates 必须是 JSON 对象');
  } else if (templates) {
    for (const [key, value] of Object.entries(templates)) {
      if (!String(key).trim()) warnings.push('视频模板存在空名称');
      warnings.push(...validateUrlValue(`视频模板 ${key}`, value, false));
    }
  }
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
    url: rowUrl(config, item.type),
    heroListUrl: item.type === 'lol_shard' ? config.shardHeroListUrl || '' : '',
    backupUrls: item.type === 'lol_ban' && Array.isArray(config.lolBanBackupUrls) ? config.lolBanBackupUrls.length : undefined,
    urlCount: (item.type === 'scammer' || item.type === 'peer') && Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls.length : undefined,
    templateCount: item.type === 'video' && config.videoApiTemplates && typeof config.videoApiTemplates === 'object' ? Object.keys(config.videoApiTemplates).length : undefined,
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
      timeoutSeconds: global.lolQueryRequestTimeoutSeconds || 20,
      globalMinIntervalSeconds: global.lolQueryGlobalMinIntervalSeconds || 1,
      groupMinIntervalSeconds: global.lolQueryGroupMinIntervalSeconds || 2,
      globalRateLimitPerMinute: global.lolQueryGlobalRateLimitPerMinute || 120,
      groupRateLimitPerMinute: global.lolQueryGroupRateLimitPerMinute || 20,
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
      shardDataUrl: config.shardDataUrl || '',
      shardHeroListUrl: config.shardHeroListUrl || '',
      shardImageUrlTemplate: config.shardImageUrlTemplate || '',
      shardQueryOutputFormat: config.shardQueryOutputFormat || 'image',
      scammerQueryUrls: config.scammerQueryUrls || [],
      scammerReportUrl: config.scammerReportUrl || '',
      videoApiTemplates: config.videoApiTemplates || {}
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
    let url = replaceTemplate(config.lolBanPrimaryUrl || '', param);
    if (!url && config.lolApiBaseUrl) url = `${String(config.lolApiBaseUrl).replace(/\/$/, '')}/api/v2/lolban?qq=${encodeURIComponent(param)}`;
    if (!url) throw new Error('未配置 lolBanPrimaryUrl 或 lolApiBaseUrl');
    if (!/[?&](qq|uin|account)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'qq', param);
    return url;
  }
  if (type === 'lol_battle' || type === 'lol_hidden') {
    let url = replaceTemplate(config.lolQueryUrl || '', param, { type });
    if (!url && config.lolApiBaseUrl) url = `${String(config.lolApiBaseUrl).replace(/\/$/, '')}/cross_query?qq=${encodeURIComponent(param)}`;
    if (!url) throw new Error('未配置 lolQueryUrl 或 lolApiBaseUrl');
    if (!/[?&](qq|uin|account|name)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'qq', param);
    if (config.lolAuthKey && !/[?&](key|auth|zhanjikey|token)=/.test(url)) url = addQueryParam(url, 'zhanjikey', config.lolAuthKey);
    return url;
  }
  if (type === 'lol_shard') {
    const which = payload?.which === 'hero' ? 'hero' : 'data';
    const url = which === 'hero' ? config.shardHeroListUrl : config.shardDataUrl;
    if (!url) throw new Error(which === 'hero' ? '未配置 shardHeroListUrl' : '未配置 shardDataUrl');
    return replaceTemplate(url, param, payload || {});
  }
  if (type === 'scammer' || type === 'peer') {
    const urls = Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls : [];
    let url = replaceTemplate(String(payload?.url || urls[0] || ''), param);
    if (!url) throw new Error('未配置 scammerQueryUrls，也未填写测试 URL');
    if (!/[?&](qq|uin|account|keyword)=/.test(url) && !url.includes('{') && !url.includes('$')) url = addQueryParam(url, 'qq', param);
    return url;
  }
  if (type === 'video') {
    const templates = config.videoApiTemplates && typeof config.videoApiTemplates === 'object' ? config.videoApiTemplates : {};
    const templateKey = String(payload?.templateKey || Object.keys(templates)[0] || '');
    const template = String(payload?.url || templates[templateKey] || '');
    if (!template) throw new Error('未配置 videoApiTemplates，也未填写测试 URL');
    return replaceTemplate(template, param, payload || {});
  }
  throw new Error(`未知查询类型: ${type}`);
}

export async function testQueryEndpoint(payload: any) {
  const type = (payload?.type || 'custom') as QueryType;
  const param = String(payload?.param || '').trim();
  if (!param && type !== 'lol_shard') throw new Error('测试参数不能为空');
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
    return {
      ok: true,
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
      finalReplyPreview: buildFinalReplyPreview(type, param, parsedPreview, parsed, body)
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

function summarizeParsedResult(type: QueryType, parsed: any, body: string): any {
  if (parsed && typeof parsed === 'object') {
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (type === 'lol_ban') {
      return {
        code: parsed.code ?? parsed.result ?? '',
        msg: parsed.msg ?? parsed.message ?? '',
        status: data.return ?? data.status ?? data.ban_status ?? '',
        detail: data.banmsg ?? data.rammsg ?? parsed.err_msg ?? '',
        extra: data.rammsg && data.banmsg ? `${data.banmsg}\n${data.rammsg}` : ''
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
    const status = parsedPreview?.status || parsedPreview?.msg || '未知';
    const detail = parsedPreview?.detail || parsedPreview?.extra || '无详情';
    return `QQ：${param}\n状态：${status}\n详情：${detail}`;
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
    return `查合集预览：接口已返回。\n输出格式：${outputFormatFor(getConfigAny(), getGlobalAny(), 'lol_shard')}`;
  }
  if (type === 'video') {
    const text = parsedPreview?.msg || parsed?.title || parsed?.url || String(body || '').slice(0, 120) || '接口已返回视频内容';
    return `视频接口预览：${text}`;
  }
  if (type === 'scammer' || type === 'peer') {
    const msg = parsedPreview?.msg || parsed?.message || parsed?.msg || String(body || '').slice(0, 160) || '接口已返回结果';
    return `风险查询预览：${msg}`;
  }
  return parsedPreview?.textPreview || parsedPreview?.msg || String(body || '').slice(0, 300);
}
