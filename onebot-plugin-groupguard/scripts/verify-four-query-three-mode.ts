import assert from 'node:assert/strict';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import {
  executeLolbanIntranetQuery,
  resolveUnifiedQueryPreferredOutput
} from '../src/dynamic-commands/intranet_query_runtime_plugin.ts';
import { executeRiskIntranetQuery } from '../src/dynamic-commands/intranet_risk_runtime_plugin.ts';
import { executeIntranetDynamicCommand } from '../src/dynamic-commands/intranet_dynamic_command_plugin.ts';
import type {
  DynamicCommandDefinition,
  UnifiedCommandExecutionContext,
  UnifiedCommandNormalizedInput
} from '../src/dynamic-commands/types.ts';
import {
  normalizeIntranetPreferredOutput,
  type IntranetDeliveryRequestFn
} from '../src/services/intranet_query_service.ts';
import { GROUPGUARD_QUERY_DELIVERY_PROTOCOL } from '../src/services/groupguard_query_delivery_client.ts';

function groupInput(
  commandId: string,
  trigger: string,
  argument: string,
  mappedParameters: Record<string, string> = {}
): UnifiedCommandNormalizedInput {
  const text = `${trigger} ${argument}`.trim();
  return {
    commandId,
    registryVersion: 1,
    rawText: text,
    cleanedText: text,
    rawArgument: argument,
    mappedParameters,
    messageType: 'group',
    userId: '20001',
    groupId: '10001',
    source: 'dynamic'
  };
}

function executionContext(rawMessage: string, messageId: string): UnifiedCommandExecutionContext {
  return {
    event: {
      self_id: 30001,
      user_id: 20001,
      group_id: 10001,
      message_id: messageId,
      message_type: 'group',
      post_type: 'message',
      raw_message: rawMessage
    }
  } as unknown as UnifiedCommandExecutionContext;
}

const dynamicDefinition: DynamicCommandDefinition = {
  id: 'test.dynamic.preference',
  enabled: true,
  trigger: { type: 'prefix', value: '查动态' },
  parameterSchema: { required: ['target'], optional: [] },
  provider: { type: 'intranet' },
  response: { type: 'structured' }
};

const capturedPreferred = new Map<string, string | undefined>();
const requestFn: IntranetDeliveryRequestFn = async (_baseUrl, payload) => {
  capturedPreferred.set(payload.feature, payload.preferred);
  const requestId = payload.request_id || `test-${payload.feature}`;
  return {
    protocol: GROUPGUARD_QUERY_DELIVERY_PROTOCOL,
    ok: true,
    feature: payload.feature,
    request_id: requestId,
    client_request_id: requestId,
    delivery: {
      kind: 'segments',
      segments: [{ type: 'text', text: `${payload.feature} ok` }]
    },
    error: null,
    retry: { allowed: false, after_seconds: 0 },
    meta: {}
  };
};

assert.equal(normalizeIntranetPreferredOutput('text'), 'text');
assert.equal(normalizeIntranetPreferredOutput('forward'), 'forward');
assert.equal(normalizeIntranetPreferredOutput('image'), 'image');
assert.equal(normalizeIntranetPreferredOutput('card'), 'image');

const original = structuredClone(configStateService.getConfig() as any);
try {
  for (const mode of ['text', 'forward', 'image'] as const) {
    const config = structuredClone(original) as any;
    config.lolApiBaseUrl = 'http://127.0.0.1:6178';
    config.global = { ...(config.global || {}), lolQueryOutputFormat: mode };
    config.groups = {};
    config.queryCommandProfiles = {};
    configStateService.setConfig(config);

    for (const keys of [['lol_ban'], ['scammer'], ['peer'], ['dynamic']]) {
      assert.equal(resolveUnifiedQueryPreferredOutput('10001', keys), mode);
    }

    capturedPreferred.clear();

    const lolbanInput = groupInput('builtin.query.lolban.intranet', '查封号', '123456789');
    const lolbanResult = await executeLolbanIntranetQuery(
      lolbanInput,
      executionContext(lolbanInput.rawText, `lolban-${mode}`),
      requestFn
    );
    assert.equal(lolbanResult.ok, true);

    const scammerInput = groupInput('builtin.query.scammer.intranet', '查骗子', 'wx_example');
    const scammerResult = await executeRiskIntranetQuery(
      'scammer',
      '查骗子',
      scammerInput,
      executionContext(scammerInput.rawText, `scammer-${mode}`),
      requestFn
    );
    assert.equal(scammerResult.ok, true);

    const peerInput = groupInput('builtin.query.peer.intranet', '查同行', '123456789');
    const peerResult = await executeRiskIntranetQuery(
      'peer',
      '查同行',
      peerInput,
      executionContext(peerInput.rawText, `peer-${mode}`),
      requestFn
    );
    assert.equal(peerResult.ok, true);

    const dynamicInput = groupInput(
      dynamicDefinition.id,
      '查动态',
      'target-value',
      { target: 'target-value' }
    );
    const dynamicResult = await executeIntranetDynamicCommand(
      dynamicDefinition,
      dynamicInput,
      executionContext(dynamicInput.rawText, `dynamic-${mode}`),
      requestFn
    );
    assert.equal(dynamicResult.ok, true);

    for (const feature of ['lolban', 'scammer', 'peer', 'dynamic']) {
      assert.equal(
        capturedPreferred.get(feature),
        mode,
        `${feature} request must honor configured ${mode} output preference`
      );
    }
  }

  const config = structuredClone(original) as any;
  config.global = { ...(config.global || {}), lolQueryOutputFormat: 'text' };
  config.queryCommandProfiles = { scammer: { outputFormat: 'forward' } };
  configStateService.setConfig(config);
  assert.equal(resolveUnifiedQueryPreferredOutput('10001', ['scammer']), 'forward');
} finally {
  configStateService.setConfig(original as any);
}

console.log('four query three-mode preference verification passed');
