import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  GROUPGUARD_QUERY_DELIVERY_PATH,
  GROUPGUARD_QUERY_DELIVERY_PROTOCOL,
  isIntranetHostname,
  parseGroupGuardQueryDelivery,
  requestGroupGuardQueryDelivery,
  resolveGroupGuardQueryEndpoint,
  toOneBotDeliveryPlan
} from '../src/services/groupguard_query_delivery_client.ts';

const fixtureRoot = fileURLToPath(new URL('../contracts/fixtures/groupguard-query-contracts/', import.meta.url));
const clientSourcePath = fileURLToPath(new URL('../src/services/groupguard_query_delivery_client.ts', import.meta.url));
const EXPECTED_SERVICE_COMMIT = '7764dbec4854a7d39a194f6ec1802f0e8902ea9e';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

async function loadJson(name: string): Promise<Record<string, any>> {
  const text = await readFile(`${fixtureRoot}/${name}`, 'utf8');
  const value = JSON.parse(text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value;
}

const manifest = await loadJson('manifest.json');
assert.equal(manifest.bundle_version, 'groupguard-query-contract-fixtures.v1');
assert.equal(manifest.service_repository, 'xianyumht-cmd/lolapisevers');
assert.equal(manifest.service_commit, EXPECTED_SERVICE_COMMIT);
assert.equal(manifest.delivery_protocol, GROUPGUARD_QUERY_DELIVERY_PROTOCOL);
assert.equal(manifest.consumer_rules?.delivery_endpoint, GROUPGUARD_QUERY_DELIVERY_PATH);
assert.equal(manifest.consumer_rules?.no_public_fallback, true);
assert.equal(manifest.consumer_rules?.verify_image_bytes_and_sha256, true);

const loaded = new Map<string, Record<string, any>>();
for (const item of manifest.fixtures as Array<{ path: string; sha256: string }>) {
  const fixture = await loadJson(item.path);
  assert.equal(canonicalSha256(fixture), item.sha256, `fixture hash mismatch: ${item.path}`);
  loaded.set(item.path, fixture);
}

const textEnvelope = parseGroupGuardQueryDelivery(loaded.get('delivery-success-text.json'));
assert.equal(textEnvelope.ok, true);
assert.equal(textEnvelope.feature, 'lolban');
const textPlan = toOneBotDeliveryPlan(textEnvelope);
assert.equal(textPlan.kind, 'segments');
if (textPlan.kind === 'segments') {
  assert.equal(textPlan.segments[0]?.type, 'text');
  assert.match((textPlan.segments[0] as any)?.data?.text || '', /账号状态：正常/);
}

const imageEnvelope = parseGroupGuardQueryDelivery(loaded.get('delivery-success-image.json'));
const imagePlan = toOneBotDeliveryPlan(imageEnvelope);
assert.equal(imagePlan.kind, 'segments');
if (imagePlan.kind === 'segments') {
  assert.equal(imagePlan.segments[0]?.type, 'image');
  assert.match((imagePlan.segments[0] as any)?.data?.file || '', /^base64:\/\//);
}

const forwardEnvelope = parseGroupGuardQueryDelivery(loaded.get('delivery-success-forward.json'));
const forwardPlan = toOneBotDeliveryPlan(forwardEnvelope);
assert.equal(forwardPlan.kind, 'forward');
if (forwardPlan.kind === 'forward') {
  assert.equal(forwardPlan.nodes.length, 2);
  assert.match((forwardPlan.nodes[0]?.segments[0] as any)?.data?.text || '', /第 1 页/);
}

const errorEnvelope = parseGroupGuardQueryDelivery(loaded.get('delivery-error-retryable.json'));
assert.equal(errorEnvelope.ok, false);
assert.equal(errorEnvelope.error?.code, 'temporarily_unavailable');
assert.equal(errorEnvelope.retry.allowed, true);
assert.equal(errorEnvelope.retry.after_seconds, 30);
const errorPlan = toOneBotDeliveryPlan(errorEnvelope);
assert.equal(errorPlan.kind, 'segments');

const unknownProtocol = structuredClone(loaded.get('delivery-success-text.json'));
unknownProtocol.protocol = 'groupguard-query-delivery.v2';
assert.throws(() => parseGroupGuardQueryDelivery(unknownProtocol), /delivery_protocol_unsupported/);

const unknownField = structuredClone(loaded.get('delivery-success-text.json'));
unknownField.public_fallback_url = 'https://example.com';
assert.throws(() => parseGroupGuardQueryDelivery(unknownField), /delivery_envelope_fields_changed/);

const tamperedImage = structuredClone(loaded.get('delivery-success-image.json'));
tamperedImage.delivery.segments[0].sha256 = '0'.repeat(64);
assert.throws(() => parseGroupGuardQueryDelivery(tamperedImage), /image_segment_sha256_mismatch/);

for (const hostname of ['localhost', 'lol-api', 'lol-api.local', '127.0.0.1', '10.0.0.8', '172.16.0.8', '172.31.255.8', '192.168.3.89', 'fd00::1', 'fe80::1']) {
  assert.equal(isIntranetHostname(hostname), true, `expected intranet hostname: ${hostname}`);
}
for (const hostname of ['example.com', 'raw.githubusercontent.com', 'game.gtimg.cn', 'op.gg', '8.8.8.8', '172.32.0.1']) {
  assert.equal(isIntranetHostname(hostname), false, `expected public hostname rejection: ${hostname}`);
}
assert.equal(resolveGroupGuardQueryEndpoint('http://192.168.3.89:5001'), 'http://192.168.3.89:5001/api/v1/groupguard/query');
assert.equal(resolveGroupGuardQueryEndpoint('http://lol-api:5001/'), 'http://lol-api:5001/api/v1/groupguard/query');
assert.throws(() => resolveGroupGuardQueryEndpoint('https://example.com'), /lol_api_base_must_be_intranet/);
assert.throws(() => resolveGroupGuardQueryEndpoint('https://raw.githubusercontent.com'), /lol_api_base_must_be_intranet/);
assert.throws(() => resolveGroupGuardQueryEndpoint('http://user:pass@192.168.3.89:5001'), /credentials_forbidden/);
assert.throws(() => resolveGroupGuardQueryEndpoint('http://192.168.3.89:5001/public/fallback'), /path_forbidden/);

let requestCount = 0;
let requestedUrl = '';
let requestedMethod = '';
const requested = await requestGroupGuardQueryDelivery(
  'http://192.168.3.89:5001',
  {
    feature: 'shard',
    parameters: { hero: '滑板鞋' },
    preferred: 'auto',
    capabilities: { text: true, image: true, forward: true },
    request_id: 'contract-client-001'
  },
  {
    timeoutMs: 1000,
    fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      requestedUrl = String(input);
      requestedMethod = String(init?.method || '');
      return new Response(JSON.stringify(loaded.get('delivery-error-retryable.json')), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch
  }
);
assert.equal(requestCount, 1, 'delivery client must make exactly one intranet request');
assert.equal(requestedUrl, 'http://192.168.3.89:5001/api/v1/groupguard/query');
assert.equal(requestedMethod, 'POST');
assert.equal(requested.ok, false);
assert.equal(requested.retry.allowed, true);

let failedRequestCount = 0;
await assert.rejects(
  () => requestGroupGuardQueryDelivery(
    'http://192.168.3.89:5001',
    { feature: 'lolban', parameters: { qq: '123456789' } },
    {
      timeoutMs: 1000,
      fetchFn: (async () => {
        failedRequestCount += 1;
        throw new TypeError('fetch failed');
      }) as typeof fetch
    }
  ),
  /fetch failed/
);
assert.equal(failedRequestCount, 1, 'network failure must not trigger a public fallback request');

const clientSource = (await readFile(clientSourcePath, 'utf8')).toLowerCase();
for (const forbidden of ['raw.githubusercontent.com', 'game.gtimg.cn', 'op.gg', 'lol2099.top']) {
  assert.equal(clientSource.includes(forbidden), false, `delivery client contains forbidden public upstream: ${forbidden}`);
}

const observability = loaded.get('observability-degraded.json');
assert.equal(observability?.schema_version, 'query-observability.v1');
assert.equal(observability?.status, 'degraded');
assert.equal(Object.values(observability?.summary || {}).reduce((total: number, value: any) => total + Number(value || 0), 0), 4);
const observabilityText = JSON.stringify(observability).toLowerCase();
for (const forbidden of ['http://', 'https://', 'raw.githubusercontent', 'game.gtimg', 'op.gg', 'token=', 'password', 'cookie', '123456789', 'kalista', 'ahri']) {
  assert.equal(observabilityText.includes(forbidden), false, `observability fixture leaked: ${forbidden}`);
}

console.log('groupguard query delivery contract verification passed');
