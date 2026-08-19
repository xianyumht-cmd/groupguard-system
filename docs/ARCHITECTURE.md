# GroupGuard Architecture

## Configuration ownership and effective resolution

GroupGuard configuration now has three explicit layers instead of treating one settings object as all three at once:

```text
config.json -> global full defaults
SQLite group_config -> sparse per-group overrides
                 \      /
                  deep merge
                     |
                     v
effective group config -> runtime-only resolved settings
```

### Sources of truth

- `config.json` / `config.global` owns the complete global defaults.
- SQLite `group_config` owns persistent per-group overrides.
- `config.json.groups` is not an independent source of truth during normal persistence; the persistence guard keeps it empty while SQLite owns group rows.
- Effective settings are computed at runtime and are never persisted as another full snapshot.

### Inheritance semantics

- `useGlobal=true`: the group uses the normalized global settings. Stored group overrides remain dormant and are not deleted.
- `useGlobal=false`: the normalized global settings are the base and the stored sparse group overlay is recursively deep-merged over them.
- Missing/`undefined` means inherit.
- `false`, `0`, and empty string are valid explicit overrides.
- Plain objects are merged recursively; arrays are atomic and a group array replaces the global array.
- Dynamic config paths reject `__proto__`, `prototype`, and `constructor` segments.

The canonical implementation lives in `onebot-plugin-groupguard/src/config_effective.ts`. Both `configStateService.resolveGroupSettings()` and legacy `PluginState.getGroupSettings()` must resolve through the same effective-config implementation; the PluginState adapter is a compatibility bridge while old call sites remain.

### Migration compatibility

Historical SQLite group rows may contain full snapshots produced by older normalization behavior. The system must not guess that values equal to global defaults are safe to delete, because they may have been deliberate administrator overrides. Existing stored paths therefore remain explicit. New broad-form writes only compact newly introduced values that merely repeat the current global value; administrators can explicitly remove one override path with “恢复继承”.

### Admin API/UI model

The admin group endpoint exposes four views for one group: `global`, stored sparse `group`, runtime `effective`, and a leaf-level `sources` map (`global` or `group`). Field-level batch operations can set one path across all or selected groups without replacing unrelated overrides. Whole-group inheritance remains a separate operation because it changes the behavior of every group field at once.

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
