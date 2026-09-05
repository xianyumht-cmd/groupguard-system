import path from 'path';
import { fileURLToPath } from 'node:url';
import { OneBotWsClient } from './onebot_ws_client';
import { OneBotActionCaller } from './onebot_action_caller';
import { createStandaloneRuntimeContext } from './standalone_context';
import { startSnowLumaAdminServer, type SnowLumaAdminServerRuntime } from './snowluma_admin_server';
import {
  handleGroupGuardEvent,
  handleGroupGuardMessage,
  initializeGroupGuard,
  shutdownGroupGuard,
} from '../index';
import { getGroupGuardBotRole } from '../core/bot_role';
import { contextStateService } from '../core/state-services/context_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { groupFileMirrorService } from '../services/group_file_mirror_service';
import { SnowLumaProfile } from '../hosts/snowluma_profile';
import { GenericOneBotProfile } from '../hosts/generic_onebot_profile';
import type { HostProfile } from '../hosts/host_profile';
import type { OneBotActionClient } from '../protocol/onebot11/action_client';
import { isOneBotMessageEvent, normalizeOneBotEvent } from '../protocol/onebot11/types';
import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import {
  installQunGuanjiaRealtimeCapture,
  observeQunGuanjiaRealtimeMessage
} from '../services/qun_guanjia_realtime_capture';

type RuntimeState = {
  ctx: GroupGuardRuntimeContext;
  client: OneBotWsClient;
  adminServer?: SnowLumaAdminServerRuntime;
};

const GENERATED_FILE_UPLOAD_TTL_MS = 2 * 60 * 1000;

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function canonicalEnv(primary: string, legacy: string, fallback = ''): string {
  const primaryValue = env(primary);
  if (primaryValue) return primaryValue;
  const legacyValue = env(legacy);
  if (legacyValue) {
    console.warn(`[GroupGuard:OneBot] ${legacy} is a temporary compatibility alias; migrate to ${primary}`);
    return legacyValue;
  }
  return fallback;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function generatedUploadKey(groupId: unknown, fileName: unknown): string {
  const group = String(groupId ?? '').trim();
  const name = String(fileName ?? '').trim();
  return group && name ? `${group}\n${name}` : '';
}

function resolveGroupFileMirrorConfigPath(configPath: string): string {
  const configured = String(process.env.GROUP_FILE_MIRROR_CONFIG_PATH || '').trim();
  if (configured) return path.resolve(configured);
  const mainConfigDir = path.dirname(configPath);
  const targetDir = path.basename(mainConfigDir).toLowerCase() === 'config'
    ? mainConfigDir
    : path.join(mainConfigDir, 'config');
  return path.join(targetDir, 'group-file-mirror.json');
}

function createLogger() {
  const prefix = '[GroupGuard:OneBot]';
  return {
    info: (message: string) => console.info(`${prefix} ${message}`),
    warn: (message: string) => console.warn(`${prefix} ${message}`),
    error: (message: string) => console.error(`${prefix} ${message}`),
    debug: (message: string) => {
      if (process.env.GROUPGUARD_DEBUG === '1' || process.env.GROUPGUARD_DEBUG === 'true') {
        console.info(`${prefix} ${message}`);
      }
    }
  };
}

function createHostProfile(id: string, actions: OneBotActionClient): HostProfile {
  if (id === 'snowluma') return new SnowLumaProfile(actions);
  if (id === 'generic-onebot') return new GenericOneBotProfile(actions);
  throw new Error(`unsupported_onebot_host_profile:${id}`);
}

async function start(): Promise<RuntimeState> {
  const logger = createLogger();
  const workDir = path.resolve(process.cwd());
  const wsUrl = canonicalEnv('ONEBOT_WS_URL', 'SNOWLUMA_WS_URL', 'ws://127.0.0.1:3001');
  const accessToken = canonicalEnv('ONEBOT_ACCESS_TOKEN', 'SNOWLUMA_ACCESS_TOKEN', '');
  const hostProfileId = env('ONEBOT_HOST_PROFILE', 'snowluma').trim().toLowerCase();
  const dataDir = path.resolve(env('GROUPGUARD_DATA_DIR', path.join(workDir, 'data')));
  const configPath = path.resolve(env('GROUPGUARD_CONFIG_PATH', path.join(workDir, 'config.json')));
  const groupFileMirrorConfigPath = resolveGroupFileMirrorConfigPath(configPath);
  const backupDir = path.resolve(env('GROUPGUARD_BACKUP_DIR', path.join(workDir, 'backups')));
  const dynamicCommandsConfigPath = path.resolve(env('DYNAMIC_COMMANDS_CONFIG_PATH', path.join(workDir, 'config', 'dynamic-commands', 'commands.json')));
  const timeoutMs = numberEnv('ONEBOT_ACTION_TIMEOUT_MS', 10000);
  const reconnectDelayMs = numberEnv('ONEBOT_RECONNECT_DELAY_MS', 3000);
  const botRole = getGroupGuardBotRole();
  logger.info(`GroupGuard bot role: ${botRole}; host profile: ${hostProfileId}`);

  if (!String(process.env.GROUP_FILE_MIRROR_CONFIG_PATH || '').trim()) {
    process.env.GROUP_FILE_MIRROR_CONFIG_PATH = groupFileMirrorConfigPath;
  }

  const client = new OneBotWsClient({
    url: wsUrl,
    accessToken,
    timeoutMs,
    reconnectDelayMs,
    logger
  });

  const rawActions = new OneBotActionCaller(client);
  const generatedFileUploads = new Map<string, number>();
  const pruneGeneratedUploads = () => {
    const now = Date.now();
    for (const [key, expiresAt] of generatedFileUploads.entries()) {
      if (expiresAt <= now) generatedFileUploads.delete(key);
    }
  };

  const actions: OneBotActionClient = {
    call: async (action, params = {}) => {
      if (action !== 'upload_group_file') return rawActions.call(action, params);
      const raw = params && typeof params === 'object' ? params as Record<string, unknown> : {};
      pruneGeneratedUploads();
      const key = generatedUploadKey(raw.group_id ?? raw.groupId, raw.name);
      if (key) {
        if (generatedFileUploads.size >= 2000) {
          const oldestKey = generatedFileUploads.keys().next().value as string | undefined;
          if (oldestKey) generatedFileUploads.delete(oldestKey);
        }
        generatedFileUploads.set(key, Date.now() + GENERATED_FILE_UPLOAD_TTL_MS);
      }
      try {
        return await rawActions.call(action, params);
      } catch (error) {
        if (key) generatedFileUploads.delete(key);
        throw error;
      }
    }
  };

  const hostProfile = createHostProfile(hostProfileId, actions);
  const ctx = createStandaloneRuntimeContext({
    actions,
    hostProfile,
    workDir,
    dataDir,
    configPath,
    backupDir,
    dynamicCommandsConfigPath,
    logger
  });
  runtime = { ctx, client };

  const consumeGeneratedUploadEvent = (event: Record<string, any>): boolean => {
    if (event.post_type !== 'notice' || event.notice_type !== 'group_upload') return false;
    pruneGeneratedUploads();
    const uploaderId = String(event.user_id ?? event.operator_id ?? '').trim();
    const botId = identityStateService.getBotId();
    if (!botId || uploaderId !== botId) return false;
    const key = generatedUploadKey(event.group_id, event.file?.name ?? event.file?.file_name);
    if (!key || !generatedFileUploads.has(key)) return false;
    generatedFileUploads.delete(key);
    logger.debug(`ignored mirror-generated group_upload group=${String(event.group_id || '')} file=${String(event.file?.name || event.file?.file_name || '')}`);
    return true;
  };

  groupFileMirrorService.bindRuntime({
    hostProfile,
    workDir,
    dataDir,
    configPath,
    log: (level, message) => {
      if (level === 'error') logger.error(message);
      else if (level === 'warn') logger.warn(message);
      else if (level === 'debug') logger.debug(message);
      else logger.info(message);
    }
  });

  installQunGuanjiaRealtimeCapture();

  let runtimeReady = false;
  const pendingEvents: unknown[] = [];
  const MAX_PENDING_EVENTS = 500;
  const dispatchEvent = async (rawEvent: unknown): Promise<void> => {
    const event = normalizeOneBotEvent(rawEvent);
    if (!event) return;
    const eventSelfId = String(event.self_id || '').trim();
    if (eventSelfId && eventSelfId !== identityStateService.getBotId()) contextStateService.setBotId(eventSelfId);
    if (!consumeGeneratedUploadEvent(event as Record<string, any>)) groupFileMirrorService.observeEvent(event);
    if (isOneBotMessageEvent(event)) {
      observeQunGuanjiaRealtimeMessage(event);
      await handleGroupGuardMessage(event, ctx);
      return;
    }
    await handleGroupGuardEvent(event, ctx);
  };

  client.onEvent(async (event) => {
    if (!runtimeReady) {
      if (pendingEvents.length >= MAX_PENDING_EVENTS) pendingEvents.shift();
      pendingEvents.push(event);
      return;
    }
    await dispatchEvent(event);
  });

  const refreshBotIdentity = async (): Promise<void> => {
    try {
      const loginInfo = await actions.call('get_login_info', {}) as { user_id?: string | number } | undefined;
      const botId = String(loginInfo?.user_id || '').trim();
      if (botId) {
        contextStateService.setBotId(botId);
        logger.info(`OneBot identity refreshed: ${botId}`);
      } else {
        logger.warn('OneBot identity refresh returned an empty user_id');
      }
    } catch (error) {
      logger.warn(`OneBot identity refresh failed: ${String((error as Error)?.message || error)}`);
    }
  };
  client.onConnected(refreshBotIdentity);

  await initializeGroupGuard(ctx);
  await client.start();
  await refreshBotIdentity();
  runtimeReady = true;
  for (const event of pendingEvents.splice(0)) await dispatchEvent(event);

  const adminServer = startSnowLumaAdminServer({
    ctx,
    workDir,
    dataDir,
    configPath,
    backupDir,
    dynamicCommandsConfigPath,
    wsUrl,
    getOneBotStatus: () => client.getConnectionStatus(),
    recoverOneBot: async () => {
      const status = await client.recover();
      await refreshBotIdentity();
      return status;
    },
    logger: console
  });
  runtime.adminServer = adminServer;

  logger.info(`service started workDir=${workDir} config=${configPath} fileMirrorConfig=${groupFileMirrorConfigPath} dataDir=${dataDir} dynamicCommands=${dynamicCommandsConfigPath} backupDir=${backupDir}`);
  logger.info(`self-message capability=${hostProfile.capabilities.selfMessageEvents}; GroupGuard also schedules self-recall from send responses.`);
  return { ctx, client, adminServer };
}

let runtime: RuntimeState | null = null;
let stopping = false;

async function stop(signal: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info(`[GroupGuard:OneBot] stopping by ${signal}`);
  try { await runtime?.adminServer?.close(); } catch (error) {
    console.error(`[GroupGuard:OneBot] admin webui close failed: ${String(error)}`);
  }
  try { await shutdownGroupGuard(); } catch (error) {
    console.error(`[GroupGuard:OneBot] cleanup failed: ${String(error)}`);
  }
  try { runtime?.client.close(); } catch { /* noop */ }
  runtime = null;
  process.exit(exitCode);
}

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error(`[GroupGuard:OneBot] unhandledRejection: ${String(reason)}`);
  void stop('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  console.error(`[GroupGuard:OneBot] uncaughtException: ${String(error)}`);
  void stop('uncaughtException', 1);
});

const isDirectRun = (() => {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const current = fileURLToPath(import.meta.url);
    return entry === current || entry.endsWith('onebot-service.mjs') || entry.endsWith('snowluma-service.mjs');
  } catch {
    return true;
  }
})();

if (isDirectRun) {
  start()
    .then((state) => { runtime = state; })
    .catch((error) => {
      console.error(`[GroupGuard:OneBot] start failed: ${String(error)}`);
      void stop('startup_failure', 1);
    });
}

export { start };
