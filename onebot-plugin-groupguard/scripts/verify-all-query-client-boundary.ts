import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = path.join(root, 'src');
const dynamicRoot = path.join(srcRoot, 'dynamic-commands');
const servicesRoot = path.join(srcRoot, 'services');

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

const migratedCommands = [
  '查合集',
  '海符榜',
  '查封号',
  '查战绩',
  '查隐藏',
  '查骗子',
  '举报骗子',
  '查同行',
  '举报同行'
];
const migratedConfigurationCommands = [
  '设置封号主接口',
  '设置封号接口配置',
  '删除封号备用接口',
  '设置lolurl',
  '设置lolkey',
  '设置loltoken',
  '设置骗子查询接口',
  '添加骗子查询接口',
  '删除骗子查询接口',
  '设置骗子举报接口',
  '设置骗子库限制',
  '设置骗子风控'
];
for (const command of [...migratedCommands, ...migratedConfigurationCommands]) {
  assert.equal(INTERACTION_PREFIXES.includes(command), false, `legacy interaction route still owns ${command}`);
  assert.equal(INTERACTION_EXACT.includes(command), false, `legacy exact route still owns ${command}`);
}
for (const command of ['封号接口列表', '骗子接口状态']) {
  assert.equal(INTERACTION_EXACT.includes(command), false, `legacy provider status command remains active: ${command}`);
}


const retiredVideoMarkers = [
  '我要看',
  '设置看视频接口',
  '删除看视频接口',
  '看视频接口列表',
  'videoApiTemplates',
  'query.video',
  'video.info',
  'intranet_video_runtime_plugin',
  'registerIntranetVideoCommandPlugins'
];
async function collectRuntimeSourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectRuntimeSourceFiles(absolute));
    else if (/\.(?:ts|js|mjs|json)$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}
for (const file of await collectRuntimeSourceFiles(srcRoot)) {
  const source = await readFile(file, 'utf8');
  for (const marker of retiredVideoMarkers) {
    assert.equal(source.includes(marker), false, `retired video query marker ${marker} remains in ${path.relative(root, file)}`);
  }
}

const commandsSource = await text('src/commands.ts');
for (const registration of [
  'registerIntranetQueryCommandPlugins()',
  'registerIntranetBattleCommandPlugins()',
  'registerIntranetHiddenCommandPlugins()',
  'registerIntranetRiskCommandPlugins()'
]) {
  assert.ok(commandsSource.includes(registration), `missing query registration: ${registration}`);
}

const activeRuntimeFiles = (await readdir(dynamicRoot))
  .filter((name) => /^intranet_.*(?:runtime_plugin|command_plugin)\.ts$/.test(name))
  .sort();
assert.ok(activeRuntimeFiles.length >= 5, 'expected all retained intranet query runtime modules');
assert.equal(activeRuntimeFiles.includes('intranet_video_runtime_plugin.ts'), false, 'retired video runtime must not exist');
assert.doesNotMatch(commandsSource, /registerIntranetVideoCommandPlugins|intranet_video_runtime_plugin/);
for (const name of activeRuntimeFiles) {
  const source = (await readFile(path.join(dynamicRoot, name), 'utf8')).toLowerCase();
  assert.equal(/\bfetch\s*\(/.test(source), false, `${name} must not call fetch directly`);
  assert.equal(/https?:\/\//.test(source), false, `${name} must not contain a business URL`);
  for (const forbidden of [
    'provider.url',
    'response.textpath',
    'response.template',
    'storageadapter',
    'scammerqueryurls',
    'scammerreporturl',
    'loltoken',
    'lolauthkey',
    'sharddataurl',
    'shardherolisturl',
    'videoapitemplates',
    'querybanbyendpoint',
    'buildcrossqueryurl',
    'loadsharddata'
  ]) {
    assert.equal(source.includes(forbidden), false, `${name} contains forbidden client business behavior: ${forbidden}`);
  }
}

const queryClientSource = (await readFile(path.join(servicesRoot, 'groupguard_query_delivery_client.ts'), 'utf8')).toLowerCase();
const reportClientSource = (await readFile(path.join(servicesRoot, 'groupguard_report_delivery_client.ts'), 'utf8')).toLowerCase();
for (const [name, source] of [
  ['groupguard_query_delivery_client.ts', queryClientSource],
  ['groupguard_report_delivery_client.ts', reportClientSource]
] as const) {
  assert.match(source, /isintranethostname/);
  assert.match(source, /fetchfn\(endpoint/);
  assert.equal(source.includes('raw.githubusercontent.com'), false, `${name} contains public business source`);
  assert.equal(source.includes('lolso1.com'), false, `${name} contains public business source`);
  assert.equal(source.includes('game.gtimg.cn'), false, `${name} contains public business source`);
}

const registrySource = await text('src/dynamic-commands/command_plugin_registry.ts');
assert.match(registrySource, /createIntranetDynamicCommandPlugin/);
assert.doesNotMatch(registrySource, /createHttpCommandPlugin/);
assert.match(registrySource, /definition\.provider\.type !== 'intranet'/);

const validatorSource = await text('src/dynamic-commands/command_validator.ts');
assert.match(validatorSource, /legacy_http_provider_forbidden/);
assert.match(validatorSource, /client_response_selector_forbidden/);

const dynamicConfig = JSON.parse(await text('config/dynamic-commands/commands.json'));
assert.equal(dynamicConfig.version, '2.0.0');
assert.ok(Array.isArray(dynamicConfig.commands) && dynamicConfig.commands.length > 0);
assert.equal(dynamicConfig.commands.some((command: any) => command.id === 'video.info'), false);
assert.equal(dynamicConfig.commands.some((command: any) => String(command?.trigger?.value || '').startsWith('视频')), false);
for (const command of dynamicConfig.commands) {
  assert.equal(command.featureType, 'query', `${command.id} must be a query feature`);
  assert.deepEqual(command.provider, { type: 'intranet' }, `${command.id} contains client provider configuration`);
  assert.deepEqual(command.response, { type: 'structured' }, `${command.id} contains client response parsing`);
  const serialized = JSON.stringify(command).toLowerCase();
  for (const forbidden of ['http://', 'https://', 'authorization', 'cookie', 'textpath', 'template', 'timeoutms']) {
    assert.equal(serialized.includes(forbidden), false, `${command.id} leaks provider detail: ${forbidden}`);
  }
}

const migrationSource = await text('scripts/migrate-dynamic-http-to-intranet.mjs');
assert.match(migrationSource, /before-intranet/);
assert.match(migrationSource, /client_sha256/);
assert.match(migrationSource, /service_sha256/);
assert.match(migrationSource, /provider:\s*\{ type: 'intranet' \}/);

const architectureDoc = await text('docs/architecture/CHANNEL_NEUTRAL_QUERY_CLIENT_BOUNDARY.md');
assert.match(architectureDoc, /官方机器人|official bot/i);
assert.match(architectureDoc, /内网接口失败时直连公网|公网.*备用|public fallback/i);

// Legacy query implementations remain temporarily reviewable in
// interaction_service.ts, but the active dispatcher must have no migrated
// trigger path into them. This assertion prevents accidental reactivation.
const interactionModuleSource = await text('src/commands/modules/interaction.ts');
for (const command of migratedCommands) {
  assert.equal(interactionModuleSource.includes(`'${command}'`), false, `migrated command reactivated in interaction module: ${command}`);
}

console.log(`all-query client boundary verification passed (${activeRuntimeFiles.length} intranet runtime modules)`);
