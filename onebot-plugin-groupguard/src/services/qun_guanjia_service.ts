import fs from 'fs';
import path from 'path';
import type { HostProfile } from '../hosts/host_profile';

export const QUN_GUANJIA_UIN = 2854196310;
const QUN_DOMAIN = 'qun.qq.com';
const QQ_DOMAIN = 'qq.com';
const SET_QNA_URL = 'https://web.qun.qq.com/qunrobot/proxy/domain/app.qun.qq.com/cgi-bin/guanjia_robot/qna_setting/set_qna';
const GET_QNA_URL = 'https://web.qun.qq.com/qunrobot/proxy/domain/app.qun.qq.com/cgi-bin/guanjia_robot/qna_setting/get_qna';
const GET_ANSWER_URL = 'https://app.qun.qq.com/cgi-bin/guanjia_robot/qna_callback/get_answer';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
const STORE_FILE = 'qun-guanjia-tokens.json';
const SESSION_TTL_MS = 5 * 60 * 1000;

export type QunGuanjiaFeature = 'qa' | 'query' | 'dynamicCommand' | 'system';
export type QunGuanjiaMode = 'bot' | 'guanjia' | 'auto';

export interface QunGuanjiaSettings {
  enabled: boolean;
  mode: QunGuanjiaMode;
  fallbackToBot: boolean;
  textOnly: boolean;
  timeoutMs: number;
  allowedFeatures: QunGuanjiaFeature[];
}

export interface QunGuanjiaStatus {
  groupId: string;
  enabled: boolean;
  mode: QunGuanjiaMode;
  hasToken: boolean;
  tokenUpdatedAt: number;
  lastSuccessAt: number;
  lastErrorAt: number;
  lastError: string;
  busy: boolean;
}

export interface QunGuanjiaRouteResult {
  handled: boolean;
  ok: boolean;
  fallback: boolean;
  response?: any;
  error?: string;
}

type RawActionCall = (actionName: string, params?: unknown) => Promise<any>;

interface RuntimeBinding {
  rawCall: RawActionCall;
  getDataDir: () => string;
  getGroupSettings: (groupId: string) => any;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

interface GuanjiaSession {
  uin: number;
  skey: string;
  pSkey: string;
  cookie: string;
  bkn: string;
  updatedAt: number;
}

interface StoredGroupState {
  token?: string;
  tokenUpdatedAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
}

interface TokenStore {
  version: number;
  groups: Record<string, StoredGroupState>;
}

interface SendTextOptions {
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeMode(value: unknown): QunGuanjiaMode {
  return value === 'bot' || value === 'guanjia' || value === 'auto' ? value : 'auto';
}

function normalizeFeature(value: unknown): QunGuanjiaFeature | null {
  const key = String(value || '').trim();
  if (key === 'qa') return 'qa';
  if (key === 'query') return 'query';
  if (key === 'dynamic' || key === 'dynamicCommand') return 'dynamicCommand';
  if (key === 'system') return 'system';
  return null;
}

export function normalizeQunGuanjiaSettings(settings: any): QunGuanjiaSettings {
  const raw = isRecord(settings?.qunGuanjia) ? settings.qunGuanjia : {};
  const allowedRaw = Array.isArray(raw.allowedFeatures) ? raw.allowedFeatures : ['qa', 'dynamicCommand', 'query'];
  const allowedFeatures = Array.from(new Set(allowedRaw.map(normalizeFeature).filter(Boolean))) as QunGuanjiaFeature[];
  return {
    enabled: raw.enabled === true,
    mode: normalizeMode(raw.mode),
    fallbackToBot: raw.fallbackToBot !== false,
    textOnly: raw.textOnly !== false,
    timeoutMs: clampNumber(raw.timeoutMs, 20000, 5000, 60000),
    allowedFeatures: allowedFeatures.length ? allowedFeatures : ['qa', 'dynamicCommand', 'query']
  };
}

export function classifyQunGuanjiaScene(scene: string): QunGuanjiaFeature {
  const key = String(scene || 'system').trim().toLowerCase();
  if (key === 'qa' || key === 'qa_reply' || key.startsWith('qa_')) return 'qa';
  if (key === 'query'
    || key.startsWith('query_')
    || key.startsWith('lol_query')
    || key.startsWith('risk_query')
    || key === 'scammer_query'
    || key === 'peer_query'
    || key === 'video_query'
    || key === 'external_query') return 'query';
  if (key === 'dynamic' || key === 'dynamic_command' || key.startsWith('dynamic_') || key.startsWith('command_')) return 'dynamicCommand';
  return 'system';
}

function extractPlainText(message: unknown): { ok: boolean; text: string } {
  if (typeof message === 'string') return { ok: message.trim().length > 0, text: message };
  if (!Array.isArray(message) || !message.length) return { ok: false, text: '' };
  let text = '';
  for (const segment of message) {
    if (!isRecord(segment) || segment.type !== 'text') return { ok: false, text: '' };
    text += String(segment.data?.text ?? '');
  }
  return { ok: text.trim().length > 0, text };
}

function randomQuestion(length = 12): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let output = '';
  for (let i = 0; i < length; i += 1) output += chars[Math.floor(Math.random() * chars.length)];
  return `GG${output}`;
}

function computeGtk(key: string, hash = 5381): string {
  for (let i = 0; i < key.length; i += 1) hash += (hash << 5) + key.charCodeAt(i);
  return String(hash & 0x7fffffff);
}

function mergeCookieStrings(...parts: string[]): string {
  const values = new Map<string, string>();
  for (const raw of parts) {
    for (const item of String(raw || '').replace(/\s/g, '').split(';')) {
      if (!item) continue;
      const index = item.indexOf('=');
      if (index <= 0) continue;
      values.set(item.slice(0, index), item.slice(index + 1));
    }
  }
  return Array.from(values.entries()).map(([key, value]) => `${key}=${value}`).join(';');
}

function parseCookieFields(cookie: string): { uin: number; skey: string; pSkey: string } | null {
  const values = new Map<string, string>();
  for (const item of String(cookie || '').replace(/\s/g, '').split(';')) {
    const index = item.indexOf('=');
    if (index <= 0) continue;
    values.set(item.slice(0, index), item.slice(index + 1));
  }
  const uin = Number.parseInt(String(values.get('uin') || '').replace(/^o/i, ''), 10);
  const skey = String(values.get('skey') || '');
  const pSkey = String(values.get('p_skey') || '');
  if (!Number.isFinite(uin) || uin <= 0 || !skey || !pSkey) return null;
  return { uin, skey, pSkey };
}

function unwrapActionData(result: any): any {
  return result?.data ?? result?.retdata ?? result;
}

function toRetcode(raw: any): number {
  const value = raw?.retcode ?? raw?.ec ?? raw?.code;
  const code = Number(value);
  return Number.isFinite(code) ? code : -1;
}

function isOkRetcode(code: number): boolean {
  return code === 0 || code === 200;
}

function extractMessageId(result: any): string {
  const data = unwrapActionData(result);
  const value = data?.message_id ?? data?.messageId ?? result?.message_id ?? result?.messageId;
  return value === undefined || value === null ? '' : String(value);
}

function parseJsonString(value: string): unknown {
  const text = value.trim();
  if (!(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractAutoreplyToken(value: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 10 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    return parsed ? extractAutoreplyToken(parsed, depth + 1, seen) : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = extractAutoreplyToken(item, depth + 1, seen);
      if (token) return token;
    }
    return '';
  }
  if (!isRecord(value)) return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (value.app === 'com.tencent.autoreply') {
    const token = value.meta?.metadata?.token ?? value.meta?.detail?.token ?? value.metadata?.token;
    if (typeof token === 'string' && token.trim()) return token.trim();
  }
  for (const item of Object.values(value)) {
    const token = extractAutoreplyToken(item, depth + 1, seen);
    if (token) return token;
  }
  return '';
}

function getMessageSenderId(message: any): string {
  const value = message?.user_id
    ?? message?.userId
    ?? message?.sender?.user_id
    ?? message?.sender?.userId
    ?? message?.sender?.uin
    ?? message?.sender_uin;
  return value === undefined || value === null ? '' : String(value);
}

class QunGuanjiaService {
  private runtime: RuntimeBinding | null = null;
  private hostProfile: HostProfile | null = null;
  private session: GuanjiaSession | null = null;
  private store: TokenStore = { version: 1, groups: {} };
  private loadedStorePath = '';
  private groupTails = new Map<string, Promise<void>>();
  private busyGroups = new Set<string>();

  bindRuntime(runtime: RuntimeBinding): void {
    this.runtime = runtime;
  }

  bindHostProfile(hostProfile: HostProfile | null): void {
    this.hostProfile = hostProfile;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.runtime?.log(level, `[QunGuanjia] ${message}`);
  }

  private requireRuntime(): RuntimeBinding {
    if (!this.runtime) throw new Error('Q群管家发送运行时尚未初始化');
    return this.runtime;
  }

  private async callAction(actionName: string, params: unknown): Promise<any> {
    const runtime = this.requireRuntime();
    return runtime.rawCall(actionName, params);
  }

  private getStorePath(): string {
    const dataDir = String(this.runtime?.getDataDir() || '').trim();
    return dataDir ? path.join(dataDir, STORE_FILE) : '';
  }

  private ensureStoreLoaded(): void {
    const filePath = this.getStorePath();
    if (!filePath || this.loadedStorePath === filePath) return;
    this.loadedStorePath = filePath;
    this.store = { version: 1, groups: {} };
    try {
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (isRecord(parsed) && isRecord(parsed.groups)) {
        this.store = { version: 1, groups: parsed.groups as Record<string, StoredGroupState> };
      }
    } catch (error) {
      this.log('warn', `读取 token 缓存失败: ${String(error)}`);
    }
  }

  private saveStore(): void {
    this.ensureStoreLoaded();
    const filePath = this.getStorePath();
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(this.store, null, 2)}\n`, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      this.log('warn', `保存 token 缓存失败: ${String(error)}`);
    }
  }

  private getStoredState(groupId: string): StoredGroupState {
    this.ensureStoreLoaded();
    if (!this.store.groups[groupId]) this.store.groups[groupId] = {};
    return this.store.groups[groupId];
  }

  private getToken(groupId: string): string {
    return String(this.getStoredState(groupId).token || '').trim();
  }

  private setToken(groupId: string, token: string): void {
    const state = this.getStoredState(groupId);
    state.token = token.trim();
    state.tokenUpdatedAt = Date.now();
    state.lastError = '';
    this.saveStore();
  }

  clearToken(groupId: string): QunGuanjiaStatus {
    const state = this.getStoredState(String(groupId));
    delete state.token;
    state.tokenUpdatedAt = 0;
    this.saveStore();
    return this.getStatus(String(groupId));
  }

  private setSuccess(groupId: string): void {
    const state = this.getStoredState(groupId);
    state.lastSuccessAt = Date.now();
    state.lastError = '';
    state.lastErrorAt = 0;
    this.saveStore();
  }

  private setError(groupId: string, error: unknown): void {
    const state = this.getStoredState(groupId);
    state.lastErrorAt = Date.now();
    state.lastError = String((error as Error)?.message || error).slice(0, 500);
    this.saveStore();
  }

  getStatus(groupId: string): QunGuanjiaStatus {
    const gid = String(groupId || '').trim();
    const settings = normalizeQunGuanjiaSettings(this.runtime?.getGroupSettings(gid));
    const state = this.getStoredState(gid);
    return {
      groupId: gid,
      enabled: settings.enabled,
      mode: settings.mode,
      hasToken: Boolean(String(state.token || '').trim()),
      tokenUpdatedAt: Number(state.tokenUpdatedAt || 0),
      lastSuccessAt: Number(state.lastSuccessAt || 0),
      lastErrorAt: Number(state.lastErrorAt || 0),
      lastError: String(state.lastError || ''),
      busy: this.busyGroups.has(gid)
    };
  }

  private async getCookies(domain: string): Promise<string> {
    const result = await this.callAction('get_cookies', { domain });
    return String(unwrapActionData(result)?.cookies ?? result?.cookies ?? '').trim();
  }

  private async ensureSession(): Promise<GuanjiaSession> {
    if (this.session && Date.now() - this.session.updatedAt < SESSION_TTL_MS) return this.session;
    const qunCookie = await this.getCookies(QUN_DOMAIN);
    if (!qunCookie) throw new Error('无法获取 qun.qq.com Cookie');
    let merged = qunCookie;
    let parsed = parseCookieFields(merged);
    if (!parsed) {
      const qqCookie = await this.getCookies(QQ_DOMAIN).catch(() => '');
      merged = mergeCookieStrings(qqCookie, qunCookie);
      parsed = parseCookieFields(merged);
    }
    if (!parsed) throw new Error('Cookie 缺少 uin/skey/p_skey');
    this.session = {
      uin: parsed.uin,
      skey: parsed.skey,
      pSkey: parsed.pSkey,
      cookie: merged,
      bkn: computeGtk(parsed.skey),
      updatedAt: Date.now()
    };
    return this.session;
  }

  private headers(session: GuanjiaSession, extra: Record<string, string> = {}): Record<string, string> {
    return {
      'qname-service': '976321:131072',
      'qname-space': 'Production',
      'User-Agent': DEFAULT_UA,
      'Content-Type': 'application/json',
      Origin: 'https://web.qun.qq.com',
      Cookie: session.cookie,
      ...extra
    };
  }

  private async postJson(session: GuanjiaSession, endpoint: string, body: Record<string, unknown>, extra: Record<string, string> = {}): Promise<any> {
    const url = new URL(endpoint);
    url.searchParams.set('bkn', session.bkn);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: this.headers(session, extra),
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Q群管家接口 HTTP ${response.status}: ${text.slice(0, 160)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Q群管家接口返回非 JSON: ${text.slice(0, 160)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async setQnaItem(session: GuanjiaSession, groupId: string, slot: number, question: string, answer: string): Promise<any> {
    return this.postJson(session, SET_QNA_URL, {
      bkn: session.bkn,
      group_id: Number(groupId),
      qna_item: {
        slot,
        question,
        answer,
        keyword: question ? [question] : []
      }
    });
  }

  private async setQnaWithRetry(session: GuanjiaSession, groupId: string, question: string, answer: string): Promise<void> {
    let result = await this.setQnaItem(session, groupId, 0, question, answer);
    let code = toRetcode(result);
    if (code === 100420) {
      await this.setQnaItem(session, groupId, 1, '', '').catch(() => null);
      result = await this.setQnaItem(session, groupId, 0, question, answer);
      code = toRetcode(result);
    }
    if (!isOkRetcode(code)) throw new Error(`set_qna 失败 retcode=${code}`);
  }

  private async getQnaList(session: GuanjiaSession, groupId: string): Promise<any[]> {
    const result = await this.postJson(session, GET_QNA_URL, {
      bkn: session.bkn,
      group_id: Number(groupId)
    });
    return Array.isArray(result?.data?.qna_list) ? result.data.qna_list : [];
  }

  private async clearQna(session: GuanjiaSession, groupId: string, question: string): Promise<void> {
    let slot = 0;
    try {
      const list = await this.getQnaList(session, groupId);
      const index = list.findIndex(item => String(item?.question || '') === question);
      if (index >= 0) slot = index + 1;
    } catch {
      // best effort
    }
    for (let i = 0; i < 5; i += 1) {
      const targetSlot = slot > 0 ? slot : i;
      const result = await this.setQnaItem(session, groupId, targetSlot, '', '').catch(() => null);
      if (isOkRetcode(toRetcode(result))) return;
    }
  }

  private async triggerAnswer(session: GuanjiaSession, question: string, token: string): Promise<void> {
    const result = await this.postJson(session, GET_ANSWER_URL, {
      anonymous: 1,
      question,
      token
    }, { Referer: 'https://web.qun.qq.com/' });
    const code = toRetcode(result);
    if (!isOkRetcode(code)) throw new Error(`get_answer 失败 retcode=${code}`);
  }

  private async getHistory(groupId: string): Promise<any[]> {
    const profile = this.hostProfile;
    if (!profile) throw new Error('host_profile_unavailable_for_group_message_history');
    const result = await profile.getGroupMessageHistory({ groupId, anchorMessageId: '0', count: 50 });
    if (result.state !== 'success' || !Array.isArray(result.data?.messages)) {
      throw new Error(`group_message_history_${result.state}:${result.reason || 'unavailable'}`);
    }
    return result.data.messages;
  }

  private findTokenInHistory(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const senderId = getMessageSenderId(message);
      if (senderId && senderId !== String(QUN_GUANJIA_UIN)) continue;
      const token = extractAutoreplyToken(message);
      if (token) return token;
    }
    return '';
  }

  private async sendTokenProbe(groupId: string, question: string): Promise<string> {
    const result = await this.callAction('send_group_msg', {
      group_id: Number(groupId),
      message: [
        { type: 'at', data: { qq: String(QUN_GUANJIA_UIN) } },
        { type: 'text', data: { text: ` ${question}` } }
      ]
    });
    return extractMessageId(result);
  }

  private async deleteMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.callAction('delete_msg', { message_id: messageId }).catch(() => null);
  }

  private async acquireToken(groupId: string, timeoutMs: number): Promise<string> {
    const cached = this.getToken(groupId);
    if (cached) return cached;
    const session = await this.ensureSession();
    const question = randomQuestion(10);
    let triggerMessageId = '';
    await this.setQnaWithRetry(session, groupId, question, 'GroupGuard_token_probe');
    try {
      triggerMessageId = await this.sendTokenProbe(groupId, question);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(900);
        const token = this.findTokenInHistory(await this.getHistory(groupId));
        if (token) {
          this.setToken(groupId, token);
          this.log('info', `群 ${groupId} 已自动采集 Q群管家 token`);
          return token;
        }
      }
      throw new Error('等待 Q群管家 token 超时，请确认群内已添加 Q群管家且机器人拥有管理权限');
    } finally {
      await this.deleteMessage(triggerMessageId);
      await this.clearQna(session, groupId, question);
    }
  }

  private async sendTextUnlocked(groupId: string, text: string, options: SendTextOptions = {}): Promise<any> {
    const settings = normalizeQunGuanjiaSettings(this.runtime?.getGroupSettings(groupId));
    const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
    const session = await this.ensureSession();
    let token = await this.acquireToken(groupId, timeoutMs);
    const question = randomQuestion(12);
    await this.setQnaWithRetry(session, groupId, question, text);
    try {
      try {
        await this.triggerAnswer(session, question, token);
      } catch (firstError) {
        this.log('warn', `群 ${groupId} 已缓存 token 触发失败，尝试重新采集: ${String(firstError)}`);
        this.clearToken(groupId);
        token = await this.acquireToken(groupId, timeoutMs);
        await this.triggerAnswer(session, question, token);
      }
      this.setSuccess(groupId);
      return {
        status: 'ok',
        retcode: 0,
        data: {
          message_id: 0,
          channel: 'qun_guanjia',
          group_id: Number(groupId)
        }
      };
    } finally {
      await this.clearQna(session, groupId, question);
    }
  }

  private async withGroupLock<T>(groupId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.groupTails.get(groupId) || Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.groupTails.set(groupId, tail);
    await previous.catch(() => undefined);
    this.busyGroups.add(groupId);
    try {
      return await task();
    } finally {
      this.busyGroups.delete(groupId);
      release();
      if (this.groupTails.get(groupId) === tail) this.groupTails.delete(groupId);
    }
  }

  async sendText(groupId: string, text: string, options: SendTextOptions = {}): Promise<any> {
    const gid = String(groupId || '').trim();
    const content = String(text || '');
    if (!/^\d+$/.test(gid)) throw new Error('群号无效');
    if (!content.trim()) throw new Error('发送内容为空');
    return this.withGroupLock(gid, async () => {
      try {
        return await this.sendTextUnlocked(gid, content, options);
      } catch (error) {
        this.setError(gid, error);
        throw error;
      }
    });
  }

  async routeGroupMessage(params: any, scene: string): Promise<QunGuanjiaRouteResult> {
    const groupId = String(params?.group_id ?? params?.groupId ?? '').trim();
    if (!groupId) return { handled: false, ok: false, fallback: true };
    const settings = normalizeQunGuanjiaSettings(this.runtime?.getGroupSettings(groupId));
    if (!settings.enabled || settings.mode === 'bot') return { handled: false, ok: false, fallback: true };
    const feature = classifyQunGuanjiaScene(scene);
    if (!settings.allowedFeatures.includes(feature)) return { handled: false, ok: false, fallback: true };
    const plain = extractPlainText(params?.message);
    if (!plain.ok) return { handled: false, ok: false, fallback: true, error: 'Q群管家通道第一版仅支持纯文本' };
    try {
      const response = await this.sendText(groupId, plain.text, { timeoutMs: settings.timeoutMs });
      return { handled: true, ok: true, fallback: false, response };
    } catch (error) {
      const message = String((error as Error)?.message || error);
      const fallback = settings.mode === 'auto' || settings.fallbackToBot;
      this.log('warn', `群 ${groupId} 代发失败 fallback=${fallback}: ${message}`);
      return { handled: true, ok: false, fallback, error: message };
    }
  }
}

export const qunGuanjiaService = new QunGuanjiaService();
