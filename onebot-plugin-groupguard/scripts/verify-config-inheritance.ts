import assert from 'node:assert/strict';
import { DEFAULT_GROUP_SETTINGS } from '../src/config';
import {
  compactNewInheritedValues,
  deleteGroupOverridePath,
  getGroupConfigSourceMap,
  isGroupFullyInherited,
  normalizeGroupOverride,
  resolveEffectiveGroupSettings,
  setGroupOverridePath,
} from '../src/config_effective';
import { configStateService } from '../src/core/state-services/config_state_service';
import { pluginState } from '../src/state';
import type { GroupGuardSettings, PluginConfig } from '../src/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const globalSettings = clone(DEFAULT_GROUP_SETTINGS) as GroupGuardSettings;
globalSettings.useGlobal = false;
globalSettings.qaLinkDelivery = {
  enabled: false,
  noticeText: 'global notice',
  delayMinMs: 2100,
  delayMaxMs: 4300,
  wrapInCodeBlock: true,
};
globalSettings.contentRisk = {
  ...(globalSettings.contentRisk || {}),
  enabled: true,
  notifyGroup: true,
  logOnly: false,
  rules: {
    ...(globalSettings.contentRisk?.rules || {}),
    url: { enabled: true, action: 'recall_warn' },
    qr: { enabled: true, action: 'recall' },
  },
};

const sparse = normalizeGroupOverride({
  useGlobal: false,
  qaLinkDelivery: { enabled: true },
  contentRisk: { rules: { url: { action: 'recall_ban', banMinutes: 30 } } },
});
assert.deepEqual(Object.keys(sparse.qaLinkDelivery || {}), ['enabled']);
assert.equal((sparse.contentRisk as any)?.rules?.url?.action, 'recall_ban');
assert.equal((sparse.contentRisk as any)?.rules?.qr, undefined);

const effective = resolveEffectiveGroupSettings(globalSettings, sparse);
assert.equal(effective.qaLinkDelivery?.enabled, true);
assert.equal(effective.qaLinkDelivery?.noticeText, 'global notice');
assert.equal(effective.qaLinkDelivery?.delayMinMs, 2100);
assert.equal(effective.contentRisk?.rules?.url?.action, 'recall_ban');
assert.equal(effective.contentRisk?.rules?.url?.enabled, true);
assert.equal(effective.contentRisk?.rules?.qr?.action, 'recall');

const changedGlobal = clone(globalSettings);
if (changedGlobal.qaLinkDelivery) changedGlobal.qaLinkDelivery.noticeText = 'changed globally';
const afterGlobalChange = resolveEffectiveGroupSettings(changedGlobal, sparse);
assert.equal(afterGlobalChange.qaLinkDelivery?.noticeText, 'changed globally');
assert.equal(afterGlobalChange.qaLinkDelivery?.enabled, true);

const dormantRow = {
  useGlobal: true,
  qaLinkDelivery: { enabled: true, noticeText: 'dormant local value' },
};
const dormant = resolveEffectiveGroupSettings(changedGlobal, dormantRow);
assert.equal(dormant.qaLinkDelivery?.enabled, false);
assert.equal(dormant.qaLinkDelivery?.noticeText, 'changed globally');
assert.equal(dormant.useGlobal, true);

// Compatibility invariant: no row means global inheritance, while a historical
// row that predates useGlobal remains an active overlay. Only explicit true is
// whole-group inheritance.
assert.equal(isGroupFullyInherited(undefined), true);
assert.equal(isGroupFullyInherited(dormantRow), true);
const legacyWithoutUseGlobal = { qaLinkDelivery: { enabled: true } };
assert.equal(isGroupFullyInherited(legacyWithoutUseGlobal), false);
const legacyEffective = resolveEffectiveGroupSettings(changedGlobal, legacyWithoutUseGlobal);
assert.equal(legacyEffective.qaLinkDelivery?.enabled, true);
assert.equal(legacyEffective.qaLinkDelivery?.noticeText, 'changed globally');
assert.equal(legacyEffective.useGlobal, false);

const sourceMap = getGroupConfigSourceMap(changedGlobal, sparse);
assert.equal(sourceMap['qaLinkDelivery.enabled'], 'group');
assert.equal(sourceMap['qaLinkDelivery.noticeText'], 'global');
assert.equal(sourceMap['contentRisk.rules.url.action'], 'group');
assert.equal(sourceMap['contentRisk.rules.url.enabled'], 'global');
assert.equal(sourceMap['contentRisk.rules.qr.action'], 'global');
const legacySourceMap = getGroupConfigSourceMap(changedGlobal, legacyWithoutUseGlobal);
assert.equal(legacySourceMap['qaLinkDelivery.enabled'], 'group');
assert.equal(legacySourceMap['qaLinkDelivery.noticeText'], 'global');

const broadFormCandidate = {
  useGlobal: false,
  qaEnabled: changedGlobal.qaEnabled,
  queryEnabled: changedGlobal.queryEnabled,
  qaLinkDelivery: {
    enabled: true,
    noticeText: changedGlobal.qaLinkDelivery?.noticeText,
    delayMinMs: changedGlobal.qaLinkDelivery?.delayMinMs,
    delayMaxMs: changedGlobal.qaLinkDelivery?.delayMaxMs,
    wrapInCodeBlock: changedGlobal.qaLinkDelivery?.wrapInCodeBlock,
  },
};
const compactedNewRow = compactNewInheritedValues(changedGlobal, {}, broadFormCandidate);
assert.equal(compactedNewRow.useGlobal, false);
assert.equal(compactedNewRow.qaEnabled, undefined);
assert.equal(compactedNewRow.queryEnabled, undefined);
assert.deepEqual(compactedNewRow.qaLinkDelivery, { enabled: true });

const explicitEqual = compactNewInheritedValues(
  changedGlobal,
  { useGlobal: false, qaEnabled: changedGlobal.qaEnabled },
  { useGlobal: false, qaEnabled: changedGlobal.qaEnabled }
);
assert.equal(explicitEqual.qaEnabled, changedGlobal.qaEnabled);

const withPath = setGroupOverridePath({ useGlobal: false }, 'qaLinkDelivery.enabled', true);
assert.equal(withPath.qaLinkDelivery?.enabled, true);
const withoutPath = deleteGroupOverridePath(withPath, 'qaLinkDelivery.enabled');
assert.equal(withoutPath.qaLinkDelivery, undefined);

// Restoring one field must not erase unrelated or dormant historical values.
const dormantAfterRestore = deleteGroupOverridePath(dormantRow, 'qaLinkDelivery.enabled');
assert.equal(dormantAfterRestore.useGlobal, true);
assert.equal(dormantAfterRestore.qaLinkDelivery?.noticeText, 'dormant local value');
assert.equal(dormantAfterRestore.qaLinkDelivery?.enabled, undefined);
assert.throws(() => setGroupOverridePath({}, 'constructor.prototype.polluted', true), /invalid_group_config_path/);

// The adapter installs the resolver onto PluginState so internal send/risk paths
// and state-service consumers cannot diverge.
const originalConfig = pluginState.config;
try {
  const runtimeConfig = clone(originalConfig) as PluginConfig;
  runtimeConfig.global = changedGlobal;
  runtimeConfig.groups = {
    '123456': { useGlobal: false, qaLinkDelivery: { enabled: true } } as GroupGuardSettings,
    '654321': legacyWithoutUseGlobal as GroupGuardSettings,
  };
  configStateService.setConfig(runtimeConfig);
  const fromService = configStateService.resolveGroupSettings('123456');
  const fromState = pluginState.getGroupSettings('123456');
  assert.equal(fromService.qaLinkDelivery?.noticeText, 'changed globally');
  assert.equal(fromState.qaLinkDelivery?.noticeText, 'changed globally');
  assert.equal(fromState.qaLinkDelivery?.enabled, true);
  const legacyFromService = configStateService.resolveGroupSettings('654321');
  const legacyFromState = pluginState.getGroupSettings('654321');
  assert.equal(legacyFromService.qaLinkDelivery?.enabled, true);
  assert.equal(legacyFromState.qaLinkDelivery?.enabled, true);
  assert.equal(legacyFromState.qaLinkDelivery?.noticeText, 'changed globally');
} finally {
  configStateService.setConfig(originalConfig);
}

console.log('[verify-config-inheritance] PASS');
