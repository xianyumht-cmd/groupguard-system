import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG } from '../src/config.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { saveConfigStrict } from '../src/commands/common.ts';
import { OneBotWsClient } from '../src/standalone/onebot_ws_client.ts';
import { redactSensitiveText, redactWebSocketUrl } from '../src/standalone/redact_url.ts';
import { pluginState } from '../src/state.ts';
import { storageAdapter } from '../src/storage_adapter.ts';

class FakeWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<{ handler: (event: any) => void; once: boolean }>>();

  addEventListener(type: string, handler: (event: any) => void, options?: { once?: boolean }): void {
    const entries = this.listeners.get(type) || [];
    entries.push({ handler, once: options?.once === true });
    this.listeners.set(type, entries);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.emit('close', {});
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  emitError(error: Error): void {
    this.emit('error', { error });
  }

  emitClose(): void {
    this.emit('close', {});
  }

  respond(echo: string, data: any): void {
    this.emit('message', {
      data: JSON.stringify({ status: 'ok', retcode: 0, echo, data })
    });
  }

  fail(echo: string, wording: string, retcode = 100): void {
    this.emit('message', {
      data: JSON.stringify({ status: 'failed', retcode, echo, wording, data: null })
    });
  }

  private emit(type: string, event: any): void {
    if (type === 'close') this.readyState = 3;
    const entries = [...(this.listeners.get(type) || [])];
    this.listeners.set(type, entries.filter((entry) => !entry.once));
    for (const entry of entries) entry.handler(event);
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

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
    activeWorkers: state.activeWorkers,
    globalSendQueue: state.globalSendQueue,
    groupSendQueues: state.groupSendQueues,
    queueRoundRobinIndex: state.queueRoundRobinIndex
  };

  try {
    state.config = structuredClone(DEFAULT_PLUGIN_CONFIG);
    state.actions = { call: async () => ({ message_id: 'test' }) };
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
    assert.equal(globalEvicted, 0, 'force overflow must preserve existing global tasks');
    assert.equal(state.globalSendQueue.length, 100, 'force overflow must not grow the global queue');
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
    assert.equal(groupEvicted, 0, 'force overflow must preserve existing group tasks');
    assert.equal(state.groupSendQueues.get('group-a')?.length, 20, 'force overflow must not grow the group queue');
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
  const originalReplaceAllGroups = storageAdapter.replaceAllGroupConfigs;
  try {
    const nextConfig = structuredClone(DEFAULT_PLUGIN_CONFIG);
    nextConfig.ownerQQs = 'atomic-save-test';
    nextConfig.groups = { '10001': structuredClone(nextConfig.global) };
    configStateService.setConfig(nextConfig);
    storageAdapter.replaceAllGroupConfigs = (_groups, beforeCommit) => { beforeCommit?.(); };

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
    storageAdapter.replaceAllGroupConfigs = originalReplaceAllGroups;
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

async function verifyWebSocketRecoveryIsolation(): Promise<void> {
  const sockets: FakeWebSocket[] = [];
  const logs: string[] = [];
  const secretUrl = 'ws://alice:password@example.invalid/onebot?Access_Token=url-secret&plain=ok';
  const client = new OneBotWsClient({
    url: secretUrl,
    accessToken: 'option-secret',
    reconnectDelayMs: 1000,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message)
    },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    }
  });

  try {
    const started = client.start();
    await waitFor(() => sockets.length === 1, 'initial fake socket was not created');
    sockets[0].open();
    await started;
    assert.equal(client.getConnectionStatus().connected, true);
    assert.equal(logs.join('\n').includes('alice'), false);
    assert.equal(logs.join('\n').includes('password'), false);
    assert.equal(logs.join('\n').includes('url-secret'), false);
    assert.equal(logs.join('\n').includes('option-secret'), false);

    const failedAction = client.call('delete_group_file', { group_id: 10001, file_id: '/old-file' });
    const failedPayload = JSON.parse(sockets[0].sent.at(-1) || '{}');
    sockets[0].fail(failedPayload.echo, 'group file delete retCode=2 retMsg=no permission');
    await assert.rejects(
      failedAction,
      /onebot_action_failed:delete_group_file:100:group file delete retCode=2 retMsg=no permission/,
      'SnowLuma wording must survive the OneBot WebSocket boundary',
    );

    sockets[0].emitError(new Error(`failed ${secretUrl} token=bare-secret`));
    const sanitizedError = client.getConnectionStatus().lastError;
    assert.equal(sanitizedError.includes('alice'), false);
    assert.equal(sanitizedError.includes('password'), false);
    assert.equal(sanitizedError.includes('url-secret'), false);
    assert.equal(sanitizedError.includes('bare-secret'), false);

    sockets[0].readyState = 2;
    const firstRecovery = client.recover();
    await waitFor(() => sockets.length === 2, 'replacement fake socket was not created');
    sockets[1].open();
    assert.equal((await firstRecovery).connected, true);

    const pendingCall = client.call('get_status', {});
    const pendingPayload = JSON.parse(sockets[1].sent.at(-1) || '{}');
    sockets[0].emitClose();
    sockets[1].respond(pendingPayload.echo, { pong: true });
    assert.deepEqual(await pendingCall, { pong: true }, 'stale socket close must not reject calls on the replacement socket');
    assert.equal(client.getConnectionStatus().connected, true);

    sockets[1].emitClose();
    const recoveryA = client.recover();
    const recoveryB = client.recover();
    await waitFor(() => sockets.length === 3, 'shared recovery socket was not created');
    assert.equal(sockets.length, 3, 'concurrent recover calls must share one connection attempt');
    sockets[2].open();
    const [statusA, statusB] = await Promise.all([recoveryA, recoveryB]);
    assert.equal(statusA.connected, true);
    assert.equal(statusB.connected, true);
    assert.equal(sockets.length, 3);
  } finally {
    client.close();
  }
}

function verifyWebSocketUrlRedaction(): void {
  const raw = 'wss://alice-private:credential-zeta@example.invalid/ws?Access_Token=alpha&ToKeN=beta&Api_Key=gamma&plain=visible#secret-fragment';
  const redacted = redactWebSocketUrl(raw);
  for (const secret of ['alice-private', 'credential-zeta', 'alpha', 'beta', 'gamma', 'secret-fragment']) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /plain=visible/);
  const text = redactSensitiveText(`connect failed ${raw} ACCESS_TOKEN=delta password=epsilon`);
  for (const secret of ['alice-private', 'credential-zeta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'secret-fragment']) {
    assert.equal(text.includes(secret), false);
  }
}

async function main(): Promise<void> {
  await verifyTokenBucket();
  await verifySendQueueSettlement();
  verifyAtomicConfigSave();
  await verifyRecoverableInitialWebSocketFailure();
  await verifyWebSocketRecoveryIsolation();
  verifyWebSocketUrlRedaction();
  console.info('core stability verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
