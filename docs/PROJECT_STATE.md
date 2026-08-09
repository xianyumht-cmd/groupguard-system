# GroupGuard Project State

Updated: 2026-08-09

## Canonical repository

- Canonical development branch: `main`.
- Target-file live-root reconciliation change record: PR #39 -> `main`.
- PR #39 was merged as `d54a5ad9dac63f85db9bda1a8a6b6137f03e9712` after GroupGuard Build, GroupGuard CI, and WebUI Browser Acceptance all passed on the final PR head.
- `main` then advanced to `b5d09d2287a937046c918353fbbcd3785650294a` via the repository's automatic `plugin.json` update; that auto-update changed only `plugin.json` relative to the PR #39 merge.
- Production rollout evidence was recorded by PR #40 -> `main`.

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

## Production acceptance

Production acceptance is complete for the exclusive-root reconciliation behavior.

Observed after running WebUI `立即检查并整理`:

- the real QQ group-file root converged from multiple files to exactly one file;
- the remaining file was the latest intended target file;
- subsequent observation did not reveal a functional problem with the one-file retention behavior;
- the earlier WebUI `GroupGuard 回调失败 HTTP 502` message did not prevent the group-file reconciliation itself from succeeding and was not reproduced as a blocking functional defect during observation.

The accepted production invariant is therefore:

> The target group-file root `/` is exclusively managed by this feature and converges to exactly one authoritative latest file.

## Current target-file design decision

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

## Next action

No further change is required for this target-file retention task unless a new production symptom appears. If the earlier HTTP 502 message becomes reproducible or affects later uploads/checks, diagnose the callback/check path separately without changing the already-accepted root reconciliation behavior.
