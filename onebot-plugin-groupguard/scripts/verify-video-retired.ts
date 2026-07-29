import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

const commandsPath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));
const runtimePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_video_runtime_plugin.ts', import.meta.url));
const dynamicConfigPath = fileURLToPath(new URL('../config/dynamic-commands/commands.json', import.meta.url));

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

console.log('retired video command verification passed');
