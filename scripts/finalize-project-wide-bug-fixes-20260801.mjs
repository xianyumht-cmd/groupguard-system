import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function replaceOnce(rel, before, after) {
  const target = path.join(root, rel);
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`finalizer target missing: ${rel}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`finalizer target not unique: ${rel}`);
  fs.writeFileSync(target, source.slice(0, index) + after + source.slice(index + before.length), 'utf8');
}

replaceOnce(
  'onebot-plugin-groupguard/scripts/verify-group-file-mirror.ts',
  "  assert.equal(invalidRegex.rules[0]?.fileNamePattern, '', 'invalid regular expressions are safely disabled');",
  "  assert.equal(invalidRegex.rules[0]?.fileNamePattern, '[', 'invalid regular expressions remain visible for diagnosis');\n  assert.equal(invalidRegex.rules[0]?.enabled, false, 'invalid regular expressions disable the rule instead of matching every file');"
);

console.log('project-wide bugfix finalizer completed');
