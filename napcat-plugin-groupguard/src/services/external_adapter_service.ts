import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { saveConfig, getTarget } from '../commands/common';

type AdapterKind = 'ban_query' | 'risk_query' | 'risk_report' | 'media_video';
type AdapterResponseType = 'json' | 'text' | 'auto';

type AdapterConfig = {
  id: string;
  name?: string;
  kind: AdapterKind;
  category?: string;
  enabled?: boolean;
  request?: {
    method?: 'GET' | 'POST';
    url?: string;
    headers?: Record<string, string>;
    responseType?: AdapterResponseType;
    timeoutMs?: number;
    bodyType?: 'json' | 'form' | 'text';
    body?: Record<string, unknown> | string;
  };
  parse?: {
    fields?: Record<string, string | string[]>;
    regex?: Record<string, string>;
    statusRules?: Record<string, string[]>;
    successRules?: string[];
  };
  template?: string | Record<string, string>;
};

type AdapterExecutionResult = {
  ok: boolean;
  adapter?: AdapterConfig;
  fields: Record<string, any>;
  rawText: string;
  data: any;
  error?: string;
};

type RateCounterBucket = { windowStart: number; count: number };
const LOL_RATE_WINDOW_MS = 60_000;
const lolGlobalRateBucket: RateCounterBucket = { windowStart: 0, count: 0 };
const lolGroupRateBuckets = new Map<string, RateCounterBucket>();
let lolGlobalLastQueryAt = 0;
const lolGroupLastQueryAt = new Map<string, number>();
const lolGroupDailyBuckets = new Map<string, { day: string; count: number }>();

function getConfigAny(): any {
  return configStateService.getConfig() as any;
}

function getGroupSettingsAny(groupId: string): any {
  return configStateService.resolveGroupSettings(groupId) as any;
}

function normalizePositiveInt(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

function ensureRateWindow(bucket: RateCounterBucket, now: number): void {
  if (!bucket.windowStart || now - bucket.windowStart >= LOL_RATE_WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
}

function checkAndConsumeLolRate(groupId: string): { ok: true } | { ok: false; reason: string } {
  const settings = getGroupSettingsAny(groupId);
  if (settings.disableLolQuery) return { ok: false, reason: '本群 LOL 查询功能已关闭' };
  const globalLimit = normalizePositiveInt(Number(settings.lolQueryGlobalRateLimitPerMinute), 120, 5000);
  const groupLimit = normalizePositiveInt(Number(settings.lolQueryGroupRateLimitPerMinute), 20, 1000);
  const globalMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGlobalMinIntervalSeconds ?? 1)));
  const groupMinIntervalSec = Math.max(0, Math.floor(Number(settings.lolQueryGroupMinIntervalSeconds ?? 2)));
  const groupDailyLimit = normalizePositiveInt(Number(settings.lolQueryDailyLimit), 200, 100000);
  const now = Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);
  ensureRateWindow(lolGlobalRateBucket, now);
  let groupBucket = lolGroupRateBuckets.get(groupId);
  if (!groupBucket) {
    groupBucket = { windowStart: now, count: 0 };
    lolGroupRateBuckets.set(groupId, groupBucket);
  }
  ensureRateWindow(groupBucket, now);
  if (lolGlobalRateBucket.count >= globalLimit) return { ok: false, reason: `LOL 查询过于频繁（全局每分钟上限 ${globalLimit} 次）` };
  if (groupBucket.count >= groupLimit) return { ok: false, reason: `LOL 查询过于频繁（本群每分钟上限 ${groupLimit} 次）` };
  const dailyRaw = lolGroupDailyBuckets.get(groupId);
  const daily = (!dailyRaw || dailyRaw.day !== dayKey) ? { day: dayKey, count: 0 } : dailyRaw;
  if (daily.count >= groupDailyLimit) return { ok: false, reason: `LOL 查询已达本群当日上限（${groupDailyLimit} 次）` };
  if (globalMinIntervalSec > 0 && lolGlobalLastQueryAt > 0 && now - lolGlobalLastQueryAt < globalMinIntervalSec * 1000) {
    return { ok: false, reason: `LOL 查询过于频繁（全局最小间隔 ${globalMinIntervalSec} 秒）` };
  }
  const groupLastAt = lolGroupLastQueryAt.get(groupId) || 0;
  if (groupMinIntervalSec > 0 && groupLastAt > 0 && now - groupLastAt < groupMinIntervalSec * 1000) {
    return { ok: false, reason: `LOL 查询过于频繁（本群最小间隔 ${groupMinIntervalSec} 秒）` };
  }
  lolGlobalRateBucket.count += 1;
  groupBucket.count += 1;
  daily.count += 1;
  lolGroupDailyBuckets.set(groupId, daily);
  lolGlobalLastQueryAt = now;
  lolGroupLastQueryAt.set(groupId, now);
  return { ok: true };
}

function readPath(input: any, path: string): any {
  const raw = String(path || '').trim();
  if (!raw) return undefined;
  if (raw === '$' || raw === '.') return input;
  const normalized = raw
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');
  if (!normalized) return input;
  let cur = input;
  for (const part of normalized.split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part as keyof typeof cur];
  }
  return cur;
}

function firstValue(input: any, paths: string | string[] | undefined): any {
  const list = Array.isArray(paths) ? paths : paths ? [paths] : [];
  for (const path of list) {
    const value = readPath(input, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function renderTemplate(template: string, vars: Record<string, any>): string {
  return String(template || '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key) => {
    const value = key.includes('.') ? readPath(vars, key) : vars[key];
    return value === undefined || value === null || value === '' ? '-' : String(value);
  });
}

function renderObject(input: any, vars: Record<string, any>): any {
  if (typeof input === 'string') return renderTemplate(input, vars);
  if (Array.isArray(input)) return input.map(item => renderObject(item, vars));
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, renderObject(v, vars)]));
  }
  return input;
}

function makeRawText(data: any, raw: string): string {
  const pieces: string[] = [];
  if (raw) pieces.push(raw);
  try { pieces.push(JSON.stringify(data)); } catch {}
  return pieces.join(' ');
}

function normalizeAdapters(input: any): AdapterConfig[] {
  if (!Array.isArray(input)) return [];
  const validKinds = new Set(['ban_query', 'risk_query', 'risk_report', 'media_video']);
  return input
    .map((item: any): AdapterConfig | null => {
      const id = String(item?.id || '').trim();
      const kind = String(item?.kind || '').trim() as AdapterKind;
      const url = String(item?.request?.url || '').trim();
      if (!id || !validKinds.has(kind) || !url) return null;
      return {
        ...item,
        id,
        kind,
        enabled: item.enabled !== false,
        request: {
          ...(item.request || {}),
          method: item.request?.method === 'POST' ? 'POST' : 'GET',
          url,
          responseType: ['json', 'text', 'auto'].includes(item.request?.responseType) ? item.request.responseType : 'auto',
          timeoutMs: Math.max(1000, Math.min(120000, Number(item.request?.timeoutMs || 10000)))
        }
      };
    })
    .filter(Boolean) as AdapterConfig[];
}

function getAdapters(kind?: AdapterKind, category?: string): AdapterConfig[] {
  const cfg = getConfigAny();
  const adapters = normalizeAdapters(cfg.externalAdapters);
  const filtered = adapters.filter(a => a.enabled !== false && (!kind || a.kind === kind));
  if (category && kind === 'media_video') {
    const exact = filtered.filter(a => String(a.category || '').trim() === category);
    if (exact.length) return exact;
  }
  const primaryId = kind ? String(cfg.externalAdapterPrimary?.[kind] || '').trim() : '';
  return filtered.sort((a, b) => {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
    return a.id.localeCompare(b.id);
  });
}

function setAdapters(adapters: AdapterConfig[], ctx: NapCatPluginContext): void {
  const cfg = getConfigAny();
  cfg.externalAdapters = normalizeAdapters(adapters);
  saveConfig(ctx);
}

async function runAdapter(adapter: AdapterConfig, vars: Record<string, any>): Promise<AdapterExecutionResult> {
  const request = adapter.request || {};
  const url = renderTemplate(String(request.url || ''), vars);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(request.timeoutMs || 10000));
  try {
    const headers = renderObject(request.headers || {}, vars) as Record<string, string>;
    const method = request.method === 'POST' ? 'POST' : 'GET';
    const init: RequestInit = { method, signal: controller.signal, headers: { Accept: 'application/json,text/plain,*/*', ...headers } };
    if (method === 'POST') {
      const body = renderObject(request.body || {}, vars);
      if (request.bodyType === 'form') {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(body || {})) params.set(k, String(v ?? ''));
        init.body = params;
        (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (request.bodyType === 'text') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body || {});
      } else {
        init.body = JSON.stringify(body || {});
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }
    const res = await fetch(url, init);
    const raw = (await res.text()).replace(/\u0000+$/g, '').trim();
    if (!res.ok) return { ok: false, adapter, fields: {}, rawText: raw, data: null, error: `HTTP ${res.status}` };
    let data: any = raw;
    const responseType = request.responseType || 'auto';
    if (responseType === 'json' || (responseType === 'auto' && /^[\[{]/.test(raw))) {
      try { data = raw ? JSON.parse(raw) : {}; } catch { if (responseType === 'json') throw new Error('接口返回非JSON或格式异常'); }
    }
    const fields: Record<string, any> = {};
    const fieldMap = adapter.parse?.fields || {};
    for (const [key, paths] of Object.entries(fieldMap)) fields[key] = firstValue(data, paths);
    const regexMap = adapter.parse?.regex || {};
    for (const [key, pattern] of Object.entries(regexMap)) {
      if (fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== '') continue;
      try {
        const m = raw.match(new RegExp(pattern));
        if (m) fields[key] = m[1] || m[0];
      } catch {}
    }
    return { ok: true, adapter, fields, rawText: makeRawText(data, raw), data };
  } catch (e: any) {
    return { ok: false, adapter, fields: {}, rawText: '', data: null, error: e?.name === 'AbortError' ? '请求超时' : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function runFirstAdapter(kind: AdapterKind, vars: Record<string, any>, category?: string): Promise<AdapterExecutionResult | null> {
  const adapters = getAdapters(kind, category);
  if (!adapters.length) return null;
  let last: AdapterExecutionResult | null = null;
  for (const adapter of adapters) {
    const result = await runAdapter(adapter, vars);
    last = result;
    if (result.ok) return result;
  }
  return last;
}

function containsAny(text: string, words?: string[]): boolean {
  const normalized = String(text || '').toLowerCase();
  return (words || []).some(word => word && normalized.includes(String(word).toLowerCase()));
}

function detectStatus(result: AdapterExecutionResult, safeDefault = 'unknown'): string {
  const rules = result.adapter?.parse?.statusRules || {};
  const source = `${Object.values(result.fields).join(' ')} ${result.rawText}`;
  if (containsAny(source, rules.safe || [])) return 'safe';
  if (containsAny(source, rules.banned || [])) return 'banned';
  if (containsAny(source, rules.found || [])) return 'found';
  if (containsAny(source, rules.ok || [])) return 'ok';
  const statusValue = String(result.fields.status ?? '').toLowerCase();
  if (['true', '1', 'yes', '封禁', '已封禁', 'banned', 'ban'].some(v => statusValue.includes(v))) return 'banned';
  if (['false', '0', '正常', '未封', 'safe', 'ok'].some(v => statusValue.includes(v))) return 'safe';
  return safeDefault;
}

function getTemplate(adapter: AdapterConfig | undefined, key: string, fallback: string): string {
  const tpl = adapter?.template;
  if (typeof tpl === 'string') return tpl;
  if (tpl && typeof tpl === 'object' && typeof tpl[key] === 'string') return tpl[key];
  return fallback;
}

async function sendGroupText(groupId: string, userId: string, text: string): Promise<void> {
  await send({
    channel: 'group',
    targetId: groupId,
    scene: 'raw_text',
    segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` ${text}` } }
    ],
    force: true,
    applyTemplate: true
  });
}

async function handleBanQuery(text: string, raw: string, groupId: string, userId: string): Promise<boolean> {
  if (!getAdapters('ban_query').length) return false;
  const settings = getGroupSettingsAny(groupId);
  if (settings.disableLolQuery || settings.lolQueryCommandSwitch?.banQuery === false) {
    await sendGroupText(groupId, userId, '本群已关闭查封号指令');
    return true;
  }
  const rate = checkAndConsumeLolRate(groupId);
  if (!rate.ok) { await sendGroupText(groupId, userId, rate.reason); return true; }
  const rest = text.slice(3).trim();
  let targetQQ = rest;
  if (!targetQQ || !/^\d+$/.test(targetQQ)) targetQQ = getTarget(raw, rest) || '';
  if (!targetQQ || !/^\d{5,13}$/.test(targetQQ)) {
    await sendGroupText(groupId, userId, '请指定正确的QQ号，例如：查封号 123456789');
    return true;
  }
  const result = await runFirstAdapter('ban_query', { qq: targetQQ, account: targetQQ, identifier: targetQQ });
  if (!result || !result.ok) {
    await sendGroupText(groupId, userId, `查询的 QQ:${targetQQ}，暂时无法确认是否封号，详情：${result?.error || '没有可用查询接口'}`);
    return true;
  }
  const status = detectStatus(result);
  const vars = { qq: targetQQ, target: targetQQ, raw: result.rawText, message: result.fields.message || result.fields.msg || '', ...result.fields };
  if (status === 'banned') {
    const tpl = getTemplate(result.adapter, 'banned', '查询的 QQ:{qq}，这号被封了。\n封禁至：{banUntil}\n距离解封：{remaining}\n封禁原因：{reason}');
    await sendGroupText(groupId, userId, renderTemplate(tpl, vars));
  } else if (status === 'safe') {
    const tpl = getTemplate(result.adapter, 'safe', '查询的 QQ:{qq}，这号未封，账号状态正常。');
    await sendGroupText(groupId, userId, renderTemplate(tpl, vars));
  } else {
    const tpl = getTemplate(result.adapter, 'unknown', '查询的 QQ:{qq}，暂时无法确认是否封号，详情：{message}');
    await sendGroupText(groupId, userId, renderTemplate(tpl, vars));
  }
  return true;
}

async function handleVideoQuery(text: string, groupId: string, userId: string): Promise<boolean> {
  const category = text.replace('我要看', '').trim() || '热门';
  if (!getAdapters('media_video', category).length) return false;
  const result = await runFirstAdapter('media_video', { category }, category);
  if (!result || !result.ok) {
    await sendGroupText(groupId, userId, `视频接口请求失败：${result?.error || '没有可用接口'}`);
    return true;
  }
  const url = result.fields.url || result.fields.video || result.fields.play || result.fields.src || '';
  const vars = { category, raw: result.rawText, ...result.fields, url };
  if (!url) {
    await sendGroupText(groupId, userId, `未解析到视频链接，接口返回：${String(result.rawText || '').slice(0, 200)}`);
    return true;
  }
  const tpl = getTemplate(result.adapter, 'default', '🎬 {category} 视频\n{url}');
  await sendGroupText(groupId, userId, renderTemplate(tpl, vars));
  return true;
}

async function handleRiskQuery(text: string, groupId: string, userId: string, category: 'scammer' | 'peer'): Promise<boolean> {
  if (!getAdapters('risk_query').length) return false;
  const prefix = category === 'scammer' ? '查骗子' : '查同行';
  const identifier = text.replace(prefix, '').trim();
  if (!identifier) { await sendGroupText(groupId, userId, `格式：${prefix} <QQ或微信>`); return true; }
  const type = /^\d{5,13}$/.test(identifier) ? 'qq' : 'wechat';
  const result = await runFirstAdapter('risk_query', { category, type, identifier, account: identifier, qq: type === 'qq' ? identifier : '', wechat: type === 'wechat' ? identifier : '' });
  if (!result || !result.ok) {
    await sendGroupText(groupId, userId, `查询失败：${result?.error || '没有可用接口'}`);
    return true;
  }
  const count = Number(result.fields.count || 0);
  const reports = Array.isArray(result.fields.reports) ? result.fields.reports : (result.fields.report ? [result.fields.report] : []);
  const found = result.fields.found === true || count > 0 || reports.length > 0 || detectStatus(result, '') === 'found';
  const title = category === 'scammer' ? '骗子查询' : '同行查询';
  const defaultText = found
    ? `${title}：命中记录 ${count || reports.length || 1} 条\n${reports.slice(0, 5).map((v: any, i: number) => `${i + 1}. ${String(v).slice(0, 120)}`).join('\n') || (result.fields.message || '接口返回命中')}`
    : `${title}：暂未查询到记录`;
  const tpl = getTemplate(result.adapter, found ? 'found' : 'safe', defaultText);
  await sendGroupText(groupId, userId, renderTemplate(tpl, { category, type, identifier, count, reports: reports.join('\n'), message: result.fields.message || '', raw: result.rawText, ...result.fields }));
  return true;
}

async function handleRiskReport(text: string, groupId: string, userId: string, category: 'scammer' | 'peer'): Promise<boolean> {
  if (!getAdapters('risk_report').length) return false;
  const prefix = category === 'scammer' ? '举报骗子' : '举报同行';
  const rest = text.replace(prefix, '').trim();
  const [identifier, ...contentParts] = rest.split(/\s+/).filter(Boolean);
  const content = contentParts.join(' ');
  if (!identifier || !content) { await sendGroupText(groupId, userId, `格式：${prefix} <QQ或微信> <原因>`); return true; }
  const type = /^\d{5,13}$/.test(identifier) ? 'qq' : 'wechat';
  const result = await runFirstAdapter('risk_report', { category, type, identifier, account: identifier, qq: type === 'qq' ? identifier : '', wechat: type === 'wechat' ? identifier : '', content, reporter: userId, group: groupId });
  if (!result || !result.ok) {
    await sendGroupText(groupId, userId, `举报提交失败：${result?.error || '没有可用接口'}`);
    return true;
  }
  const source = `${Object.values(result.fields).join(' ')} ${result.rawText}`;
  const ok = result.fields.ok === true || containsAny(source, result.adapter?.parse?.successRules || ['成功', '已接收', 'ok', 'success']);
  const tpl = getTemplate(result.adapter, ok ? 'ok' : 'unknown', ok ? '举报已提交：{message}' : '举报结果不明确：{message}');
  await sendGroupText(groupId, userId, renderTemplate(tpl, { category, type, identifier, content, message: result.fields.message || result.rawText.slice(0, 120), ...result.fields }));
  return true;
}

function maskSecret(text: string): string {
  return String(text || '').replace(/(token|key|sign|auth)=([^&\s]+)/ig, '$1=***');
}

async function handleAdapterAdminCommand(text: string, groupId: string, userId: string, ctx: NapCatPluginContext): Promise<boolean> {
  if (text === '外部适配器列表') {
    if (!authStateService.isOwner(userId)) return true;
    const cfg = getConfigAny();
    const adapters = normalizeAdapters(cfg.externalAdapters);
    if (!adapters.length) { await sendGroupText(groupId, userId, '暂无外部适配器配置'); return true; }
    const primary = cfg.externalAdapterPrimary || {};
    const lines = adapters.map((a, i) => `${i + 1}. ${a.enabled === false ? '关闭' : '启用'} ${a.id} [${a.kind}${a.category ? `/${a.category}` : ''}] ${primary[a.kind] === a.id ? '主' : ''}\n   ${maskSecret(a.request?.url || '')}`);
    await sendGroupText(groupId, userId, `外部适配器列表：\n${lines.join('\n')}`);
    return true;
  }
  if (text.startsWith('设置外部适配器')) {
    if (!authStateService.isOwner(userId)) return true;
    const payload = text.replace('设置外部适配器', '').trim();
    if (!payload) { await sendGroupText(groupId, userId, '格式：设置外部适配器 {JSON配置}'); return true; }
    try {
      const adapter = JSON.parse(payload) as AdapterConfig;
      const normalized = normalizeAdapters([adapter])[0];
      if (!normalized) { await sendGroupText(groupId, userId, '适配器配置无效：必须包含 id/kind/request.url'); return true; }
      const cfg = getConfigAny();
      const list = normalizeAdapters(cfg.externalAdapters).filter(a => a.id !== normalized.id);
      list.push(normalized);
      setAdapters(list, ctx);
      await sendGroupText(groupId, userId, `外部适配器已保存：${normalized.id}`);
    } catch (e: any) {
      await sendGroupText(groupId, userId, `JSON格式错误：${String(e?.message || e)}`);
    }
    return true;
  }
  if (text.startsWith('删除外部适配器')) {
    if (!authStateService.isOwner(userId)) return true;
    const id = text.replace('删除外部适配器', '').trim();
    const cfg = getConfigAny();
    const before = normalizeAdapters(cfg.externalAdapters);
    const after = before.filter(a => a.id !== id);
    cfg.externalAdapters = after;
    saveConfig(ctx);
    await sendGroupText(groupId, userId, before.length === after.length ? `未找到适配器：${id}` : `已删除适配器：${id}`);
    return true;
  }
  if (text.startsWith('设置主适配器')) {
    if (!authStateService.isOwner(userId)) return true;
    const [, kind, id] = text.split(/\s+/);
    const adapters = normalizeAdapters(getConfigAny().externalAdapters);
    if (!kind || !id || !adapters.some(a => a.kind === kind && a.id === id)) {
      await sendGroupText(groupId, userId, '格式：设置主适配器 <kind> <id>，例如：设置主适配器 ban_query lolmap-ban');
      return true;
    }
    const cfg = getConfigAny();
    cfg.externalAdapterPrimary = { ...(cfg.externalAdapterPrimary || {}), [kind]: id };
    saveConfig(ctx);
    await sendGroupText(groupId, userId, `已设置 ${kind} 主适配器：${id}`);
    return true;
  }
  if (text.startsWith('测试外部适配器')) {
    if (!authStateService.isOwner(userId)) return true;
    const parts = text.split(/\s+/).filter(Boolean);
    const id = parts[1] || '';
    const arg = parts[2] || '97077000';
    const adapter = normalizeAdapters(getConfigAny().externalAdapters).find(a => a.id === id);
    if (!adapter) { await sendGroupText(groupId, userId, `未找到适配器：${id}`); return true; }
    const result = await runAdapter(adapter, { qq: arg, account: arg, identifier: arg, category: adapter.category || arg, type: /^\d+$/.test(arg) ? 'qq' : 'wechat', content: '测试内容', reporter: userId, group: groupId });
    await sendGroupText(groupId, userId, result.ok ? `测试成功：${JSON.stringify(result.fields)}\n原始：${result.rawText.slice(0, 300)}` : `测试失败：${result.error}`);
    return true;
  }
  return false;
}

export async function executeExternalAdapterCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  if (event.message_type !== 'group') return false;
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id || '');
  const groupId = String(event.group_id || '');
  try {
    if (await handleAdapterAdminCommand(text, groupId, userId, ctx)) return true;
    if (text.startsWith('查封号')) return handleBanQuery(text, raw, groupId, userId);
    if (text.startsWith('我要看')) return handleVideoQuery(text, groupId, userId);
    if (text.startsWith('查骗子')) return handleRiskQuery(text, groupId, userId, 'scammer');
    if (text.startsWith('查同行')) return handleRiskQuery(text, groupId, userId, 'peer');
    if (text.startsWith('举报骗子')) return handleRiskReport(text, groupId, userId, 'scammer');
    if (text.startsWith('举报同行')) return handleRiskReport(text, groupId, userId, 'peer');
    return false;
  } catch (e) {
    loggingStateService.error(`外部适配器命令异常: ${e}`);
    return false;
  }
}
