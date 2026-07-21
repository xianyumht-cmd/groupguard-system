import type {
  ActivityRecord,
  SigninData,
  InviteData,
  AuditEventQuery,
  AuditEventPage,
  AuditEventRecord,
  AuditRetentionPolicy,
  ActionQueueEventRetentionPolicy,
  AuditStatsQuery,
  AuditStatsView,
  ActionQueueEventStatsQuery,
  ActionQueueEventStatsView,
  ActionQueueEventSearchQuery,
  ActionQueueEventSearchView,
  BotSendEventRecord,
  BotSendStatsQuery,
  BotSendStatsView,
  AuditUserProfileQuery,
  AuditUserProfileView,
  ActionQueueEventRecord,
  SelfRecallScheduleInput,
  SelfRecallTaskRecord,
  RecallTaskScheduleInput,
  RecallTaskRecord
} from '../types';
import { dbQuery } from '../db';

const get = {
  warning(groupId: string, userId: string): Promise<number> {
    return dbQuery.getWarning(groupId, userId);
  },
  signin(groupId: string, userId: string): Promise<SigninData | undefined> {
    return dbQuery.getSignin(groupId, userId);
  },
  allSignin(groupId: string): Promise<Record<string, SigninData>> {
    return dbQuery.getAllSignin(groupId);
  },
  invite(groupId: string, userId: string): Promise<InviteData | undefined> {
    return dbQuery.getInvite(groupId, userId);
  },
  allInvites(groupId: string): Promise<Record<string, InviteData>> {
    return dbQuery.getAllInvites(groupId);
  },
  activity(groupId: string, userId: string): Promise<ActivityRecord | undefined> {
    return dbQuery.getActivityAsync(groupId, userId);
  },
  allActivity(groupId: string): Promise<Record<string, ActivityRecord>> {
    return dbQuery.getAllActivity(groupId);
  }
};

const update = {
  warning(groupId: string, userId: string, count: number): Promise<void> {
    return dbQuery.setWarning(groupId, userId, count);
  },
  signin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return dbQuery.updateSignin(groupId, userId, data);
  },
  invite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return dbQuery.updateInvite(groupId, userId, data);
  },
  activity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return dbQuery.updateActivity(groupId, userId, data);
  },
  selfRecallQueued(taskId: string): Promise<void> {
    return dbQuery.markSelfRecallTaskQueued(taskId);
  },
  selfRecallResolved(taskId: string, code: string, ok: boolean, retryAfterMs: number): Promise<void> {
    return dbQuery.resolveSelfRecallTask(taskId, code, ok, retryAfterMs);
  }
};

const insert = {
  signin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return dbQuery.updateSignin(groupId, userId, data);
  },
  invite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return dbQuery.updateInvite(groupId, userId, data);
  },
  activity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return dbQuery.updateActivity(groupId, userId, data);
  }
};

const del = {
  warning(groupId: string, userId: string): Promise<void> {
    return dbQuery.setWarning(groupId, userId, 0);
  }
};

export const groupguardRepository = {
  get,
  update,
  insert,
  delete: del,
  getWarning(groupId: string, userId: string): Promise<number> {
    return get.warning(groupId, userId);
  },
  setWarning(groupId: string, userId: string, count: number): Promise<void> {
    return update.warning(groupId, userId, count);
  },
  getSignin(groupId: string, userId: string): Promise<SigninData | undefined> {
    return get.signin(groupId, userId);
  },
  updateSignin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return update.signin(groupId, userId, data);
  },
  getAllSignin(groupId: string): Promise<Record<string, SigninData>> {
    return get.allSignin(groupId);
  },
  getInvite(groupId: string, userId: string): Promise<InviteData | undefined> {
    return get.invite(groupId, userId);
  },
  updateInvite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return update.invite(groupId, userId, data);
  },
  clearInvites(groupId: string): Promise<void> {
    return dbQuery.clearInvites(groupId);
  },
  getAllInvites(groupId: string): Promise<Record<string, InviteData>> {
    return get.allInvites(groupId);
  },
  getActivityAsync(groupId: string, userId: string): Promise<ActivityRecord | undefined> {
    return get.activity(groupId, userId);
  },
  updateActivity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return update.activity(groupId, userId, data);
  },
  getAllActivity(groupId: string): Promise<Record<string, ActivityRecord>> {
    return get.allActivity(groupId);
  },
  insertAuditEvent(entry: AuditEventRecord): Promise<void> {
    return dbQuery.insertAuditEvent(entry);
  },
  getRecentAuditEvents(query?: AuditEventQuery | number): Promise<AuditEventRecord[]> {
    return dbQuery.getRecentAuditEvents(query);
  },
  queryAuditEvents(query?: AuditEventQuery | number): Promise<AuditEventPage> {
    return dbQuery.queryAuditEvents(query);
  },
  getAuditEventsByQueueTaskId(queueTaskId: string, limit = 20): Promise<AuditEventRecord[]> {
    return dbQuery.getAuditEventsByQueueTaskId(queueTaskId, limit);
  },
  insertActionQueueEvent(entry: ActionQueueEventRecord): Promise<void> {
    return dbQuery.insertActionQueueEvent(entry);
  },
  getActionQueueEventsByTaskId(taskId: string, limit = 100): Promise<ActionQueueEventRecord[]> {
    return dbQuery.getActionQueueEventsByTaskId(taskId, limit);
  },
  getAuditStats(query?: AuditStatsQuery): Promise<AuditStatsView> {
    return dbQuery.getAuditStats(query);
  },
  getActionQueueEventStats(query?: ActionQueueEventStatsQuery): Promise<ActionQueueEventStatsView> {
    return dbQuery.getActionQueueEventStats(query);
  },
  searchActionQueueEvents(query?: ActionQueueEventSearchQuery): Promise<ActionQueueEventSearchView> {
    return dbQuery.searchActionQueueEvents(query);
  },
  insertBotSendEvent(entry: BotSendEventRecord): Promise<void> {
    return dbQuery.insertBotSendEvent(entry);
  },
  getBotSendStats(query?: BotSendStatsQuery): Promise<BotSendStatsView> {
    return dbQuery.getBotSendStats(query);
  },
  getAuditUserProfile(query: AuditUserProfileQuery): Promise<AuditUserProfileView> {
    return dbQuery.getAuditUserProfile(query);
  },
  pruneAuditEvents(policy?: AuditRetentionPolicy): Promise<number> {
    return dbQuery.pruneAuditEvents(policy);
  },
  pruneActionQueueEvents(policy?: ActionQueueEventRetentionPolicy): Promise<number> {
    return dbQuery.pruneActionQueueEvents(policy);
  },
  scheduleSelfRecallTask(input: SelfRecallScheduleInput): Promise<void> {
    return dbQuery.scheduleSelfRecallTask(input);
  },
  markSelfRecallTaskQueued(taskId: string): Promise<void> {
    return update.selfRecallQueued(taskId);
  },
  resolveSelfRecallTask(taskId: string, code: string, ok: boolean, retryAfterMs: number): Promise<void> {
    return update.selfRecallResolved(taskId, code, ok, retryAfterMs);
  },
  getDueSelfRecallTasks(nowTs: number, limit: number): Promise<SelfRecallTaskRecord[]> {
    return dbQuery.getDueSelfRecallTasks(nowTs, limit);
  },
  getSelfRecallTask(taskId: string): Promise<SelfRecallTaskRecord | undefined> {
    return dbQuery.getSelfRecallTask(taskId);
  },
  cleanupSelfRecallTasks(retentionMs: number): Promise<void> {
    return dbQuery.cleanupSelfRecallTasks(retentionMs);
  },
  scheduleRecallTask(input: RecallTaskScheduleInput): Promise<void> {
    return dbQuery.scheduleRecallTask(input);
  },
  markRecallTaskQueued(taskId: string): Promise<void> {
    return dbQuery.markRecallTaskQueued(taskId);
  },
  resolveRecallTask(taskId: string, code: string, ok: boolean, retryAfterMs: number): Promise<void> {
    return dbQuery.resolveRecallTask(taskId, code, ok, retryAfterMs);
  },
  getDueRecallTasks(nowTs: number, limit: number): Promise<RecallTaskRecord[]> {
    return dbQuery.getDueRecallTasks(nowTs, limit);
  },
  getRecallTask(taskId: string): Promise<RecallTaskRecord | undefined> {
    return dbQuery.getRecallTask(taskId);
  },
  cleanupRecallTasks(retentionMs: number): Promise<void> {
    return dbQuery.cleanupRecallTasks(retentionMs);
  },
  runInTransaction<T>(fn: () => T): T {
    return dbQuery.runInTransaction(fn);
  }
};
