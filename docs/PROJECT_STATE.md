# GroupGuard Project State

Updated: 2026-08-09

## Canonical repository

- Canonical development branch: `main`.
- `main` at the start of the target-file root reconciliation task: `f1bbc194e3bced122b43f3811432eb6b224b4068`.
- Previous target-file retention repair: PR #38 -> `main`.
- Target-file live-root reconciliation change record: PR #39, branch `fix/target-file-root-reconcile-20260809` -> `main`.
- PR #39 implementation head `32b27b409c79b1a11124e71c2ee49a7d2913e98d` passed GroupGuard Build run `31277586168`, GroupGuard CI run `31277586197`, and WebUI Browser Acceptance run `31277586167`.
- Documentation-reconciled head `482cbcf48d1127500088388591a6b265dbf88ac8` also passed GroupGuard Build run `31277671015`, GroupGuard CI run `31277670995`, and WebUI Browser Acceptance run `31277670994`.
- Repository acceptance and production rollout remain separate gates: a validated PR must still be merged/verified on `main`, while ARM deployment/restart requires explicit production authorization.

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

PR #39 implements this as live reconciliation:

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

The target-file reconciliation change therefore promotes SnowLuma group-file listing to a verified built-in HostProfile capability instead of keeping it adapter-gated.

## PR #39 implementation

- SnowLuma built-in group-file listing is enabled and normalizes upload time.
- Target-file retention reconciles from the live group directory rather than trusting historical pending records.
- A successful live reconciliation replaces stale `pendingCleanup` with actual remaining leftovers.
- Manual “立即检查并整理” first reconciles the managed group root and then requests the Lanzou check.
- If the recorded latest file no longer exists during a manual reconcile, the newest real QQ file by `upload_time` is adopted rather than deleting every file blindly.
- WebUI explicitly states that `/` is an exclusive managed directory and exposes reconciliation status.
- Integration tests use the real `SnowLumaProfile` list/delete path and verify that a failed replacement upload performs no group-file deletion.
- Both the implementation head and the documentation-reconciled head passed the full build, CI, and WebUI browser acceptance suites before repository acceptance.

## Production next action

Production remains on `f1bbc194e3bced122b43f3811432eb6b224b4068` until a later explicitly authorized rollout of the accepted root-reconciliation change. Production acceptance must verify the real QQ group root converges to exactly one file and that local temp cleanup remains correct.
