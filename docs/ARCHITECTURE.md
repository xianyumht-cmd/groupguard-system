# GroupGuard Architecture

## Target-file push pipeline

The target-file push feature spans two runtimes:

1. **Interface service** — monitors the configured Lanzou share, owns the remote directory baseline, detects added/replaced files, resolves a fresh direct URL, and calls GroupGuard.
2. **GroupGuard on SnowLuma** — authenticates the callback, downloads the target file locally, uploads it to QQ group files, reconciles the managed QQ directory, and removes local temp data.

### Data flow

```text
Lanzou share
  -> interface snapshot/diff
  -> target-file-push.v1 callback
  -> GroupGuard temp download
  -> SnowLuma upload_group_file
  -> persist returned new file_id as authoritative latest
  -> SnowLuma get_group_root_files
  -> delete_group_file for every other root file
  -> get_group_root_files again to verify one-file convergence
  -> local temp cleanup
```

For the current deployment, QQ group-file root `/` is an **exclusive managed directory** for this feature. No unrelated user files may be stored there while this ownership contract is active.

### Safety invariants

- GroupGuard never deletes an existing QQ group file before the replacement upload succeeds.
- The new upload's returned `file_id` is persisted as authoritative latest before any old-file deletion starts.
- A complete live QQ directory listing is the source of truth for reconciliation.
- Historical `pendingCleanup` records are compatibility/diagnostic state only; they do not prove what files still exist in QQ.
- After delete actions, GroupGuard re-lists the directory and records actual leftovers.
- A failed replacement upload leaves the existing QQ group directory untouched.
- Local target temp cleanup is independent from QQ group-file cleanup: the retryable current failed local file may remain while obsolete unreferenced local temp files are removed.

### SnowLuma v1.12.4 host contract

`SnowLumaProfile` uses these verified OneBot actions:

- `upload_group_file(group_id, file, name, folder, upload_file)` -> returns `file_id`;
- `get_group_root_files(group_id)` for `/`;
- `get_group_files_by_folder(group_id, folder_id)` for a non-root folder;
- `delete_group_file(group_id, file_id)`.

SnowLuma's `GroupFileApi.list()` performs the underlying paginated `ListGroupFilesPage` loop internally until `isEnd`, so the OneBot list response is treated as complete.

### State ownership

`target-file-push-state.json` owns event/download retry and deduplication state.

`target-file-push-target-state.json` owns the latest successfully uploaded QQ file plus reconciliation diagnostics:

- authoritative `latest` upload record;
- observed leftovers in `pendingCleanup`;
- last reconciliation timestamp;
- last observed managed-file count;
- last reconciliation error.

The QQ directory itself remains authoritative for actual file existence.
