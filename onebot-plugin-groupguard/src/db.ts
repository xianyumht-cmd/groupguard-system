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

// Only warning counters keep a small compatibility cache. Activity, sign-in and
// invite history is read on demand so process memory is independent of lifetime
// group/user cardinality.
const cache = {
    warnings: new Map<string, Record<string, number>>(),
};
const MAX_WARNING_GROUPS = 200;
const MAX_WARNING_USERS_PER_GROUP = 2000;

function warningData(groupId: string): Record<string, number> {
    let data = cache.warnings.get(groupId);
    if (!data) {
        while (cache.warnings.size >= MAX_WARNING_GROUPS) {
            const oldest = cache.warnings.keys().next().value as string | undefined;
            if (!oldest) break;
            cache.warnings.delete(oldest);
        }
        data = {};
        cache.warnings.set(groupId, data);
    }
    return data;
}

function setWarningCache(groupId: string, userId: string, count: number): void {
    const data = warningData(groupId);
    if (!(userId in data) && Object.keys(data).length >= MAX_WARNING_USERS_PER_GROUP) {
        delete data[Object.keys(data)[0]];
    }
    data[userId] = count;
}

export function clearDbCaches(): void {
    for (const map of Object.values(cache)) map.clear();
}

export async function initDB() {
    storageAdapter.init(contextStateService.getConfigDir());
}

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        return storageAdapter.getActivity(groupId, userId) as ActivityRecord | undefined;
    },
    
    getActivityAsync: async (groupId: string, userId: string): Promise<ActivityRecord | undefined> => {
        const row = storageAdapter.getActivity(groupId, userId);
        return row ? { ...row } : undefined;
    },

    updateActivity: async (groupId: string, userId: string, data: ActivityRecord) => {
        storageAdapter.setActivity(groupId, userId, data);
    },

    getAllActivity: async (groupId: string): Promise<Record<string, ActivityRecord>> => {
        return { ...storageAdapter.getAllActivity(groupId) };
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
        const row = storageAdapter.getSignin(groupId, userId);
        return row ? { ...row } : undefined;
    },
    updateSignin: async (groupId: string, userId: string, data: SigninData) => {
        storageAdapter.setSignin(groupId, userId, data);
    },
    getAllSignin: async (groupId: string): Promise<Record<string, SigninData>> => {
        return { ...storageAdapter.getAllSignin(groupId) };
    },

    // Invites
    getInvite: async (groupId: string, userId: string): Promise<InviteData | undefined> => {
        const row = storageAdapter.getInvite(groupId, userId);
        return row ? { ...row } : undefined;
    },
    updateInvite: async (groupId: string, userId: string, data: InviteData) => {
        storageAdapter.setInvite(groupId, userId, data);
    },
    clearInvites: async (groupId: string): Promise<void> => {
        storageAdapter.clearInvites(groupId);
    },
    getAllInvites: async (groupId: string): Promise<Record<string, InviteData>> => {
        return { ...storageAdapter.getAllInvites(groupId) };
    },

    // Warnings
    getWarning: async (groupId: string, userId: string): Promise<number> => {
        const data = warningData(groupId);
        if (data[userId] === undefined) setWarningCache(groupId, userId, storageAdapter.getWarning(groupId, userId));
        return data[userId] || 0;
    },
    setWarning: async (groupId: string, userId: string, count: number) => {
        setWarningCache(groupId, userId, count);
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
