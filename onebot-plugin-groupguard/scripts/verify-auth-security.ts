import assert from 'node:assert/strict';
import { authDomainService } from '../src/domain/auth/auth_domain_service';
import { resolveLicenseExpireTime } from '../src/standalone/admin/license_api';

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
  const result = authDomainService.validateGrantRequest('123456789', token);
  assert.equal(result.ok, false, `invalid grant duration must be rejected: ${token}`);
}

for (const key of [
  'PRO-30-anything',
  'PRO-PERM-anything',
  'PRO-30-123456',
  'PRO-PERM-abcdef',
]) {
  const result = authDomainService.validateActivationKey(key);
  assert.equal(result.ok, false, `legacy prefix-only activation must stay disabled: ${key}`);
  if (!result.ok) assert.equal(result.response.scene, 'feature_disabled');
}

const permanentPrivateStatus = authDomainService.buildPrivateLicenseQueryResponse(
  '123456789',
  { level: 'pro', expireTime: 0 },
  Date.now(),
);
assert.match(permanentPrivateStatus.message, /永久/);

const permanentGroupStatus = authDomainService.buildGroupLicenseStatusResponse(
  '123456789',
  { level: 'enterprise', expireTime: 0 },
  Date.now(),
);
assert.match(permanentGroupStatus.message, /永久/);

const now = 1_700_000_000_000;
assert.equal(resolveLicenseExpireTime({ permanent: true, days: 0 }, now), 0);
assert.equal(resolveLicenseExpireTime({ permanent: false, days: 30 }, now), now + 30 * 86400000);
assert.throws(() => resolveLicenseExpireTime({ permanent: true, days: -1 }, now));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 0 }, now));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: -1 }, now));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 1.5 }, now));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, days: 'abc' }, now));
assert.throws(() => resolveLicenseExpireTime({ permanent: false, expireTime: 0 }, now));

console.log('authorization security regression passed');
