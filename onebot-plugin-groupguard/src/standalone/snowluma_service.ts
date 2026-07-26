import path from 'path';
import { fileURLToPath } from 'node:url';
import { OneBotWsClient } from './onebot_ws_client';
import { OneBotActionCaller } from './onebot_action_caller';
import { createStandaloneContext } from './standalone_context';
import { startSnowLumaAdminServer, type SnowLumaAdminServerRuntime } from './snowluma_admin_server';
import { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup } from '../index';
import { getGroupGuardBotRole } from '../core/bot_role';
import { contextStateService } from '../core/state-services/context_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import {
  installQunGuanjiaRealtimeCapture,
  observeQunGuanjiaRealtimeMessage
} from '../services/qun_guanjia_realtime_capture';

type RuntimeState = {
  ctx: any;
  client: OneBotWsClient;
  adminServer?: SnowLumaAdminServerRuntime;
};

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
  const backupDir = path.resolve(env('GROUPGUARD_BACKUP_DIR', path.join(workDir, 'backups')));
  const dynamicCommandsConfigPath = path.resolve(env('DYNAMIC_COMMANDS_CONFIG_PATH', path.join(workDir, 'config', 'dynamic-commands', 'commands.json')));
  const timeoutMs = numberEnv('ONEBOT_ACTION_TIMEOUT_MS', 10000);
  const reconnectDelayMs = numberEnv('ONEBOT_RECONNECT_DELAY_MS', 3000);
  const botRole = getGroupGuardBotRole();
  logger.info(`GroupGuard bot role: ${botRole}`);

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

  installQunGuanjiaRealtimeCapture();

  client.onEvent(async (event) => {
    if (!event || typeof event !== 'object') return;
    const eventSelfId = String(event.self_id || '').trim();
    if (eventSelfId && eventSelfId !== identityStateService.getBotId()) {
      contextStateService.setBotId(eventSelfId);
    }
    if (isMessageEvent(event)) {
      observeQunGuanjiaRealtimeMessage(event);
      await plugin_onmessage(ctx, event as any);
      return;
    }
    await plugin_onevent(ctx, event);
  });

  const refreshBotIdentity = async (): Promise<void> => {
    try {
      const loginInfo = await client.call('get_login_info', {});
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
    getOneBotStatus: () => client.getConnectionStatus(),
    recoverOneBot: async () => {
      const status = await client.recover();
      await refreshBotIdentity();
      return status;
    },
    logger: console
  });

  logger.info(`service started workDir=${workDir} config=${configPath} dataDir=${dataDir} dynamicCommands=${dynamicCommandsConfigPath} backupDir=${backupDir}`);
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
