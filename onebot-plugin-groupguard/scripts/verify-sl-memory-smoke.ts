import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG, normalizePluginConfig } from '../src/config.ts';
import { plugin_init, plugin_onmessage, plugin_cleanup } from '../src/index.ts';
import { createStandaloneRuntimeContext } from '../src/standalone/standalone_context.ts';
import { GenericOneBotProfile } from '../src/hosts/generic_onebot_profile.ts';
import { cacheStateService } from '../src/core/state-services/cache_state_service.ts';
import { contextStateService } from '../src/core/state-services/context_state_service.ts';

type Snapshot = {
  label: string;
  rssMb: number;
  heapMb: number;
  msgCache: number;
  spamCache: number;
  repeatCache: number;
};

const GROUP_ID = '90001';
const TOTAL_EVENTS = Number(process.env.SL_MEMORY_SMOKE_EVENTS || 2500);

function forceGc(): void {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (typeof gc === 'function') gc();
}

function snapshot(label: string): Snapshot {
  forceGc();
  const mem = process.memoryUsage();
  return {
    label,
    rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
    heapMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    msgCache: cacheStateService.getMessageCache().size,
    spamCache: cacheStateService.getSpamCache().size,
    repeatCache: cacheStateService.getRepeatCache().size
  };
}

function assertReasonableGrowth(before: Snapshot, after: Snapshot): void {
  const heapGrowth = after.heapMb - before.heapMb;
  if (heapGrowth > 96) {
    throw new Error(`heap growth too high: ${heapGrowth.toFixed(2)}MB`);
  }
  if (after.spamCache > 5000 || after.repeatCache > 5000) {
    throw new Error(`cache cap exceeded: spam=${after.spamCache} repeat=${after.repeatCache}`);
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-memory-smoke-'));
  const configPath = path.join(tempRoot, 'config.json');
  const dataDir = path.join(tempRoot, 'data');
  const dynamicCommandsConfigPath = path.join(tempRoot, 'dynamic-commands.json');
  const sent: Array<{ action: string; params: any }> = [];
  const config = normalizePluginConfig({
    ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)),
    ownerQQs: '10001',
    licenses: {
      [GROUP_ID]: { level: 'enterprise', expireTime: 0 }
    },
    globalAntiRecall: true,
    spamDetect: true,
    spamWindow: 60,
    spamThreshold: 999999,
    global: {
      ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG.global)),
      masterEnabled: true,
      activeReplyEnabled: false,
      qaEnabled: false,
      dynamicCommandEnabled: false,
      enableVerify: false,
      autoRecallSelf: false,
      selfRecall: {
        ...DEFAULT_PLUGIN_CONFIG.global.selfRecall,
        enabled: false
      },
      disableActivity: false,
      disableReplyTemplate: true,
      randomDelayMin: 0,
      randomDelayMax: 0,
      spamDetect: true,
      spamWindow: 60,
      spamThreshold: 999999,
      repeatThreshold: 3,
      cardLockEnabled: false
    } as any
  } as any);

  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const actions = {
    async call(action: string, params: any) {
      sent.push({ action, params });
      if (action === 'get_login_info') return { user_id: 777000 };
      if (action === 'get_group_member_info') return { role: 'member' };
      return { message_id: sent.length };
    }
  };
  const ctx = createStandaloneRuntimeContext({
    actions,
    hostProfile: new GenericOneBotProfile(actions, { selfMessageEvents: true }),
    workDir: tempRoot,
    dataDir,
    configPath,
    dynamicCommandsConfigPath,
    logger: console
  });

  await plugin_init(ctx);
  const before = snapshot('before');

  for (let i = 0; i < TOTAL_EVENTS; i += 1) {
    const userId = 20000 + (i % Math.max(1, Math.floor(TOTAL_EVENTS * 0.8)));
    const raw = i % 7 === 0 ? 'repeat-memory-smoke' : `normal-memory-smoke-${i}`;
    await plugin_onmessage(ctx, {
      post_type: 'message',
      message_type: 'group',
      group_id: Number(GROUP_ID),
      user_id: userId,
      self_id: 777000,
      message_id: 500000 + i,
      raw_message: raw,
      message: [{ type: 'text', data: { text: raw } }],
      sender: { role: 'member', card: `u${userId}` }
    } as any);
  }

  const afterEvents = snapshot('after_events');
  contextStateService.cleanCache();
  const afterClean = snapshot('after_clean');
  await plugin_cleanup();
  const afterCleanup = snapshot('after_cleanup');

  console.log(JSON.stringify({
    totalEvents: TOTAL_EVENTS,
    sentActions: sent.length,
    snapshots: [before, afterEvents, afterClean, afterCleanup]
  }, null, 2));

  assertReasonableGrowth(before, afterClean);
  console.log('[ok] SL memory smoke passed');
}

await main();
