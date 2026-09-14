import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  isOneBotMessageEvent,
  normalizeOneBotEvent,
  normalizeOneBotId,
  oneBotIdToString,
} from '../src/protocol/onebot11/types';

const root = process.cwd();
const activeRoots = [
  'src',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'scripts/build-all-clean.mjs',
];

function collectFiles(relativePath: string): string[] {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relativePath];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(child));
    else if (/\.(?:ts|mts|cts|js|mjs|cjs|json)$/.test(entry.name)) out.push(child);
  }
  return out;
}

const files = activeRoots.flatMap(collectFiles);
const joined = files.map(file => `\n--- ${file} ---\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n');

const forbidden: Array<[string, RegExp]> = [
  ['napcat-types dependency/import/path', /napcat-types/],
  ['NapCat plugin context', /NapCatPluginContext/],
  ['NapCat plugin module lifecycle', /\bPluginModule\b/],
  ['NapCat config type', /\bNapCatConfig\b/],
  ['NapCat plugin manager config', /pluginManager\.config/],
  ['legacy standalone context factory', /createStandaloneContext/],
  ['adapter-bound action state', /\badapterName\b/],
  ['network-bound action state', /\bnetworkConfig\b/],
  ['active NapCat shim path', /src\/shims\/napcat-types/],
  ['NapCat build command', /build:napcat/],
];

for (const [label, pattern] of forbidden) {
  assert.doesNotMatch(joined, pattern, label);
}

const indexSource = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/standalone/snowluma_service.ts'), 'utf8');
const contextSource = fs.readFileSync(path.join(root, 'src/standalone/standalone_context.ts'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'src/state.ts'), 'utf8');
const qunGuanjiaSource = fs.readFileSync(path.join(root, 'src/services/qun_guanjia_service.ts'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'src/core/state-infra/plugin_state_context_adapter.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, any>;

assert.match(indexSource, /initializeGroupGuard/);
assert.match(indexSource, /shutdownGroupGuard/);
assert.match(indexSource, /handleGroupGuardMessage/);
assert.match(indexSource, /handleGroupGuardEvent/);
assert.match(contextSource, /createStandaloneRuntimeContext/);
assert.match(serviceSource, /new SnowLumaProfile/);
assert.match(serviceSource, /new GenericOneBotProfile/);
assert.match(serviceSource, /const ctx = createStandaloneRuntimeContext/);
assert.match(serviceSource, /initializeGroupGuard\(ctx\)/);
assert.match(serviceSource, /ONEBOT_HOST_PROFILE/);
assert.match(stateSource, /OneBotActionClient/);
assert.match(adapterSource, /rawCall\(actionName, sanitizedParams\)/);
assert.match(qunGuanjiaSource, /profile\.getGroupMessageHistory/);
assert.doesNotMatch(qunGuanjiaSource, /callAction\('get_group_msg_history'/);
assert.doesNotMatch(adapterSource, /rawCall\([^\n]*,[^\n]*,[^\n]*,[^\n]*\)/);
assert.equal(packageJson.dependencies?.['napcat-types'], undefined);
assert.equal(packageJson.main, 'onebot-service.mjs');
assert.equal(typeof packageJson.scripts?.['build:onebot'], 'string');
assert.equal(typeof packageJson.scripts?.['build:snowluma'], 'string');
assert.equal(packageJson.scripts?.['build:napcat'], undefined);
assert.equal(fs.existsSync(path.join(root, 'src/shims/napcat-types')), false);

assert.equal(normalizeOneBotId(123456789), 123456789);
assert.equal(normalizeOneBotId(' 123456789 '), '123456789');
assert.equal(normalizeOneBotId({ value: '123' }), undefined);
assert.equal(normalizeOneBotId([]), undefined);
assert.equal(normalizeOneBotId(Number.NaN), undefined);
assert.equal(oneBotIdToString({ value: '123' }), '');

const validGroupMessage = normalizeOneBotEvent({
  post_type: 'message',
  message_type: 'group',
  group_id: ' 10001 ',
  user_id: 20002,
  message_id: 30003,
  raw_message: '测试',
  sender: { user_id: 20002, role: 'admin', card: '管理员' },
});
assert.ok(validGroupMessage && isOneBotMessageEvent(validGroupMessage));
assert.equal(validGroupMessage.group_id, '10001');
assert.equal(validGroupMessage.user_id, 20002);
assert.equal(validGroupMessage.sender?.role, 'admin');

const unknownRoleMessage = normalizeOneBotEvent({
  post_type: 'message',
  message_type: 'group',
  group_id: '10001',
  user_id: '20002',
  raw_message: '测试',
  sender: { user_id: '20002', role: 'superadmin' },
});
assert.ok(unknownRoleMessage && isOneBotMessageEvent(unknownRoleMessage));
assert.equal(unknownRoleMessage.sender?.role, undefined, 'non-OneBot role names must not enter normalized sender role');

assert.equal(normalizeOneBotEvent({
  post_type: 'message',
  message_type: 'group',
  user_id: '20002',
  raw_message: 'missing group',
}), null, 'group messages without group_id must fail closed');
assert.equal(normalizeOneBotEvent({
  post_type: 'message',
  message_type: 'group',
  group_id: '10001',
  user_id: { spoofed: '20002' },
  raw_message: 'object id',
}), null, 'object-shaped user_id must not stringify into an identity');
assert.ok(normalizeOneBotEvent({
  post_type: 'message',
  message_type: 'private',
  user_id: '20002',
  raw_message: 'private ok',
}), 'private messages must not require group_id');

assert.equal(normalizeOneBotEvent({
  post_type: 'notice',
  notice_type: 'group_decrease',
  sub_type: 'leave',
  user_id: '20002',
}), null, 'group_decrease without group_id must not reach blacklist mutation');
assert.equal(normalizeOneBotEvent({
  post_type: 'notice',
  notice_type: 'group_decrease',
  sub_type: 'leave',
  group_id: '10001',
}), null, 'group_decrease without user_id must fail closed');
assert.ok(normalizeOneBotEvent({
  post_type: 'notice',
  notice_type: 'group_decrease',
  sub_type: 'leave',
  group_id: '10001',
  user_id: '20002',
}), 'valid group_decrease must remain accepted');
assert.equal(normalizeOneBotEvent({
  post_type: 'notice',
  notice_type: 'group_recall',
  group_id: '10001',
  user_id: '20002',
}), null, 'group_recall without message_id must fail closed');
assert.equal(normalizeOneBotEvent({
  post_type: 'request',
  request_type: 'group',
  sub_type: 'add',
  user_id: '20002',
  flag: 'flag-1',
}), null, 'group request without group_id must fail closed');
assert.equal(normalizeOneBotEvent({ post_type: { forged: 'notice' } }), null, 'non-string post_type must fail closed');

// The upstream LAPI query parameter `compat=napcat` is a remote wire-format
// selector, not a runtime dependency. It remains unchanged until that service
// publishes a verified replacement contract.
console.info(`OneBot runtime boundary verified across ${files.length} active files`);
