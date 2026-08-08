# GroupGuard Decisions

## 2026-08-09 — Target-file push owns the managed QQ group-file root and reconciles from the live directory

### Decision

For the dedicated target-file push group, QQ group-file root `/` is an exclusive managed directory. The product invariant is that, after a successful replacement upload and reconciliation, the root contains exactly one file: the newest successfully uploaded target file.

The retention algorithm is:

1. upload the replacement first;
2. persist its returned `file_id` as authoritative latest;
3. call the verified SnowLuma group-file list action for the managed directory;
4. keep the authoritative latest `file_id` and delete every other listed file;
5. re-list and verify the directory converged to one file;
6. only then finish normal local-temp cleanup.

The existing `pendingCleanup` field remains for backward-compatible state loading and diagnostics, but successful reconciliation replaces it from the latest real directory observation. It is no longer the source of truth for what files exist in QQ.

The WebUI fixes `targetFolderId` to `/` for this deployment model and explicitly warns that the root is exclusively managed.

### Evidence

Official SnowLuma `v1.12.4` source provides:

- `get_group_root_files` -> `ctx.getGroupFiles(group_id, '/')`;
- `get_group_files_by_folder` -> `ctx.getGroupFiles(group_id, folder_id)`;
- `GroupFileApi.list()` loops `ListGroupFilesPage` internally until `isEnd`, so the OneBot action returns a complete directory snapshot;
- `delete_group_file` awaits `groupFile.delete(group_id, file_id)`.

Production observation showed that a historical `pendingCleanup` queue could diverge from the real QQ directory, especially after manual file deletion. Multiple group files remained despite retention retries, demonstrating that historical IDs alone were not a sufficient correctness model.

### Reason

The actual product requirement is a directory invariant, not successful processing of a local retry queue. Reconciling from the real server directory makes manual deletions, stale queue entries, and previously unknown extra files self-healing.

### Consequences

- SnowLuma `groupFileList` is now a verified built-in HostProfile capability for v1.12.4.
- A failed replacement upload performs no group-file deletion.
- The first successful replacement upload can remove pre-existing files from the exclusive root even if GroupGuard never recorded their IDs.
- Manual “立即检查并整理” can repair drift without waiting for another Lanzou update. If the recorded latest file is absent, it adopts the newest real file by `upload_time` before deleting anything.
- This decision supersedes the earlier consequence that SnowLuma group-file listing should remain adapter-gated for target-file retention. That earlier restriction was appropriate before the exact v1.12.4 list implementation was verified.
- This exclusive-root rule must not be reused for a group/folder containing unrelated user files unless the ownership contract is changed first.

## 2026-08-09 — Enable built-in SnowLuma group-file deletion from the verified v1.12.4 contract

### Decision

`SnowLumaProfile.deleteGroupFile()` has a built-in production implementation for SnowLuma using the OneBot action:

```text
delete_group_file
  group_id
  file_id
```

`folder_id` and `busid` are not forwarded. An explicit `deleteGroupFile` profile option may still override the built-in implementation for controlled tests or alternate host integration.

### Evidence

Official SnowLuma `v1.12.4` source defines `delete_group_file` with `file_id` as its action parameter, obtains `group_id` from the group action wrapper, awaits `ctx.bridge.apis.groupFile.delete(p.group_id, p.file_id)`, then returns an OK response.

GroupGuard's OneBot WebSocket client resolves an action only for an OK response/zero retcode and rejects failed or timed-out actions, so a resolved `delete_group_file` call is sufficient host-level confirmation for this contract.

### Reason

Target-file retention requires deletion of the previously uploaded QQ group file. Keeping SnowLuma deletion permanently fail-closed caused every previous file to accumulate in `pendingCleanup` even though the production SnowLuma version already exposes a defined delete action.

### Consequences

- SnowLuma group-file delete capability is now reported as supported.
- Target-file retention can drain its existing pending queue once the repaired build is later deployed.
- Group-file listing was initially kept independently adapter-gated because that repair did not require list semantics. The later live-directory reconciliation decision above supersedes that restriction after the exact v1.12.4 pagination behavior was verified.
- Future changes to the production SnowLuma version must re-check this contract if the action semantics change.
