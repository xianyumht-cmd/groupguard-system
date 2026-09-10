import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildLolPatchNoticeSegments,
  reconcileLolPatchNotifications,
  resolveLolPatchNotificationGroupIds,
  validateLolPatchStatus,
  type LolPatchStatus,
} from '../src/services/lol_patch_notifier.ts';
import { LolPatchNotificationStateStore } from '../src/services/lol_patch_notification_state.ts';

const PATCH_STATUS: LolPatchStatus = {
  date: '2026-09-10',
  patch: '26.18',
  is_update_today: true,
  next_update_date: '2026-09-23',
  next_patch: '26.19',
  source: 'riot_patch_schedule_snapshot_2026',
  source_url: 'https://support-leagueoflegends.riotgames.com/',
  checked_at: '2026-09-10T12:00:00+08:00',
  event_id: 'lol-patch-26.18-2026-09-10',
  schedule_timezone: 'Asia/Shanghai',
};

function createHarness(overrides: Record<string, unknown> = {}) {
  const delivered = new Set<string>();
  const sent: string[] = [];
  let fetchCount = 0;
  const logs: string[] = [];
  const options = {
    now: new Date('2026-09-10T04:05:00.000Z'),
    enabled: true,
    currentRole: 'query' as const,
    senderRole: 'query' as const,
    notificationTime: '12:00',
    baseUrl: 'http://192.168.3.100:5001',
    timeoutMs: 5_000,
    groupIds: ['10001', '10002'],
    fetchStatus: async () => {
      fetchCount += 1;
      return PATCH_STATUS;
    },
    hasDelivered: (eventId: string, groupId: string) => delivered.has(`${eventId}:${groupId}`),
    markDelivered: (eventId: string, groupId: string) => { delivered.add(`${eventId}:${groupId}`); },
    sendNotice: async (groupId: string) => { sent.push(groupId); },
    log: (_level: string, message: string) => { logs.push(message); },
    ...overrides,
  };
  return {
    options,
    delivered,
    sent,
    logs,
    get fetchCount() { return fetchCount; },
  };
}

async function main() {
  {
    assert.deepEqual(resolveLolPatchNotificationGroupIds([], ['10001', '10002']), []);
    assert.deepEqual(resolveLolPatchNotificationGroupIds(undefined, ['10001']), []);
    assert.deepEqual(resolveLolPatchNotificationGroupIds(['10002'], ['10001', '10002', '10003']), ['10002']);
    assert.deepEqual(resolveLolPatchNotificationGroupIds(['10002', '99999'], ['10001', '10002']), ['10002']);
    assert.deepEqual(resolveLolPatchNotificationGroupIds(['10002', '10002'], ['10002']), ['10002']);
  }

  {
    const harness = createHarness({ now: new Date('2026-09-10T03:59:00.000Z') });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'before_time');
    assert.equal(harness.fetchCount, 0);
    assert.deepEqual(harness.sent, []);
  }

  {
    const harness = createHarness({ currentRole: 'qa' });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'role_inactive');
    assert.equal(harness.fetchCount, 0);
  }

  {
    const harness = createHarness({ baseUrl: '' });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'misconfigured');
    assert.equal(harness.fetchCount, 0);
  }

  {
    const harness = createHarness({
      fetchStatus: async () => ({ ...PATCH_STATUS, is_update_today: false, patch: '26.18', event_id: null }),
    });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'not_patch_day');
    assert.deepEqual(harness.sent, []);
  }

  {
    const harness = createHarness({
      fetchStatus: async () => { throw new Error('network_down'); },
    });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'provider_error');
    assert.deepEqual(harness.sent, []);
  }

  {
    const harness = createHarness();
    const first = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(first.status, 'completed');
    assert.equal(first.succeeded, 2);
    assert.deepEqual(harness.sent, ['10001', '10002']);
    const second = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(second.attempted, 0);
    assert.equal(second.deduplicated, 2);
    assert.deepEqual(harness.sent, ['10001', '10002']);
  }

  {
    const harness = createHarness({
      groupIds: ['10001'],
      sendNotice: async () => { throw new Error('onebot_rejected'); },
    });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.failed, 1);
    assert.equal(result.succeeded, 0);
    assert.equal(harness.delivered.size, 0);
  }

  {
    const harness = createHarness({
      fetchStatus: async () => ({ ...PATCH_STATUS, date: '2026-09-09' }),
    });
    const result = await reconcileLolPatchNotifications(harness.options as any);
    assert.equal(result.status, 'provider_error');
    assert.deepEqual(harness.sent, []);
  }

  {
    assert.throws(
      () => validateLolPatchStatus({ ...PATCH_STATUS, schedule_timezone: 'UTC' }),
      /timezone_mismatch/,
    );
    const segments = buildLolPatchNoticeSegments(PATCH_STATUS);
    assert.deepEqual(segments[0], { type: 'at', data: { qq: 'all' } });
    assert.match(String((segments[1].data as Record<string, unknown>).text), /26\.18/);
  }

  {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-patch-state-'));
    const first = new LolPatchNotificationStateStore(temp);
    assert.equal(first.has(PATCH_STATUS.event_id!, '10001'), false);
    first.mark(PATCH_STATUS.event_id!, '10001', '2026-09-10T12:05:00+08:00');
    const second = new LolPatchNotificationStateStore(temp);
    assert.equal(second.has(PATCH_STATUS.event_id!, '10001'), true);
    fs.rmSync(temp, { recursive: true, force: true });
  }

  {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-patch-state-corrupt-'));
    fs.writeFileSync(path.join(temp, 'lol-patch-notifications.json'), '{bad json', 'utf8');
    assert.throws(() => new LolPatchNotificationStateStore(temp), /state_corrupt/);
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('verify-lol-patch-notifier: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
