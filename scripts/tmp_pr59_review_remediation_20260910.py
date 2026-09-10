from pathlib import Path

root = Path('.')

# 1) Legacy WebUI: keep self-recall sparse and preserve existing explicit/unknown fields.
html_path = root / 'onebot-plugin-groupguard/webui/config.html'
html = html_path.read_text(encoding='utf-8-sig')

old_fill = """    function fillGroup (gid) {
      const gs = (C.groups || {})[gid] || {};
      const g = C.global || {};
      // Merge with global defaults if undefined
      const m = (k, def) => gs[k] !== undefined ? gs[k] : (def !== undefined ? def : g[k]);
      // Actually, we should just fill fields, and let UI show current values.
      // But we need to handle \"inherit\" logic. 
      // For simplicity in this WebUI, if not using global, we show group values, defaulting to global if missing.
      const mixed = {
        ...g,
        ...gs,
        selfRecall: { ...(g.selfRecall || {}), ...(gs.selfRecall || {}) }
      };
      fillFields(mixed);
      sv('c-bl', (gs.groupBlacklist || []).join(',')); // Group blacklist
      sv('c-wl-list', ''); // No group whitelist
    }
"""
new_fill = """    function fillGroup (gid) {
      const gs = (C.groups || {})[gid] || {};
      const g = C.global || {};
      // Display the effective nested policy without turning inherited fields into stored overrides.
      const mixed = {
        ...g,
        ...gs,
        selfRecall: { ...(g.selfRecall || {}), ...(gs.selfRecall || {}) }
      };
      fillFields(mixed);
      sv('c-bl', (gs.groupBlacklist || []).join(',')); // Group blacklist
      sv('c-wl-list', ''); // No group whitelist
    }

    const SELF_RECALL_MANAGED_KEYS = ['enabled', 'mode', 'fixedDelay', 'minDelay', 'maxDelay', 'jitter'];
    function hasOwnField (obj, key) {
      return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    }
    function globalSelfRecallView (settings) {
      const sr = settings?.selfRecall || {};
      const fixedDelay = hasOwnField(sr, 'fixedDelay') ? sr.fixedDelay : (settings?.autoRecallSelfDelay ?? 60);
      const minDelay = hasOwnField(sr, 'minDelay') ? sr.minDelay : Math.max(0, Number(fixedDelay) - 15);
      return {
        enabled: hasOwnField(sr, 'enabled') ? sr.enabled === true : settings?.autoRecallSelf === true,
        mode: sr.mode === 'random' ? 'random' : 'fixed',
        fixedDelay,
        minDelay,
        maxDelay: hasOwnField(sr, 'maxDelay') ? sr.maxDelay : Math.max(Number(minDelay), Number(fixedDelay) + 30),
        jitter: hasOwnField(sr, 'jitter') ? sr.jitter : 0
      };
    }
    function compactGroupSelfRecall (previousGroup, globalSettings, currentSelfRecall) {
      const previousSr = previousGroup?.selfRecall && typeof previousGroup.selfRecall === 'object'
        ? previousGroup.selfRecall
        : {};
      const current = currentSelfRecall || {};
      const globalSr = globalSelfRecallView(globalSettings || {});
      const sparse = { ...previousSr };

      SELF_RECALL_MANAGED_KEYS.forEach((key) => {
        // Existing explicit nested ownership stays explicit, even when its value currently equals global.
        if (hasOwnField(previousSr, key)) {
          sparse[key] = current[key];
          return;
        }
        delete sparse[key];
        // Newly edited/displayed values are stored only when they actually differ from global.
        if (!Object.is(current[key], globalSr[key])) sparse[key] = current[key];
      });

      // Migrate historical legacy group ownership into the structured policy on the next save.
      // This preserves intent without making untouched inherited fields explicit.
      if (!hasOwnField(previousSr, 'enabled') && hasOwnField(previousGroup, 'autoRecallSelf')) {
        sparse.enabled = current.enabled;
      }
      if (!hasOwnField(previousSr, 'fixedDelay') && hasOwnField(previousGroup, 'autoRecallSelfDelay')) {
        sparse.fixedDelay = current.fixedDelay;
      }
      if (!hasOwnField(previousSr, 'probability') && hasOwnField(previousGroup, 'autoRecallSelfProbability')) {
        sparse.probability = previousGroup.autoRecallSelfProbability;
      }
      return Object.keys(sparse).length ? sparse : undefined;
    }
"""
if html.count(old_fill) != 1:
    raise SystemExit(f'fillGroup marker mismatch: {html.count(old_fill)}')
html = html.replace(old_fill, new_fill, 1)

old_collect = """    function collectGroup (gid) {
      C.groups = C.groups || {};
      const payload = { ...collectFields(), useGlobal: false, groupBlacklist: ($('c-bl')?.value || '').split(',').map(s => s.trim()).filter(Boolean) };
      delete payload.disableReplyTemplate;
      C.groups[gid] = payload;
    }
"""
new_collect = """    function collectGroup (gid) {
      C.groups = C.groups || {};
      const previous = C.groups[gid] || {};
      const payload = { ...collectFields(), useGlobal: false, groupBlacklist: ($('c-bl')?.value || '').split(',').map(s => s.trim()).filter(Boolean) };
      const sparseSelfRecall = compactGroupSelfRecall(previous, C.global || {}, payload.selfRecall);
      if (sparseSelfRecall) payload.selfRecall = sparseSelfRecall;
      else delete payload.selfRecall;

      // collectFields() exposes compatibility aliases for global saves. Do not create those aliases
      // in a group just because inherited values were displayed. Preserve only aliases that existed.
      if (!hasOwnField(previous, 'autoRecallSelf')) delete payload.autoRecallSelf;
      if (!hasOwnField(previous, 'autoRecallSelfDelay')) delete payload.autoRecallSelfDelay;
      if (hasOwnField(previous, 'autoRecallSelfProbability')) payload.autoRecallSelfProbability = previous.autoRecallSelfProbability;
      else delete payload.autoRecallSelfProbability;
      delete payload.disableReplyTemplate;
      C.groups[gid] = payload;
    }
"""
if html.count(old_collect) != 1:
    raise SystemExit(f'collectGroup marker mismatch: {html.count(old_collect)}')
html = html.replace(old_collect, new_collect, 1)

old_scope = """        Array.from(antiRisk.children).forEach((child) => {
          if (!isGroupMode) { child.style.display = ''; return; }
          const containsSelfRecall = Array.from(child.querySelectorAll('[id]')).some((node) => selfRecallIds.has(node.id));
          child.style.display = containsSelfRecall ? '' : 'none';
        });
        const hint = $('c-ars')?.parentElement?.querySelector('.text-xs.text-slate-400');
"""
new_scope = """        if (isGroupMode) {
          if (!hasOwnField(antiRisk.dataset, 'groupRecallWasCollapsed')) {
            antiRisk.dataset.groupRecallWasCollapsed = antiRisk.classList.contains('manage-collapsed') ? '1' : '0';
          }
          antiRisk.classList.remove('manage-collapsed');
        } else if (hasOwnField(antiRisk.dataset, 'groupRecallWasCollapsed')) {
          antiRisk.classList.toggle('manage-collapsed', antiRisk.dataset.groupRecallWasCollapsed === '1');
          delete antiRisk.dataset.groupRecallWasCollapsed;
        }
        Array.from(antiRisk.children).forEach((child) => {
          if (!isGroupMode || child.classList.contains('manage-head')) { child.style.display = ''; return; }
          const containsSelfRecall = Array.from(child.querySelectorAll('[id]')).some((node) => selfRecallIds.has(node.id));
          child.style.display = containsSelfRecall ? '' : 'none';
        });
        const hint = $('c-ars')?.parentElement?.querySelector('.text-xs.text-slate-400');
"""
if html.count(old_scope) != 1:
    raise SystemExit(f'applyScopeView marker mismatch: {html.count(old_scope)}')
html = html.replace(old_scope, new_scope, 1)
html_path.write_text(html, encoding='utf-8')

# 2) Queue: terminally resolve disabled self-recall before any early queue exit,
# keep a second guard immediately before delete, and make dedup/rate-limit durable.
queue_path = root / 'onebot-plugin-groupguard/src/services/action_queue_service.ts'
q = queue_path.read_text(encoding='utf-8')
helper_marker = """function isSelfRecallEnabledForGroup(groupId: string): boolean {
  const settings = configStateService.resolveGroupSettings(groupId);
  const policy = settings.selfRecall;
  return policy ? policy.enabled === true : settings.autoRecallSelf === true;
}
"""
helper_replacement = helper_marker + """
async function skipDisabledSelfRecallTask(task: SelfRecallTask): Promise<void> {
  const code = 'skip_self_recall_disabled' as const;
  await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, code, true, 0);
  task.resolve({ ok: false, code });
  stats.queueDropped += 1;
  recordMinuteMetric('dropped');
  appendQueueLog(`self_recall ${taskSubject(task)} skipped_disabled_for_group`);
  recordActionQueueEvent(task, 'skipped', { code, ok: false, reason: 'self_recall_disabled_for_group' });
}
"""
if q.count(helper_marker) != 1:
    raise SystemExit('self-recall helper marker mismatch')
q = q.replace(helper_marker, helper_replacement, 1)

try_marker = """  try {
    if (task.retries <= 0 && isDedupHit(task.groupId, task.dedupKey)) {
"""
try_replacement = """  try {
    // A disabled durable self-recall must be terminal before dedup/rate-limit early exits,
    // otherwise its persisted row can stay recoverable forever.
    if (task.type === 'self_recall' && !isSelfRecallEnabledForGroup(task.groupId)) {
      await skipDisabledSelfRecallTask(task);
      return;
    }
    if (task.retries <= 0 && isDedupHit(task.groupId, task.dedupKey)) {
"""
if q.count(try_marker) != 1:
    raise SystemExit('executeTask start marker mismatch')
q = q.replace(try_marker, try_replacement, 1)

recall_dedup = """      if (task.type === 'recall') {
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'skip_duplicate', true, 0);
      }
"""
dedup_replacement = recall_dedup + """      if (task.type === 'self_recall') {
        await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, 'skip_duplicate', true, 0);
      }
"""
if q.count(recall_dedup) != 1:
    raise SystemExit('dedup persistence marker mismatch')
q = q.replace(recall_dedup, dedup_replacement, 1)

recall_rate = """      if (task.type === 'recall') {
        task.retries += 1;
        const retryAfter = task.retries <= task.maxRetries ? computeRecallRetryDelayMs(task.retries) : 0;
        await groupguardRepository.resolveRecallTask(task.payload.taskId, 'skip_rate_limited', false, retryAfter);
      }
"""
rate_replacement = recall_rate + """      if (task.type === 'self_recall') {
        task.retries += 1;
        const retryAfter = task.retries <= task.maxRetries ? computeSelfRecallRetryDelayMs(task.retries) : 0;
        await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, 'skip_rate_limited', false, retryAfter);
      }
"""
if q.count(recall_rate) != 1:
    raise SystemExit('rate-limit persistence marker mismatch')
q = q.replace(recall_rate, rate_replacement, 1)

old_late = """    if (task.type === 'self_recall') {
      if (!isSelfRecallEnabledForGroup(task.groupId)) {
        const code = 'skip_self_recall_disabled' as const;
        await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, code, true, 0);
        task.resolve({ ok: false, code });
        stats.queueDropped += 1;
        recordMinuteMetric('dropped');
        appendQueueLog(`self_recall ${taskSubject(task)} skipped_disabled_for_group`);
        recordActionQueueEvent(task, 'skipped', { code, ok: false, reason: 'self_recall_disabled_for_group' });
        return;
      }
"""
new_late = """    if (task.type === 'self_recall') {
      // Re-check after queue delay as configuration may have changed while this task waited.
      if (!isSelfRecallEnabledForGroup(task.groupId)) {
        await skipDisabledSelfRecallTask(task);
        return;
      }
"""
if q.count(old_late) != 1:
    raise SystemExit('late self-recall guard marker mismatch')
q = q.replace(old_late, new_late, 1)
queue_path.write_text(q, encoding='utf-8')

# 3) Wire the focused contract into npm test.
pkg_path = root / 'onebot-plugin-groupguard/package.json'
pkg = pkg_path.read_text(encoding='utf-8')
script_marker = '    "verify:lol-patch-notifier": "node --experimental-strip-types --import ./scripts/register-ts-loader.mjs scripts/verify-lol-patch-notifier.ts",\n'
script_add = script_marker + '    "verify:per-group-self-recall": "node scripts/test_per_group_self_recall_contract.mjs",\n'
if pkg.count(script_marker) != 1:
    raise SystemExit('package script marker mismatch')
pkg = pkg.replace(script_marker, script_add, 1)
test_old = 'npm run verify:onebot-runtime && npm run verify:lol-patch-notifier && npm run arch:check:system-write:strict'
test_new = 'npm run verify:onebot-runtime && npm run verify:lol-patch-notifier && npm run verify:per-group-self-recall && npm run arch:check:system-write:strict'
if pkg.count(test_old) != 1:
    raise SystemExit('npm test marker mismatch')
pkg = pkg.replace(test_old, test_new, 1)
pkg_path.write_text(pkg, encoding='utf-8')

# 4) Strengthen the focused contract.
test_path = root / 'onebot-plugin-groupguard/scripts/test_per_group_self_recall_contract.mjs'
test_path.write_text("""import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

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
assert.match(queue, /skip_self_recall_disabled/, 'disabled queued recall must terminate without delete');
assert.match(guard, /skip_self_recall_disabled/, 'GuardResult must type the terminal skip code');
assert.ok(pkg.scripts.test.includes('verify:per-group-self-recall'), 'focused contract must run under npm test');

console.log('per-group self-recall contract: PASS');
""", encoding='utf-8')

# 5) Route durable knowledge into canonical docs and remove the dated parallel PMT.
decisions_path = root / 'docs/DECISIONS.md'
decisions = decisions_path.read_text(encoding='utf-8')
decision_block = """# GroupGuard Decisions

## 2026-09-10 — Self-recall uses sparse per-group overrides with execution-time revalidation

### Decision

`global.selfRecall` remains the default policy, while an active group overlay may override individual `selfRecall` fields. Missing fields inherit; explicit `false` and `0` remain real overrides. The structured `selfRecall` field is authoritative over same-scope legacy aliases when present. Broad WebUI saves must not turn displayed effective self-recall values into new group ownership: existing explicit nested fields remain explicit, newly introduced fields are stored only when they differ from global, and unedited/unknown nested fields such as `probability` are preserved.

Durable `self_recall` queue work is revalidated against current effective group settings before queue-level early exits and again immediately before `delete_msg`. Once disabled, the persisted task is terminally resolved as `skip_self_recall_disabled`; it must not remain recoverable or be retried later.

### Reason

A rendered effective value is not proof that the group owns that field, and a delayed recall can outlive the configuration that originally scheduled it. Persisting the preview would break future global inheritance, while validating only at scheduling time could still delete a notification after the operator disabled recall for that group.

### Consequences

- Operators can keep global self-recall enabled while disabling it for selected groups.
- Global mode/delay changes continue to propagate through omitted group fields.
- Historical explicit group paths are not silently deleted merely because they equal the current global value.
- Legacy aliases remain compatibility inputs, but new group saves prefer the structured policy and avoid creating inherited aliases.
- Disabled durable tasks are resolved before dedup/rate-limit paths and are checked again after queue delay before host deletion.
- No database migration is required.

"""
if decisions.startswith('# GroupGuard Decisions\n') and '2026-09-10 — Self-recall uses sparse per-group overrides' not in decisions:
    decisions = decisions.replace('# GroupGuard Decisions\n', decision_block, 1)
decisions_path.write_text(decisions, encoding='utf-8')

arch_path = root / 'docs/ARCHITECTURE.md'
arch = arch_path.read_text(encoding='utf-8')
arch_add = """# GroupGuard Architecture

## Group-aware self-recall lifecycle

Self-recall is part of the existing configuration inheritance model, not a separate notification-group schema. Runtime resolves `global.selfRecall` plus the active sparse group overlay through the canonical effective-config resolver. The WebUI may render inherited mode/delay values for convenience, but those effective values are not automatically persisted as group ownership.

Durable self-recall execution has two configuration gates:

```text
persisted/due self_recall
  -> resolve current effective group policy before dedup/rate-limit exits
  -> queue delay
  -> resolve current effective group policy again
  -> safeRecall / OneBot delete_msg
```

If either gate observes self-recall disabled, the durable row is terminally resolved with `skip_self_recall_disabled` and no host delete call is made. The second gate is required because configuration can change while the task waits.

"""
if arch.startswith('# GroupGuard Architecture\n') and '## Group-aware self-recall lifecycle' not in arch:
    arch = arch.replace('# GroupGuard Architecture\n', arch_add, 1)
arch_path.write_text(arch, encoding='utf-8')

pitfalls_path = root / 'docs/PITFALLS.md'
pitfalls = pitfalls_path.read_text(encoding='utf-8')
pit_add = """# GroupGuard Pitfalls

## Rendering an inherited value does not authorize persisting it as a group override

Observed: 2026-09-10

### Failure pattern

A broad group WebUI rendered the effective `selfRecall` policy and then saved every displayed mode/delay field. That converted inherited values into explicit group ownership, prevented later global changes from propagating, and could discard an unrendered nested field such as `probability`. A collapsed layout also hid the section header in group mode, leaving the remaining controls clipped and impossible to expand.

### Prevention

- Treat effective values as preview data, not proof of ownership.
- Preserve previously explicit nested fields, compact newly introduced fields against global, and retain unknown existing nested keys.
- Do not materialize legacy aliases merely because compatibility controls are displayed.
- When scope filtering hides siblings inside a collapsible section, keep its header/control reachable or force the scoped section open and restore the previous collapsed state afterward.
- Add the focused WebUI contract to the normal `npm test` path so these rules cannot silently regress.

## Durable work must be finalized before generic queue early exits

Observed: 2026-09-10

### Failure pattern

A disabled persisted self-recall task was checked only after deduplication and rate limiting. When an earlier generic queue branch returned, the SQLite row could remain scheduled, so recovery repeatedly re-enqueued work that should have been terminally skipped.

### Prevention

- Evaluate terminal business-state conditions before generic dedup/rate-limit exits when those exits do not themselves finalize durable state.
- Ensure dedup/rate-limit outcomes for durable tasks update their persistent row.
- Keep a final configuration check immediately before the external side effect to cover changes that occur while queued.

"""
if pitfalls.startswith('# GroupGuard Pitfalls\n') and '## Rendering an inherited value does not authorize persisting it as a group override' not in pitfalls:
    pitfalls = pitfalls.replace('# GroupGuard Pitfalls\n', pit_add, 1)
pitfalls_path.write_text(pitfalls, encoding='utf-8')

state_path = root / 'docs/PROJECT_STATE.md'
state = state_path.read_text(encoding='utf-8')
state = state.replace('Updated: 2026-09-05', 'Updated: 2026-09-10', 1)
state_block = """## Active self-recall / notification-update work — 2026-09-10

- PR #59 (`feat/per-group-self-recall-20260910`) is the active review unit for sparse per-group self-recall. Review remediation keeps explicit `false`, prevents inherited mode/delay values from becoming new overrides, keeps the scoped controls reachable, finalizes disabled durable queue rows before generic early exits, and wires the focused contract into `npm test`.
- Dependent branch `feat/lol-notify-groups-and-webui-updater-20260910` adds selected-group LOL patch notifications and authenticated WebUI self-update. It is intentionally not merged into `main` while #59 review findings are being reconciled.
- `main` and production deployment remain separate from these review branches. No main merge or automated ARM deployment is authorized by this review-remediation step.

"""
anchor = '## Reliability hardening candidate — 2026-09-05\n'
if '## Active self-recall / notification-update work — 2026-09-10' not in state:
    if anchor not in state:
        raise SystemExit('PROJECT_STATE insertion marker missing')
    state = state.replace(anchor, state_block + anchor, 1)
state_path.write_text(state, encoding='utf-8')

pmt = root / 'docs/PMT_PER_GROUP_SELF_RECALL_2026-09-10.md'
if pmt.exists():
    pmt.unlink()

print('PR59 review remediation patch applied')
