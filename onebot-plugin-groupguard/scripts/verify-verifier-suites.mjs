import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifierSuites } from './verifier-suites.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const aggregateEntrypoints = {
  test: 'node scripts/run-verifier-suite.mjs test',
  'build:debug': 'node scripts/run-verifier-suite.mjs build:debug',
  'build:snowluma': 'node scripts/run-verifier-suite.mjs build:snowluma',
  'build:onebot': 'node scripts/run-verifier-suite.mjs build:onebot',
};

for (const [name, command] of Object.entries(aggregateEntrypoints)) {
  assert.equal(pkg.scripts?.[name], command, `${name} must use the suite runner`);
  assert.ok(Array.isArray(verifierSuites[name]) && verifierSuites[name].length > 0, `${name} suite missing`);
}

assert.deepEqual(
  verifierSuites['build:onebot'].slice(0, -1),
  verifierSuites['build:snowluma'].slice(0, -1),
  'onebot and snowluma builds must share the same verifier sequence',
);
assert.equal(verifierSuites['build:onebot'].at(-1), 'bundle:onebot');
assert.equal(verifierSuites['build:snowluma'].at(-1), 'bundle:snowluma');
assert.equal(verifierSuites['build:debug'].at(-1), 'bundle:debug');

const expectedBuildTail = [
  'verify:intranet-shard-command',
  'verify:all-query-fast-migration',
  'verify:intranet-battle-command',
  'verify:hidden-retired',
  'verify:video-retired',
  'verify:intranet-risk-command',
  'verify:intranet-dynamic-command',
  'verify:four-query-three-mode',
  'verify:webui-ios-glass',
  'verify:all-query-client-boundary',
  'verify:group-file-mirror',
  'verify:target-file-push',
  'verify:target-file-retention-snowluma',
];

assert.deepEqual(
  verifierSuites['build:debug'].slice(4, -1),
  expectedBuildTail,
  'debug build verifier tail changed',
);
assert.deepEqual(
  verifierSuites['build:onebot'].slice(8, -1),
  expectedBuildTail,
  'release build verifier tail changed',
);

assert.equal(verifierSuites.test.length, 34, 'test suite verifier count changed unexpectedly');
assert.equal(verifierSuites['build:debug'].length, 18, 'debug suite step count changed unexpectedly');
assert.equal(verifierSuites['build:onebot'].length, 22, 'onebot suite step count changed unexpectedly');
assert.equal(verifierSuites['build:snowluma'].length, 22, 'snowluma suite step count changed unexpectedly');

console.log('Verifier suite wiring contract passed');
