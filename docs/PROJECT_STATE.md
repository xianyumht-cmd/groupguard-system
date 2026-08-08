# GroupGuard Project State

Updated: 2026-08-09

## Canonical repository

- Canonical development branch: `main`.
- Target-file live-root reconciliation change record: PR #39 -> `main`.
- PR #39 was merged as `d54a5ad9dac63f85db9bda1a8a6b6137f03e9712` after GroupGuard Build, GroupGuard CI, and WebUI Browser Acceptance all passed on the final PR head.
- `main` then advanced to `b5d09d2287a937046c918353fbbcd3785650294a` via the repository's automatic `plugin.json` update; that auto-update changed only `plugin.json` relative to the PR #39 merge.

## Verified production state

The ARM GroupGuard runtime at `192.168.3.89` was successfully deployed on 2026-08-09 at about 05:02 +08:00 to:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- root-reconciliation WebUI markers: verified
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`
- deployment report status: `completed`

Deployment pre/post state:

- historical `pendingCleanup`: `0 -> 0`
- local target temp files: `0 -> 0`
- local target temp bytes reported by directory metadata: `4096 -> 4096`
- `current.localPath`: empty before and after deployment
- business root reconciliation was intentionally **not** triggered by the deployment script

The deployment therefore proves the new build is live and the authenticated admin/UI checks pass, but it does not by itself prove that real QQ group-file deletion converges the root to one file. That destructive business acceptance remains a separate manual step.

## Current target-file design decision

The target group uses the QQ group-file root directory `/` exclusively for this feature. The desired invariant is:

> After a successful replacement upload or an explicit manual reconciliation, the managed group-file root contains exactly one file: the newest authoritative target file.

The production implementation uses live reconciliation:

1. detect a new/replaced Lanzou file;
2. download it to the GroupGuard temp directory;
3. upload the replacement QQ group file first;
4. persist the returned new `file_id` as authoritative latest;
5. read the real QQ group-file root through SnowLuma;
6. keep the authoritative new `file_id` and delete every other root file;
7. re-list the root and verify it converged to one file;
8. remove the local temp file after upload processing completes.

No QQ group file is deleted before a replacement upload succeeds.

Manual `立即检查并整理` can reconcile the existing root without waiting for a new Lanzou upload. It first uses the recorded latest file when that file still exists; if the record is stale or missing, it adopts the newest actual QQ root file by `upload_time`, then deletes the other root files and verifies convergence.

## Verified SnowLuma contracts

Against official SnowLuma `v1.12.4` source:

- `upload_group_file` returns `file_id`;
- `get_group_root_files` reads the root directory;
- `get_group_files_by_folder` reads a specified folder;
- the underlying `GroupFileApi.list()` performs its own pagination loop until `isEnd`, so the OneBot list action is a complete snapshot;
- `delete_group_file` accepts `group_id + file_id` and awaits the delete operation.

The production target-file reconciliation therefore uses SnowLuma's built-in list + delete path rather than treating historical pending IDs as the authoritative group-directory state.

## Production acceptance next action

Refresh the GroupGuard WebUI and run `立即检查并整理` once against the intentionally retained QQ root files. Production acceptance is complete only after verifying:

- the real QQ group-file root converges to exactly one file;
- the kept file is the intended latest authoritative file;
- WebUI reconciliation status reports success with no remaining cleanup items;
- no local target temp file is left behind by the reconciliation path.

If the root does not converge, capture the WebUI reconciliation error and the relevant GroupGuard/SnowLuma log entries before doing further manual deletion so the list/delete contract can be diagnosed from real production evidence.
