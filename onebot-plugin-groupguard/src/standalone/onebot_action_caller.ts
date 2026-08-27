import { configStateService } from '../core/state-services/config_state_service';
import { NormalizingOneBotActionClient } from '../protocol/onebot11/action_client';
import { normalizeOutputLocale } from '../services/output_locale_service';
import { localizeOneBotSendParamsSafe } from '../services/output_locale_egress_guard';
import type { OneBotWsClient } from './onebot_ws_client';

function resolveLocaleForAction(action: string, params: unknown): 'zh-CN' | 'zh-TW' | 'en' {
  try {
    const raw = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    const normalizedAction = String(action || '').toLowerCase();
    const groupId = String(raw.group_id ?? raw.groupId ?? '').trim();
    if (groupId && (normalizedAction.includes('group') || normalizedAction === 'send_msg')) {
      return normalizeOutputLocale((configStateService.resolveGroupSettings(groupId) as any).outputLocale);
    }
    return normalizeOutputLocale((configStateService.getGlobalSettings() as any).outputLocale);
  } catch {
    return 'zh-CN';
  }
}

export class OneBotActionCaller extends NormalizingOneBotActionClient {
  constructor(client: OneBotWsClient) {
    super(async (action, params) => {
      const locale = resolveLocaleForAction(action, params);
      const localized = await localizeOneBotSendParamsSafe(action, params, locale);
      return client.call(action, localized);
    });
  }
}
