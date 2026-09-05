# GroupGuard Decisions

## 2026-08-28 — Battle query uses an image feature default without inventing group overrides

### Decision

`查战绩` resolves its preferred delivery from explicit configuration ownership rather than from the already-merged effective group object:

1. an active raw group `lolQueryOutputFormat` override wins;
2. `queryCommandProfiles.lol_battle.outputFormat` wins next;
3. if neither is present, the battle feature default is `image`.

A group row with `useGlobal=true` does not participate as a group override even if dormant historical values remain stored in that row. Other query families keep their existing output defaults; this decision does not globally change `global.lolQueryOutputFormat`.

### Reason

The effective group resolver fills inherited fields from global defaults. Using that merged object to detect an explicit group preference made an inherited `forward` look like group intent and prevented the battle profile/default from being reached. The API already supports image delivery and the battle request advertises `capabilities.image=true`, so the correct fix is preference ownership and feature defaulting, not an API rendering workaround.

### Consequences

- Battle queries default to image without changing unrelated query output defaults.
- An explicit per-group text/forward/image value still overrides the battle feature.
- An explicit battle command profile still overrides the feature default.
- `useGlobal=true` cannot accidentally revive stale group output values.
- SnowLuma query WebUI must show the same battle precedence/default as runtime.
- Production deployment/restart remains a separate explicitly authorized operation.

## 2026-08-27 — Global output locale is an egress concern, not an input-command or image concern

### Decision

GroupGuard has one global output-locale setting at `config.global.outputLocale` with three supported values: `zh-CN` (default), `zh-TW` (Traditional Chinese), and `en` (English).

The setting changes only user-visible bot text. Input command recognition remains unchanged, and image/file payloads are never translated. User-defined Q&A, welcome text, link notices, query/rate-limit messages, template output, and forward-node text are localized only when they leave the bot; their persisted source values remain unchanged.

Localization is enforced at the final OneBot action egress (`OneBotActionCaller`) so text added late by reply templates or outgoing-risk packaging cannot bypass the selected output locale. URLs, CQ codes, placeholders, paths, and code spans/blocks are protected. Repeated translations are cached. Built-in high-frequency messages have local fast paths; arbitrary custom Simplified-Chinese text can use the configured translation endpoint, with a second public provider fallback. English mode fails closed with an English availability notice rather than leaking Chinese if all translation providers fail. Traditional mode has a local Simplified-to-Traditional fallback.

### Reason

The dominant multilingual use cases are Q&A and textual query/system notices, while most query results are images and do not need localization. Localizing individual business functions would leave hidden prompts such as Q&A link notices, template prefixes, outgoing-risk notices, and future direct sends uncovered. Rewriting stored Q&A would also make later language switching lossy.

### Consequences

- Existing installations remain behavior-compatible because missing/invalid `outputLocale` resolves to `zh-CN`.
- The WebUI exposes one global selector for Simplified Chinese, Traditional Chinese, and English.
- Custom Q&A remains authored/stored once and is converted only at send time.
- First-time arbitrary English/Traditional custom content may incur translation latency; cache hits and built-in system messages avoid that network path.
- Translation-provider availability affects unseen arbitrary custom English content, but does not change stored data or image/query payloads.
- Per-group output-language overrides are intentionally not part of this first version.

## 2026-08-27 — Dual-host deployment reuses the existing single-host safety workflow

### Decision

The one-click `DEPLOY-GROUPGUARD-89-121.cmd` launcher deploys sequentially to `192.168.3.89` and `192.168.3.121` by invoking the existing audited `scripts/windows/groupguard-update.ps1` once per host. The application directory, backup root, container name, code-only switch, exact-build health verification, and automatic restoration semantics remain owned by the single-host workflow rather than being duplicated.

### Reason

The user needs one local action to update both ARM runtimes. Reusing the existing release path keeps backup, rollback, path-validation, and health-check behavior identical on both hosts and avoids a second independent deployment implementation.

### Consequences

- 89 must complete successfully before the wrapper starts 121.
- If 121 fails after 89 succeeds, the wrapper reports the partial state explicitly; the failed host still uses the single-host automatic restoration path.
- Runtime config, SQLite/data, logs, credentials, and secrets remain untouched on both hosts.
- Production deployment still requires current-task user authorization; this decision only defines the mechanism.

## 2026-08-19 — Separate global defaults, sparse group overrides, and effective runtime config

### Decision

GroupGuard configuration is defined as three different concepts:

1. `config.global`: complete global defaults;
2. SQLite `group_config`: sparse per-group overrides;
3. effective group config: runtime-only deep-merged result.

No group row means whole-group global inheritance. Explicit `useGlobal=true` also means whole-group inheritance and does not delete dormant overrides. `useGlobal=false` means global defaults plus the stored group overlay. For backward compatibility, an existing historical row with no `useGlobal` field remains an active group overlay rather than being reinterpreted as whole-group inheritance.

Missing fields inherit; explicit `false`, `0`, and empty string remain overrides. Nested objects deep-merge and arrays replace atomically.

### Reason

The old model reused `GroupGuardSettings` as global configuration, persisted group configuration, and final runtime configuration. Together with top-level shallow merge and normalization of stored group rows, this could turn omitted fields into accidental overrides and make later global changes stop propagating.

### Consequences

- Runtime resolution is centralized in `src/config_effective.ts` and shared by state-service and PluginState call paths.
- Existing historical SQLite paths are preserved as explicit values; migration does not infer administrator intent merely from value equality.
- New broad-form writes may compact only newly introduced values that equal the current global value.
- Administrators explicitly remove one group override path with “恢复继承”.
- The WebUI exposes global, group, effective, and source information separately.

## 2026-08-19 — Field inheritance, explicit group override, and whole-group inheritance are three different operations

### Decision

The admin model distinguishes:

1. **restore field inheritance** — delete one group override path; the field follows current and future global changes;
2. **write explicit group override** — set one group path to a fixed value; future global changes do not replace it;
3. **whole-group inheritance** — `useGlobal=true`; every stored group override becomes dormant without being deleted.

For the original `qaLinkDelivery.enabled` mismatch, the preferred bulk repair is `restore-path(qaLinkDelivery.enabled)`, not copying the current global boolean into every group.

A `useGlobal=true` historical row may contain dormant old overrides. A single-field `set-path` must not delete or silently activate those unrelated values. When that operation cannot be performed without changing dormant semantics, the group is skipped and returned in `skippedDormantGroupIds`. A `restore-path` remains safe because it removes only the requested path.

### Reason

Copying a global value into every group looks correct today but actually creates fixed per-group overrides and prevents later global changes from propagating. Using `useGlobal=true` merely to synchronize one field is also too broad because it changes every field for that group. Dormant historical values add a third risk: automatically switching the group back to active overlay mode could unexpectedly reactivate unrelated old settings.

### Consequences

- “恢复该字段为全局继承” is the normal bulk tool when the administrator wants future propagation.
- “将目标值写成分群覆盖” intentionally creates fixed group values and reports protected dormant rows instead of hiding data loss.
- “全部群完全继承全局” is clearly labeled as a whole-group mode change.
- Dynamic dotted paths reject prototype-pollution segments.

## 2026-08-19 — Production deployment is code-only, backup-first, and rollbackable

### Decision

The Windows deployment workflow builds and tests on the Windows development host, then deploys only the built GroupGuard `dist` to `192.168.3.89`. It must create a timestamped production backup and deployment manifest before switching code, must not overwrite runtime `config.json`, SQLite/data, logs, or secrets, and must automatically attempt restoration when post-switch health verification fails.

A separate one-click rollback launcher restores the last recorded code backup.

### Reason

The ARM host is production state, not a build workspace. Keeping build/test local and making the remote operation code-only lowers the chance of configuration/data loss and makes a failed release recoverable without reconstructing the previous version manually.

### Consequences

- The deployment target is `groupguard-snowluma` under the recorded production application directory.
- Native SSH process exit codes are authoritative; PowerShell 5.1 stderr text alone is not treated as failure.
- Deployment helpers are designed to be resume-safe and manifest-backed.
- Production deployment/restart still requires explicit user intent at execution time.

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

## 2026-09-05 — Reliability work is bounded, ordered and drainable

### Decision

Every long-lived in-memory queue, cache, waiter set and external request path must have a hard capacity, expiry or retention rule, observable rejection/failure semantics, and a shutdown owner. OneBot events are processed in receive order; action and file work is drained before transports close.

Target-file callbacks additionally require a positive monotonic `source_revision`. Revisions at or below the last accepted value are stale no-ops. Download URLs and every redirect hop reject credentials and private, loopback, link-local or special-use addresses by default.

### Reason

Deduplication alone did not prevent stale replacement, and unbounded Promise tails/caches turned temporary downstream slowness into process-wide memory risk. Closing transports before work settled could also convert an orderly restart into silent data loss.

### Consequences

- Callback producers must send `source_revision` and retry the same revision for the same source version.
- Local/private download targets are rejected in production; the private-download override is test-only and must not be enabled in deployed service configuration.
- Overload is explicit backpressure rather than unlimited buffering.
- Shutdown has a finite drain deadline and reports work that cannot settle.

## 2026-09-05 — Network translation requires explicit operator consent

### Decision

When `GROUPGUARD_TRANSLATE_ENDPOINT` is unset, network translation is disabled. A configured endpoint enables that endpoint; public fallback requires the separate explicit `GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK` opt-in. Translation calls share a global concurrency limit.

### Reason

Administrator-authored and user message text must not be sent to a public service merely because an output locale was selected.
