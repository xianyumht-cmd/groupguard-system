import fs from 'fs';
import path from 'path';
import { loggingStateService } from '../core/state-services/logging_state_service';

export interface InviteRecord {
  group_id: number;
  inviter_qq: number;
  invited_qq: number;
  join_time: number;
}

interface GroupInviteData {
  forward: Record<string, string[]>;
  reverse: Record<string, string>;
  records: Record<string, InviteRecord>;
}

const groupCache = new Map<string, GroupInviteData>();
const dirtyGroups = new Set<string>();
let inviteDataDir = '';
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushInProgress = false;
const MAX_GROUP_CACHE = 300;

function ensureInviteData(groupId: string): GroupInviteData {
  if (groupCache.has(groupId)) return groupCache.get(groupId)!;
  const filePath = path.join(inviteDataDir, `${groupId}.json`);
  let loaded: GroupInviteData = { forward: {}, reverse: {}, records: {} };
  if (inviteDataDir && fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<GroupInviteData>;
      loaded = {
        forward: (raw.forward && typeof raw.forward === 'object') ? raw.forward : {},
        reverse: (raw.reverse && typeof raw.reverse === 'object') ? raw.reverse : {},
        records: (raw.records && typeof raw.records === 'object') ? raw.records : {}
      };
    } catch {
      loaded = { forward: {}, reverse: {}, records: {} };
    }
  }
  groupCache.set(groupId, loaded);
  if (groupCache.size > MAX_GROUP_CACHE) {
    const keys = Array.from(groupCache.keys());
    for (let i = 0; i < keys.length - MAX_GROUP_CACHE; i += 1) {
      groupCache.delete(keys[i]);
      dirtyGroups.delete(keys[i]);
    }
  }
  return loaded;
}

async function flushDirty(): Promise<void> {
  if (flushInProgress || !dirtyGroups.size || !inviteDataDir) return;
  flushInProgress = true;
  try {
    await fs.promises.mkdir(inviteDataDir, { recursive: true });
    const groups = Array.from(dirtyGroups);
    dirtyGroups.clear();
    for (const groupId of groups) {
      const data = groupCache.get(groupId);
      if (!data) continue;
      const target = path.join(inviteDataDir, `${groupId}.json`);
      const tmp = `${target}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf-8');
      await fs.promises.rename(tmp, target);
    }
  } finally {
    flushInProgress = false;
  }
}

export function initInviteService(configDir: string): void {
  inviteDataDir = path.join(configDir, 'data', 'invite_stats');
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushDirty();
    }, 5000);
  }
}

export async function flushInviteService(): Promise<void> {
  await flushDirty();
}

export function stopInviteService(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export async function resetInviteRelationData(groupId: string): Promise<void> {
  const gid = String(groupId || '');
  if (!gid) return;
  groupCache.set(gid, { forward: {}, reverse: {}, records: {} });
  dirtyGroups.delete(gid);
  if (!inviteDataDir) return;
  const target = path.join(inviteDataDir, `${gid}.json`);
  const tmp = `${target}.tmp`;
  try {
    await fs.promises.mkdir(inviteDataDir, { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ forward: {}, reverse: {}, records: {} }), 'utf-8');
    await fs.promises.rename(tmp, target);
  } catch (error) {
    loggingStateService.warn(`[InviteStat] reset relation file failed group=${gid}: ${error}`);
  }
}

export async function recordInviteRelation(input: {
  groupId: string;
  inviterQQ: string;
  invitedQQ: string;
  joinTime?: number;
}): Promise<{ created: boolean; reason?: 'self_join' | 'duplicate' | 'invalid'; }> {
  const groupId = String(input.groupId || '');
  const inviterQQ = String(input.inviterQQ || '');
  const invitedQQ = String(input.invitedQQ || '');
  if (!groupId || !inviterQQ || !invitedQQ) return { created: false, reason: 'invalid' };
  if (inviterQQ === invitedQQ) return { created: false, reason: 'self_join' };

  const store = ensureInviteData(groupId);
  if (store.reverse[invitedQQ]) return { created: false, reason: 'duplicate' };

  const joinTime = Number(input.joinTime || Date.now());
  const record: InviteRecord = {
    group_id: Number(groupId),
    inviter_qq: Number(inviterQQ),
    invited_qq: Number(invitedQQ),
    join_time: Number.isFinite(joinTime) ? joinTime : Date.now()
  };

  store.reverse[invitedQQ] = inviterQQ;
  const list = store.forward[inviterQQ] || [];
  if (!list.includes(invitedQQ)) list.push(invitedQQ);
  store.forward[inviterQQ] = list;
  store.records[invitedQQ] = record;
  dirtyGroups.add(groupId);
  loggingStateService.info(`[InviteStat] group=${groupId} inviter=${inviterQQ} invited=${invitedQQ}`);
  return { created: true };
}

export function queryInvitedBy(groupId: string, inviterQQ: string): string[] {
  const gid = String(groupId || '');
  const inviter = String(inviterQQ || '');
  if (!gid || !inviter) return [];
  const store = ensureInviteData(gid);
  return [...(store.forward[inviter] || [])];
}

export function queryInviterOf(groupId: string, invitedQQ: string): string {
  const gid = String(groupId || '');
  const invited = String(invitedQQ || '');
  if (!gid || !invited) return '';
  const store = ensureInviteData(gid);
  return String(store.reverse[invited] || '');
}
