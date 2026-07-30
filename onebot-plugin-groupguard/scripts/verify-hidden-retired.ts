import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

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

console.log('hidden query retirement verification passed');
