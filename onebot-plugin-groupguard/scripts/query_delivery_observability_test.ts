import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contextStateService } from '../src/core/state-services/context_state_service.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { send } from '../src/dynamic-commands/response_capture_runtime.ts';
import { pluginState } from '../src/state.ts';
import {
  createQueryDeliveryTrace,
  markPayloadReady,
  safeApiTiming,
  serializeQueryDeliveryTrace
} from '../src/services/query_delivery_observability.ts';
import {
  parseGroupGuardQueryDelivery,
  toOneBotDeliveryPlan
} from '../src/services/groupguard_query_delivery_client.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryDelivery(text: string, trace: ReturnType<typeof createQueryDeliveryTrace>) {
  return send({
    channel: 'group',
    targetId: 'test-group',
    scene: 'external_query',
    segments: [{ type: 'text', data: { text } }],
    force: true,
    applyTemplate: false,
    skipProbability: true,
    requireDelivery: true,
    queryDeliveryTrace: trace
  });
}

const originalConfig = structuredClone(configStateService.getConfig() as any);
const originalActions = contextStateService.getActions();
let callCount = 0;
let firstActionStarted: (() => void) | null = null;
const firstActionStartedPromise = new Promise<void>((resolve) => {
  firstActionStarted = resolve;
});
const actionStarts: number[] = [];
const actionEnds: number[] = [];

try {
  const config = structuredClone(originalConfig) as any;
  config.global = {
    ...(config.global || {}),
    queueMode: 'global',
    queueConcurrency: 1,
    randomDelayMin: 0,
    randomDelayMax: 0,
    globalMaxPerMinute: 100000,
    replyProbability: 100,
    disableReplyTemplate: true,
    autoRecallSelf: false,
    selfRecall: { ...(config.global?.selfRecall || {}), enabled: false }
  };
  config.groups = {};
  configStateService.setConfig(config);

  contextStateService.setActions({
    __groupGuardSendWrapper: true,
    call: async (action: string) => {
      assert.ok(action === 'send_group_msg' || action === 'send_group_forward_msg');
      callCount += 1;
      actionStarts.push(Date.now());
      if (callCount === 1) {
        firstActionStarted?.();
        firstActionStarted = null;
        await wait(35);
      } else if (callCount === 2) {
        await wait(5);
      } else if (callCount === 3) {
        throw new Error('onebot_send_failed');
      }
      actionEnds.push(Date.now());
      return { message_id: String(1000 + callCount) };
    }
  });

  const blocker = send({
    channel: 'group',
    targetId: 'test-group',
    scene: 'raw_text',
    message: 'queue blocker',
    force: true,
    applyTemplate: false,
    skipProbability: true,
    requireDelivery: true
  });
  await firstActionStartedPromise;

  const successTrace = createQueryDeliveryTrace('battle');
  markPayloadReady(successTrace);
  const successDelivery = queryDelivery('queued success', successTrace);
  await Promise.all([blocker, successDelivery]);

  assert.ok(successTrace.t5QueueSubmittedAt, 'T5 must be recorded when the task enters the queue');
  assert.ok(successTrace.t6QueueWorkerStartedAt, 'T6 must be recorded when a worker acquires the task');
  assert.ok(successTrace.t7RiskDelayFinishedAt, 'T7 must be recorded after risk delay');
  assert.ok(successTrace.t8SendStartedAt, 'T8 must wrap the OneBot action');
  assert.ok(successTrace.t9SendFinishedAt, 'T9 must follow the OneBot action');
  assert.ok(
    (successTrace.t6QueueWorkerStartedAt as number) > (successTrace.t5QueueSubmittedAt as number),
    'the occupied worker must leave measurable queue wait'
  );
  assert.ok(
    (successTrace.t7RiskDelayFinishedAt as number) - (successTrace.t6QueueWorkerStartedAt as number) <= 50,
    'zero configured risk delay must remain approximately zero'
  );
  assert.ok((successTrace.t8SendStartedAt as number) <= actionStarts[1], 'T8 must be before the actual OneBot call');
  assert.ok((successTrace.t9SendFinishedAt as number) >= actionEnds[1], 'T9 must be after the actual OneBot call');
  const serializedSuccess = serializeQueryDeliveryTrace(successTrace);
  assert.equal(serializedSuccess.transport, 'send_queue');
  assert.equal(serializedSuccess.send_status, 'success');
  assert.ok(Number(serializedSuccess.queue_wait_ms) > 0);
  assert.ok(Number(serializedSuccess.risk_delay_ms) <= 50);

  const failedTrace = createQueryDeliveryTrace('aram');
  markPayloadReady(failedTrace);
  await assert.rejects(queryDelivery('queued failure', failedTrace), /onebot_send_failed/);
  assert.ok(failedTrace.t8SendStartedAt, 'failed OneBot sends must still record T8');
  assert.ok(failedTrace.t9SendFinishedAt, 'failed OneBot sends must still record T9');
  assert.equal(failedTrace.sendStatus, 'failed');
  assert.equal(serializeQueryDeliveryTrace(failedTrace).send_status, 'failed');

  const forwardTrace = createQueryDeliveryTrace('shard');
  await send({
    channel: 'group',
    targetId: 'test-group',
    scene: 'external_query',
    forwardNodes: [{ type: 'node', data: { content: [{ type: 'text', data: { text: 'forward' } }] } }],
    force: true,
    applyTemplate: false,
    skipProbability: true,
    queryDeliveryTrace: forwardTrace
  });
  assert.equal(forwardTrace.transport, 'direct_onebot');
  assert.ok(forwardTrace.t8SendStartedAt && forwardTrace.t9SendFinishedAt);
  assert.equal(forwardTrace.t5QueueSubmittedAt, undefined, 'forward direct behavior must not be re-routed through the queue');

  assert.equal(safeApiTiming({}), undefined, 'missing API timing metadata must remain optional');
  const sanitized = safeApiTiming({
    timing: {
      query_ms: 12.5,
      render_ms: 3.2,
      delivery_prepare_ms: 1.1,
      api_total_ms: 16.8,
      request_id: 'must-not-pass-through',
      image: { cache: 'hit', bytes: 123, base64_chars: 164, width: 100, height: 50 }
    }
  });
  assert.equal(sanitized?.schema_version, 'query-delivery-timing.v1');
  assert.equal((sanitized as any)?.request_id, undefined);
  assert.equal((sanitized as any)?.image?.bytes, 123);

  const imageFixture = JSON.parse(await readFile(new URL('../contracts/fixtures/groupguard-query-contracts/delivery-success-image.json', import.meta.url), 'utf8'));
  const oldApiEnvelope = { ...imageFixture, meta: {} };
  const newApiEnvelope = {
    ...imageFixture,
    meta: {
      timing: {
        schema_version: 'query-delivery-timing.v1',
        query_ms: 12.5,
        render_ms: 3.2,
        delivery_prepare_ms: 1.1,
        api_total_ms: 16.8,
        image: { cache: 'hit', assets: 'complete', bytes: 3, base64_chars: 4, width: 1, height: 1 }
      }
    }
  };
  const oldPlan = toOneBotDeliveryPlan(parseGroupGuardQueryDelivery(oldApiEnvelope));
  const newPlan = toOneBotDeliveryPlan(parseGroupGuardQueryDelivery(newApiEnvelope));
  assert.deepEqual(newPlan, oldPlan, 'timing metadata must not alter primary delivery fields');
  console.log('query delivery observability verification passed');
} finally {
  pluginState.clearSelfRecallTimers();
  configStateService.setConfig(originalConfig as any);
  contextStateService.setActions(originalActions);
}
