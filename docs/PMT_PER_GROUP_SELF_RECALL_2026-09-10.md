# PMT — Per-Group Self-Recall Override with WebUI Support

## Context

GroupGuard currently exposes self-recall (the bot deleting its own messages after a delay) as an operator-facing global setting. The configuration model and effective-settings resolver already support sparse per-group overrides, and runtime scheduling already reads effective group settings, but the current WebUI intentionally suppresses `selfRecall` from group payloads and forces the group editor to display the global self-recall values. This prevents notification groups from retaining bot-generated notices while ordinary groups continue to use self-recall.

## Objective

Add a production-safe per-group self-recall switch while preserving the existing global switch as the default for all groups. Operators must be able to keep global self-recall enabled, select a specific group in WebUI, override self-recall to disabled for that group, and have bot messages in that group remain visible.

## Required semantics

1. Global `selfRecall.enabled` remains the default.
2. A group with no explicit self-recall override inherits the global setting.
3. A group with an explicit `selfRecall.enabled=false` must not schedule or execute self-recall, even when global self-recall is enabled.
4. A group with an explicit `selfRecall.enabled=true` may enable self-recall even when global self-recall is disabled, provided the group is in per-group override mode.
5. Legacy `autoRecallSelf`, `autoRecallSelfDelay`, and `autoRecallSelfProbability` remain backward-compatible through the existing normalization layer; do not add a second allowlist/denylist schema. When both the structured `selfRecall.enabled` field and legacy `autoRecallSelf` are present, the structured field is authoritative even when its value is `false`; legacy values are fallback-only when the structured field is omitted.
6. `false`, `0`, and other defined values are valid sparse overrides; only omitted/undefined values inherit.
7. Disabling self-recall for a group must take effect for newly sent messages immediately after configuration is saved.
8. A queued or persisted self-recall task must be re-validated against the current effective group setting immediately before the delete action. If self-recall is now disabled, complete/resolve the task as skipped and do not call OneBot `delete_msg`. This prevents a notification sent before the operator toggled the switch from disappearing afterwards.
9. Re-enabling self-recall must affect future eligible messages only. A task skipped because the group was disabled must not be resurrected.

## Data model

Do not introduce a new database column or notification-group whitelist. Reuse the existing group override tree:

```json
{
  "global": {
    "selfRecall": { "enabled": true }
  },
  "groups": {
    "123456789": {
      "useGlobal": false,
      "selfRecall": { "enabled": false }
    }
  }
}
```

The effective resolver remains the single source of truth. The expected precedence is explicit group override -> global value -> existing normalized defaults/legacy compatibility.

## Runtime changes

Keep the existing group-aware scheduling path in `PluginState`. Add a late guard to the `self_recall` execution path in `src/services/action_queue_service.ts` (or the narrowest equivalent location) that resolves the current effective settings through `configStateService.resolveGroupSettings(groupId)` immediately before `safeRecall` is invoked. When disabled, do not call the OneBot delete API, resolve the persisted self-recall row so recovery does not retry it forever, emit a structured queue/history event such as `skip_self_recall_disabled`, and resolve the in-memory promise without retrying.

Extend the `GuardResult` code union only if a new typed result code is required. The disabled result must be terminal and must never enter the retry-code list.

## WebUI changes

Use the existing self-recall controls; do not create a duplicate settings panel.

On the global scope page, behavior remains unchanged and the switch edits the global default.

On the group scope page:
- Stop describing the switch as global-only. Explain that it follows the current scope and can inherit from the global setting or be overridden for the selected group.
- Build the displayed effective self-recall object using a nested merge of global `selfRecall` plus group `selfRecall`; do not shallow-merge the parent object and then force the self-recall controls back to global values.
- When rendering the enabled switch, prefer a defined `selfRecall.enabled` value over `autoRecallSelf`; this must preserve an explicit `false` instead of letting an inherited legacy `true` turn the UI back on.
- Stop deleting `autoRecallSelf`, `autoRecallSelfDelay`, and `selfRecall` from the group save payload.
- Preserve the existing `useGlobal`/inheritance behavior. A group that still uses global settings must remain read-only/inherited. Once group override mode is enabled, saving `selfRecall.enabled=false` must persist a sparse group override.
- Do not accidentally make unrelated global-only fields group-scoped.
- The UI must correctly round-trip both directions: global on/group off and global off/group on.

## API and persistence requirements

Use the current config patch/save API and existing config normalization/compaction. Do not add a parallel endpoint unless the existing API cannot represent the sparse group override. Saving one group must not materialize a full copy of global settings if current compaction can preserve sparse differences.

No migration is required. Existing installations must preserve their current behavior after upgrade because groups without an explicit override inherit the global setting.

## Tests and verification

Add or extend automated checks for these cases:

- global=true, group omitted => effective=true
- global=true, group=false => effective=false
- global=false, group omitted => effective=false
- global=false, group=true => effective=true
- structured `selfRecall.enabled=false` remains false even when a legacy/inherited `autoRecallSelf=true` is present
- group self-recall delay/mode fields inherit individually when omitted
- WebUI group save payload retains `selfRecall` and legacy compatibility fields instead of deleting them
- WebUI group fill logic uses effective nested self-recall values and does not force global values
- self-recall disabled before scheduling => no task scheduled
- self-recall disabled after scheduling/before execution => no `delete_msg`, persistent task reaches a terminal skipped state, no retry
- enabled group => existing self-recall behavior still executes
- config reload/restart preserves a group override

Run at minimum TypeScript typecheck, config-inheritance verification, action-queue/self-recall verification, and relevant WebUI contract verification. Run the broader existing test suite if it is practical in the repository environment.

## Acceptance criteria

The task is complete when an operator can leave global self-recall enabled, set a notification group to a per-group override with self-recall disabled in WebUI, save/reload the page, and observe that the selected group retains bot messages while an inherited ordinary group continues to self-recall. Pending self-recall tasks for the disabled group must also be suppressed before deletion. Existing global-only installations must require no migration and show no behavior change until a group override is deliberately created.

## Non-goals

Do not redesign the complete configuration UI, alter moderation recall of other users' messages, change unrelated action-queue throttling, add a notification-group role system, deploy/restart the production ARM host, merge to `main`, or publish a release as part of this task.

## Delivery

Implement on a dedicated temporary branch from the latest verified `main`, keep the diff narrowly scoped, record verification results, and leave the change reviewable without production deployment.
