# GroupGuard Decisions

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
- Group-file listing remains independently adapter-gated. This task does not broaden list/pagination semantics because they are not required to delete a file whose `file_id` was already captured at upload time.
- Future changes to the production SnowLuma version must re-check this contract if the action semantics change.
