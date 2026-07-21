import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG } from '../src/config.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { saveConfigStrict } from '../src/commands/common.ts';
import { OneBotWsClient } from '../src/standalone/onebot_ws_client.ts';
import { pluginState } from '../src/state.ts';
import { storageAdapter } from '../src/storage_adapter.ts';

function createQueuedTask(groupId: string, onResolve: () => void) {
  return {
    groupId,
    message: [{ type: 'text', data: { text: groupId } }],
    force: true,
    applyTemplate: true,
    scene: 'stability_test',
    queuedAt: Date.now(),
    templateApplied: false,
    suffixApplied: false,
    suffixMode: '',
    contentLength: groupId.length,
    hasMedia: false,
    messageType: 'text',
    resolve: onResolve,
    reject: (error?: unknown) => { throw error; }
  };
}

async function verifyTokenBucket(): Promise<void> {
  const state = pluginState as any;
  const originalConfig = state.config;
  try {
    state.config = structuredClone(DEFAULT_PLUGIN_CONFIG);
    state.config.global.globalMaxPerMinute = 1;
    state.config.global.rateLimitEnqueue = false;
    state.tokenBucketTokens = 0;
    state.tokenBucketLastRefill = Date.now();
    state.tokenBucketInitialized = false;

    const results = await Promise.all([state.acquireToken(), state.acquireToken()]);
    assert.deepEqual(results.sort(), [false, true], 'concurrent calls may consume only one available token');
    assert.equal(await state.acquireToken(), false, 'an exhausted bucket must not refill to full immediately');
  } finally {
    state.config = originalConfig;
  }
}

async function verifySendQueueSettlement(): Promise<void> {
  const state = pluginState as any;
  const original = {
    config: state.config,
    actions: state.actions,
    networkConfig: state.networkConfig,
    activeWorkers: state.activeWorkers,
    globalSendQueue: state.globalSendQueue,
    groupSendQueues: state.groupSendQueues,
    queueRoundRobinIndex: state.queueRoundRobinIndex
  };

  try {
    state.config = structuredClone(DEFAULT_PLUGIN_CONFIG);
    state.actions = { call: async () => ({ message_id: 'test' }) };
    state.networkConfig = {};
    state.activeWorkers = 1;

    let globalEvicted = 0;
    state.config.global.queueMode = 'global';
    state.config.global.maxQueueSizeGlobal = 100;
    state.globalSendQueue = Array.from({ length: 100 }, (_, index) => (
      createQueuedTask(`global-${index}`, () => { if (index === 0) globalEvicted += 1; })
    ));
    const globalAccepted = state.enqueueGroupTask(
      'global-new',
      [{ type: 'text', data: { text: 'new' } }],
      { force: true, scene: 'stability_test' }
    );
    assert.equal(globalEvicted, 1, 'force overflow must settle the evicted global task');
    state.globalSendQueue.at(-1)?.resolve();
    await globalAccepted;

    let groupEvicted = 0;
    state.config.global.queueMode = 'group';
    state.config.global.maxQueueSizePerGroup = 20;
    const groupQueue = Array.from({ length: 20 }, (_, index) => (
      createQueuedTask('group-a', () => { if (index === 0) groupEvicted += 1; })
    ));
    state.groupSendQueues = new Map([['group-a', groupQueue]]);
    const groupAccepted = state.enqueueGroupTask(
      'group-a',
      [{ type: 'text', data: { text: 'new' } }],
      { force: true, scene: 'stability_test' }
    );
    assert.equal(groupEvicted, 1, 'force overflow must settle the evicted group task');
    state.groupSendQueues.get('group-a')?.at(-1)?.resolve();
    await groupAccepted;

    let oldModeSettled = false;
    const oldModeTask = createQueuedTask('old-group-mode', () => { oldModeSettled = true; });
    const currentModeTask = createQueuedTask('current-global-mode', () => undefined);
    state.globalSendQueue = [currentModeTask];
    state.groupSendQueues = new Map([['old-group-mode', [oldModeTask]]]);
    state.config.global.queueMode = 'global';
    const picked = state.pickNextTask();
    assert.equal(picked, oldModeTask, 'switching to global mode must drain old group queues before new traffic');
    picked.resolve();
    assert.equal(oldModeSettled, true);
  } finally {
    state.config = original.config;
    state.actions = original.actions;
    state.networkConfig = original.networkConfig;
    state.activeWorkers = original.activeWorkers;
    state.globalSendQueue = original.globalSendQueue;
    state.groupSendQueues = original.groupSendQueues;
    state.queueRoundRobinIndex = original.queueRoundRobinIndex;
  }
}

function verifyAtomicConfigSave(): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-core-stability-'));
  const configPath = path.join(tempDir, 'config.json');
  const originalConfig = configStateService.getConfig();
  const originalSaveGroups = storageAdapter.saveGroupConfigs;
  try {
    const nextConfig = structuredClone(DEFAULT_PLUGIN_CONFIG);
    nextConfig.ownerQQs = 'atomic-save-test';
    nextConfig.groups = { '10001': structuredClone(nextConfig.global) };
    configStateService.setConfig(nextConfig);
    storageAdapter.saveGroupConfigs = () => undefined;

    saveConfigStrict({ configPath } as any);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(saved.ownerQQs, 'atomic-save-test');
    assert.deepEqual(saved.groups, {}, 'main JSON must keep per-group storage split out');

    nextConfig.ownerQQs = 'atomic-save-replaced';
    saveConfigStrict({ configPath } as any);
    assert.equal(
      JSON.parse(fs.readFileSync(configPath, 'utf-8')).ownerQQs,
      'atomic-save-replaced',
      'atomic save must replace an existing config on the current platform'
    );
    assert.equal(
      fs.readdirSync(tempDir).some(name => name.endsWith('.tmp')),
      false,
      'atomic save must not leave temporary files behind'
    );
  } finally {
    storageAdapter.saveGroupConfigs = originalSaveGroups;
    configStateService.setConfig(originalConfig);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyRecoverableInitialWebSocketFailure(): Promise<void> {
  const client = new OneBotWsClient({
    url: 'not-a-valid-websocket-url',
    reconnectDelayMs: 1000,
    logger: {}
  });
  try {
    await client.start();
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  await verifyTokenBucket();
  await verifySendQueueSettlement();
  verifyAtomicConfigSave();
  await verifyRecoverableInitialWebSocketFailure();
  console.info('core stability verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
