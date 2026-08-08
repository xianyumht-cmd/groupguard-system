# GroupGuard Project State

Updated: 2026-08-09

## Canonical repository

- Canonical development branch: `main`.
- Active task branch: `fix/target-file-retention-cleanup-20260809`.
- This task fixes retention cleanup for the target Lanzou file push feature added by PR #37.
- The ARM production runtime at `192.168.3.89` is separate from repository development and has **not** been deployed or restarted by this task.

## Verified production incident

Runtime evidence captured on 2026-08-09 showed:

- `target-file-push-target-state.json` contained 14 `pendingCleanup` records.
- Every pending record ended with `snowluma_group_file_delete_contract_not_verified`.
- Attempt counts had grown to `27, 25, 23, ... 1`, proving repeated retention retries were occurring without a real SnowLuma delete action.
- `/mnt/sda1/groupguard/app/data/target-file-push-temp` contained 14 files totaling about 235 MB.
- The current failed item was retained intentionally after `onebot_action_timeout:upload_group_file`; older unreferenced failed temp files had no state entry capable of retrying them.

## Root cause

`SnowLumaProfile.deleteGroupFile()` was deliberately fail-closed when the OneBot host refactor was created because the SnowLuma delete contract had not yet been verified. The target-file retention feature later depended on that method, while its regression test used a fake HostProfile whose delete operation always succeeded. As a result, the retention state machine passed tests but production never sent `delete_group_file`.

The exact production host contract is now verified against official SnowLuma `v1.12.4` source:

- action: `delete_group_file`
- parameters: `group_id`, `file_id`
- SnowLuma awaits `groupFile.delete(group_id, file_id)` and returns an OK action response on success.

## Repair in progress

The active task branch now:

- implements verified built-in SnowLuma group-file deletion using only `group_id + file_id`;
- keeps group-file listing adapter-gated because this repair does not require list semantics;
- adds a real `SnowLumaProfile -> TargetFilePushService` retention regression so a fake delete adapter cannot hide this integration failure again;
- preserves the current failed temp file for retry, but removes unreferenced orphan temp files on service bind and removes a failed temp file once a different event supersedes it;
- gates the new integration regression in normal test/build scripts.

## Production next action

After repository CI and merge are complete, production remains unchanged until the user explicitly authorizes deployment/restart. A production rollout must preserve the current state files, verify the pending cleanup drains through real `delete_group_file` calls, verify only the intended latest QQ group file remains, and verify temp-directory cleanup without deleting the currently referenced failed item before rollout safety checks are complete.
