import path from 'path';
import { fileURLToPath } from 'node:url';
import { OneBotWsClient } from './onebot_ws_client';
import { OneBotActionCaller } from './onebot_action_caller';
import { createStandaloneContext } from './standalone_context';
import { startSnowLumaAdminServer, type SnowLumaAdminServerRuntime } from './snowluma_admin_server';
import { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup } from '../index';
import { getGroupGuardBotRole } from '../core/bot_role';
import { groupFileMirrorService } from '../services/group_file_mirror_service';
import {
  installQunGuanjiaRealtimeCapture,
  observeQunGuanjiaRealtimeMessage
} from '../services/qun_guanjia_realtime_capture';

type RuntimeState = {
  ctx: any;
  client: OneBotWsClient;
  adminServer?: SnowLumaAdminServerRuntime;
};

const GENERATED_FILE_UPLOAD_TTL_MS = 2 * 60 * 1000;

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isMessageEvent(event: any): boolean {
  return event?.post_type === 'message' || event?.post_type === 'message_sent';
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
  const prefix = '[GroupGuard:SnowLuma]';
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

async function start(): Promise<RuntimeState> {
  const logger = createLogger();
  const workDir = path.resolve(process.cwd());
  const wsUrl = env('SNOWLUMA_WS_URL', env('ONEBOT_WS_URL', 'ws://127.0.0.1:3001'));
  const accessToken = env('SNOWLUMA_ACCESS_TOKEN', env('ONEBOT_ACCESS_TOKEN', ''));
  const dataDir = path.resolve(env('GROUPGUARD_DATA_DIR', path.join(workDir, 'data')));
  const configPath = path.resolve(env('GROUPGUARD_CONFIG_PATH', path.join(workDir, 'config.json')));
  const groupFileMirrorConfigPath = resolveGroupFileMirrorConfigPath(configPath);
  const backupDir = path.resolve(env('GROUPGUARD_BACKUP_DIR', path.join(workDir, 'backups')));
  const dynamicCommandsConfigPath = path.resolve(env('DYNAMIC_COMMANDS_CONFIG_PATH', path.join(workDir, 'config', 'dynamic-commands', 'commands.json')));
  const timeoutMs = numberEnv('ONEBOT_ACTION_TIMEOUT_MS', 10000);
  const reconnectDelayMs = numberEnv('ONEBOT_RECONNECT_DELAY_MS', 3000);
  const botRole = getGroupGuardBotRole();
  logger.info(`GroupGuard bot role: ${botRole}`);

  // The mirror service supports an explicit env override. Populate it with a
  // production-safe default so both /app/config.json and
  // /app/config/config.json layouts resolve to /app/config/group-file-mirror.json.
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

  const actions = new OneBotActionCaller(client);
  const ctx = createStandaloneContext({
    actions,
    workDir,
    dataDir,
    configPath,
    backupDir,
    dynamicCommandsConfigPath,
    adapterName: 'snowluma-onebot',
    logger: console
  });

  // Uploads created by the mirror must not be fed back into another mirror rule.
  // A short-lived group+filename marker covers the group_upload event regardless
  // of whether SnowLuma emits it before or after the upload action response.
  const generatedFileUploads = new Map<string, number>();
  const pruneGeneratedUploads = () => {
    const now = Date.now();
    for (const [key, expiresAt] of generatedFileUploads.entries()) {
      if (expiresAt <= now) generatedFileUploads.delete(key);
    }
  };
  const consumeGeneratedUploadEvent = (event: any): boolean => {
    if (event?.post_type !== 'notice' || event?.notice_type !== 'group_upload') return false;
    pruneGeneratedUploads();
    const key = generatedUploadKey(event?.group_id, event?.file?.name ?? event?.file?.file_name);
    if (!key || !generatedFileUploads.has(key)) return false;
    generatedFileUploads.delete(key);
    logger.debug(`ignored mirror-generated group_upload group=${String(event?.group_id || '')} file=${String(event?.file?.name || event?.file?.file_name || '')}`);
    return true;
  };

  groupFileMirrorService.bindRuntime({
    callAction: async (action, params) => {
      if (action !== 'upload_group_file') return actions.call(action, params);
      const raw = params && typeof params === 'object' ? params as Record<string, any> : {};
      const key = generatedUploadKey(raw.group_id ?? raw.groupId, raw.name);
      if (key) generatedFileUploads.set(key, Date.now() + GENERATED_FILE_UPLOAD_TTL_MS);
      try {
        return await actions.call(action, params);
      } catch (error) {
        if (key) generatedFileUploads.delete(key);
        throw error;
      }
    },
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

  client.onEvent(async (event) => {
    if (!event || typeof event !== 'object') return;

    // File mirroring is a host-level automation and must observe events before
    // the licensed group-management pipeline can return early for source groups.
    // Events generated by the mirror's own target upload are excluded to prevent
    // A→B→A recursion or accidental cascading between multiple rules.
    if (!consumeGeneratedUploadEvent(event)) groupFileMirrorService.observeEvent(event);

    if (isMessageEvent(event)) {
      observeQunGuanjiaRealtimeMessage(event);
      await plugin_onmessage(ctx, event as any);
      return;
    }
    await plugin_onevent(ctx, event);
  });

  await client.start();
  await plugin_init(ctx);

  const adminServer = startSnowLumaAdminServer({
    ctx,
    workDir,
    dataDir,
    configPath,
    backupDir,
    dynamicCommandsConfigPath,
    wsUrl,
    logger: console
  });

  logger.info(`service started workDir=${workDir} config=${configPath} fileMirrorConfig=${groupFileMirrorConfigPath} dataDir=${dataDir} dynamicCommands=${dynamicCommandsConfigPath} backupDir=${backupDir}`);
  logger.info('SnowLuma reminder: enable reportSelfMessage if you need message_sent events from host side. GroupGuard also schedules self-recall from send_group_msg responses.');
  return { ctx, client, adminServer };
}

let runtime: RuntimeState | null = null;
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info(`[GroupGuard:SnowLuma] stopping by ${signal}`);
  try {
    runtime?.client.close();
  } catch { /* noop */ }
  try {
    await runtime?.adminServer?.close();
  } catch (error) {
    console.error(`[GroupGuard:SnowLuma] admin webui close failed: ${String(error)}`);
  }
  try {
    await plugin_cleanup();
  } catch (error) {
    console.error(`[GroupGuard:SnowLuma] cleanup failed: ${String(error)}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error(`[GroupGuard:SnowLuma] unhandledRejection: ${String(reason)}`);
});
process.on('uncaughtException', (error) => {
  console.error(`[GroupGuard:SnowLuma] uncaughtException: ${String(error)}`);
});

const isDirectRun = (() => {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const current = fileURLToPath(import.meta.url);
    return entry === current || entry.endsWith('snowluma-service.mjs');
  } catch {
    return true;
  }
})();

if (isDirectRun) {
  start()
    .then((state) => { runtime = state; })
    .catch((error) => {
      console.error(`[GroupGuard:SnowLuma] start failed: ${String(error)}`);
      process.exit(1);
    });
}

export { start };
