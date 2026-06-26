import { pluginState } from '../../state';

const WRAPPER_SCENE_KEY = '__groupGuardScene';

function normalizeForwardContent(message: unknown): any[] {
  if (Array.isArray(message)) return message as any[];
  if (message === undefined || message === null) return [];
  return [{ type: 'text', data: { text: String(message) } }];
}

function stripWrapperMeta(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  if (!(WRAPPER_SCENE_KEY in (params as any))) return params;
  const next = { ...(params as any) };
  delete next[WRAPPER_SCENE_KEY];
  return next;
}

function normalizeScene(scene: string): string {
  return String(scene || 'raw_text').trim().toLowerCase();
}

function isQaScene(scene: string): boolean {
  const key = normalizeScene(scene);
  return key === 'qa' || key === 'qa_reply' || key.startsWith('qa_');
}

function isQueryScene(scene: string): boolean {
  const key = normalizeScene(scene);
  return key === 'query'
    || key.startsWith('query_')
    || key.startsWith('lol_query')
    || key.startsWith('risk_query')
    || key === 'scammer_query'
    || key === 'peer_query'
    || key === 'video_query'
    || key === 'external_query';
}

export class PluginStateContextAdapter {
  getActions() {
    return pluginState.actions;
  }

  private shouldWrapGroupSend(actionName: string, params: unknown): boolean {
    if (actionName !== 'send_group_msg') return false;
    if (!params || typeof params !== 'object') return false;
    const global = (pluginState.config?.global || {}) as any;
    const groupId = (params as any).group_id ?? (params as any).groupId;
    if (groupId === undefined || groupId === null || String(groupId) === '') return false;

    const scene = String((params as any)[WRAPPER_SCENE_KEY] || 'raw_text');
    const masterEnabled = global.botSendWrapperEnabled === true;
    const mode = String(global.botSendWrapperMode || 'normal');
    if (!masterEnabled || mode !== 'forward') return false;

    if (global.botSendWrapperAllEnabled === true) return true;
    if (global.botSendWrapperQaEnabled === true && isQaScene(scene)) return true;
    if (global.botSendWrapperQueryEnabled === true && isQueryScene(scene)) return true;
    return false;
  }

  private buildForwardGroupMessageParams(params: any): any {
    const global = (pluginState.config?.global || {}) as any;
    const nickname = String(global.botSendForwardNickname || 'GroupGuard').trim() || 'GroupGuard';
    const userId = String(global.botSendForwardUserId || pluginState.botId || '0');
    const groupId = params?.group_id ?? params?.groupId;
    return {
      group_id: groupId,
      messages: [{
        type: 'node',
        data: {
          nickname,
          user_id: userId,
          content: normalizeForwardContent(params?.message)
        }
      }]
    };
  }

  setActions(actions: any): void {
    if (!actions || typeof actions.call !== 'function') {
      pluginState.actions = actions;
      return;
    }
    if ((actions as any).__groupGuardSendWrapper === true) {
      pluginState.actions = actions;
      return;
    }
    const rawCall = actions.call.bind(actions);
    pluginState.actions = {
      ...actions,
      __groupGuardSendWrapper: true,
      call: async (actionName: string, params: unknown, adapter: string, config: any): Promise<any> => {
        if (this.shouldWrapGroupSend(actionName, params)) {
          const wrappedParams = this.buildForwardGroupMessageParams(params as any);
          return rawCall('send_group_forward_msg', wrappedParams, adapter, config);
        }
        return rawCall(actionName, stripWrapperMeta(params), adapter, config);
      }
    };
  }

  getLogger() {
    return pluginState.logger;
  }

  setLogger(logger: any): void {
    pluginState.logger = logger;
  }

  getAdapterName(): string {
    return pluginState.adapterName;
  }

  setAdapterName(adapterName: string): void {
    pluginState.adapterName = adapterName;
  }

  getNetworkConfig() {
    return pluginState.networkConfig;
  }

  setNetworkConfig(networkConfig: any): void {
    pluginState.networkConfig = networkConfig;
  }

  getConfigDir(): string {
    return pluginState.configDir;
  }

  setConfigDir(configDir: string): void {
    pluginState.configDir = configDir;
  }

  getConfigSchemaHtml(): string {
    return pluginState.configSchemaHtml;
  }

  setConfigSchemaHtml(configSchemaHtml: string): void {
    pluginState.configSchemaHtml = configSchemaHtml;
  }

  setBotId(botId: string): void {
    pluginState.botId = botId;
  }

  getStartTime(): number {
    return pluginState.startTime;
  }

  getMsgCount(): number {
    return pluginState.msgCount;
  }

  cleanCache(): void {
    pluginState.cleanCache();
  }
}

export const pluginStateContextAdapter = new PluginStateContextAdapter();