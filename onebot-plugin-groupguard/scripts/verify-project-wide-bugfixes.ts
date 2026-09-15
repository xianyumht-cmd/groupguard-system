import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { authManager } from '../src/auth';
import { getBuildInfo } from '../src/build_info';
import { normalizePluginConfig } from '../src/config';
import { selectGroupsForPersistence } from '../src/config_persistence_guard';
import { checkFeatureGate } from '../src/core/feature_gate';
import { configStateService } from '../src/core/state-services/config_state_service';
import { authDomainService } from '../src/domain/auth/auth_domain_service';
import { normalizeCommandDefinition } from '../src/dynamic-commands/command_loader';
import { toFeaturePermission } from '../src/dynamic-commands/legacy_permission';
import { normalizeGroupFileMirrorConfig } from '../src/services/group_file_mirror_service';
import { isIntranetHostname } from '../src/services/groupguard_query_delivery_client';
import { resolveContainedSubGameplayResourcePath } from '../src/services/sub_gameplay_resources';
import { normalizeTargetFilePushConfig } from '../src/services/target_file_push_config';
import { pluginState } from '../src/state';
import { storageAdapter } from '../src/storage_adapter';
import { saveRawConfig } from '../src/standalone/admin/config_api';
import { resolveLicenseExpireTime } from '../src/standalone/admin/license_api';

const invalid = normalizePluginConfig({ configVersion: 'bad', global: { auditRetentionMaxRows: 'bad' } } as any);
assert.equal(invalid.configVersion, 8);
assert.equal(invalid.global.auditRetentionMaxRows, 20000);
const mirror = normalizeGroupFileMirrorConfig({ enabled: true, rules: [{ sourceGroupId: '1', targetGroupId: '2', fileNamePattern: '[' }] });
assert.equal(mirror.rules[0]?.enabled, false);
assert.equal(isIntranetHostname('192.168.3.89'), true);
assert.equal(isIntranetHostname('public-host'), false);
assert.equal(isIntranetHostname('example.com'), false);

for (const sourceUrl of [
  'https://abc.lanzou.com/iTEST',
  'https://wwbvf.lanzn.com/b016kzvvmd',
  'https://wwop.lanzoul.com/iTEST',
  'https://download.lanwp.com/iTEST',
]) {
  const normalized = normalizeTargetFilePushConfig({ sourceUrl });
  assert.equal(normalized.sourceUrl, sourceUrl, `known Lanzou host must remain accepted: ${sourceUrl}`);
}
for (const sourceUrl of [
  'https://lanzou.attacker.example/iTEST',
  'https://evillanzn.com/iTEST',
  'https://lanwp.com.attacker.example/iTEST',
  'https://lanzou.com.evil.example/iTEST',
  'ftp://abc.lanzou.com/iTEST',
]) {
  assert.throws(
    () => normalizeTargetFilePushConfig({ sourceUrl }),
    /蓝奏/,
    `lookalike or non-http Lanzou URL must be rejected: ${sourceUrl}`
  );
}

const validGrant = authDomainService.validateGrantRequest('123456789', '30');
assert.equal(validGrant.ok, true);
if (validGrant.ok) {
  assert.equal(validGrant.data.days, 30);
  assert.equal(validGrant.data.level, 'pro');
}
const permanentGrant = authDomainService.validateGrantRequest('123456789', '永久');
assert.equal(permanentGrant.ok, true);
if (permanentGrant.ok) {
  assert.equal(permanentGrant.data.days, -1);
  assert.equal(permanentGrant.data.level, 'enterprise');
}
for (const token of ['', '0', '-1', '30abc', '1.5', '999999999999999999999999']) {
  assert.equal(
    authDomainService.validateGrantRequest('123456789', token).ok,
    false,
    `invalid grant duration must be rejected: ${token}`
  );
}
for (const key of ['PRO-30-anything', 'PRO-PERM-anything', 'PRO-30-123456', 'PRO-PERM-abcdef']) {
  const result = authDomainService.validateActivationKey(key);
  assert.equal(result.ok, false, `legacy prefix-only activation must stay disabled: ${key}`);
  if (!result.ok) assert.equal(result.response.scene, 'feature_disabled');
}
assert.match(
  authDomainService.buildPrivateLicenseQueryResponse('123456789', { level: 'pro', expireTime: 0 }, Date.now()).message,
  /永久/
);
assert.match(
  authDomainService.buildGroupLicenseStatusResponse('123456789', { level: 'enterprise', expireTime: 0 }, Date.now()).message,
  /永久/
);
const fixedNow = 1_700_000_000_000;
assert.equal(resolveLicenseExpireTime({ permanent: true, days: 0 }, fixedNow), 0);
assert.equal(resolveLicenseExpireTime({ permanent: false, days: 30 }, fixedNow), fixedNow + 30 * 86400000);
assert.throws(() => resolveLicenseExpireTime({ permanent: true, days: -1 }, fixedNow));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 0 }, fixedNow));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: -1 }, fixedNow));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 1.5 }, fixedNow));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 'abc' }, fixedNow));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, expireTime: 0 }, fixedNow));

const enterpriseCommand = normalizeCommandDefinition({
  id: 'tier-regression',
  enabled: true,
  featureType: 'query',
  featureKey: 'query.tier_regression',
  scope: 'group',
  requiresLicense: true,
  minimumLicenseLevel: 'enterprise',
  permission: 'all',
  trigger: { type: 'exact', value: 'tier-regression' },
  parameterSchema: { required: [], optional: [] },
  provider: { type: 'intranet' },
  response: { type: 'structured' },
});
assert.equal(enterpriseCommand?.minimumLicenseLevel, 'enterprise', 'dynamic command loader must preserve explicit enterprise minimum');
const defaultPaidCommand = normalizeCommandDefinition({
  id: 'tier-default-regression',
  enabled: true,
  trigger: { type: 'exact', value: 'tier-default-regression' },
  parameterSchema: { required: [], optional: [] },
  provider: { type: 'intranet' },
  response: { type: 'structured' },
});
assert.equal(defaultPaidCommand?.minimumLicenseLevel, 'pro', 'dynamic commands must default to pro minimum');

assert.equal(toFeaturePermission('owner/admin'), 'admin', 'legacy owner/admin must not degrade to public access');
assert.equal(toFeaturePermission('admin'), 'admin', 'legacy admin must remain admin');
assert.equal(toFeaturePermission('owner'), 'owner', 'legacy owner must remain owner');
assert.equal(toFeaturePermission('all'), 'all', 'legacy public commands must remain public');

const gateGroupId = '987654321';
const gateConfig = configStateService.getConfig();
if (!gateConfig.licenses) gateConfig.licenses = {};
const previousGateLicense = gateConfig.licenses[gateGroupId];
const gateInput = {
  featureType: 'moderation' as const,
  featureKey: 'builtin.moderation',
  groupId: gateGroupId,
  userId: '123456789',
  messageType: 'group' as const,
  source: 'builtin' as const,
  scope: 'group' as const,
  requiresLicense: true,
  permission: 'all' as const,
  botSend: false,
};
try {
  gateConfig.licenses[gateGroupId] = { level: 'free', expireTime: 0 };
  configStateService.setConfig(gateConfig);
  assert.equal(authManager.getGroupLicense(gateGroupId)?.level, 'free', 'free record must remain visible to status/admin code');
  assert.equal(authManager.getPaidGroupLicense(gateGroupId), null, 'free record must not satisfy paid runtime authorization');
  const freeGate = await checkFeatureGate(gateInput);
  assert.equal(freeGate.allowed, false, 'free license must not unlock paid group features');
  assert.equal(freeGate.reason, 'license_level_insufficient');

  gateConfig.licenses[gateGroupId] = { level: 'pro', expireTime: 0 };
  configStateService.setConfig(gateConfig);
  assert.equal(authManager.getPaidGroupLicense(gateGroupId)?.level, 'pro');
  assert.equal(authManager.getPaidGroupLicense(gateGroupId, 'enterprise'), null, 'pro must not satisfy enterprise minimum');
  const proGate = await checkFeatureGate(gateInput);
  assert.equal(proGate.allowed, true, 'pro license must keep existing paid feature access');

  const proEnterpriseGate = await checkFeatureGate({ ...gateInput, minimumLicenseLevel: 'enterprise' });
  assert.equal(proEnterpriseGate.allowed, false, 'pro license must not pass an explicitly enterprise-only gate');
  assert.equal(proEnterpriseGate.reason, 'license_level_insufficient');

  gateConfig.licenses[gateGroupId] = { level: 'enterprise', expireTime: 0 };
  configStateService.setConfig(gateConfig);
  assert.equal(authManager.getPaidGroupLicense(gateGroupId, 'enterprise')?.level, 'enterprise');
  const enterpriseGate = await checkFeatureGate({ ...gateInput, minimumLicenseLevel: 'enterprise' });
  assert.equal(enterpriseGate.allowed, true, 'enterprise license must pass an enterprise-only gate');
} finally {
  if (previousGateLicense) gateConfig.licenses[gateGroupId] = previousGateLicense;
  else delete gateConfig.licenses[gateGroupId];
  configStateService.setConfig(gateConfig);
}

const tempResourceFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-sub-resource-'));
try {
  const resourceRoot = path.join(tempResourceFixture, 'resources');
  const nestedDir = path.join(resourceRoot, 'selected');
  const safeFile = path.join(nestedDir, 'safe.txt');
  const outsideFile = path.join(tempResourceFixture, 'outside-secret.txt');
  const escapingLink = path.join(nestedDir, 'escape.txt');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(safeFile, 'safe', 'utf8');
  fs.writeFileSync(outsideFile, 'secret', 'utf8');
  fs.symlinkSync(outsideFile, escapingLink, 'file');

  assert.equal(
    resolveContainedSubGameplayResourcePath(resourceRoot, 'selected/safe.txt'),
    fs.realpathSync(safeFile)
  );
  assert.equal(resolveContainedSubGameplayResourcePath(resourceRoot, 'selected'), null, 'directories are not readable resources');
  assert.equal(resolveContainedSubGameplayResourcePath(resourceRoot, '../outside-secret.txt'), null, 'parent traversal must be rejected');
  assert.equal(resolveContainedSubGameplayResourcePath(resourceRoot, 'selected/escape.txt'), null, 'symlink escape must be rejected');
} finally {
  fs.rmSync(tempResourceFixture, { recursive: true, force: true });
}

const previousPluginConfig = pluginState.config;
const previousActions = pluginState.actions;
const sendCalls: Array<{ action: string; params: unknown }> = [];
try {
  pluginState.clearSelfRecallTimers();
  pluginState.resumeSendQueue();
  pluginState.config = {
    ...previousPluginConfig,
    global: {
      ...previousPluginConfig.global,
      replyProbability: 0,
      botAntiRiskScenePolicies: {},
      randomDelayMin: 0,
      randomDelayMax: 0,
      randomSuffix: false,
      disableReplyTemplate: true,
      globalMaxPerMinute: 1000,
      rateLimitEnqueue: false,
      autoRecallSelf: false,
      selfRecall: {
        ...(previousPluginConfig.global.selfRecall || {}),
        enabled: false,
      },
    } as any,
    groups: {},
  };
  pluginState.actions = {
    call: async (action: string, params: unknown) => {
      sendCalls.push({ action, params });
      return {};
    }
  } as any;

  await pluginState.sendGroupText('1357902468', 'ordinary group text', { applyTemplate: false, scene: 'raw_text' });
  await pluginState.sendGroupMsg('1357902468', [{ type: 'text', data: { text: 'ordinary group segments' } }], { applyTemplate: false, scene: 'raw_text' });
  await pluginState.sendPrivateMsg('2468013579', 'ordinary private text', { applyTemplate: false, scene: 'raw_text' });
  assert.equal(sendCalls.length, 0, 'omitting force must leave ordinary sends subject to the configured probability gate');

  await pluginState.sendPrivateMsg('2468013579', 'truthy non-boolean force', { force: 'yes', applyTemplate: false, scene: 'raw_text' } as any);
  assert.equal(sendCalls.length, 0, 'only literal force=true may bypass the probability gate');

  await pluginState.sendGroupText('1357902468', 'forced group text', { force: true, applyTemplate: false, scene: 'raw_text' });
  await pluginState.sendGroupMsg('1357902468', [{ type: 'text', data: { text: 'forced group segments' } }], { force: true, applyTemplate: false, scene: 'raw_text' });
  await pluginState.sendPrivateMsg('2468013579', 'forced private text', { force: true, applyTemplate: false, scene: 'raw_text' });
  assert.deepEqual(
    sendCalls.map(call => call.action),
    ['send_group_msg', 'send_group_msg', 'send_private_msg'],
    'explicit force=true must bypass the zero-probability gate for all three public send entry points'
  );
} finally {
  pluginState.clearSelfRecallTimers();
  pluginState.config = previousPluginConfig;
  pluginState.actions = previousActions;
  pluginState.resumeSendQueue();
}

const root = path.resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown };
const expectedRuntimeVersion = String(packageMetadata.version ?? '').trim();
assert.match(expectedRuntimeVersion, /^\d+\.\d+\.\d+(?:[-+].+)?$/, 'package.json must expose a concrete semantic runtime version');

const sourceBuildInfo = getBuildInfo();
assert.equal(pluginState.version, sourceBuildInfo.version, 'PluginState must consume the canonical build-info version');
if (!process.env.GROUPGUARD_VERSION) {
  assert.equal(sourceBuildInfo.version, expectedRuntimeVersion, 'source runtime build info must default to package.json version');
}

const loadedSnowlumaConfig = await loadConfigFromFile(
  { command: 'build', mode: 'snowluma', isSsrBuild: false, isPreview: false },
  path.join(root, 'vite.config.ts')
);
assert.ok(loadedSnowlumaConfig, 'Vite must load the SnowLuma build configuration');
const embeddedBuildInfoText = loadedSnowlumaConfig.config.define?.__GROUPGUARD_BUILD_INFO__;
assert.equal(typeof embeddedBuildInfoText, 'string', 'SnowLuma Vite build must embed GroupGuard build metadata');
const embeddedBuildInfo = JSON.parse(String(embeddedBuildInfoText)) as { version?: unknown; artifact?: unknown };
assert.equal(embeddedBuildInfo.version, expectedRuntimeVersion, 'SnowLuma embedded runtime version must match package.json');
assert.equal(embeddedBuildInfo.artifact, 'snowluma-service.mjs', 'SnowLuma build metadata must identify the runtime artifact');

const persistedGroups = {
  '10001': { useGlobal: false, qaList: [{ keyword: 'a', mode: 'exact', reply: 'b' }] },
  '10002': { useGlobal: false }
} as any;
assert.equal(selectGroupsForPersistence(undefined, persistedGroups).preservedPersistedGroups, true);
assert.deepEqual(selectGroupsForPersistence({}, persistedGroups).groups, persistedGroups);
assert.equal(selectGroupsForPersistence({ '10003': { useGlobal: false } }, persistedGroups).preservedPersistedGroups, false);
assert.equal(selectGroupsForPersistence({}, {}).preservedPersistedGroups, false);
const explicitEmpty = selectGroupsForPersistence({}, persistedGroups, { allowEmptyRuntime: true });
assert.equal(explicitEmpty.preservedPersistedGroups, false);
assert.deepEqual(explicitEmpty.groups, {});

const tempGlobalSaveFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-global-config-save-'));
const previousGlobalSaveConfig = configStateService.getConfig();
try {
  const groupFixtures = {
    '20001': { useGlobal: false, qaEnabled: false },
    '20002': { useGlobal: true, qaEnabled: true },
  } as any;
  const workingConfig = JSON.parse(JSON.stringify(previousGlobalSaveConfig));
  workingConfig.groups = groupFixtures;
  configStateService.setConfig(workingConfig);

  storageAdapter.init(tempGlobalSaveFixture);
  storageAdapter.replaceAllGroupConfigs(groupFixtures, () => undefined);

  const configPath = path.join(tempGlobalSaveFixture, 'config.json');
  const rawGlobalSave = JSON.parse(JSON.stringify(workingConfig));
  rawGlobalSave.groups = {};
  fs.writeFileSync(configPath, JSON.stringify(rawGlobalSave, null, 2), 'utf8');

  saveRawConfig({
    ctx: { configPath },
    workDir: tempGlobalSaveFixture,
    dataDir: tempGlobalSaveFixture,
    configPath,
    backupDir: path.join(tempGlobalSaveFixture, 'backups'),
  } as any, rawGlobalSave);

  assert.deepEqual(
    configStateService.getGroups(),
    groupFixtures,
    'global config save must preserve the current in-memory group map when config.json carries groups:{}'
  );
  assert.deepEqual(
    storageAdapter.loadAllGroupConfigs(),
    groupFixtures,
    'global config save must preserve all SQLite group overrides when config.json carries groups:{}'
  );
  const persistedMainConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { groups?: unknown };
  assert.deepEqual(
    persistedMainConfig.groups,
    {},
    'config.json must remain free of per-group rows after a global config save'
  );
} finally {
  storageAdapter.close();
  configStateService.setConfig(previousGlobalSaveConfig);
  fs.rmSync(tempGlobalSaveFixture, { recursive: true, force: true });
}

const common = fs.readFileSync(path.join(root, 'src/commands/common.ts'), 'utf8');
const groupApi = fs.readFileSync(path.join(root, 'src/standalone/admin/group_api.ts'), 'utf8');
assert.ok(common.includes('allowEmptyRuntime: options.allowEmptyGroupPersistence === true'));
assert.ok(common.includes('已阻止空分群配置覆盖 SQLite'));
assert.ok(groupApi.includes('storageAdapter.deleteGroupConfig(id)'));
assert.ok(groupApi.includes('allowEmptyGroupPersistence: explicitlyBecameEmpty'));
console.log('project-wide bugfix regression passed');
