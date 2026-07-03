import {
  pluginStateCacheAdapter,
  type AdminCacheEntry,
  type MessageCacheEntry,
  type RepeatCacheEntry
} from '../state-infra/plugin_state_cache_adapter';

export type { AdminCacheEntry, MessageCacheEntry, RepeatCacheEntry } from '../state-infra/plugin_state_cache_adapter';

export class CacheStateService {
  getMessageCache(): Map<string, MessageCacheEntry> {
    return pluginStateCacheAdapter.getMessageCache();
  }

  getMessageCacheEntry(messageId: string): MessageCacheEntry | undefined {
    return pluginStateCacheAdapter.getMessageCacheEntry(messageId);
  }

  setMessageCacheEntry(messageId: string, entry: MessageCacheEntry): void {
    pluginStateCacheAdapter.setMessageCacheEntry(messageId, entry);
  }

  deleteMessageCacheEntry(messageId: string): boolean {
    return pluginStateCacheAdapter.deleteMessageCacheEntry(messageId);
  }

  clearMessageCache(): void {
    pluginStateCacheAdapter.clearMessageCache();
  }

  messageCacheEntries(): IterableIterator<[string, MessageCacheEntry]> {
    return pluginStateCacheAdapter.messageCacheEntries();
  }

  getSpamCache(): Map<string, number[]> {
    return pluginStateCacheAdapter.getSpamCache();
  }

  getSpamCacheEntry(key: string): number[] | undefined {
    return pluginStateCacheAdapter.getSpamCacheEntry(key);
  }

  setSpamCacheEntry(key: string, value: number[]): void {
    pluginStateCacheAdapter.setSpamCacheEntry(key, value);
  }

  deleteSpamCacheEntry(key: string): boolean {
    return pluginStateCacheAdapter.deleteSpamCacheEntry(key);
  }

  clearSpamCache(): void {
    pluginStateCacheAdapter.clearSpamCache();
  }

  spamCacheEntries(): IterableIterator<[string, number[]]> {
    return pluginStateCacheAdapter.spamCacheEntries();
  }

  getRepeatCache(): Map<string, RepeatCacheEntry> {
    return pluginStateCacheAdapter.getRepeatCache();
  }

  getRepeatCacheEntry(key: string): RepeatCacheEntry | undefined {
    return pluginStateCacheAdapter.getRepeatCacheEntry(key);
  }

  setRepeatCacheEntry(key: string, value: RepeatCacheEntry): void {
    pluginStateCacheAdapter.setRepeatCacheEntry(key, value);
  }

  deleteRepeatCacheEntry(key: string): boolean {
    return pluginStateCacheAdapter.deleteRepeatCacheEntry(key);
  }

  clearRepeatCache(): void {
    pluginStateCacheAdapter.clearRepeatCache();
  }

  repeatCacheEntries(): IterableIterator<[string, RepeatCacheEntry]> {
    return pluginStateCacheAdapter.repeatCacheEntries();
  }

  getQaCooldownMap(): Map<string, number> {
    return pluginStateCacheAdapter.getQaCooldownMap();
  }

  getQaCooldown(key: string): number | undefined {
    return pluginStateCacheAdapter.getQaCooldown(key);
  }

  setQaCooldown(key: string, value: number): void {
    pluginStateCacheAdapter.setQaCooldown(key, value);
  }

  deleteQaCooldown(key: string): boolean {
    return pluginStateCacheAdapter.deleteQaCooldown(key);
  }

  clearQaCooldowns(): void {
    pluginStateCacheAdapter.clearQaCooldowns();
  }

  qaCooldownEntries(): IterableIterator<[string, number]> {
    return pluginStateCacheAdapter.qaCooldownEntries();
  }

  getAdminCache(): Map<string, AdminCacheEntry> {
    return pluginStateCacheAdapter.getAdminCache();
  }

  getAdminCacheEntry(key: string): AdminCacheEntry | undefined {
    return pluginStateCacheAdapter.getAdminCacheEntry(key);
  }

  setAdminCacheEntry(key: string, value: AdminCacheEntry): void {
    pluginStateCacheAdapter.setAdminCacheEntry(key, value);
  }

  hasAdminCacheEntry(key: string): boolean {
    return pluginStateCacheAdapter.hasAdminCacheEntry(key);
  }

  deleteAdminCacheEntry(key: string): boolean {
    return pluginStateCacheAdapter.deleteAdminCacheEntry(key);
  }

  clearAdminCache(): void {
    pluginStateCacheAdapter.clearAdminCache();
  }

  adminCacheEntries(): IterableIterator<[string, AdminCacheEntry]> {
    return pluginStateCacheAdapter.adminCacheEntries();
  }

  adminCacheValues(): IterableIterator<AdminCacheEntry> {
    return pluginStateCacheAdapter.adminCacheValues();
  }
}

export const cacheStateService = new CacheStateService();
