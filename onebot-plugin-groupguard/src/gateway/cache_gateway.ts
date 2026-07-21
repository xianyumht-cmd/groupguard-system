import {
  cacheStateService,
  type MessageCacheEntry,
  type RepeatCacheEntry
} from '../core/state-services/cache_state_service';

export class CacheGateway {
  getMessageCache(): Map<string, MessageCacheEntry> {
    return cacheStateService.getMessageCache();
  }

  getMessageCacheEntry(messageId: string): MessageCacheEntry | undefined {
    return cacheStateService.getMessageCacheEntry(messageId);
  }

  setMessageCacheEntry(messageId: string, entry: MessageCacheEntry): void {
    cacheStateService.setMessageCacheEntry(messageId, entry);
  }

  deleteMessageCacheEntry(messageId: string): boolean {
    return cacheStateService.deleteMessageCacheEntry(messageId);
  }

  clearMessageCache(): void {
    cacheStateService.clearMessageCache();
  }

  messageCacheEntries(): IterableIterator<[string, MessageCacheEntry]> {
    return cacheStateService.messageCacheEntries();
  }

  getSpamCache(): Map<string, number[]> {
    return cacheStateService.getSpamCache();
  }

  getSpamCacheEntry(key: string): number[] | undefined {
    return cacheStateService.getSpamCacheEntry(key);
  }

  setSpamCacheEntry(key: string, value: number[]): void {
    cacheStateService.setSpamCacheEntry(key, value);
  }

  deleteSpamCacheEntry(key: string): boolean {
    return cacheStateService.deleteSpamCacheEntry(key);
  }

  clearSpamCache(): void {
    cacheStateService.clearSpamCache();
  }

  spamCacheEntries(): IterableIterator<[string, number[]]> {
    return cacheStateService.spamCacheEntries();
  }

  getRepeatCache(): Map<string, RepeatCacheEntry> {
    return cacheStateService.getRepeatCache();
  }

  getRepeatCacheEntry(key: string): RepeatCacheEntry | undefined {
    return cacheStateService.getRepeatCacheEntry(key);
  }

  setRepeatCacheEntry(key: string, value: RepeatCacheEntry): void {
    cacheStateService.setRepeatCacheEntry(key, value);
  }

  deleteRepeatCacheEntry(key: string): boolean {
    return cacheStateService.deleteRepeatCacheEntry(key);
  }

  clearRepeatCache(): void {
    cacheStateService.clearRepeatCache();
  }

  repeatCacheEntries(): IterableIterator<[string, RepeatCacheEntry]> {
    return cacheStateService.repeatCacheEntries();
  }

  getQaCooldownMap(): Map<string, number> {
    return cacheStateService.getQaCooldownMap();
  }

  getQaCooldown(key: string): number | undefined {
    return cacheStateService.getQaCooldown(key);
  }

  setQaCooldown(key: string, value: number): void {
    cacheStateService.setQaCooldown(key, value);
  }

  deleteQaCooldown(key: string): boolean {
    return cacheStateService.deleteQaCooldown(key);
  }

  clearQaCooldowns(): void {
    cacheStateService.clearQaCooldowns();
  }

  qaCooldownEntries(): IterableIterator<[string, number]> {
    return cacheStateService.qaCooldownEntries();
  }
}

export const cacheGateway = new CacheGateway();
