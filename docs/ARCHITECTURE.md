# GroupGuard Architecture

## Query delivery timing observability

The channel-neutral query path carries an internal `query-delivery-timing.v1`
trace without changing the delivery contract or send policy. For queued text
and image deliveries, the boundaries are:

```text
T0 plugin receives command
T1 API request starts -> T2 API response received
T3 delivery plan decoded -> T4 payload ready
T5 task submitted to send queue -> T6 queue worker acquires task
T7 configured risk delay completes -> T8 OneBot action starts
T9 OneBot action returns or throws
```

This makes `T6-T5`, `T7-T6`, and `T9-T8` independently measurable. Existing
forward-node delivery stays on its direct OneBot path and therefore records
T8/T9 without inventing queue timestamps. The trace contains sanitized stage
timestamps and delivery sizes only; it does not carry group identifiers,
message content, credentials, or authentication material.

For image responses, the API additionally returns monotonic relative offsets
for T3 render start, T4 render finish, T5 asset lookup start, T6 asset
availability and T7 API payload preparation/availability. These offsets are
local to the API request because the API and plugin clocks are not treated as
synchronized. GroupGuard records its own T7 payload-preparation start
immediately before converting the validated image envelope into OneBot
segments, while retaining the queue T5/T6/T7 meanings above as separate named
fields.

## Global output localization

GroupGuard treats multilingual output as a final transport concern. The persisted source text remains authoritative; localization is applied immediately before the selected outbound transport sends text.

```text
business service / custom Q&A / query notice
        -> reply templates + outgoing-risk packaging
        -> transport routing
             |- OneBot -> output-locale egress transform -> WebSocket client
             `- Q群管家 -> output-locale egress transform -> Q群管家 text route
```

### Ownership and boundaries

- `config.global.outputLocale` owns the global mode; supported values are `zh-CN`, `zh-TW`, and `en`.
- Missing or invalid values resolve to `zh-CN`, preserving historical behavior.
- `src/services/output_locale_service.ts` owns locale normalization, common local translations, bounded translation cache/in-flight deduplication, and traversal of OneBot text/forward-node payloads.
- `src/services/output_locale_egress_guard.ts` is the runtime safety boundary. It protects URLs, CQ codes, placeholders, code blocks/spans, and Windows/POSIX paths before Traditional conversion and applies context-sensitive Traditional fixups without blindly changing ambiguous characters such as `后` in `皇后`.
- `src/services/output_translation_policy.ts` owns the external-translation privacy/fallback policy used by runtime egress.
- `src/standalone/onebot_action_caller.ts` is the final SnowLuma/generic-OneBot hook. Only send-message actions are transformed; unrelated OneBot actions pass through.
- `src/core/state-infra/plugin_state_context_adapter.ts` localizes the copy offered to Q群管家 before its alternate transport can bypass the OneBot caller. If Q群管家 falls back, the untouched original message continues to OneBot and is localized there exactly once.
- `src/reply_generator.ts` does not add Simplified-Chinese persona wrappers in non-`zh-CN` modes; final egress still remains the authoritative coverage layer.
- `src/standalone/admin/output_locale_webui_patch.ts` exposes the global selector without changing command recognition or rewriting stored Q&A.

### Localization invariants

- Only natural-language text is localized.
- Image/file/audio/video segments and their payloads remain untouched.
- URLs, CQ codes, template placeholders, code spans/blocks, and file paths are protected from translation/conversion and restored byte-for-byte.
- Custom Q&A and other administrator-authored source strings are never rewritten in config/SQLite; changing locale is reversible because conversion happens at send time.
- Forward nodes localize only their text content; node identity fields are preserved.
- Repeated arbitrary translations use a bounded in-memory cache and in-flight deduplication.
- Built-in high-frequency notices use local fast paths so common rate-limit, permission, and Q&A-link messages do not depend on a network translator.
- If arbitrary English translation is unavailable, runtime egress emits an English availability message rather than leaking Chinese into an explicitly English bot. Traditional mode retains deterministic local conversion/fixups as its offline fallback.

### External translation data boundary

Arbitrary natural-language text that cannot be satisfied by local fast paths may leave GroupGuard for machine translation. Protected spans are replaced with opaque `__GG...__` tokens before external translation, so raw URLs, CQ payloads, code, placeholders, and protected paths are not intentionally transmitted as their original values. The surrounding natural-language message still leaves the runtime and must be treated as externally processed data.

Runtime provider policy is deliberately explicit:

1. If `GROUPGUARD_TRANSLATE_ENDPOINT` is **unset**, the built-in public chain is enabled: the default LibreTranslate endpoint is tried first, then MyMemory as public fallback.
2. If `GROUPGUARD_TRANSLATE_ENDPOINT=off` (or is explicitly set empty), network translation is disabled. No public fallback is attempted.
3. If `GROUPGUARD_TRANSLATE_ENDPOINT` is an explicit custom/private URL, only that endpoint is used by default. Failure does **not** silently send the same text to a public service.
4. Public fallback from a custom/private endpoint is allowed only when `GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK=1|true|yes|on` is explicitly configured.
5. `GROUPGUARD_TRANSLATE_API_KEY` is sent only to the configured/default Libre-style POST endpoint; it is not sent to MyMemory.

The Libre/custom POST request has an approximately 3.5-second timeout. MyMemory public fallback has an approximately 2.5-second timeout and rejects oversized payloads above its local limit before sending. Provider failures are not persisted as message data. Successful arbitrary translations are cached in memory only and the cache is bounded.

This external dependency is intentionally isolated behind `output_translation_policy.ts` so security/operations work can audit whether a deployment permits public egress without searching business command implementations.

## Configuration ownership and effective resolution

GroupGuard configuration has three explicit layers instead of treating one settings object as all three at once:

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

- no group row: the group inherits the normalized global settings;
- explicit `useGlobal=true`: whole-group inheritance; stored group overrides remain dormant and are not deleted;
- an existing historical row with no `useGlobal` field remains an active overlay for backward compatibility;
- `useGlobal=false`: global settings are the base and the stored sparse group overlay is recursively deep-merged over them;
- missing/`undefined` means inherit;
- `false`, `0`, and empty string are valid explicit overrides;
- plain objects merge recursively; arrays are atomic and a group array replaces the global array;
- dynamic config paths reject `__proto__`, `prototype`, and `constructor` segments.

The canonical implementation lives in `onebot-plugin-groupguard/src/config_effective.ts`. Both `configStateService.resolveGroupSettings()` and legacy `PluginState.getGroupSettings()` must resolve through the same effective-config implementation; the PluginState adapter is a compatibility bridge while old call sites remain.

### Migration compatibility

Historical SQLite group rows may contain full snapshots produced by older normalization behavior. The system must not guess that values equal to global defaults are safe to delete, because they may have been deliberate administrator overrides. Existing stored paths therefore remain explicit. New broad-form writes only compact newly introduced values that merely repeat the current global value.

Field inheritance is restored by deleting that exact override path. This is deliberately different from copying the current global value into every group: deletion means future global changes continue to propagate.

A `useGlobal=true` legacy row may contain dormant historical overrides. A single-field bulk `set-path` must neither erase nor silently reactivate those unrelated values. Such rows are skipped and reported when a safe single-field override cannot be created without changing dormant semantics. `restore-path`, by contrast, removes only its requested path and preserves every other dormant value.

### Admin API/UI model

The admin group endpoint exposes four views for one group: `global`, stored sparse `group`, runtime `effective`, and a leaf-level `sources` map (`global` or `group`).

The admin surface distinguishes three operations:

1. **restore field inheritance** — delete one group override path so that field follows global now and in the future;
2. **write explicit group override** — set one path to a fixed group value without replacing unrelated overrides;
3. **whole-group inheritance** — set `useGlobal=true`, temporarily making all stored group overrides dormant without deleting them.

These operations are intentionally separate because they have different persistence and future-propagation semantics.

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
