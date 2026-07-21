import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config.ts';
import { communicationStateService } from '../src/core/state-services/communication_state_service.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { handleLanzouUpdateEvent } from '../src/standalone/admin/lanzou_update_api.ts';
import { getLanzouMonitorStatus, getLatestLanzouScanAt } from '../src/standalone/admin/risk_ops_api.ts';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-lanzou-'));
const configPath = path.join(workDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  lanzouUpdatePush: {
    enabled: true,
    groupIds: ['10001'],
    privateUserIds: ['20002'],
    messageTemplate: '{message}',
    includeDiffSummary: false
  }
}), 'utf-8');

const deliveries: Array<Record<string, any>> = [];
const originalGroupSend = communicationStateService.sendGroupMsg;
const originalPrivateSend = communicationStateService.sendPrivateMsg;
const originalConfig = configStateService.getConfig();
const originalFetch = globalThis.fetch;

communicationStateService.sendGroupMsg = async (targetId, message, options) => {
  deliveries.push({ channel: 'group', targetId, message, options });
};
communicationStateService.sendPrivateMsg = async (targetId, message, options) => {
  deliveries.push({ channel: 'private', targetId, message, options });
};

try {
  const result = await handleLanzouUpdateEvent({
    configPath,
    ctx: {
      actions: {
        call: async () => {
          throw new Error('raw_action_call_must_not_be_used');
        }
      }
    }
  } as any, {
    type: 'lanzou_update.changed',
    message: 'new version available'
  });

  assert.equal(result.ok, true);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((item) => [item.channel, item.targetId]), [
    ['group', '10001'],
    ['private', '20002']
  ]);
  for (const delivery of deliveries) {
    assert.equal(delivery.options.scene, 'lanzou_update_push');
    assert.equal(delivery.options.force, false);
    assert.equal(delivery.options.applyTemplate, false);
  }

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
  assert.equal(stoppedStatus.running, false);
  assert.equal(stoppedStatus.lastScan, '2026-07-18T03:00:00Z');

  console.log('lanzou update verification passed');
} finally {
  communicationStateService.sendGroupMsg = originalGroupSend;
  communicationStateService.sendPrivateMsg = originalPrivateSend;
  configStateService.setConfig(originalConfig);
  globalThis.fetch = originalFetch;
  fs.rmSync(workDir, { recursive: true, force: true });
}
