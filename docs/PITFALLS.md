# GroupGuard Pitfalls

Updated: 2026-09-15

This file records recurring failure patterns and the prevention rule, not chat-by-chat history. Current task state belongs in `PROJECT_STATE.md`.

## Do not hide upstream status behind an output-translation catch-all

Observed: 2026-10-19

### Failure pattern

The English localization catch path replaced every non-fast-path Chinese message with one generic English translation-unavailable notice. This could mask a concrete query timeout, authentication error, or a successful yet untranslated response. The production configuration intentionally disables translation without an explicit endpoint, making the ambiguity repeatable.

### Prevention

- Keep business error classification independent from the translator's failure code.
- Never infer a business failure from translation failure alone; for unknown texts, state that the query outcome is unknown.
- Match only short, clearly error-shaped source texts; avoid categorizing arbitrary Q&A or user content with broad keyword matches.
- Never include raw provider errors, query content, CQ codes, URLs, secrets or stored Q&A in fallback messages or logs.
- Test failed translation, provider recovery, forward-node text, ordinary content and protected media separately.
- Do not silently bypass the approved translation-provider privacy boundary.


## Runtime/security behavior is not proved by source-string shape

Observed: 2026-09-15

### Failure pattern

Several verifiers read implementation files as text and required exact strings, source order, or call shape. This produced false-positive CI failures when behavior remained correct, including WebUI authentication/session refactors. It also gave weak security evidence for self-update behavior: the presence of `redirect: 'manual'`, an error string, stage/rollback path text, or an auth call did not prove the unsafe case was actually rejected.

### Prevention

- For runtime/security behavior, prefer execution through a real public boundary: HTTP server, service API, dispatcher, updater entry point, or runtime callback.
- Preserve the intended negative contract: unauthorized callback rejected, repository token not forwarded, hostile ZIP rejected, active `dist` unchanged, rollback restored, etc.
- Keep static assertions only when the contract is genuinely static, such as workflow artifact naming/schema, UI route presence, or explicit worker/supervisor process wiring.
- Never delete a security regression merely because a safe refactor changes source shape; migrate the test to behavior coverage when practical.

## Re-verify current main before reopening an audit finding

Observed: 2026-09-15

### Failure pattern

A stale audit list caused already-fixed GG-AUD-025 and GG-AUD-029 to be revisited after their fixes had landed. Old notes are useful leads, not proof of current state.

### Prevention

- Fetch current `main` before opening a branch.
- Read `PROJECT_STATE.md` and the exact current callsite/test.
- Distinguish original finding, accepted fix, later metadata-only commits, and live production state.
- If the current implementation already closes the finding, record closure evidence instead of creating another fix.

## Node strip-only TypeScript cannot load every production dependency graph

Observed: 2026-09-15

### Failure pattern

PR #73 initially imported the full legacy runtime adapter from a Node 22 `--experimental-strip-types` verifier. A transitive infrastructure class used TypeScript parameter-property syntax (`constructor(private readonly ...)`), causing `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` before the security test could run.

### Prevention

- Keep focused security decisions in side-effect-free/lightweight modules when they need direct Node verifier coverage.
- Use the repository's registered TypeScript loader where appropriate.
- Do not pull the full runtime dependency graph into a tiny verifier solely to test one mapping/decision.
- A test-load failure is not evidence that production behavior is wrong; separate harness incompatibility from the behavior under test.

## CI typechecks must run in the dependency environment they model

Observed: 2026-09-15

### Failure pattern

A single `scripts/**/*.ts` typecheck profile would include Playwright specs even though `@playwright/test` is intentionally installed only inside Browser Acceptance. That creates artificial type failures in normal `npm ci`.

A related test-only mismatch occurred when `Response(Buffer)` worked conceptually at runtime but the DOM/Node `BodyInit` typings rejected `Buffer`.

### Prevention

- Typecheck ordinary Node scripts under the normal project dependency set.
- Typecheck Playwright specs after the Browser Acceptance workflow installs its pinned Playwright version.
- Prefer real compatible data shapes (for example an explicit `ArrayBuffer`) instead of broad type casts or `@ts-ignore`.
- Fix verifier narrowing with real guards/assertions and typed tuples, not blanket `as any`.

## Main HEAD, runtime artifact commit, and live production are different states

Observed: 2026-09-15

### Failure pattern

The plugin release workflow commonly appends `chore: auto-update plugin.json [skip ci]` after an accepted runtime merge. That metadata-only child becomes `main` HEAD but is not the commit named by the already-produced self-update artifact. Separately, neither Git state proves what the ARM runtime is actually running.

### Prevention

- Record the accepted runtime/build commit separately from current `main` HEAD.
- For WebUI update, use the exact successful `main` GroupGuard Build artifact `groupguard-self-update-<runtime-commit>`.
- Treat production version as unknown unless runtime/operator evidence confirms it.
- Never tell the operator a newer commit is live merely because it merged or built successfully.

## An activation-code format is not proof of authorization

Observed: 2026-09-14

### Failure pattern

The legacy group activation flow treated strings beginning with `PRO-30-` or `PRO-PERM-` as paid authority. A recognizable prefix/regex had no signature, server record, replay protection, group binding, expiry authority, or revocation semantics. Loose duration conversion could also turn malformed values into unintended/permanent authorization.

### Prevention

- Format validation is not an authorization decision.
- Paid activation must fail closed unless backed by verifiable authority.
- Until then, use authenticated owner/WebUI authorization paths.
- Parse durations strictly; reject malformed/negative/fractional/unsafe values instead of falling back to permanent state.
- Timer/maintenance sweeps must consume Promise rejections locally and isolate each destination.

## Inbound protocol fields are not automatically authorization facts

Observed: 2026-09-15

### Failure pattern

The initial GG-AUD-027 hypothesis focused on forged OneBot `sender.role`, but sensitive FeatureGate paths already perform live `get_group_member_info` lookup. The real fail-open was malformed identity: missing `group_id` became the literal string `"undefined"` and skipped a paid-license guard in the event pipeline.

### Prevention

- Validate OneBot IDs and event shapes at the protocol boundary and again at sensitive runtime entry points when direct host integrations can bypass the outer normalizer.
- Treat `sender.role` as protocol metadata, not sensitive authorization proof.
- Sensitive admin decisions should use live OneBot role lookup and fail closed on lookup failure.
- Do not stringify malformed objects/arrays/NaN into identities.

## Rendering an inherited value does not authorize persisting it as a group override

Observed: 2026-09-10

### Failure pattern

A group WebUI rendered effective inherited settings and then saved every displayed value, converting inherited values into explicit group ownership. A similar runtime precedence bug used merged/effective group settings to decide whether a group explicitly owned a battle-output override, so inherited values masked the command profile.

### Prevention

- Effective values are preview data, not ownership proof.
- Use raw group settings when deciding whether a path is explicitly overridden.
- `useGlobal=true` makes stored historical group values dormant.
- Preserve unknown/explicit nested fields and compact newly introduced fields against the global baseline.
- Keep WebUI preview precedence aligned with runtime resolution.

## Durable work must be finalized before generic queue early exits

Observed: 2026-09-10

### Failure pattern

A disabled persisted self-recall task could hit dedup/rate-limit early exits before its durable state was finalized, leaving a SQLite row repeatedly due for recovery.

### Prevention

- Evaluate terminal business-state conditions before generic queue exits when those exits do not finalize durable state.
- Persist dedup/rate-limit/admission outcomes for durable tasks.
- Keep a final config check immediately before the external side effect.

## Host-profile unit tests can hide a disabled production capability

Observed: 2026-08-09

### Failure pattern

A service-level test used a fake `HostProfile` that reported group-file deletion success, while the production SnowLuma profile deliberately failed closed because the delete contract was unverified.

### Prevention

- Features depending on host extensions need at least one regression through the actual production `HostProfile`.
- Lock expected action name/parameters and verify the exact host contract where possible.
- Do not infer SnowLuma semantics from NapCat or a fake port.

## Unreferenced failed temp files are not retry state

Observed: 2026-08-09

### Failure pattern

Target-file download failures were preserved even after a newer event replaced the current retryable state. Once no durable state references the old file, it is only an orphan consuming disk.

### Prevention

- Preserve only files referenced by current retryable state.
- Remove unreferenced files from the dedicated temp directory at bind/startup and when superseded.
- Restrict cleanup to updater/service-owned directories.

## Historical group-file IDs are not the source of truth

Observed: 2026-08-09

### Failure pattern

A cleanup queue built from historical upload IDs drifted from the real QQ group directory after manual deletes, failed cleanups, or out-of-band uploads.

### Prevention

- For an exclusively managed directory, treat a complete server-side listing as authoritative.
- Upload replacement first, persist the new authoritative ID, then clean other real files and re-list to verify convergence.
- Derive pending cleanup state from current observation rather than indefinitely appending historical IDs.

## Hidden destructive behavior in WebUI causes product-model confusion

Observed: 2026-08-09

### Failure pattern

Backend group-file retention/cleanup was destructive but the UI described only local temporary-file deletion, hiding external ownership semantics from the operator.

### Prevention

- State destructive external-resource ownership explicitly in the UI.
- Expose ordering and reconciliation state so behavior can be verified without reading backend state files.

## A successful local action request is not a successful business action

Observed: 2026-09-05

### Failure pattern

Callers displayed success or deducted points after enqueueing an action even when the host returned a failed result; shutdown could clear queues before final results settled.

### Prevention

- Treat final `GuardResult.ok` as the business commit boundary.
- Apply irreversible effects only after remote success.
- Stop accepting work, drain bounded queues while transport is alive, then close transport/persistence.

## Callback identity does not establish source ordering

Observed: 2026-09-05

### Failure pattern

Unique event IDs prevented exact duplicate target-file events but allowed an older callback arriving late to replace a newer file.

### Prevention

- Require a positive monotonic source revision.
- Serialize mutations per destination and persist last accepted revision.
- Acknowledge stale revisions without side effects.
- Validate and pin every download URL/redirect hop against private/special networks.

## Self-update must not trust process working directory or a partial artifact manifest

Observed: 2026-09-11

### Failure pattern

A writable cwd did not prove it was the running application root. A manifest that listed only some files could leave extra payload files unverified. Failed verification could also leave stage directories behind.

### Prevention

- Require `process.argv[1]` to resolve exactly to `<workDir>/dist/snowluma-service.mjs` before update mutation.
- Require manifest and extracted `dist` regular-file sets to match exactly, then verify size and SHA-256 for every file.
- Reject traversal/symlinks/unsafe archive entries and enforce size limits.
- Remove guarded updater-owned staging directories on every failure path.
- Keep rollback only until the new worker reports the exact target commit, then clean it through an owned-path guard.
- Verify token forwarding, archive validation, managed entry, completion and rollback with behavior tests, not only source strings.
