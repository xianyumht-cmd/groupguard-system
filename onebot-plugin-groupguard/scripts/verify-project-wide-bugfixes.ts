import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config';
import { selectGroupsForPersistence } from '../src/config_persistence_guard';
import { authDomainService } from '../src/domain/auth/auth_domain_service';
import { normalizeGroupFileMirrorConfig } from '../src/services/group_file_mirror_service';
import { isIntranetHostname } from '../src/services/groupguard_query_delivery_client';
import { resolveLicenseExpireTime } from '../src/standalone/admin/license_api';

const invalid = normalizePluginConfig({ configVersion: 'bad', global: { auditRetentionMaxRows: 'bad' } } as any);
assert.equal(invalid.configVersion, 8);
assert.equal(invalid.global.auditRetentionMaxRows, 20000);
const mirror = normalizeGroupFileMirrorConfig({ enabled: true, rules: [{ sourceGroupId: '1', targetGroupId: '2', fileNamePattern: '[' }] });
assert.equal(mirror.rules[0]?.enabled, false);
assert.equal(isIntranetHostname('192.168.3.89'), true);
assert.equal(isIntranetHostname('public-host'), false);
assert.equal(isIntranetHostname('example.com'), false);

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
