import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.dirname(new URL(import.meta.url).pathname);
const sourcePath = path.join(dir, 'apply-project-wide-bug-fixes-20260801.mjs');
const generatedPath = path.join(dir, '.apply-project-wide-bug-fixes-20260801.generated.mjs');
let source = fs.readFileSync(sourcePath, 'utf8');

source = source.replace(
  /replaceOnce\(\n  p\('src\/state\.ts'\),\n  `    const force = options\?\.force !== false;`,[\s\S]*?  'private force defaults false'\n\);/,
  `{
  const rel = p('src/state.ts');
  const before = '    const force = options?.force !== false;';
  const after = '    const force = options?.force === true;';
  const current = read(rel);
  if (!current.includes(before)) {
    if (!current.includes(after)) throw new Error('patch target missing: force defaults false');
  } else {
    const count = current.split(before).length - 1;
    if (count !== 3) throw new Error(\`unexpected force default count: \${count}\`);
    write(rel, current.split(before).join(after));
  }
}`
);

fs.writeFileSync(generatedPath, source, 'utf8');
try {
  await import(`${pathToFileURL(generatedPath).href}?v=${Date.now()}`);
} finally {
  try { fs.unlinkSync(generatedPath); } catch { /* noop */ }
}
