# GroupGuard Pitfalls

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
