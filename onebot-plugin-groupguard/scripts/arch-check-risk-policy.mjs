import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcDir = path.join(root, 'src');
const restrictedNames = [
  'enqueueBanAction',
  'enqueueKickAction',
  'enqueueRecallAction'
];
const allowedFiles = new Set([
  path.normalize('src/risk/policy_engine.ts'),
  path.normalize('src/services/action_queue_service.ts'),
  path.normalize('src/services/action_guard_service.ts')
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(srcDir)) {
  const rel = path.normalize(path.relative(root, file));
  if (allowedFiles.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (restrictedNames.some((name) => line.includes(name))) {
      violations.push({ file: rel, line: index + 1, text: line.trim() });
    }
  });
}

console.log('risk_policy architecture check');
console.log('rule: ban/kick/recall queue entrypoints must be owned by PolicyEngine');

if (violations.length) {
  console.log('status: failed');
  for (const violation of violations) {
    console.log(`- ${violation.file}:${violation.line} ${violation.text}`);
  }
  process.exit(1);
}

console.log('status: clean');
