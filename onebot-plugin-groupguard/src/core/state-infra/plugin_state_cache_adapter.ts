import { pluginState } from '../../state';

export interface MessageCacheEntry {
  userId: string;
  groupId: string;
  raw: string;
  segments: any[];
  time: number;
}

export interface RepeatCacheEntry {
  content: string;
  count: number;
  time?: number;
}

export interface AdminCacheEntry {
  role: string;
  expire: number;
}

export class PluginStateCacheAdapter {
  getMessageCache(): Map<string, MessageCacheEntry> {
    return pluginState.msgCache;
  }

  getMessageCacheEntry(messageId: string): MessageCacheEntry | undefined {
    return pluginState.msgCache.get(messageId);
  }

  setMessageCacheEntry(messageId: string, entry: MessageCacheEntry): void {
    pluginState.msgCache.set(messageId, entry);
  }

  deleteMessageCacheEntry(messageId: string): boolean {
    return pluginState.msgCache.delete(messageId);
  }

  clearMessageCache(): void {
    pluginState.msgCache.clear();
  }

  messageCacheEntries(): IterableIterator<[string, MessageCacheEntry]> {
    return pluginState.msgCache.entries();
  }

  getSpamCache(): Map<string, number[]> {
    return pluginState.spamCache;
  }

  getSpamCacheEntry(key: string): number[] | undefined {
    return pluginState.spamCache.get(key);
  }

  setSpamCacheEntry(key: string, value: number[]): void {
    pluginState.spamCache.set(key, value);
  }

  deleteSpamCacheEntry(key: string): boolean {
    return pluginState.spamCache.delete(key);
  }

  clearSpamCache(): void {
    pluginState.spamCache.clear();
  }

  spamCacheEntries(): IterableIterator<[string, number[]]> {
    return pluginState.spamCache.entries();
  }

  getRepeatCache(): Map<string, RepeatCacheEntry> {
    return pluginState.repeatCache;
  }

  getRepeatCacheEntry(key: string): RepeatCacheEntry | undefined {
    return pluginState.repeatCache.get(key);
  }

  setRepeatCacheEntry(key: string, value: RepeatCacheEntry): void {
    pluginState.repeatCache.set(key, value);
  }

  deleteRepeatCacheEntry(key: string): boolean {
    return pluginState.repeatCache.delete(key);
  }

  clearRepeatCache(): void {
    pluginState.repeatCache.clear();
  }

  repeatCacheEntries(): IterableIterator<[string, RepeatCacheEntry]> {
    return pluginState.repeatCache.entries();
  }

  getQaCooldownMap(): Map<string, number> {
    return pluginState.qaCooldownMap;
  }

  getQaCooldown(key: string): number | undefined {
    return pluginState.qaCooldownMap.get(key);
  }

  setQaCooldown(key: string, value: number): void {
    pluginState.qaCooldownMap.set(key, value);
  }

  deleteQaCooldown(key: string): boolean {
    return pluginState.qaCooldownMap.delete(key);
  }

  clearQaCooldowns(): void {
    pluginState.qaCooldownMap.clear();
  }

  qaCooldownEntries(): IterableIterator<[string, number]> {
    return pluginState.qaCooldownMap.entries();
  }

  getAdminCache(): Map<string, AdminCacheEntry> {
    return pluginState.adminCache;
  }

  getAdminCacheEntry(key: string): AdminCacheEntry | undefined {
    return pluginState.adminCache.get(key);
  }

  setAdminCacheEntry(key: string, value: AdminCacheEntry): void {
    pluginState.adminCache.set(key, value);
  }

  hasAdminCacheEntry(key: string): boolean {
    return pluginState.adminCache.has(key);
  }

  deleteAdminCacheEntry(key: string): boolean {
    return pluginState.adminCache.delete(key);
  }

  clearAdminCache(): void {
    pluginState.adminCache.clear();
  }

  adminCacheEntries(): IterableIterator<[string, AdminCacheEntry]> {
    return pluginState.adminCache.entries();
  }

  adminCacheValues(): IterableIterator<AdminCacheEntry> {
    return pluginState.adminCache.values();
  }
}

export const pluginStateCacheAdapter = new PluginStateCacheAdapter();
