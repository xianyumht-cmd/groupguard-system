import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { applyPatch } from './object_patch';
import type { SnowLumaAdminServerOptions } from './types';

const MAX_BODY_PREVIEW = 12000;

type QueryType = 'lol_ban' | 'lol_battle' | 'lol_hidden' | 'lol_shard' | 'scammer' | 'peer' | 'video' | 'custom';

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

function outputFormatFor(config: any, global: any, type: QueryType): string {
  if (type === 'lol_shard') return config.shardQueryOutputFormat || 'image';
  return global.lolQueryOutputFormat || 'forward';
}

export function getQueryOverview() {
  const config = getConfigAny();
  const global = getGlobalAny();
  const featureSwitches = global.featureSwitches || {};
  const commandSwitch = global.lolQueryCommandSwitch || {};
  const baseEnabled = global.masterEnabled !== false && global.queryEnabled !== false && global.disableLolQuery !== true;
  const rows = [
    {
      type: 'lol_ban',
      name: '查封号',
      enabled: baseEnabled && enabledSwitch(featureSwitches, 'query.lol_ban') && commandSwitch.banQuery !== false,
      featureKey: 'query.lol_ban',
      trigger: '查封号',
      url: config.lolBanPrimaryUrl || '',
      backupUrls: Array.isArray(config.lolBanBackupUrls) ? config.lolBanBackupUrls.length : 0,
      outputFormat: 'text'
    },
    {
      type: 'lol_battle',
      name: '查战绩',
      enabled: baseEnabled && enabledSwitch(featureSwitches, 'query.lol_battle') && commandSwitch.battleQuery !== false,
      featureKey: 'query.lol_battle',
      trigger: '查战绩',
      url: config.lolQueryUrl || config.lolApiBaseUrl || '',
      outputFormat: outputFormatFor(config, global, 'lol_battle')
    },
    {
      type: 'lol_hidden',
      name: '查隐藏',
      enabled: baseEnabled && enabledSwitch(featureSwitches, 'query.lol_hidden') && commandSwitch.hiddenQuery !== false,
      featureKey: 'query.lol_hidden',
      trigger: '查隐藏',
      url: config.lolApiBaseUrl || config.lolQueryUrl || '',
      outputFormat: outputFormatFor(config, global, 'lol_hidden')
    },
    {
      type: 'lol_shard',
      name: '查合集',
      enabled: baseEnabled && enabledSwitch(featureSwitches, 'query.lol_shard'),
      featureKey: 'query.lol_shard',
      trigger: '查合集',
      url: config.shardDataUrl || '',
      heroListUrl: config.shardHeroListUrl || '',
      outputFormat: outputFormatFor(config, global, 'lol_shard')
    },
    {
      type: 'scammer',
      name: '骗子查询',
      enabled: global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.scammer'),
      featureKey: 'query.scammer',
      trigger: '查骗子',
      url: Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls[0] || '' : '',
      urlCount: Array.isArray(config.scammerQueryUrls) ? config.scammerQueryUrls.length : 0,
      outputFormat: 'text'
    },
    {
      type: 'peer',
      name: '同行查询',
      enabled: global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.peer'),
      featureKey: 'query.peer',
      trigger: '查同行',
      url: '',
      outputFormat: 'text'
    },
    {
      type: 'video',
      name: '视频接口',
      enabled: global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.video'),
      featureKey: 'query.video',
      trigger: '查视频/视频',
      url: '',
      templateCount: config.videoApiTemplates && typeof config.videoApiTemplates === 'object' ? Object.keys(config.videoApiTemplates).length : 0,
      outputFormat: 'text'
    }
  ];

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
    return {
      ok: true,
      type,
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
      parsedPreview: summarizeParsedResult(type, parsed, body)
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
        detail: data.banmsg ?? data.rammsg ?? parsed.err_msg ?? ''
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
