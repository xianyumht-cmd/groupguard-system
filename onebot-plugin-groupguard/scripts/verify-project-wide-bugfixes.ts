import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config';
import { selectGroupsForPersistence } from '../src/config_persistence_guard';
import { checkFeatureGate } from '../src/core/feature_gate';
import { configStateService } from '../src/core/state-services/config_state_service';
import { authDomainService } from '../src/domain/auth/auth_domain_service';
import { normalizeGroupFileMirrorConfig } from '../src/services/group_file_mirror_service';
import { isIntranetHostname } from '../src/services/groupguard_query_delivery_client';
import { resolveContainedSubGameplayResourcePath } from '../src/services/sub_gameplay_resources';
import { normalizeTargetFilePushConfig } from '../src/services/target_file_push_config';
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
  const freeGate = await checkFeatureGate(gateInput);
  assert.equal(freeGate.allowed, false, 'free license must not unlock paid group features');
  assert.equal(freeGate.reason, 'license_level_insufficient');

  gateConfig.licenses[gateGroupId] = { level: 'pro', expireTime: 0 };
  configStateService.setConfig(gateConfig);
  const proGate = await checkFeatureGate(gateInput);
  assert.equal(proGate.allowed, true, 'pro license must keep existing paid feature access');

  const proEnterpriseGate = await checkFeatureGate({ ...gateInput, minimumLicenseLevel: 'enterprise' });
  assert.equal(proEnterpriseGate.allowed, false, 'pro license must not pass an explicitly enterprise-only gate');
  assert.equal(proEnterpriseGate.reason, 'license_level_insufficient');

  gateConfig.licenses[gateGroupId] = { level: 'enterprise', expireTime: 0 };
  configStateService.setConfig(gateConfig);
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

const root = path.resolve(import.meta.dirname, '..');
const state = fs.readFileSync(path.join(root, 'src/state.ts'), 'utf8');
const common = fs.readFileSync(path.join(root, 'src/commands/common.ts'), 'utf8');
const configApi = fs.readFileSync(path.join(root, 'src/standalone/admin/config_api.ts'), 'utf8');
const groupApi = fs.readFileSync(path.join(root, 'src/standalone/admin/group_api.ts'), 'utf8');
assert.ok(state.includes('const force = options?.force === true'));
assert.ok(!state.includes("return '1.0.0'"));
assert.ok(common.includes('allowEmptyRuntime: options.allowEmptyGroupPersistence === true'));
assert.ok(common.includes('已阻止空分群配置覆盖 SQLite'));
assert.ok(configApi.includes('normalized.groups = previous.groups || {}'));
assert.ok(groupApi.includes('storageAdapter.deleteGroupConfig(id)'));
assert.ok(groupApi.includes('allowEmptyGroupPersistence: explicitlyBecameEmpty'));
console.log('project-wide bugfix regression passed');