# GroupGuard Pitfalls

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


## Effective config cannot prove that a group field was explicitly overridden

Observed: 2026-08-28

### Failure pattern

A preference resolver used `resolveGroupSettings(groupId)` to decide whether a group had set `lolQueryOutputFormat`. That API returns the fully merged effective settings, so an inherited global value looked exactly like an explicit group override. The resolver therefore returned the inherited `forward` value before it ever evaluated the battle command profile, masking the intended feature preference.

A `useGlobal=true` row can also retain dormant historical values. Reading the merged/effective object when deciding precedence can accidentally treat those dormant values as active intent.

### Prevention

- Use raw `getGroupSettings(groupId)` data when the question is whether a group explicitly owns an override path.
- Treat `useGlobal=true` as whole-group inheritance; stored values in that row are dormant until the mode changes.
- Use effective settings only after override ownership/precedence has already been resolved.
- Add regression cases for explicit group override, `useGlobal=true` with a stale stored value, command-profile override, and no-override defaults.
- Keep WebUI effective-value previews aligned with the runtime resolver instead of deriving precedence independently from merged settings.

## Host-profile unit tests can hide a disabled production capability

Observed: 2026-08-09

### Failure pattern

A service-level regression can pass while production is unable to perform the same operation when the test substitutes a fake `HostProfile` implementation.

The target-file retention test supplied a fake `deleteGroupFile()` that returned confirmed success. Production instead constructed `new SnowLumaProfile(actions)` where group-file deletion was deliberately fail-closed and returned `snowluma_group_file_delete_contract_not_verified` without sending `delete_group_file`.

### Detection signals

- service/state-machine tests pass but runtime `pendingCleanup` grows;
- the same `lastError` repeats with increasing attempt counts;
- host-profile tests assert that a capability is unsupported/indeterminate while another feature assumes it works;
- no raw action invocation appears for the expected host operation.

### Prevention

- Any feature depending on a host-specific extension must include at least one regression through the actual production `HostProfile`, not only a fake service port.
- Lock the expected action name and exact parameters in the integration test.
- Verify the contract against the exact production host version when possible; do not infer SnowLuma semantics from NapCat.
- Keep unknown/unverified host behavior fail-closed, but do not let a feature claim support for an operation whose production profile still fails closed.

## Unreferenced failed temp files are not retry state

Observed: 2026-08-09

### Failure pattern

`TargetFilePushService` intentionally preserves the current failed download so the same event can retry it. When a different event replaces `state.current`, the old local file is no longer referenced by any retryable state. Retaining that orphan for a fixed age window only consumes storage; it does not improve recovery.

### Prevention

- Preserve only the file referenced by the current retryable state.
- On a fresh service bind, remove files in the dedicated target-file temp directory that are not referenced by `current.localPath`.
- When a different event supersedes a failed current event, remove the old failed temp file after persisting the new state.
- Restrict cleanup to paths strictly inside the dedicated temp directory.

## Historical group-file IDs are not the source of truth

Observed: 2026-08-09

### Failure pattern

A retention queue built only from previously observed upload `file_id` values can drift from the real QQ group directory. Users can manually delete files, uploads can occur while cleanup is failing, and old queue entries can remain after the corresponding QQ files no longer exist. Repeatedly retrying those historical IDs does not prove that the group directory has reached the desired state.

In production, `pendingCleanup` grew while the QQ group still contained multiple files. Manual cleanup then made the local queue even less representative of the actual directory.

### Prevention

- For an exclusive managed QQ group-file directory, treat a complete server-side directory listing as authoritative.
- After a replacement upload succeeds, re-read the actual directory, keep the authoritative new `file_id`, delete every other real file, then re-list to verify convergence.
- Derive any pending-cleanup display/state from the latest real directory observation instead of indefinitely appending historical IDs.
- Never delete the previous valid file before the replacement upload has succeeded and its returned `file_id` has been persisted.
- When manual reconciliation has no valid recorded latest file, adopt a deterministically selected real file before deleting anything; for the target-file push root this is the newest item by SnowLuma `upload_time`.

## Hidden destructive behavior in WebUI causes product-model confusion

Observed: 2026-08-09

### Failure pattern

The target-file WebUI described the last step only as deleting the local temporary download. The group-file retention behavior existed only in backend state-machine code, so the visible product model did not tell the operator that the QQ group directory was intended to be managed or cleaned.

### Prevention

- If a feature owns an external resource destructively, state that ownership explicitly in the UI.
- Show the ordering invariant in the visible workflow: upload replacement first, then clean old group files, then verify, then delete local temp.
- Expose reconciliation status, current kept file, observed managed-file count, and remaining cleanup count so production behavior can be verified without inspecting JSON state files.

## A successful local action request is not a successful business action

Observed: 2026-09-05

### Failure pattern

Callers displayed success or deducted points after enqueueing an action even when the host returned a failed action result. Shutdown also cleared pending queues before their results settled.

### Prevention

- Treat the final `GuardResult.ok` as the business commit boundary.
- Apply irreversible local effects such as point deductions only after the remote action succeeds.
- Stop accepting work before shutdown, drain bounded queues while their transport is still available, then close transports and persistence.
- Test failure, timeout, overload and shutdown paths; a resolved Promise alone is not evidence of success.

## Callback identity does not establish source ordering

Observed: 2026-09-05

### Failure pattern

Unique event IDs prevented exact duplicate processing but allowed an older callback arriving late to replace a newer target file.

### Prevention

- Require a positive monotonic source revision in every callback.
- Serialize target mutations per destination and persist the last accepted revision.
- Acknowledge stale revisions without downloading, uploading or deleting files.
- Validate every download URL and redirect hop against private/link-local destinations.
