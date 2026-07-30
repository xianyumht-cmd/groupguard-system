import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

// Permanent guard: the retired hidden query must not regain an active route,
// protocol feature, legacy implementation, or user-visible configuration.
const root = process.cwd();
const commands = readFileSync(path.join(root, 'src/commands.ts'), 'utf8');
const formatter = readFileSync(path.join(root, 'src/dynamic-commands/command_response_formatter.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(commands.includes('registerIntranetHiddenCommandPlugins'), false);
assert.equal(commands.includes('intranet_hidden_runtime_plugin'), false);
assert.equal(existsSync(path.join(root, 'src/dynamic-commands/intranet_hidden_runtime_plugin.ts')), false);
assert.equal(existsSync(path.join(root, 'scripts/verify-intranet-hidden-command.ts')), false);
assert.equal(INTERACTION_PREFIXES.some(prefix => prefix.startsWith('查隐藏')), false);
assert.equal(formatter.includes("'查隐藏'"), false);
assert.equal(Boolean(packageJson.scripts['verify:intranet-hidden-command']), false);
assert.ok(packageJson.scripts['verify:hidden-retired']);

const typesSource = readFileSync(path.join(root, 'src/types.ts'), 'utf8');
const configSource = readFileSync(path.join(root, 'src/config.ts'), 'utf8');
const interactionSource = readFileSync(path.join(root, 'src/services/interaction_service.ts'), 'utf8');
for (const source of [typesSource, configSource, interactionSource]) {
  assert.equal(source.includes('hiddenQuery'), false);
  assert.equal(source.includes('query.lol_hidden'), false);
  assert.equal(source.includes("text.startsWith('查隐藏')"), false);
  assert.equal(source.includes('LolHiddenData'), false);
  assert.equal(source.includes('buildLolForwardPages'), false);
}

console.log('hidden query retirement verification passed');
