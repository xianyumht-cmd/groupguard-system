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
} from './types';
import { contextStateService } from './core/state-services/context_state_service';
import { storageAdapter } from './storage_adapter';

// 内存缓存
const cache = {
    activity: new Map<string, Record<string, ActivityRecord>>(),
    signin: new Map<string, Record<string, SigninData>>(),
    invites: new Map<string, Record<string, InviteData>>(),
    warnings: new Map<string, Record<string, number>>(),
};

export async function initDB() {
    storageAdapter.init(contextStateService.getConfigDir());
}

function loadData<T>(type: keyof typeof cache, groupId: string): Record<string, T> {
    if (cache[type].has(groupId)) {
        return cache[type].get(groupId) as Record<string, T>;
    }
    let data: Record<string, T> = {} as Record<string, T>;
    if (type === 'activity') data = storageAdapter.getAllActivity(groupId) as Record<string, T>;
    else if (type === 'signin') data = storageAdapter.getAllSignin(groupId) as Record<string, T>;
    else if (type === 'invites') data = storageAdapter.getAllInvites(groupId) as Record<string, T>;
    else if (type === 'warnings') data = {} as Record<string, T>;
    (cache[type] as Map<string, Record<string, T>>).set(groupId, data);
    return data;
}

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        return storageAdapter.getActivity(groupId, userId) as ActivityRecord | undefined;
    },
    
    getActivityAsync: async (groupId: string, userId: string): Promise<ActivityRecord | undefined> => {
        const data = loadData<ActivityRecord>('activity', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getActivity(groupId, userId);
            if (row) {
                data[userId] = row;
            }
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },

    updateActivity: async (groupId: string, userId: string, data: ActivityRecord) => {
        const allData = loadData<ActivityRecord>('activity', groupId);
        allData[userId] = data;
        storageAdapter.setActivity(groupId, userId, data);
    },

    getAllActivity: async (groupId: string): Promise<Record<string, ActivityRecord>> => {
        return { ...loadData<ActivityRecord>('activity', groupId) };
    },
    insertAuditEvent: async (entry: AuditEventRecord): Promise<void> => {
        storageAdapter.insertAuditEvent(entry);
    },
    getRecentAuditEvents: async (query: AuditEventQuery | number = 200): Promise<AuditEventRecord[]> => {
        return storageAdapter.getRecentAuditEvents(query);
    },
    queryAuditEvents: async (query: AuditEventQuery | number = 200): Promise<AuditEventPage> => {
        return storageAdapter.queryAuditEvents(query);
    },
    getAuditEventsByQueueTaskId: async (queueTaskId: string, limit = 20): Promise<AuditEventRecord[]> => {
        return storageAdapter.getAuditEventsByQueueTaskId(queueTaskId, limit);
    },
    insertActionQueueEvent: async (entry: ActionQueueEventRecord): Promise<void> => {
        storageAdapter.insertActionQueueEvent(entry);
    },
    getActionQueueEventsByTaskId: async (taskId: string, limit = 100): Promise<ActionQueueEventRecord[]> => {
        return storageAdapter.getActionQueueEventsByTaskId(taskId, limit);
    },
    getAuditStats: async (query?: AuditStatsQuery): Promise<AuditStatsView> => {
        return storageAdapter.getAuditStats(query);
    },
    getActionQueueEventStats: async (query?: ActionQueueEventStatsQuery): Promise<ActionQueueEventStatsView> => {
        return storageAdapter.getActionQueueEventStats(query);
    },
    searchActionQueueEvents: async (query?: ActionQueueEventSearchQuery): Promise<ActionQueueEventSearchView> => {
        return storageAdapter.searchActionQueueEvents(query);
    },
    insertBotSendEvent: async (entry: BotSendEventRecord): Promise<void> => {
        storageAdapter.insertBotSendEvent(entry);
    },
    getBotSendStats: async (query?: BotSendStatsQuery): Promise<BotSendStatsView> => {
        return storageAdapter.getBotSendStats(query);
    },
    getAuditUserProfile: async (query: AuditUserProfileQuery): Promise<AuditUserProfileView> => {
        return storageAdapter.getAuditUserProfile(query);
    },
    pruneAuditEvents: async (policy?: AuditRetentionPolicy): Promise<number> => {
        return storageAdapter.pruneAuditEvents(policy);
    },
    pruneActionQueueEvents: async (policy?: ActionQueueEventRetentionPolicy): Promise<number> => {
        return storageAdapter.pruneActionQueueEvents(policy);
    },

    // Signin
    getSignin: async (groupId: string, userId: string): Promise<SigninData | undefined> => {
        const data = loadData<SigninData>('signin', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getSignin(groupId, userId);
            if (row) data[userId] = row;
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateSignin: async (groupId: string, userId: string, data: SigninData) => {
        const allData = loadData<SigninData>('signin', groupId);
        allData[userId] = data;
        storageAdapter.setSignin(groupId, userId, data);
    },
    getAllSignin: async (groupId: string): Promise<Record<string, SigninData>> => {
        return { ...loadData<SigninData>('signin', groupId) };
    },

    // Invites
    getInvite: async (groupId: string, userId: string): Promise<InviteData | undefined> => {
        const data = loadData<InviteData>('invites', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getInvite(groupId, userId);
            if (row) data[userId] = row;
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateInvite: async (groupId: string, userId: string, data: InviteData) => {
        const allData = loadData<InviteData>('invites', groupId);
        allData[userId] = data;
        storageAdapter.setInvite(groupId, userId, data);
    },
    clearInvites: async (groupId: string): Promise<void> => {
        cache.invites.delete(groupId);
        storageAdapter.clearInvites(groupId);
    },
    getAllInvites: async (groupId: string): Promise<Record<string, InviteData>> => {
        return { ...loadData<InviteData>('invites', groupId) };
    },

    // Warnings
    getWarning: async (groupId: string, userId: string): Promise<number> => {
        const data = loadData<number>('warnings', groupId);
        if (data[userId] === undefined) data[userId] = storageAdapter.getWarning(groupId, userId);
        return data[userId] || 0;
    },
    setWarning: async (groupId: string, userId: string, count: number) => {
        const allData = loadData<number>('warnings', groupId);
        allData[userId] = count;
        storageAdapter.setWarning(groupId, userId, count);
    },
    scheduleSelfRecallTask: async (input: SelfRecallScheduleInput): Promise<void> => {
        storageAdapter.scheduleSelfRecallTask(input);
    },
    markSelfRecallTaskQueued: async (taskId: string): Promise<void> => {
        storageAdapter.markSelfRecallTaskQueued(taskId);
    },
    resolveSelfRecallTask: async (taskId: string, code: string, ok: boolean, retryAfterMs: number): Promise<void> => {
        storageAdapter.resolveSelfRecallTask(taskId, code, ok, retryAfterMs);
    },
    getDueSelfRecallTasks: async (nowTs: number, limit: number): Promise<SelfRecallTaskRecord[]> => {
        return storageAdapter.getDueSelfRecallTasks(nowTs, limit);
    },
    getSelfRecallTask: async (taskId: string): Promise<SelfRecallTaskRecord | undefined> => {
        return storageAdapter.getSelfRecallTask(taskId);
    },
    cleanupSelfRecallTasks: async (retentionMs: number): Promise<void> => {
        storageAdapter.cleanupSelfRecallTasks(retentionMs);
    },
    scheduleRecallTask: async (input: RecallTaskScheduleInput): Promise<void> => {
        storageAdapter.scheduleRecallTask(input);
    },
    markRecallTaskQueued: async (taskId: string): Promise<void> => {
        storageAdapter.markRecallTaskQueued(taskId);
    },
    resolveRecallTask: async (taskId: string, code: string, ok: boolean, retryAfterMs: number): Promise<void> => {
        storageAdapter.resolveRecallTask(taskId, code, ok, retryAfterMs);
    },
    getDueRecallTasks: async (nowTs: number, limit: number): Promise<RecallTaskRecord[]> => {
        return storageAdapter.getDueRecallTasks(nowTs, limit);
    },
    getRecallTask: async (taskId: string): Promise<RecallTaskRecord | undefined> => {
        return storageAdapter.getRecallTask(taskId);
    },
    cleanupRecallTasks: async (retentionMs: number): Promise<void> => {
        storageAdapter.cleanupRecallTasks(retentionMs);
    },
    runInTransaction: <T>(fn: () => T): T => storageAdapter.runInTransaction(fn)
};
