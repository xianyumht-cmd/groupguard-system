import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = path.join(root, 'src');
const commandsPath = path.join(srcRoot, 'commands.ts');
const runtimePath = path.join(srcRoot, 'dynamic-commands', 'intranet_video_runtime_plugin.ts');
const dynamicConfigPath = path.join(root, 'config', 'dynamic-commands', 'commands.json');

async function collectSourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectSourceFiles(absolute));
    else if (/\.(?:ts|js|mjs|json)$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}

const commandsSource = await readFile(commandsPath, 'utf8');
assert.doesNotMatch(commandsSource, /registerIntranetVideoCommandPlugins/);
assert.doesNotMatch(commandsSource, /intranet_video_runtime_plugin/);
await assert.rejects(access(runtimePath, constants.F_OK), 'retired video runtime file must not exist');

for (const command of ['我要看', '设置看视频接口', '删除看视频接口']) {
  assert.equal(INTERACTION_PREFIXES.includes(command), false, `legacy route still claims ${command}`);
  assert.equal(INTERACTION_EXACT.includes(command), false, `legacy exact route still claims ${command}`);
}
assert.equal(INTERACTION_EXACT.includes('看视频接口列表'), false);

const dynamicConfig = JSON.parse(await readFile(dynamicConfigPath, 'utf8'));
assert.equal(dynamicConfig.commands.some((command: any) => command.id === 'video.info'), false);
assert.equal(dynamicConfig.commands.some((command: any) => String(command?.trigger?.value || '').startsWith('视频')), false);

const forbiddenRuntimeMarkers = [
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
for (const file of await collectSourceFiles(srcRoot)) {
  const source = await readFile(file, 'utf8');
  for (const marker of forbiddenRuntimeMarkers) {
    assert.equal(source.includes(marker), false, `retired video query marker ${marker} remains in ${path.relative(root, file)}`);
  }
}

console.log('retired video command verification passed');
