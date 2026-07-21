import { GROUPGUARD_SEND_SCENE_KEY } from '../send_wrapper_constants';
import { loggingStateService } from '../state-services/logging_state_service';
import { pluginState } from '../../state';
import { packageForwardMessages, packageOutgoingSegments } from '../../services/outgoing_risk_packager';
import { qunGuanjiaService } from '../../services/qun_guanjia_service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessageSegment(value: unknown): value is Record<string, any> {
  return isRecord(value) && typeof value.type === 'string';
}

function getSceneFromMessage(message: unknown): string {
  if (!Array.isArray(message)) return '';
  for (const segment of message) {
    if (!isMessageSegment(segment)) continue;
    const data = isRecord(segment.data) ? segment.data : null;
    const scene = data?.[GROUPGUARD_SEND_SCENE_KEY];
    if (typeof scene === 'string' && scene.trim()) return scene.trim();
  }
  return '';
}

function stripSceneMetaFromSegment(segment: unknown): unknown {
  if (!isMessageSegment(segment)) return segment;
  const data = isRecord(segment.data) ? { ...segment.data } : segment.data;
  if (isRecord(data) && GROUPGUARD_SEND_SCENE_KEY in data) {
    delete data[GROUPGUARD_SEND_SCENE_KEY];
    return { ...segment, data };
  }
  return segment;
}

function stripSceneMetaFromMessage(message: unknown): unknown {
  if (!Array.isArray(message)) return message;
  return message.map(stripSceneMetaFromSegment);
}

function normalizeForwardContent(message: unknown): any[] {
  if (Array.isArray(message)) return stripSceneMetaFromMessage(message) as any[];
  if (message === undefined || message === null) return [];
  return [{ type: 'text', data: { text: String(message) } }];
}

function stripWrapperMeta(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const next = { ...(params as any) };
  if (GROUPGUARD_SEND_SCENE_KEY in next) delete next[GROUPGUARD_SEND_SCENE_KEY];
  if (Array.isArray(next.message)) next.message = stripSceneMetaFromMessage(next.message);
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

  private getSendScene(params: unknown): string {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return 'raw_text';
    return String((params as any)[GROUPGUARD_SEND_SCENE_KEY] || getSceneFromMessage((params as any).message) || 'raw_text');
  }

  private shouldWrapGroupSend(actionName: string, params: unknown): boolean {
    if (actionName !== 'send_group_msg') return false;
    if (!params || typeof params !== 'object') return false;
    const global = (pluginState.config?.global || {}) as any;
    const groupId = (params as any).group_id ?? (params as any).groupId;
    if (groupId === undefined || groupId === null || String(groupId) === '') return false;

    const scene = this.getSendScene(params);
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
    const scene = this.getSendScene(params);
    const settings = pluginState.getGroupSettings(String(groupId || ''));
    const content = packageOutgoingSegments(normalizeForwardContent(params?.message), settings, scene, 'forward').message;
    return {
      group_id: groupId,
      messages: [{
        type: 'node',
        data: {
          nickname,
          user_id: userId,
          content
        }
      }]
    };
  }

  private sanitizeSendParams(actionName: string, params: unknown): unknown {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
    const next = stripWrapperMeta(params) as any;
    if (actionName === 'send_group_msg' && Array.isArray(next.message)) {
      const groupId = String(next.group_id ?? next.groupId ?? '');
      const scene = this.getSendScene(params);
      next.message = packageOutgoingSegments(next.message, pluginState.getGroupSettings(groupId), scene, 'group').message;
    }
    if (actionName === 'send_group_forward_msg' && Array.isArray(next.messages)) {
      const groupId = String(next.group_id ?? next.groupId ?? '');
      next.messages = packageForwardMessages(next.messages, pluginState.getGroupSettings(groupId), 'raw_text').messages;
    }
    return next;
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
    qunGuanjiaService.bindRuntime({
      rawCall,
      getAdapterName: () => pluginState.adapterName,
      getNetworkConfig: () => pluginState.networkConfig,
      getDataDir: () => pluginState.dataDir,
      getGroupSettings: (groupId: string) => pluginState.getGroupSettings(groupId),
      log: (level, message) => pluginState.log(level, message)
    });
    pluginState.actions = {
      ...actions,
      __groupGuardSendWrapper: true,
      call: async (actionName: string, params: unknown, adapter: string, config: any): Promise<any> => {
        const sanitizedParams = this.sanitizeSendParams(actionName, params);
        if (actionName === 'send_group_msg') {
          const route = await qunGuanjiaService.routeGroupMessage(sanitizedParams as any, this.getSendScene(params));
          if (route.ok) return route.response;
          if (route.handled && !route.fallback) throw new Error(route.error || 'Q群管家代发失败');
        }
        if (this.shouldWrapGroupSend(actionName, params)) {
          const wrappedParams = this.buildForwardGroupMessageParams(params as any);
          loggingStateService.warn(`forward_send_direct source=send_wrapper group=${String((wrappedParams as any).group_id || '')}`);
          return rawCall('send_group_forward_msg', wrappedParams, adapter, config);
        }
        return rawCall(actionName, sanitizedParams, adapter, config);
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

  getWorkDir(): string {
    return pluginState.workDir;
  }

  setWorkDir(workDir: string): void {
    pluginState.workDir = workDir;
  }

  getConfigPath(): string {
    return pluginState.configPath;
  }

  setConfigPath(configPath: string): void {
    pluginState.configPath = configPath;
  }

  getConfigDir(): string {
    return pluginState.configDir;
  }

  setConfigDir(configDir: string): void {
    pluginState.configDir = configDir;
  }

  getDataDir(): string {
    return pluginState.dataDir;
  }

  setDataDir(dataDir: string): void {
    pluginState.dataDir = dataDir;
  }

  getBackupDir(): string {
    return pluginState.backupDir;
  }

  setBackupDir(backupDir: string): void {
    pluginState.backupDir = backupDir;
  }

  getDynamicCommandsConfigPath(): string {
    return pluginState.dynamicCommandsConfigPath;
  }

  setDynamicCommandsConfigPath(configPath: string): void {
    pluginState.dynamicCommandsConfigPath = configPath;
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
