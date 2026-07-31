import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { contextStateService } from './core/state-services/context_state_service';
import type {
  GroupGuardSettings,
  AuditEventQuery,
  AuditEventPage,
  AuditEventRecord,
  AuditRetentionPolicy,
  ActionQueueEventRetentionPolicy,
  ActionQueueEventStatsQuery,
  ActionQueueEventStatsView,
  ActionQueueEventSearchQuery,
  ActionQueueEventSearchView,
  BotSendEventRecord,
  BotSendStatsQuery,
  BotSendStatsView,
  ContactIdentifierType,
  ContactRiskCategory,
  ContactRiskRecord,
  ContactRiskReportInput,
  ScammerRecord,
  ScammerReportInput,
  AuditStatsQuery,
  AuditStatsView,
  AuditUserProfileQuery,
  AuditUserProfileView,
  ActionQueueEventRecord,
  JoinLogEntry,
  SelfRecallScheduleInput,
  SelfRecallTaskRecord,
  RecallTaskScheduleInput,
  RecallTaskRecord
} from './types';

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS storage_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS group_config (group_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS group_qa (group_id TEXT NOT NULL, keyword TEXT NOT NULL, mode TEXT NOT NULL, reply TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (group_id, keyword, mode));
CREATE TABLE IF NOT EXISTS activity (group_id TEXT NOT NULL, user_id TEXT NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0, last_active INTEGER NOT NULL DEFAULT 0, msg_count_today INTEGER NOT NULL DEFAULT 0, last_active_day TEXT NOT NULL DEFAULT '', PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS signin (group_id TEXT NOT NULL, user_id TEXT NOT NULL, last_signin INTEGER NOT NULL DEFAULT 0, days INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS invites (group_id TEXT NOT NULL, user_id TEXT NOT NULL, inviter_id TEXT NOT NULL DEFAULT '', invite_count INTEGER NOT NULL DEFAULT 0, invited_users_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS warnings (group_id TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS join_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, user_id TEXT NOT NULL, answer TEXT NOT NULL, passphrase_matched INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  handled INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  risk_score REAL NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS self_recall_tasks (
  task_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  last_code TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recall_tasks (
  task_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  last_code TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_event_links (
  link_type TEXT NOT NULL,
  link_value TEXT NOT NULL,
  audit_event_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (link_type, link_value, audit_event_id)
);
CREATE TABLE IF NOT EXISTS action_queue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  action_id TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_send_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  message_id TEXT NOT NULL DEFAULT '',
  content_length INTEGER NOT NULL DEFAULT 0,
  has_media INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  apply_template INTEGER NOT NULL DEFAULT 1,
  template_applied INTEGER NOT NULL DEFAULT 0,
  suffix_applied INTEGER NOT NULL DEFAULT 0,
  suffix_mode TEXT NOT NULL DEFAULT '',
  random_delay_ms INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL DEFAULT 0,
  self_recall_due_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scammer_records (
  qq TEXT PRIMARY KEY,
  report_count INTEGER NOT NULL DEFAULT 0,
  last_report_content TEXT NOT NULL DEFAULT '',
  recent_reports_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  first_reported_at INTEGER NOT NULL DEFAULT 0,
  last_reported_at INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_risk_records (
  category TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 0,
  last_report_content TEXT NOT NULL DEFAULT '',
  recent_reports_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  first_reported_at INTEGER NOT NULL DEFAULT 0,
  last_reported_at INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (category, identifier_type, identifier_value)
);
CREATE TABLE IF NOT EXISTS sub_players (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  gold INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  servant_name TEXT NOT NULL DEFAULT '',
  master_id TEXT NOT NULL DEFAULT '',
  last_welfare_day TEXT NOT NULL DEFAULT '',
  last_action_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS sub_contracts (
  group_id TEXT NOT NULL,
  master_id TEXT NOT NULL,
  servant_id TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active',
  servant_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, servant_id)
);
CREATE TABLE IF NOT EXISTS sub_gameplay_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sub_racing_players (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  racer_name TEXT NOT NULL DEFAULT '',
  car_coins INTEGER NOT NULL DEFAULT 0,
  fuel INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  champions INTEGER NOT NULL DEFAULT 0,
  career_runs INTEGER NOT NULL DEFAULT 0,
  active_car_id TEXT NOT NULL DEFAULT 'starter',
  owned_cars_json TEXT NOT NULL DEFAULT '["starter"]',
  last_duel_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS sub_resources (
  group_id TEXT NOT NULL DEFAULT '',
  resource_key TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  resource_type TEXT NOT NULL DEFAULT 'text',
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, resource_key)
);
CREATE INDEX IF NOT EXISTS idx_activity_group_last_active ON activity(group_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_signin_group_points ON signin(group_id, points DESC);
CREATE INDEX IF NOT EXISTS idx_join_logs_group_timestamp ON join_logs(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_group_created ON audit_events(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_created ON audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warnings_group_count ON warnings(group_id, count DESC);
CREATE INDEX IF NOT EXISTS idx_self_recall_due_status ON self_recall_tasks(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_recall_due_status ON recall_tasks(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_audit_event_links_value ON audit_event_links(link_type, link_value, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_queue_events_task ON action_queue_events(task_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_action_queue_events_group ON action_queue_events(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_send_events_created ON bot_send_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_send_events_group_created ON bot_send_events(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_send_events_message ON bot_send_events(group_id, message_id);
CREATE INDEX IF NOT EXISTS idx_scammer_records_updated ON scammer_records(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scammer_records_last_reported ON scammer_records(last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_risk_records_category_updated ON contact_risk_records(category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_risk_records_identifier ON contact_risk_records(identifier_type, identifier_value);
CREATE INDEX IF NOT EXISTS idx_contact_risk_records_last_reported ON contact_risk_records(category, last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_players_gold ON sub_players(group_id, gold DESC);
CREATE INDEX IF NOT EXISTS idx_sub_players_value ON sub_players(group_id, value DESC);
CREATE INDEX IF NOT EXISTS idx_sub_players_level ON sub_players(group_id, level DESC, exp DESC);
CREATE INDEX IF NOT EXISTS idx_sub_contracts_master ON sub_contracts(group_id, master_id, state);
CREATE INDEX IF NOT EXISTS idx_sub_gameplay_events_group_created ON sub_gameplay_events(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_racing_wins ON sub_racing_players(group_id, wins DESC);
CREATE INDEX IF NOT EXISTS idx_sub_racing_champions ON sub_racing_players(group_id, champions DESC);
`;

type SqliteDb = any;
type AuditRetentionLogHandler = (event: { deleted: number; maxAgeDays: number; maxRows: number; timestamp: number; }) => void;
type ActionQueueEventRetentionLogHandler = (event: { deleted: number; maxAgeDays: number; maxRows: number; timestamp: number; }) => void;

function toNumber(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readJsonFile(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`invalid_migration_json:${filePath}`, { cause: error });
  }
}

function parseJson(value: string): any {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return null;
  }
}

function parseJsonArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function normalizeLimitedText(value: string, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeRiskCategory(value: string): ContactRiskCategory {
  return value === 'peer' ? 'peer' : 'scammer';
}

function normalizeIdentifierType(value: string): ContactIdentifierType {
  return value === 'wechat' ? 'wechat' : 'qq';
}

function isValidRiskIdentifier(type: ContactIdentifierType, value: string): boolean {
  if (type === 'qq') return /^\d{5,13}$/.test(value);
  return /^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(value);
}

function toContactRiskRecord(row: any): ContactRiskRecord {
  return {
    category: normalizeRiskCategory(String(row.category || 'scammer')),
    identifierType: normalizeIdentifierType(String(row.identifier_type || 'qq')),
    identifierValue: String(row.identifier_value || ''),
    reportCount: toNumber(row.report_count, 0),
    lastReportContent: String(row.last_report_content || ''),
    recentReports: parseJsonArray(String(row.recent_reports_json || '[]')),
    sources: parseJsonArray(String(row.sources_json || '[]')),
    firstReportedAt: toNumber(row.first_reported_at, 0),
    lastReportedAt: toNumber(row.last_reported_at, 0),
    lastCheckedAt: toNumber(row.last_checked_at, 0),
    updatedAt: toNumber(row.updated_at, 0)
  };
}

function toScammerRecord(record: ContactRiskRecord): ScammerRecord {
  return {
    qq: record.identifierValue,
    reportCount: record.reportCount,
    lastReportContent: record.lastReportContent,
    recentReports: record.recentReports,
    sources: record.sources,
    firstReportedAt: record.firstReportedAt,
    lastReportedAt: record.lastReportedAt,
    lastCheckedAt: record.lastCheckedAt,
    updatedAt: record.updatedAt
  };
}

function collectAuditLinks(payloadText: string): Array<{ type: string; value: string; }> {
  const payload = parseJson(payloadText);
  if (!payload || typeof payload !== 'object') return [];
  const links: Array<{ type: string; value: string; }> = [];
  const push = (type: string, value: unknown) => {
    const text = String(value || '').trim();
    if (!text) return;
    for (const item of text.split(/[,\s]+/).map(v => v.trim()).filter(Boolean)) {
      if (!links.some(link => link.type === type && link.value === item)) links.push({ type, value: item });
    }
  };
  push('correlation_id', payload.correlationId || payload.context?.correlationId);
  push('queue_task_id', payload.queueTaskId);
  if (Array.isArray(payload.actions)) {
    for (const action of payload.actions) push('queue_task_id', action?.queueTaskId);
  }
  return links;
}

export class StorageAdapter {
  private db: SqliteDb | null = null;
  private inited = false;
  private dbPath = '';
  private lastAuditPruneAt = 0;
  private lastActionQueueEventPruneAt = 0;
  private dataDir = '';
  private auditRetentionPolicy: AuditRetentionPolicy = { maxAgeDays: 30, maxRows: 20000 };
  private auditRetentionLogHandler: AuditRetentionLogHandler | null = null;
  private actionQueueEventRetentionPolicy: ActionQueueEventRetentionPolicy = { maxAgeDays: 7, maxRows: 50000 };
  private actionQueueEventRetentionLogHandler: ActionQueueEventRetentionLogHandler | null = null;

  init(configDir: string): void {
    const nextDataDir = path.resolve(contextStateService.getDataDir() || path.join(configDir, 'data'));
    const nextDbPath = path.join(nextDataDir, 'groupguard.db');
    if (this.inited && this.db && this.dbPath === nextDbPath) return;
    if (this.inited) this.close();
    this.dataDir = nextDataDir;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.dbPath = nextDbPath;
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    this.inited = true;
  }

  close(): void {
    try { this.db?.close?.(); } finally {
      this.db = null;
      this.inited = false;
      this.dbPath = '';
      this.dataDir = '';
    }
  }

  private assertReady(): SqliteDb {
    if (!this.db) throw new Error('storage adapter not initialized');
    return this.db;
  }

  runInTransaction<T>(fn: () => T): T {
    const db = this.assertReady();
    db.exec('BEGIN IMMEDIATE');
    try {
      const ret = fn();
      db.exec('COMMIT');
      return ret;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  isMigrated(): boolean {
    const db = this.assertReady();
    const row = db.prepare('SELECT v FROM storage_meta WHERE k = ?').get('json_migrated');
    return !!row && String(row.v) === '1';
  }

  markMigrated(): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO storage_meta(k, v) VALUES (?, ?)').run('json_migrated', '1');
  }

  getContactRiskRecord(category: ContactRiskCategory, identifierType: ContactIdentifierType, identifierValue: string): ContactRiskRecord | undefined {
    const db = this.assertReady();
    const normalizedCategory = normalizeRiskCategory(category);
    const normalizedType = normalizeIdentifierType(identifierType);
    const normalizedValue = String(identifierValue || '').trim();
    if (!isValidRiskIdentifier(normalizedType, normalizedValue)) return undefined;
    const row = db.prepare(`SELECT category, identifier_type, identifier_value, report_count, last_report_content, recent_reports_json, sources_json,
      first_reported_at, last_reported_at, last_checked_at, updated_at
      FROM contact_risk_records
      WHERE category = ? AND identifier_type = ? AND identifier_value = ?`).get(normalizedCategory, normalizedType, normalizedValue);
    return row ? toContactRiskRecord(row) : undefined;
  }

  upsertContactRiskReport(input: ContactRiskReportInput): ContactRiskRecord {
    const db = this.assertReady();
    const category = normalizeRiskCategory(input.category);
    const identifierType = normalizeIdentifierType(input.identifierType);
    const identifierValue = String(input.identifierValue || '').trim();
    if (!isValidRiskIdentifier(identifierType, identifierValue)) throw new Error('invalid_contact_identifier');
    const maxEvidenceLength = Math.max(50, Math.min(5000, toNumber(input.maxEvidenceLength, 500)));
    const maxRecentReports = Math.max(1, Math.min(50, toNumber(input.maxRecentReports, 10)));
    const content = normalizeLimitedText(input.content, maxEvidenceLength);
    const source = String(input.source || 'local').trim() || 'local';
    const now = Date.now();
    const current = this.getContactRiskRecord(category, identifierType, identifierValue);
    const recentReports = current?.recentReports ? [...current.recentReports] : [];
    if (content && !recentReports.includes(content)) recentReports.unshift(content);
    const trimmedReports = recentReports.slice(0, maxRecentReports);
    const sources = current?.sources ? [...current.sources] : [];
    if (!sources.includes(source)) sources.unshift(source);
    const firstReportedAt = current?.firstReportedAt || now;
    const next: ContactRiskRecord = {
      category,
      identifierType,
      identifierValue,
      reportCount: (current?.reportCount || 0) + 1,
      lastReportContent: content || current?.lastReportContent || '',
      recentReports: trimmedReports,
      sources: sources.slice(0, 20),
      firstReportedAt,
      lastReportedAt: now,
      lastCheckedAt: current?.lastCheckedAt || 0,
      updatedAt: now
    };
    db.prepare(`INSERT OR REPLACE INTO contact_risk_records(
      category, identifier_type, identifier_value, report_count, last_report_content, recent_reports_json, sources_json,
      first_reported_at, last_reported_at, last_checked_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      next.category,
      next.identifierType,
      next.identifierValue,
      next.reportCount,
      next.lastReportContent,
      JSON.stringify(next.recentReports),
      JSON.stringify(next.sources),
      next.firstReportedAt,
      next.lastReportedAt,
      next.lastCheckedAt,
      next.updatedAt
    );
    return next;
  }

  touchContactRiskChecked(category: ContactRiskCategory, identifierType: ContactIdentifierType, identifierValue: string): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`UPDATE contact_risk_records SET last_checked_at = ?, updated_at = ?
      WHERE category = ? AND identifier_type = ? AND identifier_value = ?`).run(
      now,
      now,
      normalizeRiskCategory(category),
      normalizeIdentifierType(identifierType),
      String(identifierValue || '').trim()
    );
  }

  pruneContactRiskRecords(category: ContactRiskCategory, maxRows: number): number {
    const db = this.assertReady();
    const normalizedCategory = normalizeRiskCategory(category);
    const limit = Math.max(100, Math.min(100000, toNumber(maxRows, 5000)));
    const countRow = db.prepare('SELECT COUNT(1) AS c FROM contact_risk_records WHERE category = ?').get(normalizedCategory);
    const overflow = toNumber(countRow?.c, 0) - limit;
    if (overflow <= 0) return 0;
    const result = db.prepare(`DELETE FROM contact_risk_records
      WHERE rowid IN (
        SELECT rowid FROM contact_risk_records
        WHERE category = ?
        ORDER BY updated_at ASC, identifier_type ASC, identifier_value ASC
        LIMIT ?
      )`).run(normalizedCategory, overflow);
    return toNumber(result?.changes, 0);
  }

  getScammerRecord(qq: string): ScammerRecord | undefined {
    const normalizedQQ = String(qq || '').trim();
    const migrated = this.getContactRiskRecord('scammer', 'qq', normalizedQQ);
    if (migrated) return toScammerRecord(migrated);
    const db = this.assertReady();
    const row = db.prepare(`SELECT qq, report_count, last_report_content, recent_reports_json, sources_json,
      first_reported_at, last_reported_at, last_checked_at, updated_at
      FROM scammer_records WHERE qq = ?`).get(normalizedQQ);
    if (!row) return undefined;
    return {
      qq: String(row.qq || ''),
      reportCount: toNumber(row.report_count, 0),
      lastReportContent: String(row.last_report_content || ''),
      recentReports: parseJsonArray(String(row.recent_reports_json || '[]')),
      sources: parseJsonArray(String(row.sources_json || '[]')),
      firstReportedAt: toNumber(row.first_reported_at, 0),
      lastReportedAt: toNumber(row.last_reported_at, 0),
      lastCheckedAt: toNumber(row.last_checked_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  upsertScammerReport(input: ScammerReportInput): ScammerRecord {
    const record = this.upsertContactRiskReport({
      category: 'scammer',
      identifierType: 'qq',
      identifierValue: input.qq,
      content: input.content,
      source: input.source,
      maxEvidenceLength: input.maxEvidenceLength,
      maxRecentReports: input.maxRecentReports
    });
    return toScammerRecord(record);
  }

  touchScammerChecked(qq: string): void {
    this.touchContactRiskChecked('scammer', 'qq', qq);
    const db = this.assertReady();
    const now = Date.now();
    db.prepare('UPDATE scammer_records SET last_checked_at = ?, updated_at = ? WHERE qq = ?').run(now, now, String(qq || '').trim());
  }

  pruneScammerRecords(maxRows: number): number {
    const db = this.assertReady();
    const limit = Math.max(100, Math.min(100000, toNumber(maxRows, 5000)));
    const countRow = db.prepare('SELECT COUNT(1) AS c FROM scammer_records').get();
    const overflow = toNumber(countRow?.c, 0) - limit;
    const genericDeleted = this.pruneContactRiskRecords('scammer', limit);
    if (overflow <= 0) return genericDeleted;
    const result = db.prepare(`DELETE FROM scammer_records
      WHERE qq IN (
        SELECT qq FROM scammer_records
        ORDER BY updated_at ASC, qq ASC
        LIMIT ?
      )`).run(overflow);
    return genericDeleted + toNumber(result?.changes, 0);
  }

  private saveGroupConfigUnsafe(groupId: string, cfg: GroupGuardSettings): void {
    const db = this.assertReady();
    const now = Date.now();
    const qaList = Array.isArray((cfg as any).qaList) ? (cfg as any).qaList : [];
    const configToSave: any = { ...(cfg as any) };
    delete configToSave.qaList;
    db.prepare('INSERT OR REPLACE INTO group_config(group_id, config_json, updated_at) VALUES (?, ?, ?)').run(groupId, JSON.stringify(configToSave), now);
    db.prepare('DELETE FROM group_qa WHERE group_id = ?').run(groupId);
    const stmt = db.prepare('INSERT OR REPLACE INTO group_qa(group_id, keyword, mode, reply, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const qa of qaList) {
      stmt.run(groupId, String(qa.keyword || ''), String(qa.mode || 'exact'), String(qa.reply || ''), now);
    }
  }

  saveGroupConfig(groupId: string, cfg: GroupGuardSettings): void {
    this.runInTransaction(() => this.saveGroupConfigUnsafe(groupId, cfg));
  }

  deleteGroupConfig(groupId: string): void {
    const db = this.assertReady();
    this.runInTransaction(() => {
      db.prepare('DELETE FROM group_qa WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM group_config WHERE group_id = ?').run(groupId);
    });
  }

  replaceAllGroupConfigs(groups: Record<string, GroupGuardSettings>, beforeCommit?: () => void): void {
    const db = this.assertReady();
    const ids = Object.keys(groups || {});
    this.runInTransaction(() => {
      for (const gid of ids) {
        const cfg = groups[gid];
        if (cfg) this.saveGroupConfigUnsafe(gid, cfg);
      }
      if (ids.length === 0) {
        db.prepare('DELETE FROM group_qa').run();
        db.prepare('DELETE FROM group_config').run();
      } else {
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM group_qa WHERE group_id NOT IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM group_config WHERE group_id NOT IN (${placeholders})`).run(...ids);
      }
      beforeCommit?.();
    });
  }

  saveGroupConfigs(groups: Record<string, GroupGuardSettings>): void {
    this.replaceAllGroupConfigs(groups);
  }

  loadAllGroupConfigs(): Record<string, GroupGuardSettings> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT group_id, config_json FROM group_config').all();
    const qaRows = db.prepare('SELECT group_id, keyword, mode, reply FROM group_qa').all();
    const qaMap = new Map<string, any[]>();
    for (const row of qaRows) {
      const list = qaMap.get(String(row.group_id)) || [];
      list.push({ keyword: String(row.keyword || ''), mode: String(row.mode || 'exact'), reply: String(row.reply || '') });
      qaMap.set(String(row.group_id), list);
    }
    const result: Record<string, GroupGuardSettings> = {};
    for (const row of rows) {
      const gid = String(row.group_id);
      let cfg: any = {};
      try {
        cfg = JSON.parse(String(row.config_json || '{}'));
      } catch (error) {
        throw new Error(`invalid_group_config_json:${gid}`, { cause: error });
      }
      cfg.qaList = qaMap.get(gid) || [];
      result[gid] = cfg as GroupGuardSettings;
    }
    return result;
  }

  listGroupQaSummaries(): Array<{ groupId: string; configured: boolean; qaCount: number; config: Record<string, any>; }> {
    const db = this.assertReady();
    const configRows = db.prepare('SELECT group_id, config_json FROM group_config').all();
    const qaRows = db.prepare('SELECT group_id, COUNT(1) AS c FROM group_qa GROUP BY group_id').all();
    const map = new Map<string, { groupId: string; configured: boolean; qaCount: number; config: Record<string, any>; }>();
    for (const row of configRows) {
      const groupId = String(row.group_id || '');
      if (!groupId) continue;
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(String(row.config_json || '{}'));
      } catch {
        parsed = {};
      }
      map.set(groupId, {
        groupId,
        configured: true,
        qaCount: 0,
        config: parsed
      });
    }
    for (const row of qaRows) {
      const groupId = String(row.group_id || '');
      if (!groupId) continue;
      const current = map.get(groupId) || { groupId, configured: false, qaCount: 0, config: {} };
      current.qaCount = toNumber(row.c, 0);
      map.set(groupId, current);
    }
    return Array.from(map.values());
  }

  migrateFromJson(configDir: string, groupsFromConfig: Record<string, GroupGuardSettings>): void {
    if (this.isMigrated()) return;
    const runChunk = (fn: () => void) => this.runInTransaction(fn);
    if (groupsFromConfig && Object.keys(groupsFromConfig).length) {
      this.saveGroupConfigs(groupsFromConfig);
    }
    const groupsDirs = Array.from(new Set([
      path.join(configDir, 'data', 'groups'),
      path.join(contextStateService.getDataDir() || path.join(configDir, 'data'), 'groups'),
      path.join(contextStateService.getDataDir() || path.join(configDir, 'data'), 'data', 'groups'),
      path.join(configDir, 'groups')
    ].map(p => path.resolve(p))));

    const importGroupDir = (gid: string, groupPath: string) => {
      const cfg = readJsonFile(path.join(groupPath, 'config.json')) || {};
      const qa = readJsonFile(path.join(groupPath, 'qa.json')) || [];
      cfg.qaList = qa;
      this.saveGroupConfig(gid, cfg);
      const activity = readJsonFile(path.join(groupPath, 'activity.json')) || {};
      const signin = readJsonFile(path.join(groupPath, 'signin.json')) || {};
      const invites = readJsonFile(path.join(groupPath, 'invites.json')) || {};
      const warnings = readJsonFile(path.join(groupPath, 'warnings.json')) || {};
      const joinLogs = readJsonFile(path.join(groupPath, 'join_logs.json')) || [];
      this.importActivity(gid, activity, runChunk);
      this.importSignin(gid, signin, runChunk);
      this.importInvites(gid, invites, runChunk);
      this.importWarnings(gid, warnings, runChunk);
      this.importJoinLogs(gid, joinLogs, runChunk);
    };

    for (const groupsDir of groupsDirs) {
      if (!fs.existsSync(groupsDir)) continue;
      const entries = fs.readdirSync(groupsDir);
      const fileGroupIds = entries.filter(n => n.endsWith('.json'));
      for (const file of fileGroupIds) {
        const gid = file.replace(/\.json$/i, '');
        const cfg = readJsonFile(path.join(groupsDir, file));
        if (cfg) this.saveGroupConfig(gid, cfg);
      }
      const groupIds = entries.filter(n => fs.statSync(path.join(groupsDir, n)).isDirectory());
      for (const gid of groupIds) {
        importGroupDir(gid, path.join(groupsDir, gid));
      }
    }
    this.markMigrated();
  }

  private importActivity(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO activity(group_id, user_id, msg_count, last_active, msg_count_today, last_active_day) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber((v as any).msgCount, 0), toNumber((v as any).lastActive, 0), toNumber((v as any).msgCountToday ?? (v as any).todayCount, 0), String((v as any).lastActiveDay ?? (v as any).todayDate ?? ''));
        }
      });
    }
  }

  private importSignin(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO signin(group_id, user_id, last_signin, days, points) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber((v as any).lastSignin ?? (v as any).lastSigninTime, 0), toNumber((v as any).days ?? (v as any).streak, 0), toNumber((v as any).points, 0));
        }
      });
    }
  }

  private importInvites(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO invites(group_id, user_id, inviter_id, invite_count, invited_users_json) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, String((v as any).inviterId || ''), toNumber((v as any).inviteCount, 0), JSON.stringify((v as any).invitedUsers || []));
        }
      });
    }
  }

  private importWarnings(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO warnings(group_id, user_id, count) VALUES (?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber(v, 0));
        }
      });
    }
  }

  private importJoinLogs(groupId: string, rows: any[], tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const list = Array.isArray(rows) ? rows : [];
    const stmt = db.prepare('INSERT INTO join_logs(group_id, user_id, answer, passphrase_matched, action, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      tx(() => {
        for (const r of chunk) {
          stmt.run(groupId, String(r.userId || ''), String(r.answer || ''), r.passphraseMatched ? 1 : 0, String(r.action || 'reject'), String(r.reason || ''), toNumber(r.timestamp, Date.now()));
        }
      });
    }
  }

  getActivity(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT msg_count, last_active, msg_count_today, last_active_day FROM activity WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { msgCount: toNumber(row.msg_count, 0), lastActive: toNumber(row.last_active, 0), msgCountToday: toNumber(row.msg_count_today, 0), lastActiveDay: String(row.last_active_day || '') };
  }

  setActivity(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO activity(group_id, user_id, msg_count, last_active, msg_count_today, last_active_day) VALUES (?, ?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      toNumber(data?.msgCount, 0),
      toNumber(data?.lastActive, 0),
      toNumber(data?.msgCountToday ?? data?.todayCount, 0),
      String(data?.lastActiveDay ?? data?.todayDate ?? '')
    );
  }

  getAllActivity(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, msg_count, last_active, msg_count_today, last_active_day FROM activity WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { msgCount: toNumber(r.msg_count, 0), lastActive: toNumber(r.last_active, 0), msgCountToday: toNumber(r.msg_count_today, 0), lastActiveDay: String(r.last_active_day || '') };
    }
    return out;
  }

  getSignin(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT last_signin, days, points FROM signin WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { lastSignin: toNumber(row.last_signin, 0), days: toNumber(row.days, 0), points: toNumber(row.points, 0) };
  }

  setSignin(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO signin(group_id, user_id, last_signin, days, points) VALUES (?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      toNumber(data?.lastSignin ?? data?.lastSigninTime, 0),
      toNumber(data?.days ?? data?.streak, 0),
      toNumber(data?.points, 0)
    );
  }

  getAllSignin(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, last_signin, days, points FROM signin WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { lastSignin: toNumber(r.last_signin, 0), days: toNumber(r.days, 0), points: toNumber(r.points, 0) };
    }
    return out;
  }

  getInvite(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT inviter_id, invite_count, invited_users_json FROM invites WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { inviterId: String(row.inviter_id || ''), inviteCount: toNumber(row.invite_count, 0), invitedUsers: JSON.parse(String(row.invited_users_json || '[]')) };
  }

  setInvite(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO invites(group_id, user_id, inviter_id, invite_count, invited_users_json) VALUES (?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      String(data?.inviterId || ''),
      toNumber(data?.inviteCount, 0),
      JSON.stringify(data?.invitedUsers || [])
    );
  }

  getAllInvites(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, inviter_id, invite_count, invited_users_json FROM invites WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { inviterId: String(r.inviter_id || ''), inviteCount: toNumber(r.invite_count, 0), invitedUsers: JSON.parse(String(r.invited_users_json || '[]')) };
    }
    return out;
  }

  clearInvites(groupId: string): void {
    const db = this.assertReady();
    db.prepare('DELETE FROM invites WHERE group_id = ?').run(groupId);
  }

  getWarning(groupId: string, userId: string): number {
    const db = this.assertReady();
    const row = db.prepare('SELECT count FROM warnings WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return row ? toNumber(row.count, 0) : 0;
  }

  setWarning(groupId: string, userId: string, count: number): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO warnings(group_id, user_id, count) VALUES (?, ?, ?)').run(groupId, userId, toNumber(count, 0));
  }

  getSubPlayer(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare(`SELECT group_id, user_id, nickname, gold, value, exp, level, title, servant_name, master_id, last_welfare_day, last_action_at, created_at, updated_at
      FROM sub_players WHERE group_id = ? AND user_id = ?`).get(String(groupId), String(userId));
    if (!row) return undefined;
    return {
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      nickname: String(row.nickname || ''),
      gold: toNumber(row.gold, 0),
      value: toNumber(row.value, 0),
      exp: toNumber(row.exp, 0),
      level: toNumber(row.level, 1),
      title: String(row.title || ''),
      servantName: String(row.servant_name || ''),
      masterId: String(row.master_id || ''),
      lastWelfareDay: String(row.last_welfare_day || ''),
      lastActionAt: toNumber(row.last_action_at, 0),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  upsertSubPlayer(record: any): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`INSERT OR REPLACE INTO sub_players(
      group_id, user_id, nickname, gold, value, exp, level, title, servant_name, master_id, last_welfare_day, last_action_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(record.groupId || record.group_id || ''),
      String(record.userId || record.user_id || ''),
      String(record.nickname || ''),
      toNumber(record.gold, 0),
      toNumber(record.value, 0),
      toNumber(record.exp, 0),
      toNumber(record.level, 1),
      String(record.title || ''),
      String(record.servantName || record.servant_name || ''),
      String(record.masterId || record.master_id || ''),
      String(record.lastWelfareDay || record.last_welfare_day || ''),
      toNumber(record.lastActionAt || record.last_action_at, 0),
      toNumber(record.createdAt || record.created_at, now),
      now
    );
  }

  listSubPlayersByRank(groupId: string, rankBy: 'gold' | 'value' | 'level', limit = 10): any[] {
    const db = this.assertReady();
    const column = rankBy === 'value' ? 'value' : rankBy === 'level' ? 'level' : 'gold';
    const secondary = rankBy === 'level' ? ', exp DESC' : '';
    const rows = db.prepare(`SELECT group_id, user_id, nickname, gold, value, exp, level, title, servant_name, master_id, last_welfare_day, last_action_at, created_at, updated_at
      FROM sub_players WHERE group_id = ? ORDER BY ${column} DESC${secondary}, updated_at DESC LIMIT ?`).all(String(groupId), Math.max(1, Math.min(100, Math.floor(limit))));
    return rows.map((row: any) => ({
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      nickname: String(row.nickname || ''),
      gold: toNumber(row.gold, 0),
      value: toNumber(row.value, 0),
      exp: toNumber(row.exp, 0),
      level: toNumber(row.level, 1),
      title: String(row.title || ''),
      servantName: String(row.servant_name || ''),
      masterId: String(row.master_id || ''),
      lastWelfareDay: String(row.last_welfare_day || ''),
      lastActionAt: toNumber(row.last_action_at, 0),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  getSubContractByServant(groupId: string, servantId: string): any {
    const db = this.assertReady();
    const row = db.prepare(`SELECT group_id, master_id, servant_id, price, state, servant_name, created_at, updated_at
      FROM sub_contracts WHERE group_id = ? AND servant_id = ?`).get(String(groupId), String(servantId));
    if (!row) return undefined;
    return {
      groupId: String(row.group_id || ''),
      masterId: String(row.master_id || ''),
      servantId: String(row.servant_id || ''),
      price: toNumber(row.price, 0),
      state: String(row.state || 'active'),
      servantName: String(row.servant_name || ''),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  listSubContractsByMaster(groupId: string, masterId: string): any[] {
    const db = this.assertReady();
    const rows = db.prepare(`SELECT group_id, master_id, servant_id, price, state, servant_name, created_at, updated_at
      FROM sub_contracts WHERE group_id = ? AND master_id = ? AND state = 'active' ORDER BY price DESC, updated_at DESC`).all(String(groupId), String(masterId));
    return rows.map((row: any) => ({
      groupId: String(row.group_id || ''),
      masterId: String(row.master_id || ''),
      servantId: String(row.servant_id || ''),
      price: toNumber(row.price, 0),
      state: String(row.state || 'active'),
      servantName: String(row.servant_name || ''),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  upsertSubContract(record: any): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`INSERT OR REPLACE INTO sub_contracts(group_id, master_id, servant_id, price, state, servant_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(record.groupId || record.group_id || ''),
      String(record.masterId || record.master_id || ''),
      String(record.servantId || record.servant_id || ''),
      toNumber(record.price, 0),
      String(record.state || 'active'),
      String(record.servantName || record.servant_name || ''),
      toNumber(record.createdAt || record.created_at, now),
      now
    );
  }

  deleteSubContract(groupId: string, servantId: string): void {
    const db = this.assertReady();
    db.prepare('DELETE FROM sub_contracts WHERE group_id = ? AND servant_id = ?').run(String(groupId), String(servantId));
  }

  getSubRacingPlayer(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare(`SELECT group_id, user_id, racer_name, car_coins, fuel, wins, losses, champions, career_runs, active_car_id, owned_cars_json, last_duel_at, created_at, updated_at
      FROM sub_racing_players WHERE group_id = ? AND user_id = ?`).get(String(groupId), String(userId));
    if (!row) return undefined;
    const ownedCars = parseJsonArray(String(row.owned_cars_json || '[]'));
    return {
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      racerName: String(row.racer_name || ''),
      carCoins: toNumber(row.car_coins, 0),
      fuel: toNumber(row.fuel, 0),
      wins: toNumber(row.wins, 0),
      losses: toNumber(row.losses, 0),
      champions: toNumber(row.champions, 0),
      careerRuns: toNumber(row.career_runs, 0),
      activeCarId: String(row.active_car_id || 'starter'),
      ownedCars: ownedCars.length ? ownedCars : ['starter'],
      lastDuelAt: toNumber(row.last_duel_at, 0),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  upsertSubRacingPlayer(record: any): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`INSERT OR REPLACE INTO sub_racing_players(
      group_id, user_id, racer_name, car_coins, fuel, wins, losses, champions, career_runs, active_car_id, owned_cars_json, last_duel_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(record.groupId || record.group_id || ''),
      String(record.userId || record.user_id || ''),
      String(record.racerName || record.racer_name || ''),
      toNumber(record.carCoins || record.car_coins, 0),
      toNumber(record.fuel, 0),
      toNumber(record.wins, 0),
      toNumber(record.losses, 0),
      toNumber(record.champions, 0),
      toNumber(record.careerRuns || record.career_runs, 0),
      String(record.activeCarId || record.active_car_id || 'starter'),
      JSON.stringify(Array.isArray(record.ownedCars) ? record.ownedCars : ['starter']),
      toNumber(record.lastDuelAt || record.last_duel_at, 0),
      toNumber(record.createdAt || record.created_at, now),
      now
    );
  }

  listSubRacingPlayersByRank(groupId: string, rankBy: 'wins' | 'champions', limit = 10): any[] {
    const db = this.assertReady();
    const column = rankBy === 'champions' ? 'champions' : 'wins';
    const rows = db.prepare(`SELECT group_id, user_id, racer_name, car_coins, fuel, wins, losses, champions, career_runs, active_car_id, owned_cars_json, last_duel_at, created_at, updated_at
      FROM sub_racing_players WHERE group_id = ? ORDER BY ${column} DESC, wins DESC, updated_at DESC LIMIT ?`).all(String(groupId), Math.max(1, Math.min(100, Math.floor(limit))));
    return rows.map((row: any) => ({
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      racerName: String(row.racer_name || ''),
      carCoins: toNumber(row.car_coins, 0),
      fuel: toNumber(row.fuel, 0),
      wins: toNumber(row.wins, 0),
      losses: toNumber(row.losses, 0),
      champions: toNumber(row.champions, 0),
      careerRuns: toNumber(row.career_runs, 0),
      activeCarId: String(row.active_car_id || 'starter'),
      ownedCars: parseJsonArray(String(row.owned_cars_json || '[]')),
      lastDuelAt: toNumber(row.last_duel_at, 0),
      createdAt: toNumber(row.created_at, 0),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  insertSubGameplayEvent(entry: any): void {
    const db = this.assertReady();
    db.prepare(`INSERT INTO sub_gameplay_events(group_id, module, action, actor_id, target_id, amount, status, detail, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(entry.groupId || entry.group_id || ''),
      String(entry.module || ''),
      String(entry.action || ''),
      String(entry.actorId || entry.actor_id || ''),
      String(entry.targetId || entry.target_id || ''),
      toNumber(entry.amount, 0),
      String(entry.status || ''),
      String(entry.detail || ''),
      JSON.stringify(entry.payload || {}),
      toNumber(entry.createdAt || entry.created_at, Date.now())
    );
  }

  listSubGameplayEvents(groupId: string, limit = 50): any[] {
    const db = this.assertReady();
    const rows = db.prepare(`SELECT id, group_id, module, action, actor_id, target_id, amount, status, detail, payload_json, created_at
      FROM sub_gameplay_events WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(
      String(groupId),
      Math.max(1, Math.min(200, Math.floor(limit)))
    );
    return rows.map((row: any) => ({
      id: toNumber(row.id, 0),
      groupId: String(row.group_id || ''),
      module: String(row.module || ''),
      action: String(row.action || ''),
      actorId: String(row.actor_id || ''),
      targetId: String(row.target_id || ''),
      amount: toNumber(row.amount, 0),
      status: String(row.status || ''),
      detail: String(row.detail || ''),
      payload: parseJson(String(row.payload_json || '{}')) || {},
      createdAt: toNumber(row.created_at, 0)
    }));
  }

  upsertSubResource(record: any): void {
    const db = this.assertReady();
    db.prepare(`INSERT OR REPLACE INTO sub_resources(group_id, resource_key, module, resource_type, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      String(record.groupId || record.group_id || ''),
      String(record.key || record.resourceKey || record.resource_key || ''),
      String(record.module || ''),
      String(record.type || record.resourceType || record.resource_type || 'text'),
      String(record.value || ''),
      Date.now()
    );
  }

  listSubResources(groupId = ''): any[] {
    const db = this.assertReady();
    const rows = db.prepare(`SELECT group_id, resource_key, module, resource_type, value, updated_at
      FROM sub_resources WHERE group_id = '' OR group_id = ? ORDER BY module ASC, resource_key ASC`).all(String(groupId || ''));
    return rows.map((row: any) => ({
      groupId: String(row.group_id || ''),
      key: String(row.resource_key || ''),
      module: String(row.module || ''),
      type: String(row.resource_type || 'text'),
      value: String(row.value || ''),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  insertJoinLog(entry: JoinLogEntry): void {
    const db = this.assertReady();
    db.prepare('INSERT INTO join_logs(group_id, user_id, answer, passphrase_matched, action, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      String(entry.groupId || ''),
      String(entry.userId || ''),
      String(entry.answer || ''),
      entry.passphraseMatched ? 1 : 0,
      String(entry.action || 'reject'),
      String(entry.reason || ''),
      toNumber(entry.timestamp, Date.now())
    );
  }

  insertAuditEvent(entry: AuditEventRecord): void {
    const db = this.assertReady();
    const payloadText = String(entry.payload || '{}');
    const createdAt = toNumber(entry.createdAt, Date.now());
    const info = db.prepare('INSERT INTO audit_events(event_type, kind, group_id, user_id, message_id, handled, reason, risk_score, risk_level, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      String(entry.eventType || 'risk_signal'),
      String(entry.kind || ''),
      String(entry.groupId || ''),
      String(entry.userId || ''),
      String(entry.messageId || ''),
      entry.handled ? 1 : 0,
      String(entry.reason || ''),
      toNumber(entry.riskScore, 0),
      String(entry.riskLevel || ''),
      payloadText,
      createdAt
    );
    const auditEventId = toNumber(info?.lastInsertRowid, 0);
    if (auditEventId > 0) {
      const stmt = db.prepare('INSERT OR IGNORE INTO audit_event_links(link_type, link_value, audit_event_id, created_at) VALUES (?, ?, ?, ?)');
      for (const link of collectAuditLinks(payloadText)) stmt.run(link.type, link.value, auditEventId, createdAt);
    }
    this.pruneAuditEventsIfDue();
  }

  setAuditRetentionPolicy(policy: AuditRetentionPolicy = {}): void {
    this.auditRetentionPolicy = {
      maxAgeDays: Math.max(1, Math.min(3650, toNumber(policy.maxAgeDays, 30))),
      maxRows: Math.max(100, Math.min(1000000, toNumber(policy.maxRows, 20000)))
    };
  }

  setAuditRetentionLogHandler(handler: AuditRetentionLogHandler | null): void {
    this.auditRetentionLogHandler = handler;
  }

  setActionQueueEventRetentionPolicy(policy: ActionQueueEventRetentionPolicy = {}): void {
    this.actionQueueEventRetentionPolicy = {
      maxAgeDays: Math.max(1, Math.min(3650, toNumber(policy.maxAgeDays, 7))),
      maxRows: Math.max(100, Math.min(1000000, toNumber(policy.maxRows, 50000)))
    };
  }

  setActionQueueEventRetentionLogHandler(handler: ActionQueueEventRetentionLogHandler | null): void {
    this.actionQueueEventRetentionLogHandler = handler;
  }

  getRecentAuditEvents(query: AuditEventQuery | number = 200): AuditEventRecord[] {
    return this.queryAuditEvents(query).rows;
  }

  queryAuditEvents(query: AuditEventQuery | number = 200): AuditEventPage {
    const db = this.assertReady();
    const normalizedQuery: AuditEventQuery = typeof query === 'number' ? { limit: query } : (query || {});
    const where: string[] = [];
    const params: any[] = [];
    if (normalizedQuery.groupId) {
      where.push('group_id = ?');
      params.push(String(normalizedQuery.groupId));
    }
    if (normalizedQuery.userId) {
      where.push('user_id = ?');
      params.push(String(normalizedQuery.userId));
    }
    if (normalizedQuery.eventType) {
      where.push('event_type = ?');
      params.push(String(normalizedQuery.eventType));
    }
    if (normalizedQuery.correlationId) {
      const correlation = String(normalizedQuery.correlationId).replace(/%/g, '\\%').replace(/_/g, '\\_');
      where.push("payload_json LIKE ? ESCAPE '\\'");
      params.push(`%"correlationId":"${correlation}"%`);
    }
    const limit = Math.max(1, Math.min(500, toNumber(normalizedQuery.limit, 200)));
    const offset = Math.max(0, toNumber(normalizedQuery.offset, 0));
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.prepare(`SELECT COUNT(1) AS c FROM audit_events ${whereSql}`).get(...params);
      const rows = db.prepare(`SELECT id, event_type, kind, group_id, user_id, message_id, handled, reason, risk_score, risk_level, payload_json, created_at
       FROM audit_events
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const mappedRows = (rows || []).map((row: any) => ({
      id: toNumber(row.id, 0),
      eventType: String(row.event_type || 'risk_signal') as AuditEventRecord['eventType'],
      kind: String(row.kind || ''),
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      messageId: String(row.message_id || '') || undefined,
      handled: !!row.handled,
      reason: String(row.reason || ''),
      riskScore: toNumber(row.risk_score, 0),
      riskLevel: String(row.risk_level || ''),
      payload: String(row.payload_json || '{}'),
      createdAt: toNumber(row.created_at, 0)
    }));
    const total = Math.max(0, toNumber(totalRow?.c, mappedRows.length));
    return { rows: mappedRows, total, limit, offset, hasMore: offset + mappedRows.length < total };
  }

  getAuditEventsByQueueTaskId(queueTaskId: string, limit = 20): AuditEventRecord[] {
    const db = this.assertReady();
    const taskId = String(queueTaskId || '').trim();
    if (!taskId) return [];
    const safeLimit = Math.max(1, Math.min(100, toNumber(limit, 20)));
    let rows = db.prepare(`SELECT a.id, a.event_type, a.kind, a.group_id, a.user_id, a.message_id, a.handled, a.reason, a.risk_score, a.risk_level, a.payload_json, a.created_at
      FROM audit_event_links l
      JOIN audit_events a ON a.id = l.audit_event_id
      WHERE l.link_type = 'queue_task_id' AND l.link_value = ?
      ORDER BY a.created_at DESC
      LIMIT ?`).all(taskId, safeLimit);
    if (!rows || !rows.length) {
      const like = `%\"queueTaskId\":\"${taskId.replace(/%/g, '\\%').replace(/_/g, '\\_')}\"%`;
      rows = db.prepare(`SELECT id, event_type, kind, group_id, user_id, message_id, handled, reason, risk_score, risk_level, payload_json, created_at
        FROM audit_events
        WHERE payload_json LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC
        LIMIT ?`).all(like, safeLimit);
    }
    return (rows || []).map((row: any) => ({
      id: toNumber(row.id, 0),
      eventType: String(row.event_type || 'risk_signal') as AuditEventRecord['eventType'],
      kind: String(row.kind || ''),
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || ''),
      messageId: String(row.message_id || '') || undefined,
      handled: !!row.handled,
      reason: String(row.reason || ''),
      riskScore: toNumber(row.risk_score, 0),
      riskLevel: String(row.risk_level || ''),
      payload: String(row.payload_json || '{}'),
      createdAt: toNumber(row.created_at, 0)
    }));
  }

  insertActionQueueEvent(entry: ActionQueueEventRecord): void {
    const db = this.assertReady();
    db.prepare(`INSERT INTO action_queue_events(task_id, action_id, task_type, group_id, user_id, message_id, event, code, ok, reason, attempt_count, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(entry.taskId || ''),
      String(entry.actionId || ''),
      String(entry.taskType || ''),
      String(entry.groupId || ''),
      String(entry.userId || ''),
      String(entry.messageId || ''),
      String(entry.event || ''),
      String(entry.code || ''),
      entry.ok === true ? 1 : 0,
      String(entry.reason || ''),
      toNumber(entry.attemptCount, 0),
      String(entry.payload || '{}'),
      toNumber(entry.createdAt, Date.now())
    );
    this.pruneActionQueueEventsIfDue();
  }

  getActionQueueEventsByTaskId(taskId: string, limit = 100): ActionQueueEventRecord[] {
    const db = this.assertReady();
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) return [];
    const safeLimit = Math.max(1, Math.min(500, toNumber(limit, 100)));
    const rows = db.prepare(`SELECT id, task_id, action_id, task_type, group_id, user_id, message_id, event, code, ok, reason, attempt_count, payload_json, created_at
      FROM action_queue_events
      WHERE task_id = ?
      ORDER BY created_at ASC
      LIMIT ?`).all(safeTaskId, safeLimit);
    return (rows || []).map((row: any) => ({
      id: toNumber(row.id, 0),
      taskId: String(row.task_id || ''),
      actionId: String(row.action_id || ''),
      taskType: String(row.task_type || ''),
      groupId: String(row.group_id || ''),
      userId: String(row.user_id || '') || undefined,
      messageId: String(row.message_id || '') || undefined,
      event: String(row.event || ''),
      code: String(row.code || ''),
      ok: !!row.ok,
      reason: String(row.reason || ''),
      attemptCount: toNumber(row.attempt_count, 0),
      payload: String(row.payload_json || '{}'),
      createdAt: toNumber(row.created_at, 0)
    }));
  }

  insertBotSendEvent(entry: BotSendEventRecord): void {
    const db = this.assertReady();
    const createdAt = toNumber(entry.createdAt, Date.now());
    db.prepare(`INSERT INTO bot_send_events(group_id, scene, message_type, message_id, content_length, has_media, force, apply_template, template_applied, suffix_applied, suffix_mode, random_delay_ms, queued_at, sent_at, self_recall_due_at, status, reason, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(entry.groupId || ''),
      String(entry.scene || ''),
      String(entry.messageType || 'text'),
      String(entry.messageId || ''),
      Math.max(0, toNumber(entry.contentLength, 0)),
      entry.hasMedia ? 1 : 0,
      entry.force ? 1 : 0,
      entry.applyTemplate !== false ? 1 : 0,
      entry.templateApplied ? 1 : 0,
      entry.suffixApplied ? 1 : 0,
      String(entry.suffixMode || ''),
      Math.max(0, toNumber(entry.randomDelayMs, 0)),
      toNumber(entry.queuedAt, createdAt),
      toNumber(entry.sentAt, 0),
      toNumber(entry.selfRecallDueAt, 0),
      String(entry.status || 'queued'),
      String(entry.reason || ''),
      String(entry.payload || '{}'),
      createdAt
    );
  }

  getBotSendStats(query: BotSendStatsQuery = {}): BotSendStatsView {
    const db = this.assertReady();
    const sinceMs = Math.max(0, toNumber(query.sinceMs, Date.now() - 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(100, toNumber(query.limit, 10)));
    const totalRow = db.prepare(`SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN suffix_applied = 1 THEN 1 ELSE 0 END) AS suffix_applied,
        SUM(CASE WHEN template_applied = 1 THEN 1 ELSE 0 END) AS template_applied,
        SUM(CASE WHEN sent_at > 0 AND message_id = '' THEN 1 ELSE 0 END) AS message_id_missing,
        AVG(random_delay_ms) AS avg_delay
      FROM bot_send_events
      WHERE created_at >= ?`).get(sinceMs);
    const selfRecallRow = db.prepare(`SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status IN ('scheduled', 'queued') THEN 1 ELSE 0 END) AS pending
      FROM self_recall_tasks
      WHERE created_at >= ? AND source IN ('send_group_msg', 'message_event')`).get(sinceMs);
    const sceneRows = db.prepare(`SELECT scene,
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM bot_send_events
      WHERE created_at >= ?
      GROUP BY scene
      ORDER BY total DESC
      LIMIT ?`).all(sinceMs, limit);
    const groupRows = db.prepare(`SELECT group_id,
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM bot_send_events
      WHERE created_at >= ? AND group_id != ''
      GROUP BY group_id
      ORDER BY total DESC
      LIMIT ?`).all(sinceMs, limit);
    const recentRows = db.prepare(`SELECT id, group_id, scene, message_type, message_id, content_length, has_media, force, apply_template, template_applied, suffix_applied, suffix_mode, random_delay_ms, queued_at, sent_at, self_recall_due_at, status, reason, payload_json, created_at
      FROM bot_send_events
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?`).all(sinceMs, limit);
    const mapSendEvent = (row: any): BotSendEventRecord => ({
      id: toNumber(row.id, 0),
      groupId: String(row.group_id || ''),
      scene: String(row.scene || ''),
      messageType: String(row.message_type || 'text'),
      messageId: String(row.message_id || '') || undefined,
      contentLength: toNumber(row.content_length, 0),
      hasMedia: !!row.has_media,
      force: !!row.force,
      applyTemplate: !!row.apply_template,
      templateApplied: !!row.template_applied,
      suffixApplied: !!row.suffix_applied,
      suffixMode: String(row.suffix_mode || '') || undefined,
      randomDelayMs: toNumber(row.random_delay_ms, 0),
      queuedAt: toNumber(row.queued_at, 0),
      sentAt: toNumber(row.sent_at, 0) || undefined,
      selfRecallDueAt: toNumber(row.self_recall_due_at, 0) || undefined,
      status: String(row.status || 'queued') as BotSendEventRecord['status'],
      reason: String(row.reason || '') || undefined,
      payload: String(row.payload_json || '{}'),
      createdAt: toNumber(row.created_at, 0)
    });
    const mapRank = (row: any, key: 'scene' | 'group_id') => ({
      [key === 'scene' ? 'scene' : 'groupId']: String(row[key] || ''),
      count: toNumber(row.total, 0),
      sent: toNumber(row.sent, 0),
      dropped: toNumber(row.dropped, 0),
      failed: toNumber(row.failed, 0)
    });
    return {
      sinceMs,
      total: toNumber(totalRow?.total, 0),
      sent: toNumber(totalRow?.sent, 0),
      dropped: toNumber(totalRow?.dropped, 0),
      failed: toNumber(totalRow?.failed, 0),
      suffixApplied: toNumber(totalRow?.suffix_applied, 0),
      templateApplied: toNumber(totalRow?.template_applied, 0),
      withSelfRecall: toNumber(selfRecallRow?.total, 0),
      selfRecallSuccess: toNumber(selfRecallRow?.success, 0),
      selfRecallFailed: toNumber(selfRecallRow?.failed, 0),
      selfRecallPending: toNumber(selfRecallRow?.pending, 0),
      messageIdMissing: toNumber(totalRow?.message_id_missing, 0),
      avgDelayMs: Math.round(toNumber(totalRow?.avg_delay, 0)),
      byScene: (sceneRows || []).map((row: any) => mapRank(row, 'scene') as BotSendStatsView['byScene'][number]),
      topGroups: (groupRows || []).map((row: any) => mapRank(row, 'group_id') as BotSendStatsView['topGroups'][number]),
      recent: (recentRows || []).map(mapSendEvent)
    };
  }

  getActionQueueEventStats(query: ActionQueueEventStatsQuery = {}): ActionQueueEventStatsView {
    const db = this.assertReady();
    const sinceMs = Math.max(0, toNumber(query.sinceMs, Date.now() - 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(100, toNumber(query.limit, 10)));
    const totalRow = db.prepare('SELECT COUNT(1) AS c FROM action_queue_events WHERE created_at >= ?').get(sinceMs);
    const eventRows = db.prepare(`SELECT event, COUNT(1) AS c
      FROM action_queue_events
      WHERE created_at >= ?
      GROUP BY event
      ORDER BY c DESC`).all(sinceMs);
    const typeRows = db.prepare(`SELECT task_type, COUNT(1) AS c
      FROM action_queue_events
      WHERE created_at >= ?
      GROUP BY task_type
      ORDER BY c DESC`).all(sinceMs);
    const groupRows = db.prepare(`SELECT group_id, COUNT(1) AS c
      FROM action_queue_events
      WHERE created_at >= ? AND group_id != ''
      GROUP BY group_id
      ORDER BY c DESC
      LIMIT ?`).all(sinceMs, limit);
    const userRows = db.prepare(`SELECT user_id, COUNT(1) AS c
      FROM action_queue_events
      WHERE created_at >= ? AND user_id != ''
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT ?`).all(sinceMs, limit);
    const taskRows = db.prepare(`SELECT
        e.task_id,
        (SELECT task_type FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS task_type,
        (SELECT group_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS group_id,
        (SELECT user_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS user_id,
        (SELECT event FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_event,
        COUNT(1) AS c,
        MAX(created_at) AS updated_at
      FROM action_queue_events e
      WHERE e.created_at >= ? AND e.task_id != ''
      GROUP BY e.task_id
      ORDER BY updated_at DESC
      LIMIT ?`).all(sinceMs, limit);
    const byEvent: Record<string, number> = {};
    const byTaskType: Record<string, number> = {};
    for (const row of eventRows || []) byEvent[String(row.event || 'unknown')] = toNumber(row.c, 0);
    for (const row of typeRows || []) byTaskType[String(row.task_type || 'unknown')] = toNumber(row.c, 0);
    return {
      sinceMs,
      total: toNumber(totalRow?.c, 0),
      byEvent,
      byTaskType,
      topGroups: (groupRows || []).map((row: any) => ({ groupId: String(row.group_id || ''), count: toNumber(row.c, 0) })),
      topUsers: (userRows || []).map((row: any) => ({ userId: String(row.user_id || ''), count: toNumber(row.c, 0) })),
      topTasks: (taskRows || []).map((row: any) => ({
        taskId: String(row.task_id || ''),
        taskType: String(row.task_type || ''),
        groupId: String(row.group_id || ''),
        userId: String(row.user_id || '') || undefined,
        lastEvent: String(row.last_event || ''),
        count: toNumber(row.c, 0),
        updatedAt: toNumber(row.updated_at, 0)
      }))
    };
  }

  searchActionQueueEvents(query: ActionQueueEventSearchQuery = {}): ActionQueueEventSearchView {
    const db = this.assertReady();
    const where: string[] = [];
    const params: any[] = [];
    const pushFilter = (field: string, value: unknown) => {
      const text = String(value || '').trim();
      if (!text) return;
      where.push(`${field} = ?`);
      params.push(text);
    };
    pushFilter('e.task_id', query.taskId);
    pushFilter('e.action_id', query.actionId);
    pushFilter('e.group_id', query.groupId);
    pushFilter('e.user_id', query.userId);
    pushFilter('e.message_id', query.messageId);
    pushFilter('e.event', query.event);
    if (!where.length) return { query, candidates: [] };
    const limit = Math.max(1, Math.min(100, toNumber(query.limit, 20)));
    const rows = db.prepare(`SELECT
        e.task_id,
        (SELECT action_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS action_id,
        (SELECT task_type FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS task_type,
        (SELECT group_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS group_id,
        (SELECT user_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS user_id,
        (SELECT message_id FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS message_id,
        (SELECT event FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_event,
        (SELECT code FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS code,
        (SELECT ok FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS ok,
        (SELECT reason FROM action_queue_events x WHERE x.task_id = e.task_id ORDER BY created_at DESC, id DESC LIMIT 1) AS reason,
        COUNT(1) AS c,
        MAX(created_at) AS updated_at
      FROM action_queue_events e
      WHERE ${where.join(' AND ')}
      GROUP BY e.task_id
      ORDER BY updated_at DESC
      LIMIT ?`).all(...params, limit);
    return {
      query,
      candidates: (rows || []).map((row: any) => ({
        taskId: String(row.task_id || ''),
        actionId: String(row.action_id || '') || undefined,
        taskType: String(row.task_type || ''),
        groupId: String(row.group_id || ''),
        userId: String(row.user_id || '') || undefined,
        messageId: String(row.message_id || '') || undefined,
        lastEvent: String(row.last_event || ''),
        code: String(row.code || '') || undefined,
        ok: !!row.ok,
        reason: String(row.reason || '') || undefined,
        count: toNumber(row.c, 0),
        updatedAt: toNumber(row.updated_at, 0)
      }))
    };
  }

  getAuditStats(query: AuditStatsQuery = {}): AuditStatsView {
    const db = this.assertReady();
    const sinceMs = Math.max(0, toNumber(query.sinceMs, Date.now() - 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(100, toNumber(query.limit, 10)));
    const totalRow = db.prepare('SELECT COUNT(1) AS c FROM audit_events WHERE created_at >= ?').get(sinceMs);
    const typeRows = db.prepare(`SELECT event_type, COUNT(1) AS c
      FROM audit_events
      WHERE created_at >= ?
      GROUP BY event_type`).all(sinceMs);
    const groupRows = db.prepare(`SELECT group_id, COUNT(1) AS c
      FROM audit_events
      WHERE created_at >= ? AND group_id != ''
      GROUP BY group_id
      ORDER BY c DESC
      LIMIT ?`).all(sinceMs, limit);
    const userRows = db.prepare(`SELECT user_id, COUNT(1) AS c
      FROM audit_events
      WHERE created_at >= ? AND user_id != ''
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT ?`).all(sinceMs, limit);
    const byType: AuditStatsView['byType'] = {
      risk_signal: 0,
      risk_assessment: 0,
      policy_decision: 0,
      manual_policy_action: 0,
      content_risk: 0
    };
    for (const row of typeRows || []) {
      const type = String(row.event_type || '') as keyof typeof byType;
      if (type in byType) byType[type] = toNumber(row.c, 0);
    }
    return {
      sinceMs,
      total: toNumber(totalRow?.c, 0),
      byType,
      topGroups: (groupRows || []).map((row: any) => ({ groupId: String(row.group_id || ''), count: toNumber(row.c, 0) })),
      topUsers: (userRows || []).map((row: any) => ({ userId: String(row.user_id || ''), count: toNumber(row.c, 0) }))
    };
  }

  getAuditUserProfile(query: AuditUserProfileQuery): AuditUserProfileView {
    const db = this.assertReady();
    const userId = String(query.userId || '').trim();
    const sinceMs = Math.max(0, toNumber(query.sinceMs, Date.now() - 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(100, toNumber(query.limit, 20)));
    const emptyByType: AuditUserProfileView['byType'] = {
      risk_signal: 0,
      risk_assessment: 0,
      policy_decision: 0,
      manual_policy_action: 0,
      content_risk: 0
    };
    if (!userId) {
      return { userId, sinceMs, total: 0, byType: emptyByType, highestScore: 0, latestRiskLevel: '', groups: [], recentQueueTaskIds: [], recentActions: [], recentEvents: [] };
    }
    const totalRow = db.prepare('SELECT COUNT(1) AS c, MAX(risk_score) AS max_score FROM audit_events WHERE user_id = ? AND created_at >= ?').get(userId, sinceMs);
    const typeRows = db.prepare(`SELECT event_type, COUNT(1) AS c
      FROM audit_events
      WHERE user_id = ? AND created_at >= ?
      GROUP BY event_type`).all(userId, sinceMs);
    const groupRows = db.prepare(`SELECT group_id, COUNT(1) AS c
      FROM audit_events
      WHERE user_id = ? AND created_at >= ? AND group_id != ''
      GROUP BY group_id
      ORDER BY c DESC
      LIMIT 20`).all(userId, sinceMs);
    const latestRiskRow = db.prepare(`SELECT risk_level
      FROM audit_events
      WHERE user_id = ? AND created_at >= ? AND risk_level != ''
      ORDER BY created_at DESC
      LIMIT 1`).get(userId, sinceMs);
    const page = this.queryAuditEvents({ userId, limit, offset: 0 });
    const recentEvents = page.rows.filter(row => row.createdAt >= sinceMs);
    const byType = { ...emptyByType };
    for (const row of typeRows || []) {
      const type = String(row.event_type || '') as keyof typeof byType;
      if (type in byType) byType[type] = toNumber(row.c, 0);
    }
    const recentActions: AuditUserProfileView['recentActions'] = [];
    const queueTaskIds: string[] = [];
    for (const event of recentEvents) {
      let payload: any = null;
      try { payload = JSON.parse(String(event.payload || '{}')); } catch { payload = null; }
      const actions = Array.isArray(payload?.actions) ? payload.actions : [];
      const taskIds = [
          String(payload?.queueTaskId || ''),
          ...actions.map((action: any) => String(action?.queueTaskId || ''))
        ].map(item => item.trim()).filter(Boolean);
      for (const taskId of taskIds) {
        if (!queueTaskIds.includes(taskId)) queueTaskIds.push(taskId);
      }
      if (event.eventType === 'policy_decision' || event.eventType === 'manual_policy_action') {
        if (actions.length) {
          for (const action of actions.slice(0, 5)) {
            recentActions.push({
              eventType: event.eventType,
              actionType: String(action?.type || payload?.actionType || ''),
              decision: String(payload?.decision || ''),
              queueTaskId: String(action?.queueTaskId || payload?.queueTaskId || ''),
              reason: String(action?.reason || payload?.reason || event.reason || ''),
              createdAt: event.createdAt
            });
          }
        } else {
          recentActions.push({
            eventType: event.eventType,
            actionType: String(payload?.actionType || event.kind || ''),
            decision: String(payload?.decision || ''),
            queueTaskId: String(payload?.queueTaskId || ''),
            reason: String(payload?.reason || event.reason || ''),
            createdAt: event.createdAt
          });
        }
      }
    }
    return {
      userId,
      sinceMs,
      total: toNumber(totalRow?.c, 0),
      byType,
      highestScore: toNumber(totalRow?.max_score, 0),
      latestRiskLevel: String(latestRiskRow?.risk_level || ''),
      groups: (groupRows || []).map((row: any) => ({ groupId: String(row.group_id || ''), count: toNumber(row.c, 0) })),
      recentQueueTaskIds: queueTaskIds.slice(0, 20),
      recentActions: recentActions.slice(0, 20),
      recentEvents
    };
  }

  pruneAuditEvents(policy: AuditRetentionPolicy = {}): number {
    const db = this.assertReady();
    const basePolicy = { ...this.auditRetentionPolicy, ...policy };
    const maxAgeDays = Math.max(1, Math.min(3650, toNumber(basePolicy.maxAgeDays, 30)));
    const maxRows = Math.max(100, Math.min(1000000, toNumber(basePolicy.maxRows, 20000)));
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    const oldRows = db.prepare('DELETE FROM audit_events WHERE created_at < ?').run(cutoff);
    deleted += toNumber(oldRows?.changes, 0);
    const countRow = db.prepare('SELECT COUNT(1) AS c FROM audit_events').get();
    const overflow = toNumber(countRow?.c, 0) - maxRows;
    if (overflow > 0) {
      const overflowRows = db.prepare(`DELETE FROM audit_events
        WHERE id IN (
          SELECT id FROM audit_events
          ORDER BY created_at ASC, id ASC
          LIMIT ?
        )`).run(overflow);
      deleted += toNumber(overflowRows?.changes, 0);
    }
    return deleted;
  }

  pruneActionQueueEvents(policy: ActionQueueEventRetentionPolicy = {}): number {
    const db = this.assertReady();
    const basePolicy = { ...this.actionQueueEventRetentionPolicy, ...policy };
    const maxAgeDays = Math.max(1, Math.min(3650, toNumber(basePolicy.maxAgeDays, 7)));
    const maxRows = Math.max(100, Math.min(1000000, toNumber(basePolicy.maxRows, 50000)));
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    const oldRows = db.prepare('DELETE FROM action_queue_events WHERE created_at < ?').run(cutoff);
    deleted += toNumber(oldRows?.changes, 0);
    const countRow = db.prepare('SELECT COUNT(1) AS c FROM action_queue_events').get();
    const overflow = toNumber(countRow?.c, 0) - maxRows;
    if (overflow > 0) {
      const overflowRows = db.prepare(`DELETE FROM action_queue_events
        WHERE id IN (
          SELECT id FROM action_queue_events
          ORDER BY created_at ASC, id ASC
          LIMIT ?
        )`).run(overflow);
      deleted += toNumber(overflowRows?.changes, 0);
    }
    return deleted;
  }

  private pruneAuditEventsIfDue(): void {
    const now = Date.now();
    if (now - this.lastAuditPruneAt < 10 * 60 * 1000) return;
    this.lastAuditPruneAt = now;
    try {
      const deleted = this.pruneAuditEvents();
      if (deleted > 0 && this.auditRetentionLogHandler) {
        this.auditRetentionLogHandler({
          deleted,
          maxAgeDays: Math.max(1, Math.min(3650, toNumber(this.auditRetentionPolicy.maxAgeDays, 30))),
          maxRows: Math.max(100, Math.min(1000000, toNumber(this.auditRetentionPolicy.maxRows, 20000))),
          timestamp: now
        });
      }
    } catch {
      // Audit retention must never break the risk-control path.
    }
  }

  private pruneActionQueueEventsIfDue(): void {
    const now = Date.now();
    if (now - this.lastActionQueueEventPruneAt < 10 * 60 * 1000) return;
    this.lastActionQueueEventPruneAt = now;
    try {
      const deleted = this.pruneActionQueueEvents();
      if (deleted > 0 && this.actionQueueEventRetentionLogHandler) {
        this.actionQueueEventRetentionLogHandler({
          deleted,
          maxAgeDays: Math.max(1, Math.min(3650, toNumber(this.actionQueueEventRetentionPolicy.maxAgeDays, 7))),
          maxRows: Math.max(100, Math.min(1000000, toNumber(this.actionQueueEventRetentionPolicy.maxRows, 50000))),
          timestamp: now
        });
      }
    } catch {
      // Action history retention must never break queue execution or auditing.
    }
  }

  scheduleSelfRecallTask(input: SelfRecallScheduleInput): void {
    const db = this.assertReady();
    const now = Date.now();
    const row = db.prepare('SELECT task_id, status, created_at, attempt_count FROM self_recall_tasks WHERE task_id = ?').get(String(input.taskId));
    if (row && String(row.status || '') === 'success') return;
    const createdAt = row ? toNumber(row.created_at, now) : now;
    const attemptCount = row ? toNumber(row.attempt_count, 0) : 0;
    db.prepare(`INSERT OR REPLACE INTO self_recall_tasks(
      task_id, group_id, message_id, reason, source, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(input.taskId),
      String(input.groupId),
      String(input.messageId),
      String(input.reason || 'self_recall_event'),
      String(input.source || 'send_group_msg'),
      'scheduled',
      createdAt,
      toNumber(input.dueAt, now),
      toNumber(input.dueAt, now),
      attemptCount,
      Math.max(1, toNumber(input.maxAttempts, 2)),
      '',
      '',
      now
    );
  }

  getSelfRecallTask(taskId: string): SelfRecallTaskRecord | undefined {
    const db = this.assertReady();
    const row = db.prepare(`SELECT task_id, group_id, message_id, reason, source, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
      FROM self_recall_tasks
      WHERE task_id = ?
      LIMIT 1`).get(String(taskId));
    if (!row) return undefined;
    return {
      taskId: String(row.task_id || ''),
      groupId: String(row.group_id || ''),
      messageId: String(row.message_id || ''),
      reason: String(row.reason || ''),
      source: (String(row.source || 'send_group_msg') as SelfRecallTaskRecord['source']),
      status: (String(row.status || 'scheduled') as SelfRecallTaskRecord['status']),
      createdAt: toNumber(row.created_at, 0),
      dueAt: toNumber(row.due_at, 0),
      nextRetryAt: toNumber(row.next_retry_at, 0),
      attemptCount: toNumber(row.attempt_count, 0),
      maxAttempts: Math.max(1, toNumber(row.max_attempts, 2)),
      lastCode: String(row.last_code || ''),
      lastError: String(row.last_error || ''),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  markSelfRecallTaskQueued(taskId: string): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`UPDATE self_recall_tasks
      SET status = 'queued', updated_at = ?
      WHERE task_id = ? AND status IN ('scheduled', 'queued')`).run(now, String(taskId));
  }

  resolveSelfRecallTask(taskId: string, code: string, ok: boolean, retryAfterMs: number): void {
    const db = this.assertReady();
    const now = Date.now();
    const row = db.prepare('SELECT attempt_count, max_attempts FROM self_recall_tasks WHERE task_id = ?').get(String(taskId));
    if (!row) return;
    const attemptCount = toNumber(row.attempt_count, 0) + 1;
    const maxAttempts = Math.max(1, toNumber(row.max_attempts, 2));
    const normalizedCode = String(code || '');
    const success = ok || normalizedCode === 'ok' || normalizedCode === 'skip_duplicate';
    if (success) {
      db.prepare(`UPDATE self_recall_tasks
        SET status = 'success', attempt_count = ?, next_retry_at = 0, last_code = ?, last_error = '', updated_at = ?
        WHERE task_id = ?`).run(attemptCount, normalizedCode, now, String(taskId));
      return;
    }
    const hasRetry = retryAfterMs > 0 && attemptCount < maxAttempts;
    if (hasRetry) {
      const nextRetryAt = now + Math.max(1000, Math.floor(retryAfterMs));
      db.prepare(`UPDATE self_recall_tasks
        SET status = 'scheduled', attempt_count = ?, next_retry_at = ?, last_code = ?, last_error = ?, updated_at = ?
        WHERE task_id = ?`).run(attemptCount, nextRetryAt, normalizedCode, normalizedCode, now, String(taskId));
      return;
    }
    db.prepare(`UPDATE self_recall_tasks
      SET status = 'failed', attempt_count = ?, next_retry_at = 0, last_code = ?, last_error = ?, updated_at = ?
      WHERE task_id = ?`).run(attemptCount, normalizedCode, normalizedCode, now, String(taskId));
  }

  getDueSelfRecallTasks(nowTs: number, limit: number): SelfRecallTaskRecord[] {
    const db = this.assertReady();
    const rows = db.prepare(`SELECT task_id, group_id, message_id, reason, source, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
      FROM self_recall_tasks
      WHERE status = 'scheduled' AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
      LIMIT ?`).all(toNumber(nowTs, Date.now()), Math.max(1, toNumber(limit, 200)));
    return (rows || []).map((row: any) => ({
      taskId: String(row.task_id || ''),
      groupId: String(row.group_id || ''),
      messageId: String(row.message_id || ''),
      reason: String(row.reason || ''),
      source: (String(row.source || 'send_group_msg') as SelfRecallTaskRecord['source']),
      status: (String(row.status || 'scheduled') as SelfRecallTaskRecord['status']),
      createdAt: toNumber(row.created_at, 0),
      dueAt: toNumber(row.due_at, 0),
      nextRetryAt: toNumber(row.next_retry_at, 0),
      attemptCount: toNumber(row.attempt_count, 0),
      maxAttempts: Math.max(1, toNumber(row.max_attempts, 2)),
      lastCode: String(row.last_code || ''),
      lastError: String(row.last_error || ''),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  cleanupSelfRecallTasks(retentionMs: number): void {
    const db = this.assertReady();
    const now = Date.now();
    const keep = Math.max(60 * 1000, toNumber(retentionMs, 3 * 24 * 60 * 60 * 1000));
    const cutoff = now - keep;
    db.prepare(`DELETE FROM self_recall_tasks
      WHERE status IN ('success', 'failed') AND updated_at < ?`).run(cutoff);
  }

  scheduleRecallTask(input: RecallTaskScheduleInput): void {
    const db = this.assertReady();
    const now = Date.now();
    const row = db.prepare('SELECT task_id, status, created_at, attempt_count FROM recall_tasks WHERE task_id = ?').get(String(input.taskId));
    if (row && String(row.status || '') === 'success') return;
    const createdAt = row ? toNumber(row.created_at, now) : now;
    const attemptCount = row ? toNumber(row.attempt_count, 0) : 0;
    db.prepare(`INSERT OR REPLACE INTO recall_tasks(
      task_id, group_id, message_id, target_user_id, reason, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(input.taskId),
      String(input.groupId),
      String(input.messageId),
      String(input.targetUserId || ''),
      String(input.reason || 'recall_action'),
      'scheduled',
      createdAt,
      toNumber(input.dueAt, now),
      toNumber(input.dueAt, now),
      attemptCount,
      Math.max(1, toNumber(input.maxAttempts, 2)),
      '',
      '',
      now
    );
  }

  getRecallTask(taskId: string): RecallTaskRecord | undefined {
    const db = this.assertReady();
    const row = db.prepare(`SELECT task_id, group_id, message_id, target_user_id, reason, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
      FROM recall_tasks
      WHERE task_id = ?
      LIMIT 1`).get(String(taskId));
    if (!row) return undefined;
    return {
      taskId: String(row.task_id || ''),
      groupId: String(row.group_id || ''),
      messageId: String(row.message_id || ''),
      targetUserId: String(row.target_user_id || ''),
      reason: String(row.reason || ''),
      status: (String(row.status || 'scheduled') as RecallTaskRecord['status']),
      createdAt: toNumber(row.created_at, 0),
      dueAt: toNumber(row.due_at, 0),
      nextRetryAt: toNumber(row.next_retry_at, 0),
      attemptCount: toNumber(row.attempt_count, 0),
      maxAttempts: Math.max(1, toNumber(row.max_attempts, 2)),
      lastCode: String(row.last_code || ''),
      lastError: String(row.last_error || ''),
      updatedAt: toNumber(row.updated_at, 0)
    };
  }

  markRecallTaskQueued(taskId: string): void {
    const db = this.assertReady();
    const now = Date.now();
    db.prepare(`UPDATE recall_tasks
      SET status = 'queued', updated_at = ?
      WHERE task_id = ? AND status IN ('scheduled', 'queued')`).run(now, String(taskId));
  }

  resolveRecallTask(taskId: string, code: string, ok: boolean, retryAfterMs: number): void {
    const db = this.assertReady();
    const now = Date.now();
    const row = db.prepare('SELECT attempt_count, max_attempts FROM recall_tasks WHERE task_id = ?').get(String(taskId));
    if (!row) return;
    const attemptCount = toNumber(row.attempt_count, 0) + 1;
    const maxAttempts = Math.max(1, toNumber(row.max_attempts, 2));
    const normalizedCode = String(code || '');
    const success = ok || normalizedCode === 'ok' || normalizedCode === 'skip_duplicate';
    if (success) {
      db.prepare(`UPDATE recall_tasks
        SET status = 'success', attempt_count = ?, next_retry_at = 0, last_code = ?, last_error = '', updated_at = ?
        WHERE task_id = ?`).run(attemptCount, normalizedCode, now, String(taskId));
      return;
    }
    const hasRetry = retryAfterMs > 0 && attemptCount < maxAttempts;
    if (hasRetry) {
      const nextRetryAt = now + Math.max(1000, Math.floor(retryAfterMs));
      db.prepare(`UPDATE recall_tasks
        SET status = 'scheduled', attempt_count = ?, next_retry_at = ?, last_code = ?, last_error = ?, updated_at = ?
        WHERE task_id = ?`).run(attemptCount, nextRetryAt, normalizedCode, normalizedCode, now, String(taskId));
      return;
    }
    db.prepare(`UPDATE recall_tasks
      SET status = 'failed', attempt_count = ?, next_retry_at = 0, last_code = ?, last_error = ?, updated_at = ?
      WHERE task_id = ?`).run(attemptCount, normalizedCode, normalizedCode, now, String(taskId));
  }

  getDueRecallTasks(nowTs: number, limit: number): RecallTaskRecord[] {
    const db = this.assertReady();
    const rows = db.prepare(`SELECT task_id, group_id, message_id, target_user_id, reason, status, created_at, due_at, next_retry_at, attempt_count, max_attempts, last_code, last_error, updated_at
      FROM recall_tasks
      WHERE status = 'scheduled' AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
      LIMIT ?`).all(toNumber(nowTs, Date.now()), Math.max(1, toNumber(limit, 200)));
    return (rows || []).map((row: any) => ({
      taskId: String(row.task_id || ''),
      groupId: String(row.group_id || ''),
      messageId: String(row.message_id || ''),
      targetUserId: String(row.target_user_id || ''),
      reason: String(row.reason || ''),
      status: (String(row.status || 'scheduled') as RecallTaskRecord['status']),
      createdAt: toNumber(row.created_at, 0),
      dueAt: toNumber(row.due_at, 0),
      nextRetryAt: toNumber(row.next_retry_at, 0),
      attemptCount: toNumber(row.attempt_count, 0),
      maxAttempts: Math.max(1, toNumber(row.max_attempts, 2)),
      lastCode: String(row.last_code || ''),
      lastError: String(row.last_error || ''),
      updatedAt: toNumber(row.updated_at, 0)
    }));
  }

  cleanupRecallTasks(retentionMs: number): void {
    const db = this.assertReady();
    const now = Date.now();
    const keep = Math.max(60 * 1000, toNumber(retentionMs, 3 * 24 * 60 * 60 * 1000));
    const cutoff = now - keep;
    db.prepare(`DELETE FROM recall_tasks
      WHERE status IN ('success', 'failed') AND updated_at < ?`).run(cutoff);
  }

  getStorageStatus(): { migrated: boolean; dbPath: string; tableCounts: Record<string, number>; } {
    const db = this.assertReady();
    const tables = ['group_config', 'group_qa', 'activity', 'signin', 'invites', 'warnings', 'join_logs', 'audit_event_links', 'audit_events', 'action_queue_events', 'bot_send_events', 'self_recall_tasks', 'recall_tasks'];
    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      const row = db.prepare(`SELECT COUNT(1) AS c FROM ${t}`).get();
      tableCounts[t] = toNumber(row?.c, 0);
    }
    return { migrated: this.isMigrated(), dbPath: this.dbPath, tableCounts };
  }
}

export const storageAdapter = new StorageAdapter();
