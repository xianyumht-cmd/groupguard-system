import assert from 'node:assert/strict';
import { communicationStateService } from '../src/core/state-services/communication_state_service';
import { configStateService } from '../src/core/state-services/config_state_service';
import { loggingStateService } from '../src/core/state-services/logging_state_service';
import { groupguardRepository } from '../src/repositories/groupguard_repository';
import {
  enqueueBanAction,
  enqueueKickAction,
  enqueueMiscAction,
  getActionQueueSnapshot,
  getActionQueueTaskSnapshot,
  resetActionQueueRuntime
} from '../src/services/action_queue_service';
import type { ActionQueueEventRecord } from '../src/types';

const DEDUP_CACHE_LIMIT = 5000;

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

const settings = {
  actionQueueConcurrency: 1,
  maxActionQueueSizePerGroup: 500,
  maxActionQueueSizeGlobal: 2000,
  maxMiscPerMinute: 10000,
  maxBanPerMinute: 10000,
  maxKickPerMinute: 10000,
  actionDedupSeconds: 3600,
  actionTimeoutMs: 1000,
  miscDelayMinSeconds: 0,
  miscDelayMaxSeconds: 0,
  banDelayMinSeconds: 0,
  banDelayMaxSeconds: 0,
  kickDelayMinSeconds: 0,
  kickDelayMaxSeconds: 0
};

const originalResolveGroupSettings = configStateService.resolveGroupSettings;
const originalCallApi = communicationStateService.callApi;
const originalDebug = loggingStateService.debug;
const originalInsertActionQueueEvent = groupguardRepository.insertActionQueueEvent;
const recordedEvents: ActionQueueEventRecord[] = [];
let captureEvents = false;

configStateService.resolveGroupSettings = () => settings as never;
loggingStateService.debug = () => {};
groupguardRepository.insertActionQueueEvent = async (event) => {
  if (captureEvents) recordedEvents.push(event);
};

async function verifyDedupCapacityDoesNotDeadlock(): Promise<void> {
  settings.actionQueueConcurrency = 20;
  communicationStateService.callApi = async () => ({ status: 'ok' });
  const batchSize = 100;
  for (let start = 0; start <= DEDUP_CACHE_LIMIT; start += batchSize) {
    const end = Math.min(DEDUP_CACHE_LIMIT + 1, start + batchSize);
    const results = await Promise.all(Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return enqueueMiscAction({
        groupId: 'dedup-regression',
        action: 'dedup_noop',
        params: { index },
        reason: 'dedup_capacity_regression',
        dedupKey: `dedup-regression:${index}`,
        maxRetries: 0
      });
    }));
    results.forEach((result, offset) => {
      const index = start + offset;
      assert.equal(result.ok, true, `unique action ${index} should execute after the dedup cache reaches capacity`);
      assert.notEqual(result.code, 'backpressure_reject');
    });
  }
  await waitFor(() => getActionQueueSnapshot().activeWorkers === 0, 'dedup regression worker did not finish');
  assert.equal(getActionQueueSnapshot().totalPending, 0);
  resetActionQueueRuntime();
  settings.actionQueueConcurrency = 1;
}

async function verifyPriorityFifoAndResetSettlement(): Promise<void> {
  let releaseHold: ((value: unknown) => void) | undefined;
  communicationStateService.callApi = async (action) => {
    if (action === 'hold_worker') {
      return await new Promise((resolve) => {
        releaseHold = resolve;
      });
    }
    return { status: 'ok' };
  };

  const holdPromise = enqueueMiscAction({
    groupId: 'priority-regression',
    action: 'hold_worker',
    params: {},
    reason: 'hold_worker_for_queue_assertions',
    dedupKey: 'priority-regression:hold',
    maxRetries: 0
  });

  try {
    await waitFor(() => releaseHold !== undefined, 'priority regression worker was not held');
    recordedEvents.length = 0;
    captureEvents = true;

    const originalNow = Date.now;
    const fixedNow = originalNow();
    let firstMiscPromise: ReturnType<typeof enqueueMiscAction>;
    let secondMiscPromise: ReturnType<typeof enqueueMiscAction>;
    let kickPromise: ReturnType<typeof enqueueKickAction>;
    let banPromise: ReturnType<typeof enqueueBanAction>;
    try {
      Date.now = () => fixedNow;
      firstMiscPromise = enqueueMiscAction({
        groupId: 'priority-regression',
        action: 'first_misc',
        params: {},
        reason: 'fifo_first',
        dedupKey: 'priority-regression:misc:first',
        maxRetries: 0
      });
      secondMiscPromise = enqueueMiscAction({
        groupId: 'priority-regression',
        action: 'second_misc',
        params: {},
        reason: 'fifo_second',
        dedupKey: 'priority-regression:misc:second',
        maxRetries: 0
      });
      kickPromise = enqueueKickAction({
        groupId: 'priority-regression',
        userId: 'kick-target',
        reason: 'priority_kick',
        dedupKey: 'priority-regression:kick',
        maxRetries: 0
      });
      banPromise = enqueueBanAction({
        groupId: 'priority-regression',
        userId: 'ban-target',
        durationSeconds: 60,
        reason: 'priority_ban',
        dedupKey: 'priority-regression:ban',
        maxRetries: 0
      });
    } finally {
      Date.now = originalNow;
    }

    const [banSnapshot, kickSnapshot, firstMiscSnapshot, secondMiscSnapshot] = await Promise.all([
      getActionQueueTaskSnapshot('priority-regression:ban'),
      getActionQueueTaskSnapshot('priority-regression:kick'),
      getActionQueueTaskSnapshot('priority-regression:misc:first'),
      getActionQueueTaskSnapshot('priority-regression:misc:second')
    ]);
    assert.equal(banSnapshot?.queuePosition, 1, 'ban must be first');
    assert.equal(kickSnapshot?.queuePosition, 2, 'kick must follow ban');
    assert.equal(firstMiscSnapshot?.queuePosition, 3, 'older equal-priority task must remain first');
    assert.equal(secondMiscSnapshot?.queuePosition, 4, 'newer equal-priority task must remain second');

    const resetResult = resetActionQueueRuntime();
    assert.equal(resetResult.cleared, 4);
    const settled = await Promise.all([firstMiscPromise, secondMiscPromise, kickPromise, banPromise]);
    for (const result of settled) {
      assert.equal(result.ok, false);
      assert.equal(result.code, 'queue_reset');
    }

    const resetEvents = recordedEvents.filter((event) => event.event === 'reset');
    assert.equal(resetEvents.length, 4, 'every cleared task must record a reset outcome');
    assert.deepEqual(
      new Set(resetEvents.map((event) => event.taskId)),
      new Set([
        'priority-regression:misc:first',
        'priority-regression:misc:second',
        'priority-regression:kick',
        'priority-regression:ban'
      ])
    );
    for (const event of resetEvents) {
      assert.equal(event.code, 'queue_reset');
      assert.equal(event.ok, false);
    }
  } finally {
    captureEvents = false;
    resetActionQueueRuntime();
    releaseHold?.({ status: 'ok' });
    await holdPromise;
    await waitFor(() => getActionQueueSnapshot().activeWorkers === 0, 'held worker did not finish');
  }
}

try {
  resetActionQueueRuntime();
  await verifyDedupCapacityDoesNotDeadlock();
  await verifyPriorityFifoAndResetSettlement();
  console.log(JSON.stringify({
    passed: true,
    checks: [
      'dedup_capacity_recovers_without_backpressure_deadlock',
      'priority_descending_and_equal_priority_fifo',
      'runtime_reset_settles_and_records_every_pending_task'
    ]
  }, null, 2));
} finally {
  resetActionQueueRuntime();
  configStateService.resolveGroupSettings = originalResolveGroupSettings;
  communicationStateService.callApi = originalCallApi;
  loggingStateService.debug = originalDebug;
  groupguardRepository.insertActionQueueEvent = originalInsertActionQueueEvent;
}
