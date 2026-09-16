import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifierSuites } from './verifier-suites.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('npm_execpath_missing');
}

const aggregateScripts = new Set([
  'test',
  'build',
  'build:all',
  'build:debug',
  'build:snowluma',
  'build:onebot',
]);

function validateSuite(name, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(`invalid_verifier_suite:${name}`);
  }

  const seen = new Set();
  for (const step of steps) {
    if (typeof step !== 'string' || !step) {
      throw new Error(`invalid_verifier_step:${name}`);
    }
    if (seen.has(step)) {
      throw new Error(`duplicate_verifier_step:${name}:${step}`);
    }
    seen.add(step);

    if (aggregateScripts.has(step)) {
      throw new Error(`recursive_verifier_step:${name}:${step}`);
    }
    if (typeof packageJson.scripts?.[step] !== 'string') {
      throw new Error(`missing_package_script:${name}:${step}`);
    }
  }
}

for (const [name, steps] of Object.entries(verifierSuites)) {
  validateSuite(name, steps);
}

const requested = process.argv[2];
if (requested === '--list') {
  for (const [name, steps] of Object.entries(verifierSuites)) {
    console.log(`${name}: ${steps.join(' -> ')}`);
  }
  process.exit(0);
}

const steps = verifierSuites[requested];
if (!steps) {
  console.error(`Unknown verifier suite: ${requested || '<missing>'}`);
  console.error(`Available suites: ${Object.keys(verifierSuites).join(', ')}`);
  process.exit(2);
}

for (const [index, scriptName] of steps.entries()) {
  console.log(`\n[groupguard-suite] ${requested} ${index + 1}/${steps.length}: npm run ${scriptName}`);
  const result = spawnSync(process.execPath, [npmCli, 'run', scriptName], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[groupguard-suite] failed to start ${scriptName}:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    const code = Number.isInteger(result.status) ? result.status : 1;
    console.error(`[groupguard-suite] failed at ${index + 1}/${steps.length}: ${scriptName} (exit ${code})`);
    process.exit(code);
  }
}

console.log(`\n[groupguard-suite] ${requested} passed (${steps.length}/${steps.length})`);
