# GroupGuard Project State

Updated: 2026-08-09

## Canonical repository

- Canonical development branch: `main`.
- `main` at the start of the current task: `f1bbc194e3bced122b43f3811432eb6b224b4068`.
- Previous target-file retention repair: PR #38 -> `main`.
- Active task branch: `fix/target-file-root-reconcile-20260809`.
- Current task goal: replace historical-file-id retention with live QQ group-directory reconciliation for the dedicated target-file push group.

## Verified production state

The ARM GroupGuard runtime at `192.168.3.89` was successfully deployed on 2026-08-09 to:

- release commit: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated WebUI/API verification: HTTP 200
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-041531-target-retention-fix-f1bbc194e3bc`

The successful deployment report recorded:

- `pendingCleanup`: `17 -> 17`
- local target temp files: `1 -> 1`
- the one retained local temp file was exactly the current retryable `current.localPath`

The user subsequently manually deleted most QQ group files and intentionally left a small set for observation. This made the historical `pendingCleanup` records diverge further from the real QQ group directory. Production observation still showed multiple group files after new uploads, so the queue-based retention model did not achieve the actual product goal: one managed group file.

## Current target-file design decision

The target group uses the QQ group-file root directory `/` exclusively for this feature. The desired invariant is:

> After a successful replacement upload, the managed group-file root contains exactly one file: the newest successfully uploaded target file.

The active branch implements this as live reconciliation:

1. detect a new/replaced Lanzou file;
2. download it to the GroupGuard temp directory;
3. upload the replacement QQ group file first;
4. persist the returned new `file_id` as authoritative latest;
5. read the real QQ group-file directory through SnowLuma;
6. keep the authoritative new `file_id` and delete every other file in the managed root;
7. re-list the QQ directory and verify it converged to one file;
8. remove the local temp file after upload processing completes.

No QQ group file is deleted before the replacement upload succeeds.

## Verified SnowLuma contracts

Against official SnowLuma `v1.12.4` source:

- `upload_group_file` returns `file_id`;
- `get_group_root_files` reads the root directory;
- `get_group_files_by_folder` reads a specified folder;
- the underlying `GroupFileApi.list()` performs its own pagination loop until `isEnd`, so the OneBot list action is a complete snapshot;
- `delete_group_file` accepts `group_id + file_id` and awaits the delete operation.

The current task therefore promotes SnowLuma group-file listing to a verified built-in HostProfile capability instead of keeping it adapter-gated.

## Active implementation state

On `fix/target-file-root-reconcile-20260809`:

- SnowLuma built-in group-file listing is enabled and normalizes upload time;
- target-file retention reconciles from the live group directory rather than trusting historical pending records;
- a successful live reconciliation replaces stale `pendingCleanup` with actual remaining leftovers;
- manual “立即检查并整理” first reconciles the managed group root and then requests the Lanzou check;
- if the recorded latest file no longer exists during a manual reconcile, the newest real QQ file by `upload_time` is adopted rather than deleting every file blindly;
- WebUI now explicitly states that `/` is an exclusive managed directory and exposes reconciliation status;
- integration tests use the real `SnowLumaProfile` list/delete path and verify that a failed replacement upload performs no group-file deletion.

CI/PR/merge verification is still pending for this active branch.

## Production next action

Do not deploy this active-branch redesign merely because repository implementation is finished. After CI passes and the PR is merged to `main`, production deployment/restart still requires explicit user authorization for this new rollout. Production acceptance must verify the real QQ group root converges to exactly one file and that local temp cleanup remains correct.
