import { cacheStateService, type AdminCacheEntry } from '../core/state-services/cache_state_service';

export class AdminCacheGateway {
  getAdminCache(): Map<string, AdminCacheEntry> {
    return cacheStateService.getAdminCache();
  }

  get(key: string): AdminCacheEntry | undefined {
    return cacheStateService.getAdminCacheEntry(key);
  }

  set(key: string, value: AdminCacheEntry): void {
    cacheStateService.setAdminCacheEntry(key, value);
  }

  has(key: string): boolean {
    return cacheStateService.hasAdminCacheEntry(key);
  }

  delete(key: string): boolean {
    return cacheStateService.deleteAdminCacheEntry(key);
  }

  clear(): void {
    cacheStateService.clearAdminCache();
  }

  entries(): IterableIterator<[string, AdminCacheEntry]> {
    return cacheStateService.adminCacheEntries();
  }

  values(): IterableIterator<AdminCacheEntry> {
    return cacheStateService.adminCacheValues();
  }
}

export const adminCacheGateway = new AdminCacheGateway();
