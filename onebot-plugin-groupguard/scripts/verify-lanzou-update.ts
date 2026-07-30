import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config.ts';
import { communicationStateService } from '../src/core/state-services/communication_state_service.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  getLanzouDeliveryStoreStatus,
  handleLanzouUpdateEvent
} from '../src/standalone/admin/lanzou_update_api.ts';
import { getLanzouMonitorStatus, getLatestLanzouScanAt } from '../src/standalone/admin/risk_ops_api.ts';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-lanzou-'));
const configPath = path.join(workDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  lanzouUpdatePush: {
    enabled: true,
    groupIds: ['10001', '10002'],
    privateUserIds: ['20002'],
    messageTemplate: '检测到网盘更新：{title}',
    includeDiffSummary: false
  }
}), 'utf-8');

const deliveries: Array<Record<string, any>> = [];
const originalGroupSend = communicationStateService.sendGroupMsg;
const originalPrivateSend = communicationStateService.sendPrivateMsg;
const originalConfig = configStateService.getConfig();
const originalFetch = globalThis.fetch;
let failGroupOnce = '';
let failGroupError = 'simulated_group_send_failure';
let groupSendDelayMs = 0;
let activeGroupSends = 0;
let maxConcurrentGroupSends = 0;

communicationStateService.sendGroupMsg = async (targetId, message, options) => {
  activeGroupSends += 1;
  maxConcurrentGroupSends = Math.max(maxConcurrentGroupSends, activeGroupSends);
  try {
    if (groupSendDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, groupSendDelayMs));
    }
    if (targetId === failGroupOnce) {
      failGroupOnce = '';
      const errorMessage = failGroupError;
      failGroupError = 'simulated_group_send_failure';
      throw new Error(errorMessage);
    }
    deliveries.push({ channel: 'group', targetId, message, options });
  } finally {
    activeGroupSends -= 1;
  }
};
communicationStateService.sendPrivateMsg = async (targetId, message, options) => {
  deliveries.push({ channel: 'private', targetId, message, options });
};

try {
  const result = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {
      actions: {
        call: async () => {
          throw new Error('raw_action_call_must_not_be_used');
        }
      }
    }
  } as any, {
    id: 'event-complete-1',
    type: 'lanzou_update.changed',
    title: '新版资源包',
    message: 'new version available'
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryState, 'complete');
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries.map((item) => [item.channel, item.targetId]), [
    ['group', '10001'],
    ['group', '10002'],
    ['private', '20002']
  ]);
  for (const delivery of deliveries) {
    assert.equal(delivery.options.scene, 'lanzou_update_push');
    assert.equal(delivery.options.force, true);
    assert.equal(delivery.options.applyTemplate, false);
    assert.equal(delivery.options.requireDelivery, true);
  }
  assert.equal(result.message, '检测到网盘更新：新版资源包');

  const duplicate = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    id: 'event-complete-1',
    type: 'lanzou_update.changed',
    title: '新版资源包',
    message: 'new version available'
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.deliveryState, 'complete');
  assert.equal(duplicate.deduplicatedCount, 3);
  assert.equal(deliveries.length, 3);

  const conflict = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    id: 'event-complete-1',
    type: 'lanzou_update.changed',
    title: '冲突内容',
    message: 'different payload'
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'lanzou_update_event_id_conflict');
  assert.equal(conflict.retryable, false);
  assert.equal(deliveries.length, 3);

  const sensitiveErrorSentinel = 'ws://user:super-secret-token@example.invalid message=private-content';
  failGroupOnce = '10002';
  failGroupError = `onebot_action_failed:send_group_msg:500:${sensitiveErrorSentinel}`;
  const partial = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    event_id: 'event-partial-1',
    type: 'lanzou_update.changed',
    title: '第二次更新',
    message: 'second update'
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.deliveryState, 'partial');
  const failedDelivery = partial.deliveries.find((item: any) => item.targetKey === 'group:10002');
  assert.equal(failedDelivery?.ok, false);
  assert.equal(failedDelivery?.error, 'delivery_rejected');
  assert.equal(failedDelivery?.errorCode, 'delivery_rejected');
  assert.equal(failedDelivery?.errorClass, 'Error');
  const partialStoreText = fs.readFileSync(path.join(workDir, 'lanzou-update-deliveries.json'), 'utf-8');
  assert.equal(partialStoreText.includes(sensitiveErrorSentinel), false);
  assert.equal(partialStoreText.includes('super-secret-token'), false);
  assert.equal(partialStoreText.includes('private-content'), false);
  const deliveriesAfterPartial = deliveries.length;

  const retried = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    event_id: 'event-partial-1',
    type: 'lanzou_update.changed',
    title: '第二次更新',
    message: 'second update'
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.deliveryState, 'complete');
  assert.equal(retried.deduplicatedCount, 2);
  assert.equal(deliveries.length, deliveriesAfterPartial + 1);
  assert.deepEqual(deliveries.at(-1) && [deliveries.at(-1)!.channel, deliveries.at(-1)!.targetId], ['group', '10002']);

  groupSendDelayMs = 10;
  await Promise.all(['event-concurrent-a', 'event-concurrent-b'].map((eventId) => handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    event_id: eventId,
    type: 'lanzou_update.changed',
    title: eventId === 'event-concurrent-a' ? '并发更新甲' : '并发更新乙',
    message: eventId
  })));
  groupSendDelayMs = 0;
  const deliveryStore = JSON.parse(fs.readFileSync(path.join(workDir, 'lanzou-update-deliveries.json'), 'utf-8'));
  assert.ok(deliveryStore.events['event-concurrent-a']);
  assert.ok(deliveryStore.events['event-concurrent-b']);

  const deliveriesBeforeConcurrentDuplicates = deliveries.length;
  await Promise.all(['event-concurrent-a', 'event-concurrent-b'].map((eventId) => handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    event_id: eventId,
    type: 'lanzou_update.changed',
    title: eventId === 'event-concurrent-a' ? '并发更新甲' : '并发更新乙',
    message: eventId
  })));
  assert.equal(deliveries.length, deliveriesBeforeConcurrentDuplicates);

  const isolatedWorkDir = path.join(workDir, 'isolated-store');
  fs.mkdirSync(isolatedWorkDir, { recursive: true });
  const isolatedConfigPath = path.join(isolatedWorkDir, 'config.json');
  fs.writeFileSync(isolatedConfigPath, JSON.stringify({
    lanzouUpdatePush: {
      enabled: true,
      groupIds: ['30003'],
      messageTemplate: '检测到网盘更新：{title}',
      includeDiffSummary: false
    }
  }), 'utf-8');
  groupSendDelayMs = 20;
  maxConcurrentGroupSends = 0;
  const sharedEvent = {
    event_id: 'same-id-different-store',
    type: 'lanzou_update.changed',
    title: '不同存储目录并发测试',
    message: 'same payload'
  };
  await Promise.all([
    handleLanzouUpdateEvent({ configPath, dataDir: workDir, ctx: {} } as any, sharedEvent),
    handleLanzouUpdateEvent({ configPath: isolatedConfigPath, dataDir: isolatedWorkDir, ctx: {} } as any, sharedEvent)
  ]);
  groupSendDelayMs = 0;
  assert.ok(maxConcurrentGroupSends >= 2);
  const mainStoreAfterIsolation = JSON.parse(fs.readFileSync(path.join(workDir, 'lanzou-update-deliveries.json'), 'utf-8'));
  const isolatedStore = JSON.parse(fs.readFileSync(path.join(isolatedWorkDir, 'lanzou-update-deliveries.json'), 'utf-8'));
  assert.ok(mainStoreAfterIsolation.events['same-id-different-store']);
  assert.ok(isolatedStore.events['same-id-different-store']);

  const corruptWorkDir = path.join(workDir, 'corrupt-store');
  fs.mkdirSync(corruptWorkDir, { recursive: true });
  const corruptConfigPath = path.join(corruptWorkDir, 'config.json');
  fs.writeFileSync(corruptConfigPath, JSON.stringify({
    lanzouUpdatePush: {
      enabled: true,
      groupIds: ['40004'],
      messageTemplate: '{title}',
      includeDiffSummary: false
    }
  }), 'utf-8');
  const corruptOptions = {
    configPath: corruptConfigPath,
    dataDir: corruptWorkDir,
    ctx: {}
  } as any;
  const corruptStorePath = path.join(corruptWorkDir, 'lanzou-update-deliveries.json');
  const corruptStoreContents = '{"version":1,"events":';
  fs.writeFileSync(corruptStorePath, corruptStoreContents, 'utf-8');
  const detectedCorruption = getLanzouDeliveryStoreStatus(corruptOptions);
  assert.equal(detectedCorruption.ok, false);
  assert.equal(detectedCorruption.status, 'degraded');
  assert.equal(detectedCorruption.error, 'lanzou_delivery_store_corrupt');

  const deliveriesBeforeCorruptStore = deliveries.length;
  const corruptResult = await handleLanzouUpdateEvent(corruptOptions, {
    event_id: 'event-corrupt-store',
    type: 'lanzou_update.changed',
    title: '鎹熷潖瀛樺偍鍥炲綊',
    message: 'must not send before operator recovery'
  });
  assert.equal(corruptResult.ok, false);
  assert.equal(corruptResult.deliveryState, 'failed');
  assert.equal(corruptResult.degraded, true);
  assert.equal(corruptResult.retryable, false);
  assert.equal(corruptResult.requiresOperatorAction, true);
  assert.equal(corruptResult.error, 'lanzou_delivery_store_corrupt');
  assert.equal(deliveries.length, deliveriesBeforeCorruptStore);
  assert.equal(fs.existsSync(corruptStorePath), false, 'corrupt canonical store must not be overwritten with an empty store');
  const quarantineFiles = fs.readdirSync(corruptWorkDir)
    .filter((name) => name.startsWith('lanzou-update-deliveries.json.corrupt-'));
  assert.equal(quarantineFiles.length, 1);
  assert.equal(fs.readFileSync(path.join(corruptWorkDir, quarantineFiles[0]), 'utf-8'), corruptStoreContents);

  const quarantinedStatus = getLanzouDeliveryStoreStatus(corruptOptions);
  assert.equal(quarantinedStatus.ok, false);
  assert.equal(quarantinedStatus.status, 'degraded');
  assert.equal(quarantinedStatus.error, 'lanzou_delivery_store_quarantined');
  assert.equal(quarantinedStatus.quarantineFile, quarantineFiles[0]);

  const blockedRetry = await handleLanzouUpdateEvent(corruptOptions, {
    event_id: 'event-corrupt-store',
    type: 'lanzou_update.changed',
    title: '鎹熷潖瀛樺偍鍥炲綊',
    message: 'must not send before operator recovery'
  });
  assert.equal(blockedRetry.ok, false);
  assert.equal(blockedRetry.error, 'lanzou_delivery_store_quarantined');
  assert.equal(deliveries.length, deliveriesBeforeCorruptStore);

  fs.writeFileSync(corruptStorePath, '{"version":1,"events":{}}\n', 'utf-8');
  const recoveredStoreStatus = getLanzouDeliveryStoreStatus(corruptOptions);
  assert.equal(recoveredStoreStatus.ok, true);
  assert.equal(recoveredStoreStatus.status, 'healthy');
  const recoveredDelivery = await handleLanzouUpdateEvent(corruptOptions, {
    event_id: 'event-corrupt-store',
    type: 'lanzou_update.changed',
    title: '鎹熷潖瀛樺偍鍥炲綊',
    message: 'operator restored a valid canonical store'
  });
  assert.equal(recoveredDelivery.ok, true);
  assert.equal(deliveries.length, deliveriesBeforeCorruptStore + 1);

  assert.equal(getLatestLanzouScanAt({
    watcherA: { ok: true, at: '2026-07-18T01:00:00Z' },
    watcherB: { ok: false, at: '2026-07-18T03:00:00Z' }
  }), '2026-07-18T03:00:00Z');

  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error('disabled_monitor_must_not_be_fetched');
  }) as typeof fetch;
  configStateService.setConfig(normalizePluginConfig({
    lanzouUpdatePush: { enabled: false, monitorBaseUrl: 'http://monitor.local:6178' }
  } as any));
  const disabledStatus = await getLanzouMonitorStatus();
  assert.equal(disabledStatus.status, 'not_applicable');
  assert.equal(disabledStatus.ok, true);
  assert.equal(fetchCount, 0);

  configStateService.setConfig(normalizePluginConfig({
    lanzouUpdatePush: { enabled: true, monitorBaseUrl: '' }
  } as any));
  const misconfiguredStatus = await getLanzouMonitorStatus();
  assert.equal(misconfiguredStatus.status, 'misconfigured');
  assert.equal(misconfiguredStatus.ok, false);
  assert.equal(misconfiguredStatus.error, 'monitor_base_url_missing');
  assert.equal(fetchCount, 0);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.endsWith('/health')
      ? {
        ok: true,
        running: false,
        watcher_count: 2,
        enabled_watcher_count: 1,
        last_scan: {
          watcherA: { at: '2026-07-18T01:00:00Z' },
          watcherB: { at: '2026-07-18T03:00:00Z' }
        }
      }
      : { ok: true, watchers: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  configStateService.setConfig(normalizePluginConfig({
    lanzouUpdatePush: { enabled: true, monitorBaseUrl: 'http://monitor.local:6178' }
  } as any));
  const stoppedStatus = await getLanzouMonitorStatus();
  assert.equal(stoppedStatus.status, 'stopped');
  assert.equal(stoppedStatus.ok, false);
  assert.equal(stoppedStatus.ready, false);
  assert.equal(stoppedStatus.running, false);
  assert.equal(stoppedStatus.lastScan, '2026-07-18T03:00:00Z');

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.endsWith('/health')
      ? {
        ok: true,
        running: true,
        ready: false,
        status: 'degraded',
        degraded: true,
        pending_watcher_count: 1,
        orphan_watcher_count: 2
      }
      : { ok: true, watchers: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  const degradedStatus = await getLanzouMonitorStatus();
  assert.equal(degradedStatus.status, 'degraded');
  assert.equal(degradedStatus.ok, false);
  assert.equal(degradedStatus.ready, false);
  assert.equal(degradedStatus.pendingWatcherCount, 1);
  assert.equal(degradedStatus.orphanWatcherCount, 2);
  assert.equal(degradedStatus.error, 'monitor_not_ready');

  fs.writeFileSync(configPath, JSON.stringify({
    lanzouUpdatePush: {
      enabled: true,
      groupIds: ['10001'],
      messageTemplate: '缃戠洏鏇存柊锛歿title}',
      includeDiffSummary: false
    }
  }), 'utf-8');
  const invalidTemplate = await handleLanzouUpdateEvent({
    configPath,
    dataDir: workDir,
    ctx: {}
  } as any, {
    event_id: 'event-invalid-template',
    type: 'lanzou_update.changed',
    title: '不会发送的更新',
    message: 'invalid template regression'
  });
  assert.equal(invalidTemplate.ok, false);
  assert.equal(invalidTemplate.deliveryState, 'skipped');
  assert.equal(invalidTemplate.error, 'lanzou_update_push_invalid_message_template');

  console.log('lanzou update verification passed');
} finally {
  communicationStateService.sendGroupMsg = originalGroupSend;
  communicationStateService.sendPrivateMsg = originalPrivateSend;
  configStateService.setConfig(originalConfig);
  globalThis.fetch = originalFetch;
  fs.rmSync(workDir, { recursive: true, force: true });
}
