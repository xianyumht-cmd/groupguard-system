import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// This focused contract is intentionally wired into npm test so group inheritance,
// durable queue finalization, and legacy WebUI scope behavior cannot regress silently.
const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'webui/config.html'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src/services/action_queue_service.ts'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'src/services/action_guard_service.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(html, /selfRecall:\s*\{ \.\.\.\(g\.selfRecall \|\| \{\}\), \.\.\.\(gs\.selfRecall \|\| \{\}\) \}/, 'group editor must nested-merge selfRecall');
assert.match(html, /sr\.enabled !== undefined \? sr\.enabled === true : g\.autoRecallSelf === true/, 'structured enabled=false must win over legacy enabled=true');
assert.match(html, /function compactGroupSelfRecall/, 'group save must use a sparse self-recall compactor');
assert.match(html, /Existing explicit nested ownership stays explicit/, 'existing explicit nested fields must retain ownership');
assert.match(html, /Preserve only aliases that existed/, 'inherited legacy aliases must not be materialized');
assert.match(html, /sparse\.probability = previousGroup\.autoRecallSelfProbability/, 'legacy probability intent must survive migration');
assert.match(html, /child\.classList\.contains\('manage-head'\)/, 'group self-recall must keep the expand header visible');
assert.match(html, /antiRisk\.classList\.remove\('manage-collapsed'\)/, 'group self-recall controls must not remain clipped by collapsed layout');
assert.match(queue, /before dedup\/rate-limit early exits/, 'disabled self-recall must be checked before queue early exits');
assert.match(queue, /Re-check after queue delay/, 'self-recall must be checked again immediately before delete');
assert.match(queue, /resolveSelfRecallTask\(task\.payload\.taskId, 'skip_duplicate', true, 0\)/, 'self-recall dedup must resolve durable state');
assert.match(queue, /resolveSelfRecallTask\(task\.payload\.taskId, 'skip_rate_limited', false, retryAfter\)/, 'self-recall rate limit must persist retry state');
assert.match(queue, /retryableAdmissionFailure = code === 'backpressure_reject' \|\| code === 'skip_queue_overflow'/, 'self-recall admission pressure must persist a delayed retry');
assert.match(queue, /self_recall_enqueue_result_write_failed/, 'self-recall admission outcome persistence must be observable');
assert.match(queue, /task\.type === 'self_recall'[\s\S]*resolveSelfRecallTask\(task\.payload\.taskId, 'exception'/, 'self-recall worker exceptions must update durable state');
assert.match(queue, /skip_self_recall_disabled/, 'disabled queued recall must terminate without delete');
assert.match(guard, /skip_self_recall_disabled/, 'GuardResult must type the terminal skip code');
assert.ok(pkg.scripts.test.includes('verify:per-group-self-recall'), 'focused contract must run under npm test');

console.log('per-group self-recall contract: PASS');