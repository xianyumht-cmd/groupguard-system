import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'webui/config.html'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src/services/action_queue_service.ts'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'src/services/action_guard_service.ts'), 'utf8');

assert.match(html, /selfRecall:\s*\{ \.\.\.\(g\.selfRecall \|\| \{\}\), \.\.\.\(gs\.selfRecall \|\| \{\}\) \}/, 'group editor must nested-merge selfRecall');
assert.doesNotMatch(html, /delete payload\.selfRecall;/, 'group save must retain selfRecall');
assert.doesNotMatch(html, /delete payload\.autoRecallSelf;/, 'group save must retain legacy enabled field');
assert.match(html, /当前群可独立覆盖全局设置/, 'group UI must explain per-group override');
assert.match(html, /sr\.enabled !== undefined \? sr\.enabled === true : g\.autoRecallSelf === true/, 'new selfRecall.enabled must override the legacy flag even when false');
assert.match(queue, /isSelfRecallEnabledForGroup/, 'queue must revalidate current group setting');
assert.match(queue, /skip_self_recall_disabled/, 'disabled queued recall must terminate without delete');
assert.match(guard, /skip_self_recall_disabled/, 'GuardResult must type the terminal skip code');

console.log('per-group self-recall contract: PASS');
