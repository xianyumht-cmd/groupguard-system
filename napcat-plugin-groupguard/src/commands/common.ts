import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import fs from 'fs';
import { authStateService } from '../core/state-services/auth_state_service';
import { cacheStateService } from '../core/state-services/cache_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { storageAdapter } from '../storage_adapter';

export function extractAt(raw: string): string | null {
  const m = raw.match(/\[CQ:at,qq=(\d+)\]/);
  return m ? m[1] : null;
}

export function extractQQ(text: string): string | null {
  const m = text.match(/(\d{5,12})/);
  return m ? m[1] : null;
}

export function getTarget(raw: string, textAfterCmd: string): string | null {
  return extractAt(raw) || extractQQ(textAfterCmd);
}

export async function isAdminOrOwner(groupId: string, userId: string): Promise<boolean> {
  if (authStateService.isOwner(userId)) return true;
  const key = `${groupId}:${userId}`;
  const settings = configStateService.resolveGroupSettings(groupId);
  const cacheSeconds = settings.adminCacheSeconds !== undefined ? settings.adminCacheSeconds : 60;
  if (cacheSeconds > 0) {
    const cached = cacheStateService.getAdminCacheEntry(key);
    if (cached && Date.now() < cached.expire) {
      return cached.role === 'admin' || cached.role === 'owner';
    }
  }
  const info = await communicationStateService.callApi('get_group_member_info', { group_id: groupId, user_id: userId }) as any;
  const role = info?.role || 'member';
  if (cacheSeconds > 0) {
    cacheStateService.setAdminCacheEntry(key, { role, expire: Date.now() + cacheSeconds * 1000 });
  }
  return role === 'admin' || role === 'owner';
}

export function saveConfig(ctx: NapCatPluginContext): void {
  try {
    if (ctx?.configPath) {
      const config = configStateService.getConfig();
      const mainConfig = { ...config, groups: {} };
      fs.writeFileSync(ctx.configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
      storageAdapter.saveGroupConfigs(config.groups || {});
    }
  } catch (e) {
    loggingStateService.error(`保存配置失败: ${e}`);
  }
}

export function saveConfigStrict(ctx: NapCatPluginContext): void {
  if (!ctx?.configPath) {
    throw new Error('missing_config_path');
  }
  const config = configStateService.getConfig();
  const mainConfig = { ...config, groups: {} };
  fs.writeFileSync(ctx.configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
  storageAdapter.saveGroupConfigs(config.groups || {});
}

export async function sendGroupScene(groupId: string, scene: string, fallback: string, vars?: Record<string, string | number | boolean>): Promise<void> {
  await send({ channel: 'group', targetId: groupId, scene, message: fallback, vars, force: true, applyTemplate: true });
}

export async function sendPrivateScene(userId: string, scene: string, fallback: string, vars?: Record<string, string | number | boolean>): Promise<void> {
  await send({ channel: 'private', targetId: userId, scene, message: fallback, vars, force: true, applyTemplate: true });
}
