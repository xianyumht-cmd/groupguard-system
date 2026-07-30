import { authManager } from '../auth';
import { isQaOnlyBotRole, shouldBlockByBotRole } from '../core/bot_role';
import { authStateService } from '../core/state-services/auth_state_service';
import { checkFeatureGate } from '../core/feature_gate';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { getTarget, isAdminOrOwner, saveConfig, sendGroupScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';
import { executeManualPolicyAction } from '../risk/policy_engine';
import { enqueueMiscAction } from './action_queue_service';
import { queryInvitedBy, queryInviterOf, resetInviteRelationData } from './invite_service';
import { checkAndConsumeQueryRate } from './query_rate_limit_service';
import { storageAdapter } from '../storage_adapter';
import type { ContactIdentifierType, ContactRiskCategory, ContactRiskRecord, ScammerRecord } from '../types';
import { deliverOneBotImageToGroup } from './lol_image_delivery';

const DEFAULT_SHARD_DATA_URL = 'https://raw.githubusercontent.com/badspacebar/release/master/files/shards.json';
const DEFAULT_SHARD_HERO_LIST_URL = 'https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js';
function getConfig() {
  return configStateService.getConfig();
}

function getGroupSettings(groupId: string) {
  return configStateService.resolveGroupSettings(groupId);
}

const QUERY_ROLE_PREFIXES = [
  '查封号',
  '查战绩',
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
  '设置封号主接口',
  '设置封号接口配置',
  '删除封号备用接口',
  '设置骗子查询接口',
  '添加骗子查询接口',
  '删除骗子查询接口',
  '设置骗子举报接口',
  '设置骗子库限制',
  '设置骗子风控'
];

const QUERY_ROLE_EXACT = new Set([
  '封号接口列表',
  '战绩接口状态',
  '战绩配置',
  '骗子接口状态'
]);

function isQueryRoleInteractionText(text: string): boolean {
  return QUERY_ROLE_EXACT.has(text) || QUERY_ROLE_PREFIXES.some(prefix => text.startsWith(prefix));
}

type QueryCommandType = 'lol_battle' | 'lol_shard';
type QueryOutputFormat = 'forward' | 'text' | 'image' | 'card';
type QueryWrapperMode = 'global' | 'none' | 'forward';

async function sendQueryRateLimitNotice(groupId: string, rateCheck: { ok: false; reason: string; notify?: boolean }): Promise<void> {
  if (rateCheck.notify === false) return;
  await sendGroupScene(groupId, 'invalid_range', rateCheck.reason);
}

function getQueryCommandProfiles(): Record<string, any> {
  const profiles = (getConfig() as any).queryCommandProfiles;
  return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

function normalizeQueryOutputFormat(value: unknown, fallback: QueryOutputFormat): QueryOutputFormat {
  return value === 'forward' || value === 'text' || value === 'image' || value === 'card'
    ? value
    : fallback;
}

function resolveQueryOutputFormat(groupId: string, type: QueryCommandType, fallback: QueryOutputFormat): QueryOutputFormat {
  const group = configStateService.getGroupSettings(groupId) as any;
  const groupKey = type === 'lol_shard' ? 'shardQueryOutputFormat' : 'lolQueryOutputFormat';
  if (group && Object.prototype.hasOwnProperty.call(group, groupKey)) {
    return normalizeQueryOutputFormat(group[groupKey], fallback);
  }
  const profileFormat = getQueryCommandProfiles()[type]?.outputFormat;
  if (profileFormat !== undefined && profileFormat !== '') {
    return normalizeQueryOutputFormat(profileFormat, fallback);
  }
  return fallback;
}

function resolveQueryWrapperMode(type: QueryCommandType): QueryWrapperMode {
  const mode = getQueryCommandProfiles()[type]?.wrapperMode;
  return mode === 'none' || mode === 'forward' ? mode : 'global';
}

type BanStatus = 'banned' | 'safe' | 'unknown';

interface BanQueryResult {
  status: BanStatus;
  detail: string;
}

interface BanQueryAttempt {
  result: BanQueryResult;
  source: string;
}

interface LolRecentMatch {
  match_id?: string;
  game_time?: string;
  champion?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  kda?: number;
  win?: boolean;
}




interface CrossPrettyMatch {
  game_time?: string;
  champion?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  kda?: number;
  win?: boolean;
  duration?: number;
  queue?: string | number;
}

interface CrossPrettyError {
  code?: number;
  message?: string;
}

interface ShardStatItem {
  name?: string;
  id?: string;
  pick_rate?: number;
  win_rate?: number;
}

interface ChampionMeta {
  alias: string;
  name?: string;
  title?: string;
  keywords?: string;
}

interface ChampionShardStat {
  pick_rate?: number;
  win_rate?: number;
  shards?: ShardStatItem[];
}

let shardCache: {
  expiresAt: number;
  dataUrl: string;
  heroUrl: string;
  shards: Record<string, ChampionShardStat>;
  champions: ChampionMeta[];
} | null = null;

interface CrossPrettyData {
  name?: string;
  region?: string;
  level?: number;
  profile_icon?: number;
  rank?: string;
  last_online_time?: string;
  winrate_recent?: string;
  avg_kda_recent?: number;
  recent_matches?: CrossPrettyMatch[];
  errors?: CrossPrettyError[];
  raw_ok?: boolean;
}

type LolCommandKey = 'battleQuery' | 'banQuery';

const BAN_UNAVAILABLE_PATTERNS = [
  /额度|上限|次数|限制|限流|频繁|拥挤|繁忙|维护|异常|失败|超时|重试|稍后|暂停|通道|风控|waf|拦截|拒绝/i,
  /会员|付费|到期|过期|充值/i
];

const BAN_CONFIRMED_PATTERNS = /封|ban|冻结|停封|处罚|禁赛|封停/i;
const SAFE_CONFIRMED_PATTERNS = /未封|正常|安全|无封|未被封|无处罚/i;

function isUnavailableMessage(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  return BAN_UNAVAILABLE_PATTERNS.some((r) => r.test(normalized));
}

function normalizeDetailKey(text: string): string {
  return text.replace(/[\s，,。；;：:、"'`]/g, '').toLowerCase();
}

function mergeUniqueDetail(parts: Array<any>): string {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const text = part.trim();
    if (!text) continue;
    const key = normalizeDetailKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result.join('；');
}

function collectBanQueryEndpoints(): string[] {
  const config = getConfig();
  const localBase = normalizeUrlBase(config.lolApiBaseUrl || '');
  const localEndpoint = localBase
    ? `${localBase}/api/v2/lolban?qq={qq}&output=json&compat=napcat`
    : '';
  const primary = (config.lolBanPrimaryUrl || '').trim();
  const backups = Array.isArray(config.lolBanBackupUrls) ? config.lolBanBackupUrls : [];
  // Once the unified intranet API is configured it owns provider fallback,
  // cache, stale/LKG semantics, and observability. Direct legacy URLs remain
  // available only as a migration fallback when no local API base is set.
  const list = localEndpoint
    ? [localEndpoint]
    : [primary, ...backups.map(v => String(v || '').trim()).filter(Boolean)];
  return Array.from(new Set(list.filter(Boolean)));
}

function normalizeUrlBase(url: string): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function resolveLolApiBaseUrl(): string {
  return normalizeUrlBase(getConfig().lolApiBaseUrl || '');
}

function resolveLolQueryTimeoutMs(): number {
  const raw = Number(getConfig().global?.lolQueryRequestTimeoutSeconds ?? 20);
  const sec = Number.isFinite(raw) ? Math.min(120, Math.max(3, Math.floor(raw))) : 20;
  return sec * 1000;
}


function normalizePlayerId(input: string): { ok: true; playerId: string; gameName: string; tagLine: string; } | { ok: false; reason: string; } {
  const raw = String(input || '').trim();
  const cleaned = raw.replace(/\s+/g, '');
  if (!cleaned || !cleaned.includes('#')) return { ok: false, reason: '请输入：查战绩张三#12345' };
  const idx = cleaned.indexOf('#');
  const gameName = cleaned.slice(0, idx).trim();
  const tagLine = cleaned.slice(idx + 1).trim();
  if (!gameName || !tagLine) return { ok: false, reason: '格式错误，示例：查战绩张三#12345' };
  if (tagLine.length < 2 || tagLine.length > 12) return { ok: false, reason: '标签长度需在 2-12 个字符之间' };
  return { ok: true, playerId: `${gameName}#${tagLine}`, gameName, tagLine };
}


function parseLolQueryInput(input: string): { ok: true; playerId: string; region: string; } | { ok: false; reason: string; } {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, reason: '请输入：查战绩张三#12345' };
  const parts = raw.split(/\s+/).filter(Boolean);
  const idPart = parts[0] || '';
  const idParsed = normalizePlayerId(idPart);
  if (!idParsed.ok) return idParsed;
  const region = parts.slice(1).join('').trim();
  return { ok: true, playerId: idParsed.playerId, region: region || '' };
}

function toOnOff(value: string): boolean | null {
  const raw = value.trim();
  if (['开', '开启', 'on', 'true', '1'].includes(raw)) return true;
  if (['关', '关闭', 'off', 'false', '0'].includes(raw)) return false;
  return null;
}

function getLolCommandSwitch(groupId: string): Record<LolCommandKey, boolean> {
  const settings = getGroupSettings(groupId);
  const data = settings.lolQueryCommandSwitch || {};
  return {
    battleQuery: (data as any).battleQuery !== false,
    banQuery: (data as any).banQuery !== false,
  };
}

function ensureGroupSettings(groupId: string): any {
  if (!getConfig().groups[groupId]) getConfig().groups[groupId] = { ...getGroupSettings(groupId) };
  return getConfig().groups[groupId];
}

function setLolCommandSwitch(groupId: string, key: LolCommandKey, enabled: boolean): void {
  const gs = ensureGroupSettings(groupId);
  if (!gs.lolQueryCommandSwitch) {
    gs.lolQueryCommandSwitch = {
      battleQuery: true,
      banQuery: true,
    };
  }
  gs.lolQueryCommandSwitch[key] = enabled;
}

function isLolCommandEnabled(groupId: string, key: LolCommandKey): boolean {
  const settings = getGroupSettings(groupId);
  if (settings.disableLolQuery) return false;
  return getLolCommandSwitch(groupId)[key];
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number = 10000): Promise<{ ok: true; data: any; } | { ok: false; error: string; }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json,text/plain,*/*' } });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const cleaned = text.replace(/\u0000+$/g, '').trim();
    const data = cleaned ? JSON.parse(cleaned) : {};
    return { ok: true, data };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: '请求超时' };
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function buildCrossQueryUrl(baseUrl: string, playerId: string, region: string | undefined, output: 'pretty' | 'raw' | 'image'): string {
  const params = new URLSearchParams();
  params.set('name', playerId);
  params.set('output', output);
  if (region) params.set('region', region);
  return `${baseUrl.replace(/\/+$/g, '')}/cross_query?${params.toString()}`;
}

async function probeImageUrlWithTimeout(url: string, timeoutMs: number = 10000): Promise<{ ok: true; contentType: string; } | { ok: false; error: string; }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'image/*,*/*' } });
    await res.body?.cancel();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { ok: false, error: `接口未返回图片 (${contentType || 'unknown content-type'})` };
    }
    return { ok: true, contentType };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: '请求超时' };
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAnyWithTimeout(url: string, timeoutMs: number = 10000): Promise<{ ok: true; data: any; raw: string; } | { ok: false; error: string; }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json,text/plain,*/*' } });
    const text = (await res.text()).replace(/\u0000+$/g, '').trim();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    return { ok: true, data, raw: text };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: '请求超时' };
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveShardDataUrls(groupId: string): { ok: true; dataUrl: string; heroUrl: string; imageTemplate: string; outputFormat: QueryOutputFormat; wrapperMode: QueryWrapperMode } | { ok: false; reason: string } {
  const cfg = getConfig() as any;
  const dataUrl = String(cfg.shardDataUrl || DEFAULT_SHARD_DATA_URL).trim();
  const heroUrl = String(cfg.shardHeroListUrl || DEFAULT_SHARD_HERO_LIST_URL).trim();
  const configuredImageTemplate = String(cfg.shardImageUrlTemplate || '').trim();
  const localBase = resolveLolApiBaseUrl();
  const imageTemplate = configuredImageTemplate || (localBase ? `${localBase}/shard_query?hero={name}&output=image` : '');
  const fallback = normalizeQueryOutputFormat(cfg.shardQueryOutputFormat, 'image');
  const outputFormat = resolveQueryOutputFormat(groupId, 'lol_shard', fallback);
  const wrapperMode = resolveQueryWrapperMode('lol_shard');
  if (!isHttpUrl(dataUrl) || !isHttpUrl(heroUrl)) return { ok: false, reason: '合集接口地址格式无效，仅支持 http/https' };
  if (imageTemplate && !isHttpUrl(imageTemplate.replaceAll('{alias}', 'Yasuo').replaceAll('{hero}', 'Yasuo').replaceAll('{name}', 'Yasuo'))) {
    return { ok: false, reason: '合集图片接口模板格式无效' };
  }
  return { ok: true, dataUrl, heroUrl, imageTemplate, outputFormat, wrapperMode };
}

async function loadShardData(dataUrl: string, heroUrl: string): Promise<{ ok: true; shards: Record<string, ChampionShardStat>; champions: ChampionMeta[] } | { ok: false; error: string }> {
  const now = Date.now();
  if (shardCache && shardCache.expiresAt > now && shardCache.dataUrl === dataUrl && shardCache.heroUrl === heroUrl) {
    return { ok: true, shards: shardCache.shards, champions: shardCache.champions };
  }
  const [shardRes, heroRes] = await Promise.all([
    fetchJsonWithTimeout(dataUrl, resolveLolQueryTimeoutMs()),
    fetchJsonWithTimeout(heroUrl, resolveLolQueryTimeoutMs())
  ]);
  if (!shardRes.ok) return { ok: false, error: `合集数据加载失败：${shardRes.error}` };
  if (!heroRes.ok) return { ok: false, error: `英雄列表加载失败：${heroRes.error}` };
  const shards = shardRes.data && typeof shardRes.data === 'object' && !Array.isArray(shardRes.data)
    ? shardRes.data as Record<string, ChampionShardStat>
    : {};
  const heroList = Array.isArray(heroRes.data?.hero) ? heroRes.data.hero : [];
  const champions = heroList
    .map((hero: any): ChampionMeta => ({
      alias: String(hero?.alias || '').trim(),
      name: String(hero?.name || '').trim(),
      title: String(hero?.title || '').trim(),
      keywords: String(hero?.keywords || '').trim()
    }))
    .filter((hero: ChampionMeta) => hero.alias);
  shardCache = { expiresAt: now + 10 * 60 * 1000, dataUrl, heroUrl, shards, champions };
  return { ok: true, shards, champions };
}

function normalizeSearchText(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function findChampionByQuery(query: string, champions: ChampionMeta[], shards: Record<string, ChampionShardStat>): ChampionMeta | null {
  const needle = normalizeSearchText(query);
  if (!needle) return null;
  const withData = champions.filter(hero => !!shards[hero.alias]);
  return withData.find(hero => normalizeSearchText(hero.alias) === needle
    || normalizeSearchText(hero.title || '') === needle
    || normalizeSearchText(hero.name || '') === needle) || withData.find(hero => {
      const hay = normalizeSearchText([hero.alias, hero.title, hero.name, hero.keywords].filter(Boolean).join(','));
      return hay.includes(needle);
    }) || null;
}

function pct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

function buildShardQueryPages(hero: ChampionMeta, stat: ChampionShardStat): string[] {
  const shards = Array.isArray(stat.shards) ? [...stat.shards] : [];
  shards.sort((a, b) => Number(b.pick_rate || 0) - Number(a.pick_rate || 0));
  const title = `${hero.title || hero.alias}${hero.name ? `（${hero.name}）` : ''}`;
  const pages: string[] = [];
  const head = [
    `📦 合集查询：${title}`,
    `英文：${hero.alias}`,
    `英雄选率：${pct(stat.pick_rate)} / 胜率：${pct(stat.win_rate)}`,
    `合集数量：${shards.length}`
  ];
  const chunkSize = 12;
  for (let i = 0; i < Math.max(1, shards.length); i += chunkSize) {
    const chunk = shards.slice(i, i + chunkSize);
    const lines = i === 0 ? [...head, ''] : [`📦 ${title} 合集列表（续）`, ''];
    if (!chunk.length) {
      lines.push('暂无可用合集数据');
    } else {
      chunk.forEach((item, idx) => {
        lines.push(`${i + idx + 1}. ${String(item.name || item.id || '未知合集').trim()}  选率 ${pct(item.pick_rate)}  胜率 ${pct(item.win_rate)}`);
      });
    }
    pages.push(lines.join('\n'));
  }
  return pages;
}

function buildShardImageUrl(template: string, hero: ChampionMeta, query: string): string {
  return template
    .replaceAll('{alias}', encodeURIComponent(hero.alias))
    .replaceAll('{hero}', encodeURIComponent(hero.alias))
    .replaceAll('{name}', encodeURIComponent(query || hero.title || hero.alias));
}

function buildAramAugmentImageUrl(baseUrl: string, hero: string): string {
  const params = new URLSearchParams();
  params.set('hero', hero);
  params.set('output', 'image');
  return `${baseUrl.replace(/\/+$/g, '')}/aram_augments?${params.toString()}`;
}

function buildAramAugmentJsonUrl(baseUrl: string, hero: string): string {
  const params = new URLSearchParams();
  params.set('hero', hero);
  params.set('output', 'json');
  return `${baseUrl.replace(/\/+$/g, '')}/aram_augments?${params.toString()}`;
}

function rarityText(value: unknown): string {
  const n = Number(value);
  if (n === 1) return '银';
  if (n === 2 || n === 3 || n === 8) return '金';
  if (n === 4) return '棱镜';
  return '-';
}

function buildAramAugmentPages(data: any, query: string): string[] {
  const hero = data && typeof data.hero === 'object' ? data.hero : {};
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const title = `${hero.title || query}${hero.name ? `（${hero.name}）` : ''}`;
  const lines = [
    `🧬 海符榜：${title}`,
    `模式：海克斯大乱斗`,
    `数据：GGK整理`,
    ''
  ];
  if (!rows.length) {
    lines.push('暂无可用强化符文推荐数据');
  } else {
    rows.slice(0, 10).forEach((row: any, idx: number) => {
      const score = Number(row?.performance);
      const scoreText = Number.isFinite(score) ? score.toFixed(2) : '-';
      lines.push(`${idx + 1}. ${String(row?.name || '未知强化符文').trim()}  品质 ${rarityText(row?.rarity)}  推荐 ${scoreText}`);
    });
  }
  const itemBuilds = Array.isArray(data?.item_builds) ? data.item_builds : [];
  if (itemBuilds.length) {
    lines.push('', '核心出装 Top 3');
    itemBuilds.slice(0, 3).forEach((build: any, idx: number) => {
      const items = Array.isArray(build?.items) ? build.items : [];
      const names = items.map((item: any) => String(item?.name || '').trim()).filter(Boolean);
      lines.push(`${idx + 1}. ${names.join(' > ') || '-'}`);
    });
  }
  const starter = Array.isArray(data?.starter_items) ? data.starter_items : [];
  const boots = Array.isArray(data?.boots) ? data.boots : [];
  const summonerSpells = Array.isArray(data?.summoner_spells) ? data.summoner_spells : [];
  const skillOrder = Array.isArray(data?.skill_order) ? data.skill_order : [];
  const spellNames = summonerSpells.map((item: any) => String(item?.name || '').trim()).filter(Boolean);
  const skillKeys = skillOrder.map((item: any) => String(item?.key || '').trim()).filter(Boolean);
  const firstStarter = Array.isArray(starter[0]?.items) ? starter[0].items.map((item: any) => String(item?.name || '').trim()).filter(Boolean) : [];
  const firstBoots = Array.isArray(boots[0]?.items) ? boots[0].items.map((item: any) => String(item?.name || '').trim()).filter(Boolean) : [];
  if (spellNames.length || skillKeys.length || firstStarter.length || firstBoots.length) {
    lines.push('');
    if (spellNames.length) lines.push(`召唤师技能：${spellNames.join(' + ')}`);
    if (skillKeys.length) lines.push(`技能顺序：${skillKeys.join(' > ')}`);
    lines.push('', `出门装：${firstStarter.join(' + ') || '-'}`);
    lines.push(`鞋子：${firstBoots.join(' + ') || '-'}`);
  }
  return [lines.join('\n')];
}

function summarizeMatch(match: LolRecentMatch): string {
  const winText = match?.win ? '胜' : '负';
  const champion = match?.champion || '未知英雄';
  const kda = typeof match?.kda === 'number'
    ? match.kda.toFixed(2)
    : `${match?.kills ?? 0}/${match?.deaths ?? 0}/${match?.assists ?? 0}`;
  const when = match?.game_time || '-';
  return `${when} | ${champion} | ${winText} | KDA ${kda}`;
}

function buildCrossPrettyPages(playerId: string, region: string, data: CrossPrettyData | null, errorText: string): string[] {
  if (!data) return [`🎮 战绩查询（跨区）\n玩家：${playerId}\n查询失败：${errorText || '接口返回异常'}`];
  const rows = Array.isArray(data.recent_matches) ? data.recent_matches : [];
  const header = [
    '🎮 战绩查询（跨区）',
    `玩家：${data.name || playerId}`,
    `大区：${data.region || region || '未指定'}`,
    `等级：${typeof data.level === 'number' ? data.level : '-'}`,
    `段位：${(data.rank || '').trim() || '未知'}`,
    `最后在线：${(data.last_online_time || '').trim() || '未知'}`,
    `近10场胜率：${(data.winrate_recent || '').trim() || '未知'}`,
    `近10场平均KDA：${typeof data.avg_kda_recent === 'number' ? data.avg_kda_recent.toFixed(2) : '未知'}`
  ];
  const page1 = [header.join('\n')];
  if (!rows.length) page1.push('最近战绩：暂无可用数据');
  else page1.push('', ...rows.slice(0, 10).map((m, i) => `${i + 1}. ${summarizeMatch(m as LolRecentMatch)}`));
  const pages = [page1.join('\n')];
  const errors = Array.isArray(data.errors) ? data.errors : [];
  if (errors.length) {
    const lines = ['⚠️ 接口告警（不一定影响主查询）'];
    for (const item of errors.slice(0, 5)) {
      lines.push(`- [${item.code ?? '-'}] ${item.message || '未知异常'}`);
    }
    pages.push(lines.join('\n'));
  }
  return pages;
}


async function sendForwardTextPages(groupId: string, selfId: string, nickname: string, pages: string[]): Promise<boolean> {
  const nodes = pages.map(content => ({
    type: 'node',
    data: {
      nickname,
      user_id: selfId,
      content: [{ type: 'text', data: { text: content } }]
    }
  }));
  try {
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', forwardNodes: nodes, force: true, applyTemplate: true });
    return true;
  } catch (e: any) {
    loggingStateService.warn(`战绩查询合并转发发送失败: ${String(e?.message || e)}`);
    return false;
  }
}

async function sendForwardTextPagesDirect(groupId: string, selfId: string, nickname: string, pages: string[]): Promise<boolean> {
  const nodes = pages.map(content => ({
    type: 'node',
    data: {
      nickname,
      user_id: selfId,
      content: [{ type: 'text', data: { text: content } }]
    }
  }));
  try {
    loggingStateService.warn(`forward_send_direct source=interaction_service group=${groupId} nodes=${nodes.length}`);
    await communicationStateService.callApi('send_group_forward_msg', {
      group_id: groupId,
      messages: nodes
    });
    return true;
  } catch (e: any) {
    loggingStateService.warn(`后台合并转发发送失败: ${String(e?.message || e)}`);
    return false;
  }
}

async function sendGroupSceneDirect(groupId: string, scene: string, message: string, vars?: Record<string, string | number | boolean>): Promise<void> {
  await communicationStateService.sendGroupText(groupId, message, {
    scene,
    vars,
    force: true,
    applyTemplate: true
  });
}

async function sendGroupSegmentsDirect(groupId: string, segments: Array<Record<string, unknown>>): Promise<void> {
  await communicationStateService.sendGroupMsg(groupId, segments as any, {
    scene: 'raw_text',
    force: true,
    applyTemplate: true
  });
}

function buildBanQueryShortText(targetQQ: string, status: BanStatus): string {
  if (status === 'banned') return `QQ:${targetQQ} 状态：疑似封号。`;
  if (status === 'safe') return `QQ:${targetQQ} 状态：未封。`;
  return `QQ:${targetQQ} 状态：暂无法确认。`;
}

function normalizeImageLine(text: string): string {
  return String(text || '')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function renderBanQueryResultImage(targetQQ: string, status: BanStatus, detail: string): Promise<string | null> {
  loggingStateService.warn(`ban_query_image_mode_unavailable target=${targetQQ} status=${status} detail=${normalizeImageLine(detail).slice(0, 80)}`);
  return null;
}

async function sendBanQueryResult(
  groupId: string,
  userId: string,
  targetQQ: string,
  status: BanStatus,
  fullContent: string
): Promise<void> {
  const mode = getGroupSettings(groupId).banQueryResultMode || 'short';
  const shortText = buildBanQueryShortText(targetQQ, status);
  if (mode === 'image') {
    const imagePath = await renderBanQueryResultImage(targetQQ, status, fullContent);
    if (imagePath) {
      try {
        await sendGroupSegmentsDirect(groupId, [
          { type: 'at', data: { qq: userId } },
          { type: 'text', data: { text: ' 查询结果：' } },
          { type: 'image', data: { file: `file:///${imagePath.replace(/\\/g, '/')}` } }
        ]);
        return;
      } catch (e: any) {
        loggingStateService.warn(`ban_query_image_send_failed err=${String(e?.message || e)}`);
      }
    }
  }
  const text = mode === 'text' ? `查询的QQ:${targetQQ}，${fullContent}` : shortText;
  await send({
    channel: 'group',
    targetId: groupId,
    scene: 'query_lol_ban',
    segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` ${text}` } }
    ],
    vars: { user: userId, target: targetQQ },
    force: true,
    applyTemplate: mode === 'text'
  });
}

async function sendQueryCardDirect(groupId: string, title: string, pages: string[]): Promise<void> {
  const summaryText = pages.join('\n').substring(0, 100).replace(/\n/g, ' ');
  const jsonCard = {
    app: 'com.tencent.structmsg',
    config: { autosize: true, forward: true, type: 'normal' },
    view: 'layout',
    meta: {
      layout: {
        title,
        desc: `${summaryText}...`,
        preview: 'https://shp.qpic.cn/collector/10000/3/0'
      }
    },
    prompt: title
  };
  await sendGroupSegmentsDirect(groupId, [
    { type: 'json', data: { data: JSON.stringify(jsonCard) } }
  ]);
}

async function sendFormattedQueryPagesDirect(
  groupId: string,
  selfId: string,
  nickname: string,
  pages: string[],
  outputFormat: QueryOutputFormat,
  wrapperMode: QueryWrapperMode
): Promise<void> {
  if (wrapperMode === 'none' || outputFormat === 'text') {
    await sendGroupSceneDirect(groupId, 'raw_text', pages.join('\n\n'));
    return;
  }
  if (wrapperMode === 'global' && outputFormat === 'card') {
    await sendQueryCardDirect(groupId, nickname, pages);
    return;
  }
  const forwarded = await sendForwardTextPagesDirect(groupId, selfId, nickname, pages);
  if (!forwarded) {
    await sendGroupSceneDirect(groupId, 'raw_text', pages.join('\n\n'));
  }
}

async function sendLolQueryImage(groupId: string, imageUrl: string): Promise<boolean> {
  try {
    const timeoutMs = Math.min(90_000, Math.max(45_000, resolveLolQueryTimeoutMs() + 15_000));
    await deliverOneBotImageToGroup(groupId, imageUrl, { timeoutMs });
    return true;
  } catch (e: any) {
    loggingStateService.warn(`LOL 查询图片获取或发送失败，降级文本结果: ${String(e?.message || e)}`);
  }
  return false;
}

function runDetachedQuery(label: string, task: () => Promise<void>): void {
  setTimeout(() => {
    void task().catch((e: any) => {
      loggingStateService.error(`${label}后台查询失败: ${String(e?.message || e)}`);
    });
  }, 0);
}

function buildBanQueryUrl(endpoint: string, qq: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) throw new Error('空接口地址');
  if (trimmed.includes('{qq}')) return trimmed.replaceAll('{qq}', encodeURIComponent(qq));
  if (trimmed.includes('%s')) return trimmed.replaceAll('%s', encodeURIComponent(qq));
  const parsed = new URL(trimmed);
  if (parsed.searchParams.has('qq')) {
    parsed.searchParams.set('qq', qq);
    return parsed.toString();
  }
  const pathname = parsed.pathname || '/';
  if (pathname.endsWith('/')) parsed.pathname = `${pathname}${encodeURIComponent(qq)}`;
  else parsed.pathname = `${pathname}/${encodeURIComponent(qq)}`;
  return parsed.toString();
}

function replaceScammerUrlPlaceholders(endpoint: string, identifier: ParsedContactIdentifier): string {
  return endpoint
    .replaceAll('{qq}', encodeURIComponent(identifier.value))
    .replaceAll('{wechat}', encodeURIComponent(identifier.type === 'wechat' ? identifier.value : ''))
    .replaceAll('{wx}', encodeURIComponent(identifier.type === 'wechat' ? identifier.value : ''))
    .replaceAll('{account}', encodeURIComponent(identifier.value))
    .replaceAll('{identifier}', encodeURIComponent(identifier.value))
    .replaceAll('{type}', encodeURIComponent(identifier.type));
}

function buildScammerQueryUrl(endpoint: string, identifier: ParsedContactIdentifier): string {
  const trimmed = endpoint.trim();
  if (!trimmed) throw new Error('空接口地址');
  if (/\{(?:qq|wechat|wx|account|identifier|type)\}/i.test(trimmed)) {
    return replaceScammerUrlPlaceholders(trimmed, identifier);
  }
  if (trimmed.includes('%s')) return trimmed.replaceAll('%s', encodeURIComponent(identifier.value));
  const parsed = new URL(trimmed);
  if (parsed.searchParams.has('qq') || parsed.searchParams.has('wechat') || parsed.searchParams.has('account') || parsed.searchParams.has('identifier')) {
    if (identifier.type === 'qq') parsed.searchParams.set('qq', identifier.value);
    else parsed.searchParams.set('wechat', identifier.value);
    parsed.searchParams.set('type', identifier.type);
    return parsed.toString();
  }
  parsed.searchParams.set(identifier.type === 'qq' ? 'qq' : 'wechat', identifier.value);
  parsed.searchParams.set('type', identifier.type);
  return parsed.toString();
}

function collectScammerQueryEndpoints(): string[] {
  const configuredValue = getConfig().scammerQueryUrls;
  const configured = Array.isArray(configuredValue) ? configuredValue : [];
  const list = configured.map(v => String(v || '').trim()).filter(Boolean);
  return Array.from(new Set(list));
}

function getScammerReportUrl(): string {
  return String(getConfig().scammerReportUrl || '').trim();
}

function getScammerLimits() {
  return {
    maxRecords: Math.max(100, Math.min(100000, Number(getConfig().scammerMaxRecords || 5000))),
    maxEvidenceLength: Math.max(50, Math.min(5000, Number(getConfig().scammerMaxEvidenceLength || 500))),
    maxRecentReports: Math.max(1, Math.min(50, Number(getConfig().scammerMaxRecentReportsPerQQ || 10)))
  };
}

function getRiskRateLimits() {
  return {
    queryUserCooldownSeconds: Math.max(0, Math.min(3600, Number(getConfig().scammerQueryUserCooldownSeconds ?? 10))),
    queryGroupRateLimitPerMinute: Math.max(1, Math.min(1000, Number(getConfig().scammerQueryGroupRateLimitPerMinute ?? 20))),
    queryCacheSeconds: Math.max(0, Math.min(86400, Number(getConfig().scammerQueryCacheSeconds ?? 300))),
    reportUserCooldownSeconds: Math.max(0, Math.min(86400, Number(getConfig().scammerReportUserCooldownSeconds ?? 60))),
    reportGroupRateLimitPerMinute: Math.max(1, Math.min(1000, Number(getConfig().scammerReportGroupRateLimitPerMinute ?? 5))),
    reportUserDailyLimit: Math.max(1, Math.min(1000, Number(getConfig().scammerReportUserDailyLimit ?? 20))),
    reportDedupHours: Math.max(0, Math.min(720, Number(getConfig().scammerReportDedupHours ?? 24)))
  };
}

const riskCooldowns = new Map<string, number>();
const riskWindows = new Map<string, number[]>();
const riskDailyCounters = new Map<string, number[]>();
const riskReportDedup = new Map<string, number>();
const riskQueryCache = new Map<string, { expiresAt: number; results: ScammerExternalResult[]; }>();

function riskKey(category: ContactRiskCategory, identifier: ParsedContactIdentifier): string {
  return `${category}:${identifier.type}:${identifier.value.toLowerCase()}`;
}

function compactRiskRuntime(now = Date.now()): void {
  if (riskCooldowns.size > 5000) {
    for (const [key, until] of riskCooldowns) if (until <= now) riskCooldowns.delete(key);
  }
  if (riskWindows.size > 5000) {
    for (const [key, list] of riskWindows) {
      const kept = list.filter(t => now - t < 60000);
      if (kept.length) riskWindows.set(key, kept);
      else riskWindows.delete(key);
    }
  }
  if (riskDailyCounters.size > 5000) {
    for (const [key, list] of riskDailyCounters) {
      const kept = list.filter(t => now - t < 86400000);
      if (kept.length) riskDailyCounters.set(key, kept);
      else riskDailyCounters.delete(key);
    }
  }
  if (riskReportDedup.size > 10000) {
    for (const [key, until] of riskReportDedup) if (until <= now) riskReportDedup.delete(key);
  }
  if (riskQueryCache.size > 5000) {
    for (const [key, item] of riskQueryCache) if (item.expiresAt <= now) riskQueryCache.delete(key);
  }
}

function consumeCooldown(key: string, seconds: number): { ok: boolean; retryAfter: number; } {
  if (seconds <= 0) return { ok: true, retryAfter: 0 };
  const now = Date.now();
  compactRiskRuntime(now);
  const until = riskCooldowns.get(key) || 0;
  if (until > now) return { ok: false, retryAfter: Math.ceil((until - now) / 1000) };
  riskCooldowns.set(key, now + seconds * 1000);
  return { ok: true, retryAfter: 0 };
}

function consumeMinuteLimit(key: string, limit: number): { ok: boolean; retryAfter: number; } {
  const now = Date.now();
  compactRiskRuntime(now);
  const history = (riskWindows.get(key) || []).filter(t => now - t < 60000);
  if (history.length >= limit) {
    const oldest = history[0] || now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000)) };
  }
  history.push(now);
  riskWindows.set(key, history);
  return { ok: true, retryAfter: 0 };
}

function consumeDailyLimit(key: string, limit: number): { ok: boolean; retryAfter: number; } {
  const now = Date.now();
  compactRiskRuntime(now);
  const history = (riskDailyCounters.get(key) || []).filter(t => now - t < 86400000);
  if (history.length >= limit) {
    const oldest = history[0] || now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((86400000 - (now - oldest)) / 1000)) };
  }
  history.push(now);
  riskDailyCounters.set(key, history);
  return { ok: true, retryAfter: 0 };
}

function normalizeRiskDedupContent(content: string): string {
  return String(content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
}

function riskReportDedupKey(groupId: string, category: ContactRiskCategory, identifier: ParsedContactIdentifier, content: string): string {
  return `report-dedup:${groupId}:${riskKey(category, identifier)}:${normalizeRiskDedupContent(content)}`;
}

function checkRiskReportDedup(groupId: string, category: ContactRiskCategory, identifier: ParsedContactIdentifier, content: string): { ok: boolean; retryAfter: number; key: string; } {
  const key = riskReportDedupKey(groupId, category, identifier, content);
  const hours = getRiskRateLimits().reportDedupHours;
  if (hours <= 0) return { ok: true, retryAfter: 0, key };
  const now = Date.now();
  compactRiskRuntime(now);
  const until = riskReportDedup.get(key) || 0;
  if (until > now) return { ok: false, retryAfter: Math.ceil((until - now) / 1000), key };
  return { ok: true, retryAfter: 0, key };
}

function markRiskReportDedup(key: string): void {
  const hours = getRiskRateLimits().reportDedupHours;
  if (hours <= 0 || !key) return;
  riskReportDedup.set(key, Date.now() + hours * 3600000);
}

function checkRiskQueryGuard(groupId: string, userId: string, category: ContactRiskCategory, identifier: ParsedContactIdentifier): { ok: boolean; reason?: string; } {
  const limits = getRiskRateLimits();
  const user = consumeCooldown(`risk-query-user:${groupId}:${userId}`, limits.queryUserCooldownSeconds);
  if (!user.ok) return { ok: false, reason: `查询过于频繁，请 ${user.retryAfter} 秒后再试。` };
  const group = consumeMinuteLimit(`risk-query-group:${groupId}`, limits.queryGroupRateLimitPerMinute);
  if (!group.ok) return { ok: false, reason: `本群风险查询过于频繁，请稍后再试。` };
  return { ok: true };
}

function checkRiskReportGuard(groupId: string, userId: string, category: ContactRiskCategory, identifier: ParsedContactIdentifier, content: string): { ok: boolean; reason?: string; } {
  const limits = getRiskRateLimits();
  const dedup = checkRiskReportDedup(groupId, category, identifier, content);
  if (!dedup.ok) return { ok: false, reason: '相同账号和内容的举报记录已收录，请勿重复提交。' };
  const user = consumeCooldown(`risk-report-user:${groupId}:${userId}`, limits.reportUserCooldownSeconds);
  if (!user.ok) return { ok: false, reason: `举报过于频繁，请 ${user.retryAfter} 秒后再试。` };
  const group = consumeMinuteLimit(`risk-report-group:${groupId}`, limits.reportGroupRateLimitPerMinute);
  if (!group.ok) return { ok: false, reason: '本群举报提交过于频繁，请稍后再试。' };
  const daily = consumeDailyLimit(`risk-report-daily:${groupId}:${userId}`, limits.reportUserDailyLimit);
  if (!daily.ok) return { ok: false, reason: '今日举报次数已达上限，请明天再试。' };
  markRiskReportDedup(dedup.key);
  return { ok: true };
}

function isValidScammerUrl(url: string): boolean {
  try {
    const sample = String(url || '')
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
}

function normalizeEvidenceText(value: string): string {
  const maxLength = getScammerLimits().maxEvidenceLength;
  const text = String(value || '').replace(/\[CQ:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

interface ParsedContactIdentifier {
  type: ContactIdentifierType;
  value: string;
  display: string;
}

function contactRiskTitle(category: ContactRiskCategory): string {
  return category === 'peer' ? '同行' : '骗子';
}

function contactIdentifierLabel(identifier: ParsedContactIdentifier): string {
  return identifier.type === 'qq' ? `QQ ${identifier.value}` : `微信 ${identifier.value}`;
}

function parseContactIdentifier(input: string): ParsedContactIdentifier | null {
  let raw = String(input || '').trim();
  if (!raw || /\s/.test(raw)) return null;
  const qqPrefix = raw.match(/^qq[:：]?(\d+)$/i);
  if (qqPrefix) raw = qqPrefix[1];
  const wechatPrefix = raw.match(/^(?:微信|wx|weixin)[:：]?(.+)$/i);
  if (wechatPrefix) raw = wechatPrefix[1].trim();
  if (/^\d+$/.test(raw)) {
    if (!/^\d{5,13}$/.test(raw)) return null;
    return { type: 'qq', value: raw, display: `QQ ${raw}` };
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(raw)) return null;
  return { type: 'wechat', value: raw, display: `微信 ${raw}` };
}

function parseRiskQueryCommand(text: string, command: string): { matched: boolean; identifier?: ParsedContactIdentifier; } {
  if (!text.startsWith(command)) return { matched: false };
  const arg = text.slice(command.length).trim();
  return { matched: true, identifier: parseContactIdentifier(arg) || undefined };
}

function parseRiskReportCommand(text: string, command: string): { matched: boolean; identifier?: ParsedContactIdentifier; evidence?: string; } {
  if (!text.startsWith(command)) return { matched: false };
  const rest = text.slice(command.length).trim();
  const match = rest.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) return { matched: true };
  return {
    matched: true,
    identifier: parseContactIdentifier(match[1]) || undefined,
    evidence: normalizeEvidenceText(match[2])
  };
}

function saveLocalContactRiskReport(category: ContactRiskCategory, identifier: ParsedContactIdentifier, content: string, source: string): ContactRiskRecord {
  const limits = getScammerLimits();
  const record = storageAdapter.upsertContactRiskReport({
    category,
    identifierType: identifier.type,
    identifierValue: identifier.value,
    content,
    source,
    maxEvidenceLength: limits.maxEvidenceLength,
    maxRecentReports: limits.maxRecentReports
  });
  storageAdapter.pruneContactRiskRecords(category, limits.maxRecords);
  return record;
}

interface ScammerExternalResult {
  found: boolean;
  count: number;
  message: string;
  reports: string[];
  source: string;
}

function extractScammerReportTexts(data: any): string[] {
  const buckets = [
    ...(Array.isArray(data?.reports) ? data.reports : []),
    ...(Array.isArray(data?.anonymous_reports) ? data.anonymous_reports : []),
    ...(Array.isArray(data?.data?.reports) ? data.data.reports : []),
    ...(Array.isArray(data?.data?.anonymous_reports) ? data.data.anonymous_reports : [])
  ];
  const texts: string[] = [];
  for (const item of buckets) {
    const text = typeof item === 'string'
      ? item
      : String(item?.report_content || item?.content || item?.message || item?.desc || item?.description || '').trim();
    const normalized = normalizeEvidenceText(text);
    if (normalized && !texts.includes(normalized)) texts.push(normalized);
  }
  return texts.slice(0, getScammerLimits().maxRecentReports);
}

function parseScammerExternalResult(data: any, source: string): ScammerExternalResult {
  const reports = extractScammerReportTexts(data);
  const count = Number(data?.count ?? data?.data?.count ?? reports.length) || reports.length;
  const found = data?.found === true || (data?.success === true && (count > 0 || reports.length > 0)) || reports.length > 0;
  const message = String(data?.message || data?.msg || data?.error || (found ? '查询到相关记录' : '未查询到相关记录')).trim();
  return { found, count, message, reports, source };
}

async function queryScammerByEndpoint(endpoint: string, identifier: ParsedContactIdentifier): Promise<ScammerExternalResult> {
  const url = buildScammerQueryUrl(endpoint, identifier);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json,text/plain,*/*'
      }
    });
    const raw = await res.text();
    if (!res.ok) return { found: false, count: 0, message: `HTTP ${res.status}`, reports: [], source: endpoint };
    try {
      return parseScammerExternalResult(JSON.parse(raw.trim()), endpoint);
    } catch {
      return { found: false, count: 0, message: '接口返回非JSON', reports: [], source: endpoint };
    }
  } catch (e: any) {
    return { found: false, count: 0, message: e?.name === 'AbortError' ? '请求超时' : String(e?.message || e), reports: [], source: endpoint };
  } finally {
    clearTimeout(timeout);
  }
}

async function submitExternalScammerReport(identifier: ParsedContactIdentifier, content: string): Promise<{ ok: boolean; message: string; skipped?: boolean; }> {
  const reportUrl = getScammerReportUrl();
  if (!reportUrl) return { ok: false, skipped: true, message: '未配置第三方举报接口' };
  const form = new FormData();
  form.append('scammer_qq', identifier.type === 'qq' ? identifier.value : '');
  form.append('scammer_name', '');
  form.append('scammer_wechat', identifier.type === 'wechat' ? identifier.value : '');
  form.append('scammer_phone', '');
  form.append('scammer_idcard', '');
  form.append('report_content', content);
  form.append('images_base64', '[]');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(reportUrl, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const ok = data ? data.success !== false && data.code !== -1 : true;
    return { ok, message: String(data?.message || data?.msg || data?.error || raw || (ok ? '第三方已接收' : '第三方提交失败')).slice(0, 200) };
  } catch (e: any) {
    return { ok: false, message: e?.name === 'AbortError' ? '请求超时' : String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}

function saveLocalScammerReport(qq: string, content: string, source: string): ScammerRecord {
  const limits = getScammerLimits();
  const record = storageAdapter.upsertScammerReport({
    qq,
    content,
    source,
    maxEvidenceLength: limits.maxEvidenceLength,
    maxRecentReports: limits.maxRecentReports
  });
  storageAdapter.pruneScammerRecords(limits.maxRecords);
  return record;
}

function toBanQueryResult(data: any): BanQueryResult {
  const structuredStatus = String(data?.data?.status || data?.status || '').trim();
  const detailText = mergeUniqueDetail([
    data?.msg,
    data?.data?.banmsg,
    data?.data?.rammsg,
    data?.data?.return,
    data?.data?.time,
    data?.data?.ban_time,
    data?.data?.end_time,
    data?.data?.unban_time,
    data?.data?.left_time,
    data?.source === 'stale' ? '数据来自最近一次成功结果' : ''
  ]);
  if (detailText && isUnavailableMessage(detailText)) {
    return { status: 'unknown', detail: detailText };
  }
  if (structuredStatus === '封禁' || structuredStatus.toLowerCase() === 'banned') {
    return { status: 'banned', detail: detailText || '账号封禁中' };
  }
  if (structuredStatus === '正常' || ['safe', 'normal', 'unbanned'].includes(structuredStatus.toLowerCase())) {
    return { status: 'safe', detail: detailText || '账号状态正常' };
  }
  if (typeof data?.code === 'number') {
    if ([201, 202, 203, 204, 401, 402, 403, 405, 408, 409, 410, 412, 423, 425, 429].includes(data.code)) {
      return { status: 'unknown', detail: detailText || `接口返回状态码 ${data.code}` };
    }
    if (data.code >= 500) return { status: 'unknown', detail: detailText || `接口返回状态码 ${data.code}` };
    if (data.code === 404) return { status: 'safe', detail: '账号状态正常' };
    if (data.code === 200) {
      const statusText = `${data?.msg || ''} ${data?.data?.banmsg || ''} ${data?.data?.rammsg || ''} ${data?.data?.return || ''}`.replace(/\s+/g, '');
      const unbanned = SAFE_CONFIRMED_PATTERNS.test(statusText);
      const banned = BAN_CONFIRMED_PATTERNS.test(statusText) && !unbanned;
      if (banned) return { status: 'banned', detail: detailText || '接口未返回更多时间信息' };
      if (unbanned) return { status: 'safe', detail: '账号状态正常' };
      return { status: 'unknown', detail: detailText || '接口返回状态不明确' };
    }
    return { status: 'unknown', detail: detailText || `接口返回状态码 ${data.code}` };
  }
  if (typeof data?.ban === 'boolean') {
    if (detailText && isUnavailableMessage(detailText)) return { status: 'unknown', detail: detailText };
    if (data.ban) return { status: 'banned', detail: detailText || (typeof data?.msg === 'string' ? data.msg : '接口未返回更多时间信息') };
    return { status: 'safe', detail: '账号状态正常' };
  }
  const msg = typeof data?.msg === 'string' ? data.msg : '';
  if (msg) {
    const normalized = msg.replace(/\s+/g, '');
    if (isUnavailableMessage(normalized)) return { status: 'unknown', detail: detailText || msg };
    const unbanned = SAFE_CONFIRMED_PATTERNS.test(normalized);
    const banned = BAN_CONFIRMED_PATTERNS.test(normalized) && !unbanned;
    if (banned) return { status: 'banned', detail: detailText || msg };
    if (unbanned) return { status: 'safe', detail: '账号状态正常' };
    return { status: 'unknown', detail: detailText || msg };
  }
  return { status: 'unknown', detail: '接口返回数据结构无法识别' };
}

async function queryBanByEndpoint(endpoint: string, qq: string): Promise<BanQueryAttempt> {
  const url = buildBanQueryUrl(endpoint, qq);
  const controller = new AbortController();
  const timeoutMs = endpoint.includes('/api/v2/lolban')
    ? Math.max(10_000, resolveLolQueryTimeoutMs())
    : 8000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*'
      }
    });
    if (!res.ok) return { result: { status: 'unknown', detail: `HTTP ${res.status}` }, source: endpoint };
    const raw = await res.text();
    const cleaned = raw.replace(/\u0000+$/g, '').trim();
    let data: any;
    try {
      data = JSON.parse(cleaned);
    } catch {
      return { result: { status: 'unknown', detail: '接口返回非JSON或格式异常' }, source: endpoint };
    }
    return { result: toBanQueryResult(data), source: endpoint };
  } catch (e: any) {
    return { result: { status: 'unknown', detail: e?.name === 'AbortError' ? '请求超时' : String(e?.message || e) }, source: endpoint };
  } finally {
    clearTimeout(timeout);
  }
}

async function canUseInviteQuery(groupId: string, userId: string): Promise<boolean> {
  const permission = getGroupSettings(groupId).inviteQueryPermission || 'all';
  if (permission === 'all') return true;
  if (permission === 'owner') return authStateService.isOwner(userId);
  if (authStateService.isOwner(userId)) return true;
  return isAdminOrOwner(groupId, userId);
}

async function allowGroupFeature(input: CommandExecutionContext, featureKey: string, disabledMessage: string): Promise<boolean> {
  const gate = await checkFeatureGate({
    featureType: 'query',
    featureKey,
    groupId: input.groupId,
    userId: input.userId,
    messageType: 'group',
    source: 'builtin',
    scope: 'group',
    requiresLicense: true,
    permission: 'all',
    passiveReply: false,
    botSend: true
  });
  if (gate.allowed) return true;
  if (gate.reason === 'bot_role_query_blocked' || gate.reason === 'bot_role_qa_blocked') return false;
  if (gate.reason === 'master_disabled' || gate.reason === 'silent_no_bot_send' || gate.reason === 'active_reply_disabled') return false;
  await sendGroupScene(input.groupId, 'feature_disabled', disabledMessage);
  return false;
}

export async function executeInteractionCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, raw, ctx } = input;
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;
  const qaRoleBlock = shouldBlockByBotRole({ source: 'interaction_service', rawMessage: text, featureType: 'query' });
  if (isQaOnlyBotRole() && (isQueryRoleInteractionText(text) || qaRoleBlock.blocked)) {
    const block = qaRoleBlock.blocked ? qaRoleBlock : shouldBlockByBotRole({ source: 'interaction_service', rawMessage: text, intent: 'query_like', featureType: 'query' });
    loggingStateService.info(block.logLine || `bot_role_blocked role=qa intent=query_like rawMessage=${text} source=interaction_service`);
    return true;
  }
  if (text.startsWith('设置骗子查询接口')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const url = text.replace('设置骗子查询接口', '').trim();
    if (!url || !isValidScammerUrl(url)) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置骗子查询接口 <URL模板>，支持 {qq}/{wechat}/{account}/{identifier}/{type}', { example: '设置骗子查询接口 https://example.com/search?account={account}&type={type}' });
      return true;
    }
    getConfig().scammerQueryUrls = [url];
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '骗子查询接口已设置');
    return true;
  }
  if (text.startsWith('添加骗子查询接口')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const url = text.replace('添加骗子查询接口', '').trim();
    if (!url || !isValidScammerUrl(url)) {
      await sendGroupScene(groupId, 'command_format_error', '格式：添加骗子查询接口 <URL模板>，支持 {qq}/{wechat}/{account}/{identifier}/{type}', { example: '添加骗子查询接口 https://example.com/search?account={account}&type={type}' });
      return true;
    }
    const list = collectScammerQueryEndpoints();
    if (!list.includes(url)) list.push(url);
    getConfig().scammerQueryUrls = list;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已添加骗子查询接口，当前共 ${list.length} 条`);
    return true;
  }
  if (text.startsWith('删除骗子查询接口')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const arg = text.replace('删除骗子查询接口', '').trim();
    const configuredUrls = getConfig().scammerQueryUrls;
    const list = Array.isArray(configuredUrls) ? configuredUrls.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (!arg || !list.length) {
      await sendGroupScene(groupId, 'command_format_error', '格式：删除骗子查询接口 <序号或URL>', { example: '删除骗子查询接口 1' });
      return true;
    }
    let removed = '';
    if (/^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1;
      if (idx < 0 || idx >= list.length) {
        await sendGroupScene(groupId, 'invalid_range', `序号超出范围，当前范围 1-${list.length}`);
        return true;
      }
      removed = list[idx];
      list.splice(idx, 1);
    } else {
      const idx = list.indexOf(arg);
      if (idx < 0) {
        await sendGroupScene(groupId, 'not_found', '未找到对应骗子查询接口');
        return true;
      }
      removed = list[idx];
      list.splice(idx, 1);
    }
    getConfig().scammerQueryUrls = list;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已删除骗子查询接口：${removed}`);
    return true;
  }
  if (text.startsWith('设置骗子举报接口')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const url = text.replace('设置骗子举报接口', '').trim();
    if (!url || !isValidScammerUrl(url)) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置骗子举报接口 <URL>', { example: '设置骗子举报接口 https://example.com/report' });
      return true;
    }
    getConfig().scammerReportUrl = url;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '骗子举报接口已设置');
    return true;
  }
  if (text.startsWith('设置骗子库限制')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const parts = text.replace('设置骗子库限制', '').trim().split(/\s+/).filter(Boolean);
    const maxRecords = Number(parts[0]);
    const maxEvidence = Number(parts[1]);
    const maxRecent = Number(parts[2]);
    if (!Number.isFinite(maxRecords) || !Number.isFinite(maxEvidence) || !Number.isFinite(maxRecent)) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置骗子库限制 <最大记录数> <单条证据字数> <每账号最近证据条数>', { example: '设置骗子库限制 5000 500 10' });
      return true;
    }
    getConfig().scammerMaxRecords = Math.max(100, Math.min(100000, Math.floor(maxRecords)));
    getConfig().scammerMaxEvidenceLength = Math.max(50, Math.min(5000, Math.floor(maxEvidence)));
    getConfig().scammerMaxRecentReportsPerQQ = Math.max(1, Math.min(50, Math.floor(maxRecent)));
    saveConfig(ctx);
    storageAdapter.pruneScammerRecords(getScammerLimits().maxRecords);
    await sendGroupScene(groupId, 'action_success', `骗子库限制已更新：最大记录 ${getConfig().scammerMaxRecords}，证据 ${getConfig().scammerMaxEvidenceLength} 字，每账号 ${getConfig().scammerMaxRecentReportsPerQQ} 条`);
    return true;
  }
  if (text.startsWith('设置骗子风控')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const parts = text.replace('设置骗子风控', '').trim().split(/\s+/).filter(Boolean).map(Number);
    if (parts.length < 7 || parts.some(v => !Number.isFinite(v))) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置骗子风控 <查询同用户冷却秒> <查询群每分钟> <查询缓存秒> <举报同用户冷却秒> <举报群每分钟> <每人每日举报> <重复内容去重小时>', { example: '设置骗子风控 10 20 300 60 5 20 24' });
      return true;
    }
    getConfig().scammerQueryUserCooldownSeconds = Math.max(0, Math.min(3600, Math.floor(parts[0])));
    getConfig().scammerQueryGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Math.floor(parts[1])));
    getConfig().scammerQueryCacheSeconds = Math.max(0, Math.min(86400, Math.floor(parts[2])));
    getConfig().scammerReportUserCooldownSeconds = Math.max(0, Math.min(86400, Math.floor(parts[3])));
    getConfig().scammerReportGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Math.floor(parts[4])));
    getConfig().scammerReportUserDailyLimit = Math.max(1, Math.min(1000, Math.floor(parts[5])));
    getConfig().scammerReportDedupHours = Math.max(0, Math.min(720, Math.floor(parts[6])));
    saveConfig(ctx);
    const rateLimits = getRiskRateLimits();
    await sendGroupScene(groupId, 'action_success', `骗子风控已更新：查询 ${rateLimits.queryUserCooldownSeconds}s/${rateLimits.queryGroupRateLimitPerMinute}次每分钟/缓存${rateLimits.queryCacheSeconds}s；举报 ${rateLimits.reportUserCooldownSeconds}s/${rateLimits.reportGroupRateLimitPerMinute}次每分钟/每日${rateLimits.reportUserDailyLimit}次/去重${rateLimits.reportDedupHours}小时`);
    return true;
  }
  if (text === '骗子接口状态') {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const queryUrls = collectScammerQueryEndpoints();
    const limits = getScammerLimits();
    const rateLimits = getRiskRateLimits();
    const lines = [
      '骗子接口状态',
      `查询接口：${queryUrls.length} 条`,
      ...queryUrls.map((url, idx) => `${idx + 1}. ${url}`),
      `举报接口：${getScammerReportUrl() || '未配置'}`,
      `本地库限制：最大记录 ${limits.maxRecords}，证据 ${limits.maxEvidenceLength} 字，每账号最近 ${limits.maxRecentReports} 条`,
      `查询风控：同用户 ${rateLimits.queryUserCooldownSeconds}s 冷却，本群每分钟 ${rateLimits.queryGroupRateLimitPerMinute} 次，缓存 ${rateLimits.queryCacheSeconds}s`,
      `举报风控：同用户 ${rateLimits.reportUserCooldownSeconds}s 冷却，本群每分钟 ${rateLimits.reportGroupRateLimitPerMinute} 次，每人每天 ${rateLimits.reportUserDailyLimit} 次，重复内容 ${rateLimits.reportDedupHours} 小时去重`
    ];
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }
  for (const queryDef of [
    { command: '查骗子', category: 'scammer' as ContactRiskCategory },
    { command: '查同行', category: 'peer' as ContactRiskCategory }
  ]) {
    const parsed = parseRiskQueryCommand(text, queryDef.command);
    if (!parsed.matched) continue;
    const featureKey = queryDef.category === 'peer' ? 'query.peer' : 'query.scammer';
    if (!await allowGroupFeature(input, featureKey, '本群风险查询功能已关闭')) return true;
    if (!parsed.identifier) {
      await sendGroupScene(groupId, 'command_format_error', `格式：${queryDef.command}<QQ或微信号>`, { example: `${queryDef.command}123456` });
      return true;
    }
    const identifier = parsed.identifier;
    const rateCheck = checkAndConsumeQueryRate(groupId, queryDef.command);
    if (!rateCheck.ok) {
      await sendQueryRateLimitNotice(groupId, rateCheck);
      return true;
    }
    let local = storageAdapter.getContactRiskRecord(queryDef.category, identifier.type, identifier.value);
    if (!local && queryDef.category === 'scammer' && identifier.type === 'qq') {
      const legacy = storageAdapter.getScammerRecord(identifier.value);
      if (legacy) {
        local = {
          category: 'scammer',
          identifierType: 'qq',
          identifierValue: legacy.qq,
          reportCount: legacy.reportCount,
          lastReportContent: legacy.lastReportContent,
          recentReports: legacy.recentReports,
          sources: legacy.sources,
          firstReportedAt: legacy.firstReportedAt,
          lastReportedAt: legacy.lastReportedAt,
          lastCheckedAt: legacy.lastCheckedAt,
          updatedAt: legacy.updatedAt
        };
      }
    }
    if (local) storageAdapter.touchContactRiskChecked(queryDef.category, identifier.type, identifier.value);
    const externalResults: ScammerExternalResult[] = [];
    if (queryDef.category === 'scammer') {
      const queryCacheSeconds = getRiskRateLimits().queryCacheSeconds;
      const cacheKey = `external-query:${riskKey('scammer', identifier)}`;
      const cached = riskQueryCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        externalResults.push(...cached.results);
      } else {
        for (const endpoint of collectScammerQueryEndpoints()) {
          const result = await queryScammerByEndpoint(endpoint, identifier);
          externalResults.push(result);
          if (result.found) {
            for (const content of result.reports.length ? result.reports : [result.message]) {
              saveLocalContactRiskReport('scammer', identifier, content, result.source);
            }
          }
        }
        if (queryCacheSeconds > 0 && externalResults.length) {
          riskQueryCache.set(cacheKey, { expiresAt: Date.now() + queryCacheSeconds * 1000, results: externalResults });
        }
      }
      local = storageAdapter.getContactRiskRecord('scammer', identifier.type, identifier.value) || local;
    }
    const externalFound = externalResults.filter(item => item.found);
    const lines = [`${queryDef.category === 'peer' ? '同行风险查询' : '风险查询'}：${contactIdentifierLabel(identifier)}`];
    if (local) {
      lines.push(`本地库：查询到举报记录，累计 ${local.reportCount} 次`);
      if (local.lastReportContent) lines.push(`最近举报内容：${local.lastReportContent}`);
    } else {
      lines.push('本地库：暂无举报记录');
    }
    if (queryDef.category === 'scammer') {
      if (externalResults.length) {
        lines.push(`第三方：${externalFound.length ? `查询到相关记录，命中 ${externalFound.length} 个接口` : '暂未查询到相关记录'}`);
        for (const result of externalResults.slice(0, 3)) {
          lines.push(`- ${result.message}${result.count ? ` (${result.count})` : ''}`);
        }
      } else {
        lines.push('第三方：未配置查询接口，仅使用本地库');
      }
    }
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }

  for (const reportDef of [
    { command: '举报骗子', category: 'scammer' as ContactRiskCategory },
    { command: '举报同行', category: 'peer' as ContactRiskCategory }
  ]) {
    const parsed = parseRiskReportCommand(text, reportDef.command);
    if (!parsed.matched) continue;
    if (!parsed.identifier || !parsed.evidence) {
      await sendGroupScene(groupId, 'command_format_error', `格式：${reportDef.command}<QQ或微信号> 描述`, { example: `${reportDef.command}123456 收款后拉黑，有聊天记录` });
      return true;
    }
    const reportFeatureKey = reportDef.category === 'peer' ? 'query.peer' : 'query.scammer';
    const reportDisabledMessage = reportDef.category === 'peer' ? '本群已关闭同行举报功能' : '本群已关闭骗子举报功能';
    if (!await allowGroupFeature(input, reportFeatureKey, reportDisabledMessage)) return true;
    const guard = checkRiskReportGuard(groupId, userId, reportDef.category, parsed.identifier, parsed.evidence);
    if (!guard.ok) {
      await sendGroupScene(groupId, 'invalid_range', guard.reason || '举报提交过于频繁，请稍后再试。');
      return true;
    }
    const local = saveLocalContactRiskReport(reportDef.category, parsed.identifier, parsed.evidence, `local:${groupId}`);
    const lines = [
      `已记录${reportDef.category === 'peer' ? '同行风险' : '风险'}举报：${contactIdentifierLabel(parsed.identifier)}`,
      `本地库累计：${local.reportCount} 次举报记录`
    ];
    if (reportDef.category === 'scammer') {
      const external = await submitExternalScammerReport(parsed.identifier, parsed.evidence);
      lines.push(`第三方提交：${external.ok ? '成功' : '失败'}，${external.message}`);
      lines.push(external.skipped ? '请主人先配置骗子举报接口；本地库已保存。' : (external.ok ? '后续查询会同时使用本地库和第三方接口。' : '第三方不可用时，本地库仍可继续查询。'));
    } else {
      lines.push('同行库完全由本地数据库支持。');
    }
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }
  const inviteByMatch = text.match(/^查邀请(\d{5,13})$/);
  if (inviteByMatch) {
    if (getGroupSettings(groupId).disableInvite) { await sendGroupScene(groupId, 'feature_disabled', '本群邀请统计已关闭'); return true; }
    if (!await canUseInviteQuery(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '当前仅限管理员或主人查询邀请关系'); return true; }
    const targetQQ = inviteByMatch[1];
    const invitedList = queryInvitedBy(groupId, targetQQ);
    if (!invitedList.length) {
      await sendGroupScene(groupId, 'list_empty', `${targetQQ} 在本群暂无邀请记录`);
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `${targetQQ} 在本群邀请了：\n${invitedList.join('\n')}`);
    return true;
  }
  const inviteFromMatch = text.match(/^查来源(\d{5,13})$/);
  if (inviteFromMatch) {
    if (getGroupSettings(groupId).disableInvite) { await sendGroupScene(groupId, 'feature_disabled', '本群邀请统计已关闭'); return true; }
    if (!await canUseInviteQuery(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '当前仅限管理员或主人查询邀请关系'); return true; }
    const targetQQ = inviteFromMatch[1];
    const inviterQQ = queryInviterOf(groupId, targetQQ);
    if (!inviterQQ) {
      await sendGroupScene(groupId, 'not_found', `${targetQQ} 在本群暂无可用邀请来源记录`);
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `${targetQQ} 是由 ${inviterQQ} 邀请进群`);
    return true;
  }

  if (text === '签到') {
    if (getGroupSettings(groupId).disableSignin) { await sendGroupScene(groupId, 'feature_disabled', '本群签到功能已关闭'); return true; }
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (userSignin.lastSignin >= today) {
      await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ' 你今天已经签到过了，明天再来吧！' } }
      ], vars: { user: userId }, force: true, applyTemplate: true });
      return true;
    }
    const yesterday = today - 86400000;
    if (userSignin.lastSignin >= yesterday && userSignin.lastSignin < today) userSignin.days++;
    else userSignin.days = 1;
    const settings = getGroupSettings(groupId);
    const min = settings.signinMin || 10;
    const max = settings.signinMax || 50;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    const bonus = Math.min(userSignin.days, 10);
    const points = base + bonus;
    userSignin.points += points;
    userSignin.lastSignin = Date.now();
    await groupguardRepository.updateSignin(groupId, userId, userSignin);
    await send({ channel: 'group', targetId: groupId, scene: 'signin_success', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 签到成功！\n获得积分：${points}\n当前积分：${userSignin.points}\n连续签到：${userSignin.days}天` } }
    ], vars: { points, total: userSignin.points, days: userSignin.days }, force: true, applyTemplate: true });
    return true;
  }
  if (text === '签到榜') {
    if (getGroupSettings(groupId).disableSignin) { await sendGroupScene(groupId, 'feature_disabled', '本群签到功能已关闭'); return true; }
    const data = await groupguardRepository.getAllSignin(groupId);
    if (!Object.keys(data).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无签到数据'); return true; }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const list = Object.entries(data).filter(([_, v]) => v.lastSignin >= today).sort((a, b) => b[1].lastSignin - a[1].lastSignin).slice(0, 10);
    if (!list.length) { await sendGroupScene(groupId, 'list_empty', '今天还没有人签到哦'); return true; }
    const content = list.map((item, i) => `${i + 1}. ${item[0]} (${new Date(item[1].lastSignin).toLocaleTimeString()})`).join('\n');
    await sendGroupScene(groupId, 'raw_text', `📅 今日签到榜\n${content}`);
    return true;
  }
  if (text === '我的积分') {
    if (getGroupSettings(groupId).disableSignin) { await sendGroupScene(groupId, 'feature_disabled', '本群积分功能已关闭'); return true; }
    const data = await groupguardRepository.getSignin(groupId, userId);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你的当前积分：${data ? data.points : 0}` } }], vars: { user: userId }, force: true, applyTemplate: true });
    return true;
  }
  if (text.startsWith('查封号')) {
    if (!await allowGroupFeature(input, 'query.lol_ban', '本群已关闭查封号指令')) return true;
    if (!isLolCommandEnabled(groupId, 'banQuery')) {
      await sendGroupScene(groupId, 'feature_disabled', '本群已关闭查封号指令');
      return true;
    }
    const rateCheck = checkAndConsumeQueryRate(groupId, '查封号');
    if (!rateCheck.ok) {
      await sendQueryRateLimitNotice(groupId, rateCheck);
      return true;
    }
    const rest = text.slice(3).trim();
    let targetQQ = rest;
    if (!targetQQ || !/^\d+$/.test(targetQQ)) targetQQ = getTarget(raw, rest) || '';
    if (!targetQQ) {
      await sendGroupScene(groupId, 'command_format_error', '请指定要查询的QQ号，例如：查封号 12345 或 查封号 @某人', { example: '查封号 123456789' });
      return true;
    }
    if (!/^\d{5,11}$/.test(targetQQ)) {
      await sendGroupScene(groupId, 'invalid_range', 'QQ号格式错误 (需5-11位数字)');
      return true;
    }
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    const pureTextMode = getConfig().global?.disableReplyTemplate === true;
    const banTexts = ['真是活该，直接进小黑屋了~', '这波操作属实离谱，封得明明白白。', '翻车现场，系统都看不下去了。', '号子已经躺平，连申诉都得排队。', '风控一锤定音，这把寄得很彻底。', '这号现在主打一个“只能看不能玩”。'];
    const unknownTexts = ['接口今天有点小情绪，稍后再查一次。', '这波网络不太给面子，过会儿再试试。', '数据源在摸鱼，建议晚点重试。', '查询通道有点拥挤，等等会更稳。'];
    const sendResult = async (content: string, status: BanStatus) => {
      await sendBanQueryResult(groupId, userId, targetQQ, status, content);
    };
    try {
      const endpoints = collectBanQueryEndpoints();
      let attempt: BanQueryAttempt | null = null;
      for (const endpoint of endpoints) {
        const current = await queryBanByEndpoint(endpoint, targetQQ);
        attempt = current;
        if (current.result.status !== 'unknown') break;
      }
      if (!attempt) {
        const tail = pureTextMode ? '' : `，${pick(unknownTexts)}`;
        await sendResult(`暂时无法确认是否封号，详情：没有可用查询接口${tail}`, 'unknown');
        return true;
      }
      if (attempt.result.status === 'banned') {
        const tail = pureTextMode ? '' : `，${pick(banTexts)}`;
        await sendResult(`这号被封了，详情：${attempt.result.detail || '接口未返回更多时间信息'}${tail}`, 'banned');
      } else if (attempt.result.status === 'safe') {
        await sendResult(`这号未封，${attempt.result.detail || '账号状态正常'}`, 'safe');
      } else {
        const tail = pureTextMode ? '' : `，${pick(unknownTexts)}`;
        await sendResult(`暂时无法确认是否封号，详情：${attempt.result.detail || '接口返回异常'}${tail}`, 'unknown');
      }
    } catch (e) {
      loggingStateService.error(`查询封号失败: ${e}`);
      const tail = pureTextMode ? '' : `，${pick(unknownTexts)}`;
      await sendResult(`暂时无法确认是否封号${tail}`, 'unknown');
    }
    return true;
  }
  if (text.startsWith('查战绩')) {
    if (!await allowGroupFeature(input, 'query.lol_battle', '本群已关闭查战绩指令')) return true;
    if (!isLolCommandEnabled(groupId, 'battleQuery')) {
      await sendGroupScene(groupId, 'feature_disabled', '本群已关闭查战绩指令');
      return true;
    }
    const rateCheck = checkAndConsumeQueryRate(groupId, '查战绩');
    if (!rateCheck.ok) {
      await sendQueryRateLimitNotice(groupId, rateCheck);
      return true;
    }
    const rest = text.replace('查战绩', '').trim();
    const parsed = parseLolQueryInput(rest);
    if (!parsed.ok) {
      await sendGroupScene(groupId, 'command_format_error', parsed.reason, { example: '查战绩张三#12345' });
      return true;
    }
    const baseUrl = resolveLolApiBaseUrl();
    if (!baseUrl) {
      await sendGroupScene(groupId, 'not_found', '未配置 LOL API Base，请联系机器人主人完成内网服务地址配置');
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `正在为您查询${parsed.playerId}${parsed.region ? parsed.region : ''}，请耐心等待`);
    runDetachedQuery('查战绩', async () => {
      const outputFormat = resolveQueryOutputFormat(groupId, 'lol_battle', normalizeQueryOutputFormat(getGroupSettings(groupId).lolQueryOutputFormat, 'forward'));
      const wrapperMode = resolveQueryWrapperMode('lol_battle');
      const selfId = String((event as any).self_id || userId);

      if (outputFormat === 'image' && wrapperMode === 'global') {
        const imgUrl = buildCrossQueryUrl(baseUrl, parsed.playerId, parsed.region, 'image');
        if (await sendLolQueryImage(groupId, imgUrl)) {
          return;
        }
      }

      const crossUrl = buildCrossQueryUrl(baseUrl, parsed.playerId, parsed.region, 'pretty');
      const crossRes = await fetchJsonWithTimeout(crossUrl, resolveLolQueryTimeoutMs());
      if (!crossRes.ok) {
        await sendGroupSceneDirect(groupId, 'raw_text', `⚠️ 跨区战绩接口不可用：${crossRes.error}`);
        return;
      }
      const pages = buildCrossPrettyPages(parsed.playerId, parsed.region, crossRes.data as CrossPrettyData, '');

      await sendFormattedQueryPagesDirect(groupId, selfId, '🎮 战绩查询', pages, outputFormat, wrapperMode);
    });
    return true;
  }

  if (text.startsWith('查合集')) {
    if (!await allowGroupFeature(input, 'query.lol_shard', '本群已关闭查合集指令')) return true;
    const rest = text.replace('查合集', '').trim();
    if (!rest) {
      await sendGroupScene(groupId, 'command_format_error', '请输入：查合集 亚索', { example: '查合集 亚索' });
      return true;
    }
    const rateCheck = checkAndConsumeQueryRate(groupId, '查合集');
    if (!rateCheck.ok) {
      await sendQueryRateLimitNotice(groupId, rateCheck);
      return true;
    }
    const urls = resolveShardDataUrls(groupId);
    if (!urls.ok) {
      await sendGroupScene(groupId, 'raw_text', urls.reason);
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `正在查询 ${rest} 的合集数据，请稍等`);
    runDetachedQuery('查合集', async () => {
      const loaded = await loadShardData(urls.dataUrl, urls.heroUrl);
      if (!loaded.ok) {
        await sendGroupSceneDirect(groupId, 'raw_text', loaded.error);
        return;
      }
      const hero = findChampionByQuery(rest, loaded.champions, loaded.shards);
      if (!hero) {
        await sendGroupSceneDirect(groupId, 'not_found', `未找到英雄：${rest}`);
        return;
      }
      const stat = loaded.shards[hero.alias];
      if (!stat) {
        await sendGroupSceneDirect(groupId, 'not_found', `暂无 ${hero.title || hero.alias} 的合集数据`);
        return;
      }
      if (urls.outputFormat === 'image' && urls.wrapperMode === 'global' && urls.imageTemplate) {
        const imageUrl = buildShardImageUrl(urls.imageTemplate, hero, rest);
        const probe = await probeImageUrlWithTimeout(imageUrl, resolveLolQueryTimeoutMs());
        if (probe.ok) {
          try {
            await sendGroupSegmentsDirect(groupId, [
              { type: 'image', data: { file: imageUrl } }
            ]);
            return;
          } catch (e: any) {
            loggingStateService.warn(`合集图片发送失败，降级合并转发: ${String(e?.message || e)}`);
          }
        } else {
          loggingStateService.warn(`合集图片接口不可用，降级合并转发: ${probe.error}`);
        }
      }
      const pages = buildShardQueryPages(hero, stat);
      const selfId = String((event as any).self_id || userId);
      await sendFormattedQueryPagesDirect(groupId, selfId, '📦 合集查询', pages, urls.outputFormat, urls.wrapperMode);
    });
    return true;
  }

  if (text.startsWith('海符榜')) {
    if (!await allowGroupFeature(input, 'query.lol_aram_augments', '本群已关闭海符榜指令')) return true;
    const rest = text.replace('海符榜', '').trim();
    if (!rest) {
      await sendGroupScene(groupId, 'command_format_error', '请输入：海符榜 亚索', { example: '海符榜 亚索' });
      return true;
    }
    const rateCheck = checkAndConsumeQueryRate(groupId, '海符榜');
    if (!rateCheck.ok) {
      await sendQueryRateLimitNotice(groupId, rateCheck);
      return true;
    }
    const baseUrl = resolveLolApiBaseUrl();
    if (!baseUrl) {
      await sendGroupScene(groupId, 'not_found', '未配置 LOL API Base，请联系机器人主人完成内网服务地址配置');
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `正在查询 ${rest} 的海克斯大乱斗强化符文，请稍等`);
    runDetachedQuery('海符榜', async () => {
      const imageUrl = buildAramAugmentImageUrl(baseUrl, rest);
      if (await sendLolQueryImage(groupId, imageUrl)) {
        return;
      }
      const jsonRes = await fetchJsonWithTimeout(buildAramAugmentJsonUrl(baseUrl, rest), resolveLolQueryTimeoutMs());
      if (!jsonRes.ok) {
        await sendGroupSceneDirect(groupId, 'raw_text', `海符榜查询失败：${jsonRes.error}`);
        return;
      }
      const pages = buildAramAugmentPages(jsonRes.data, rest);
      const selfId = String((event as any).self_id || userId);
      const forwarded = await sendForwardTextPagesDirect(groupId, selfId, '🧬 海符榜', pages);
      if (!forwarded) {
        await sendGroupSceneDirect(groupId, 'raw_text', pages.join('\n\n'));
      }
    });
    return true;
  }

  if (text.startsWith('设置封号主接口')) {
    if (!authStateService.isOwner(userId)) return true;
    const url = text.replace('设置封号主接口', '').trim();
    if (!url) {
      await sendGroupScene(groupId, 'command_format_error', '请提供接口地址，例如：设置封号主接口 https://example.com/ban/{qq}', { example: '设置封号主接口 https://example.com/ban/{qq}' });
      return true;
    }
    try {
      void new URL(url.includes('{qq}') ? url.replace('{qq}', '123456') : url);
    } catch {
      await sendGroupScene(groupId, 'invalid_range', '接口地址格式无效，请提供完整的 http/https 地址');
      return true;
    }
    getConfig().lolBanPrimaryUrl = url;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '封号主接口已更新');
    return true;
  }
  if (text.startsWith('设置封号接口配置')) {
    if (!authStateService.isOwner(userId)) return true;
    const payload = text.replace('设置封号接口配置', '').trim();
    if (!payload) {
      await sendGroupScene(groupId, 'command_format_error', '请提供JSON配置，例如：设置封号接口配置 {"primary":"https://example.com/ban/{qq}","backups":["https://a.com/ban/{qq}"]}', { example: '设置封号接口配置 {"primary":"https://example.com/ban/{qq}","backups":["https://a.com/ban/{qq}"]}' });
      return true;
    }
    try {
      const cfg = JSON.parse(payload) as any;
      const nextPrimaryRaw = String(cfg?.primary ?? cfg?.lolBanPrimaryUrl ?? '').trim();
      const nextBackupsRaw = Array.isArray(cfg?.backups)
        ? cfg.backups
        : Array.isArray(cfg?.lolBanBackupUrls) ? cfg.lolBanBackupUrls : [];
      if (!nextPrimaryRaw) {
        await sendGroupScene(groupId, 'invalid_range', 'JSON中缺少 primary 字段');
        return true;
      }
      void new URL(nextPrimaryRaw.includes('{qq}') ? nextPrimaryRaw.replace('{qq}', '123456') : nextPrimaryRaw);
      const nextBackups = nextBackupsRaw
        .map((v: any) => String(v || '').trim())
        .filter(Boolean);
      for (const u of nextBackups) {
        void new URL(u.includes('{qq}') ? u.replace('{qq}', '123456') : u);
      }
      getConfig().lolBanPrimaryUrl = nextPrimaryRaw;
      getConfig().lolBanBackupUrls = Array.from(new Set(nextBackups));
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `封号接口配置已更新（主接口1条，备用${nextBackups.length}条）`);
    } catch {
      await sendGroupScene(groupId, 'invalid_range', 'JSON格式或接口地址无效，请检查后重试');
    }
    return true;
  }
  if (text.startsWith('删除封号备用接口')) {
    if (!authStateService.isOwner(userId)) return true;
    const arg = text.replace('删除封号备用接口', '').trim();
    if (!arg) {
      await sendGroupScene(groupId, 'command_format_error', '请提供要删除的接口地址或序号，例如：删除封号备用接口 1', { example: '删除封号备用接口 1' });
      return true;
    }
    const configuredBackups = getConfig().lolBanBackupUrls;
    const list = Array.isArray(configuredBackups) ? configuredBackups.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (!list.length) {
      await sendGroupScene(groupId, 'list_empty', '当前没有封号备用接口');
      return true;
    }
    let removed = '';
    if (/^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1;
      if (idx < 0 || idx >= list.length) {
        await sendGroupScene(groupId, 'invalid_range', `序号超出范围，当前范围 1-${list.length}`);
        return true;
      }
      removed = list[idx];
      list.splice(idx, 1);
    } else {
      const idx = list.findIndex(v => v === arg);
      if (idx < 0) {
        await sendGroupScene(groupId, 'not_found', '未找到对应接口地址');
        return true;
      }
      removed = list[idx];
      list.splice(idx, 1);
    }
    getConfig().lolBanBackupUrls = list;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已删除备用接口：${removed}`);
    return true;
  }
  if (text === '封号接口列表') {
    if (!authStateService.isOwner(userId)) return true;
    const localBase = resolveLolApiBaseUrl();
    const primary = localBase ? `${localBase}/api/v2/lolban` : '（未配置 LOL API Base）';
    const legacyPrimary = (getConfig().lolBanPrimaryUrl || '').trim();
    const configuredBackups = getConfig().lolBanBackupUrls;
    const backups = Array.isArray(configuredBackups) ? configuredBackups.map(v => String(v || '').trim()).filter(Boolean) : [];
    const fallbacks = [legacyPrimary, ...backups].filter(Boolean);
    const lines = [`统一主接口：${primary}`, '', '兼容备用接口列表：'];
    if (!fallbacks.length) lines.push('（空）');
    else fallbacks.forEach((url, idx) => lines.push(`${idx + 1}. ${url}`));
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }
  if (text.startsWith('设置战绩接口')) {
    if (!authStateService.isOwner(userId)) return true;
    const rawUrl = text.replace('设置战绩接口', '').trim();
    if (!rawUrl) {
      await sendGroupScene(groupId, 'command_format_error', '请提供接口根地址，例如：设置战绩接口 http://192.168.x.x:5001', { example: '设置战绩接口 http://192.168.1.10:5001' });
      return true;
    }
    try {
      const parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        await sendGroupScene(groupId, 'invalid_range', '仅支持 http/https 地址');
        return true;
      }
      getConfig().lolApiBaseUrl = normalizeUrlBase(parsedUrl.toString());
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `战绩接口已更新为：${getConfig().lolApiBaseUrl}`);
    } catch {
      await sendGroupScene(groupId, 'invalid_range', '接口地址格式无效，请提供完整 URL');
    }
    return true;
  }
  if (text === '战绩接口状态') {
    if (!authStateService.isOwner(userId)) return true;
    const current = resolveLolApiBaseUrl();
    const lines = [
      '战绩查询接口状态',
      `当前接口：${current}`,
      '',
      '可用命令：',
      '1) 设置战绩接口 http://192.168.1.10:5001',
      '2) 查战绩张三#12345'
    ];
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }
  if (text.startsWith('设置战绩全局开关')) {
    if (!authStateService.isOwner(userId)) return true;
    const arg = text.replace('设置战绩全局开关', '').trim();
    const enabled = toOnOff(arg);
    if (enabled === null) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置战绩全局开关 开/关', { example: '设置战绩全局开关 开' });
      return true;
    }
    getConfig().global.disableLolQuery = !enabled;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已${enabled ? '开启' : '关闭'}战绩查询全局开关`);
    return true;
  }
  if (text.startsWith('设置战绩全局限流')) {
    if (!authStateService.isOwner(userId)) return true;
    const value = parseInt(text.replace('设置战绩全局限流', '').trim(), 10);
    if (!Number.isFinite(value) || value < 1 || value > 5000) {
      await sendGroupScene(groupId, 'invalid_range', '请设置 1-5000 之间的每分钟次数');
      return true;
    }
    getConfig().global.lolQueryGlobalRateLimitPerMinute = Math.floor(value);
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `战绩查询全局限流已设置为每分钟 ${Math.floor(value)} 次`);
    return true;
  }
  if (text.startsWith('设置战绩分群开关')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const arg = text.replace('设置战绩分群开关', '').trim();
    const enabled = toOnOff(arg);
    if (enabled === null) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置战绩分群开关 开/关', { example: '设置战绩分群开关 关' });
      return true;
    }
    const gs = ensureGroupSettings(groupId);
    gs.disableLolQuery = !enabled;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `本群战绩查询已${enabled ? '开启' : '关闭'}`);
    return true;
  }
  if (text.startsWith('设置战绩分群限流')) {
    if (!authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '仅主人可操作'); return true; }
    const value = parseInt(text.replace('设置战绩分群限流', '').trim(), 10);
    if (!Number.isFinite(value) || value < 1 || value > 1000) {
      await sendGroupScene(groupId, 'invalid_range', '请设置 1-1000 之间的每分钟次数');
      return true;
    }
    const gs = ensureGroupSettings(groupId);
    gs.lolQueryGroupRateLimitPerMinute = Math.floor(value);
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `本群战绩查询限流已设置为每分钟 ${Math.floor(value)} 次`);
    return true;
  }
  if (text.startsWith('设置战绩指令开关')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const rest = text.replace('设置战绩指令开关', '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await sendGroupScene(groupId, 'command_format_error', '格式：设置战绩指令开关 查战绩 开', { example: '设置战绩指令开关 查封号 关' });
      return true;
    }
    const commandName = parts[0];
    const enabled = toOnOff(parts[1]);
    if (enabled === null) {
      await sendGroupScene(groupId, 'invalid_range', '开关值仅支持 开/关');
      return true;
    }
    const map: Record<string, LolCommandKey> = {
      查战绩: 'battleQuery',
      查封号: 'banQuery',
    };
    const key = map[commandName];
    if (!key) {
      await sendGroupScene(groupId, 'not_found', '仅支持：查战绩、查封号');
      return true;
    }
    setLolCommandSwitch(groupId, key, enabled);
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `本群指令 ${commandName} 已${enabled ? '开启' : '关闭'}`);
    return true;
  }
  if (text === '战绩配置') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const globalCfg = getConfig().global;
    const groupCfg = getConfig().groups[groupId] || {};
    const effective = getGroupSettings(groupId);
    const switches = getLolCommandSwitch(groupId);
    const lines = [
      `战绩接口：${resolveLolApiBaseUrl()}`,
      `全局功能开关：${globalCfg.disableLolQuery ? '关' : '开'}`,
      `分群功能开关：${effective.disableLolQuery ? '关' : '开'}`,
      `全局限流(次/分钟)：${effective.lolQueryGlobalRateLimitPerMinute ?? 120}`,
      `分群限流(次/分钟)：${effective.lolQueryGroupRateLimitPerMinute ?? 20}`,
      `分群每日上限(次)：${effective.lolQueryDailyLimit ?? 200}`,
      `全局最小间隔(秒)：${effective.lolQueryGlobalMinIntervalSeconds ?? 1}`,
      `接口等待时长(秒)：${effective.lolQueryRequestTimeoutSeconds ?? 20}`,
      `分群最小间隔(秒)：${effective.lolQueryGroupMinIntervalSeconds ?? 2}`,
      `指令开关：查战绩(${switches.battleQuery ? '开' : '关'}) / 查封号(${switches.banQuery ? '开' : '关'})`,
      '',
      '配置来源：',
      `- 本群覆盖开关：${typeof (groupCfg as any).disableLolQuery === 'boolean' ? '已设置' : '未设置'}`,
      `- 本群覆盖限流：${typeof (groupCfg as any).lolQueryGroupRateLimitPerMinute === 'number' ? '已设置' : '未设置'}`,
      `- 本群覆盖指令：${(groupCfg as any).lolQueryCommandSwitch ? '已设置' : '未设置'}`
    ];
    await sendGroupScene(groupId, 'raw_text', lines.join('\n'));
    return true;
  }
  if (text.startsWith('设置lolurl')) {
    if (!authStateService.isOwner(userId)) return true;
    const url = text.replace('设置lolurl', '').trim();
    if (!url) {
      await sendGroupScene(groupId, 'command_format_error', '请提供完整的查询接口地址，例如：设置lolurl http://example.com/query.php', { example: '设置lolurl http://example.com/query.php' });
      return true;
    }
    getConfig().lolQueryUrl = url;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '自定义战绩查询接口地址已更新');
    return true;
  }
  if (text.startsWith('设置lolkey')) {
    if (!authStateService.isOwner(userId)) return true;
    const key = text.replace('设置lolkey', '').trim();
    if (!key) {
      await sendGroupScene(groupId, 'command_format_error', '请提供授权码(zhanjikey)', { example: '设置lolkey demo-key' });
      return true;
    }
    getConfig().lolAuthKey = key;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '自定义战绩查询授权码已更新');
    return true;
  }
  if (text.startsWith('设置loltoken')) {
    if (!authStateService.isOwner(userId)) return true;
    const token = text.replace('设置loltoken', '').trim();
    if (!token) {
      await sendGroupScene(groupId, 'command_format_error', '请提供 Token，例如：设置loltoken eyJ...', { example: '设置loltoken eyJ...' });
      return true;
    }
    getConfig().lolToken = token;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', 'LOL Token 已更新');
    return true;
  }
  if (text === '邀请查询') {
    if (getGroupSettings(groupId).disableInvite) { await sendGroupScene(groupId, 'feature_disabled', '本群邀请统计已关闭'); return true; }
    const data = await groupguardRepository.getInvite(groupId, userId);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你已邀请 ${data ? data.inviteCount : 0} 人加入本群` } }], vars: { user: userId }, force: true, applyTemplate: true });
    return true;
  }
  if (text === '重置邀请统计' || text === '清空邀请统计') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    await groupguardRepository.clearInvites(groupId);
    await resetInviteRelationData(groupId);
    await sendGroupScene(groupId, 'action_success', '本群邀请统计已重置');
    return true;
  }
  if (text === '邀请榜') {
    if (getGroupSettings(groupId).disableInvite) { await sendGroupScene(groupId, 'feature_disabled', '本群邀请统计已关闭'); return true; }
    const data = await groupguardRepository.getAllInvites(groupId);
    if (!Object.keys(data).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无邀请数据'); return true; }
    const list = Object.entries(data).sort((a, b) => b[1].inviteCount - a[1].inviteCount).slice(0, 10);
    await sendGroupScene(groupId, 'raw_text', `🏆 邀请排行榜\n${list.map((item, i) => `${i + 1}. ${item[0]} - 邀请 ${item[1].inviteCount} 人`).join('\n')}`);
    return true;
  }
  if (text === '抽奖') {
    if (getGroupSettings(groupId).disableLottery) { await sendGroupScene(groupId, 'feature_disabled', '本群抽奖功能已关闭'); return true; }
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    const settings = getGroupSettings(groupId);
    const cost = settings.lotteryCost || 20;
    const maxReward = settings.lotteryReward || 100;
    if (!userSignin || userSignin.points < cost) {
      await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 积分不足！抽奖需要${cost}积分，请先签到获取积分。` } }], vars: { user: userId }, force: true, applyTemplate: true });
      return true;
    }
    userSignin.points -= cost;
    const rand = Math.random();
    let prize = '';
    let bonus = 0;
    if (rand < 0.01) { prize = `特等奖：积分+${maxReward}`; bonus = maxReward; }
    else if (rand < 0.1) { prize = `一等奖：积分+${Math.floor(maxReward * 0.5)}`; bonus = Math.floor(maxReward * 0.5); }
    else if (rand < 0.3) { prize = `二等奖：积分+${Math.floor(maxReward * 0.3)}`; bonus = Math.floor(maxReward * 0.3); }
    else if (rand < 0.6) { prize = `三等奖：积分+${Math.floor(maxReward * 0.1)}`; bonus = Math.floor(maxReward * 0.1); }
    else { prize = '谢谢参与'; bonus = 0; }
    userSignin.points += bonus;
    await groupguardRepository.updateSignin(groupId, userId, userSignin);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 消耗${cost}积分抽奖...\n🎉 ${prize}\n当前积分：${userSignin.points}` } }], vars: { user: userId }, force: true, applyTemplate: true });
    return true;
  }
  if (text.startsWith('兑换 ')) {
    if (getGroupSettings(groupId).disableLottery) return true;
    const args = text.slice(3).trim().split(/\s+/);
    const item = args[0];
    const param = args.slice(1).join(' ');
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    if (item === '免死金牌') {
      const cost = 100;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      const warnings = await groupguardRepository.getWarning(groupId, userId);
      if (warnings <= 0) { await sendGroupScene(groupId, 'not_found', '你当前没有警告记录，无需使用免死金牌'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.runInTransaction(() => { groupguardRepository.updateSignin(groupId, userId, userSignin!); groupguardRepository.setWarning(groupId, userId, 0); });
      await sendGroupScene(groupId, 'action_success', `兑换成功！已清除所有警告记录。\n剩余积分：${userSignin.points}`, { user: userId });
      return true;
    }
    if (item === '头衔') {
      const cost = 500;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      if (!param) { await sendGroupScene(groupId, 'command_format_error', '请指定头衔内容：兑换 头衔 <内容>', { example: '兑换 头衔 传奇守护者' }); return true; }
      if (!await authStateService.isBotAdmin(groupId)) { await sendGroupScene(groupId, 'permission_denied', '兑换失败：机器人非管理员，无法设置头衔'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.updateSignin(groupId, userId, userSignin);
      await enqueueMiscAction({
        groupId,
        action: 'set_group_special_title',
        params: { group_id: groupId, user_id: userId, special_title: param },
        reason: 'shop_title',
        dedupKey: `${groupId}:shop_title:${userId}`,
        maxRetries: 1
      });
      await sendGroupScene(groupId, 'action_success', `兑换成功！头衔已设置为：${param}\n剩余积分：${userSignin.points}`, { user: userId });
      return true;
    }
    if (item === '解禁') {
      const cost = 200;
      const target = getTarget(raw, param) || userId;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      if (!await authStateService.isBotAdmin(groupId)) { await sendGroupScene(groupId, 'permission_denied', '机器人非管理员'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.updateSignin(groupId, userId, userSignin);
      const result = await executeManualPolicyAction({ type: 'ban', groupId, userId: target, durationSeconds: 0, reason: 'shop_unban', ignoreTargetProtection: true, maxRetries: 1 });
      if (!result.ok) { await sendGroupScene(groupId, 'raw_text', `兑换失败：${result.code}`); return true; }
      await sendGroupScene(groupId, 'action_success', `兑换成功！已解除 ${target} 的禁言。\n剩余积分：${userSignin.points}`, { user: userId, target });
      return true;
    }
    await sendGroupScene(groupId, 'not_found', '未知商品。请发送“积分商城”查看列表。');
    return true;
  }
  if (text === '积分商城' || text === '商城') {
    if (getGroupSettings(groupId).disableLottery) { await sendGroupScene(groupId, 'feature_disabled', '本群积分功能已关闭'); return true; }
    await sendGroupScene(groupId, 'raw_text', `🛒 积分商城
----------------
1. 免死金牌 (清除警告) - 100积分
   指令：兑换 免死金牌
2. 自定义头衔 (永久) - 500积分
   指令：兑换 头衔 <内容>
3. 解除禁言 (自己) - 200积分
   指令：兑换 解禁
----------------
发送“我的积分”查看余额`);
    return true;
  }
  if (text.startsWith('开启发言奖励 ') || text === '关闭发言奖励') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const gs = ensureGroupSettings(groupId);
    if (text === '关闭发言奖励') gs.messageReward = 0;
    else {
      const points = parseInt(text.slice(7));
      if (isNaN(points) || points <= 0) { await sendGroupScene(groupId, 'command_format_error', '请输入正确的积分数', { example: '开启发言奖励 2' }); return true; }
      gs.messageReward = points;
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '关闭发言奖励' ? '已关闭发言奖励' : `已开启发言奖励，每条消息奖励 ${gs.messageReward} 积分`);
    return true;
  }
  if (text.startsWith('活跃统计')) {
    if (getGroupSettings(groupId).disableActivity) { await sendGroupScene(groupId, 'feature_disabled', '本群活跃统计已关闭'); return true; }
    const stats = await groupguardRepository.getAllActivity(groupId);
    if (!Object.keys(stats).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无活跃统计数据'); return true; }
    const selfId = String((event as any).self_id || '');
    const entries = Object.entries(stats).sort((a, b) => b[1].msgCount - a[1].msgCount);
    const today = new Date().toISOString().slice(0, 10);
    const totalMsg = entries.reduce((s, [, r]) => s + r.msgCount, 0);
    const todayMsg = entries.reduce((s, [, r]) => s + (r.lastActiveDay === today ? (r.msgCountToday ?? 0) : 0), 0);
    const summary = `📊 本群活跃统计\n总消息数：${totalMsg}\n今日消息：${todayMsg}\n统计人数：${entries.length}`;
    const pages: string[] = [];
    const pageSize = 15;
    for (let i = 0; i < entries.length; i += pageSize) {
      const chunk = entries.slice(i, i + pageSize);
      pages.push(`排行榜（${i + 1}-${i + chunk.length}）\n\n${chunk.map(([uid, r], idx) => `${i + idx + 1}. ${uid}\n   总消息：${r.msgCount} | 今日：${r.lastActiveDay === today ? (r.msgCountToday ?? 0) : 0}\n   最后活跃：${new Date(r.lastActive).toLocaleString('zh-CN', { hour12: false })}`).join('\n\n')}`);
    }
    const nodes = [summary, ...pages].map(content => ({ type: 'node', data: { nickname: '📊 活跃统计', user_id: selfId, content: [{ type: 'text', data: { text: content } }] } }));
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', forwardNodes: nodes, force: true, applyTemplate: true });
    return true;
  }
  return false;
}
