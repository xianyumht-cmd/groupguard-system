# GroupGuard Project State

Updated: 2026-09-15

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical development branch: `main`.
- Runtime/code baseline accepted by this audit: `450c1d452856837c7f4f64cbc9081d00d52938eb` (merge of PR #81).
- At the start of the current GG-AUD-004/005 round, `main` was `0fc827e097a117c793f29288b23a6e6b554bcf42`, the documentation-only merge of PR #82. Always re-fetch current `main` in a new session because later audit merges or automated metadata commits may advance it without changing the live production runtime.
- Latest verified `main` workflows for runtime commit `450c1d45...` all succeeded:
  - GroupGuard CI #899;
  - GroupGuard Build #903;
  - Build SnowLuma Service #128;
  - Build & Release Plugins #193.
- Latest verified WebUI self-update artifact:
  - `groupguard-self-update-450c1d452856837c7f4f64cbc9081d00d52938eb`;
  - artifact id `10389353831`;
  - SHA-256 `db51b08e88fbd992dec144ed2340c29b5276d018eb9c463a532a7fda80454da9`;
  - expires 2026-10-15.
- Matching deployment bundle:
  - `groupguard-deployment-bundle-450c1d452856837c7f4f64cbc9081d00d52938eb`;
  - artifact id `10389453389`;
  - SHA-256 `f0861749019ab5db244688c2e0e0075715575c82992ddd318ebb89ab6977eef2`.
- Matching build log artifact id `10389562944`, SHA-256 `c4f1fbf0339ecdc400edad9d7b1aca33785294952564cddf56df31fd0cfa0eee`.

### Production/runtime evidence boundary

- The operator last explicitly confirmed the live runtime at `9318d86415cbb726b022511d11d6a598b4237216` after a successful WebUI one-click update.
- No later audit round deployed, restarted, or otherwise mutated the production ARM runtime.
- Therefore **do not claim that production is running `450c1d45...`, `0fc827e...`, or any intermediate audit commit**.
- The audit strategy is intentionally to accumulate reviewed fixes and perform one later WebUI one-click upgrade, not one production update per PR.
- Production/runtime state remains separate from GitHub `main`, the Windows checkout `D:\project2\groupguard-system`, and Actions artifacts.

### Repository hygiene snapshot

- A 2026-09-15 branch inventory returned 33 remote branches including `main`; many already-merged audit/feature branches remain. Branch cleanup is not complete. Do not delete branches without verifying that their unique history is already reachable from `main` or safely archived.
- PR #56 (`perf: trace queued query delivery stages`) is still open and is independent of this security/code-quality audit. Do not merge, close, or fold it into an audit task without fresh review.

## 2026-09-14 to 2026-09-15 audit campaign

The campaign started from a repository-wide review using current code as the source of truth and adapting ideas from high-signal public agent/review projects (TDD/YAGNI/systematic debugging, explicit reviewer/security roles, repository-local skills/instructions). External patterns are guidance only; repository code, tests, CI, and runtime evidence decide findings.

Working rule for this campaign: one medium issue end-to-end per user `继续` round (or two tightly related small items), including current-main inspection, fix/test when warranted, PR, CI/Build, merge, main verification, and artifact verification. Do not start a second unrelated issue in the same round. Production stays unchanged until the final batched update.

## Completed security/reliability findings

| ID | Final result | PR / accepted runtime commit |
| --- | --- | --- |
| GG-AUD-019 P0 | Prefix-only `PRO-30-*` / `PRO-PERM-*` activation was not authorization. Legacy group activation now fails closed; owner/WebUI authorization remains. | #64 / `9318d86415cbb726b022511d11d6a598b4237216` |
| GG-AUD-026 P2 | Loose duration parsing could turn malformed values into unintended/permanent authorization. Positive integer days or explicit permanent semantics are now required. | #64 / `9318d864...` |
| GG-AUD-001 | `AuthManager` timer/send rejection could reach fatal process-level `unhandledRejection`. Production fix was already in #64; PR #75 added behavior-level regression coverage for the real timer callback and cleanup. | #64 + #75 / `e59d6fbeac03fb2f67e20e2beb1dd5e9ee4aa1b7` test baseline |
| GG-AUD-021 P1 | `/api/query/test` authenticated SSRF/unbounded response read. Arbitrary custom URL/headers and one-shot URL overrides are rejected; configured targets only, manual redirects, bounded streaming body. | #66 / `d229730139b3ae3f3372b90a5ffeeddb9fb35850` |
| GG-AUD-022 P1 hardening | Target-file DNS validation had lookup/fetch TOCTOU. Each redirect hop is resolved, validated and socket-pinned; redirects re-pin. | #67 / `cf8cd85484304cf971360ebd8b7a114a480319a9` |
| GG-AUD-023 P2 | Cookie-authenticated mutating WebUI requests lacked explicit Origin/CSRF enforcement. Same-host Origin is required for unsafe cookie-auth methods; explicit token clients remain supported. | #68 / `6b960a3c6c72236ca1a4e742de9f2b27992c55ad` |
| GG-AUD-024 P2 | SUB resource path validation was lexical only and allowed symlink escape. Realpath containment + regular-file requirement added. | #69 / `a57dae9b3a1130e6b798531dc06bcc4bd361fe8c` |
| GG-AUD-029 P2 | Lanzou validation used substring matching. Replaced with explicit supported roots plus exact/subdomain boundary and HTTP(S) requirement. | #70 / `1c622c573e1782baa93a36799f25ed37a4e1ffa6` |
| GG-AUD-025 P1 | A valid stored `free` license satisfied paid group runtime gates. Canonical paid-license check now requires at least Pro; explicit Enterprise minimum is supported. | #71 / `9bc936b19ab86e2bc14c148505a47de6916528a2` |
| GG-AUD-028 P2 | Browser cookie stored the full WebUI master token. Browser now receives an opaque HMAC-signed 8-hour session; Bearer/X-token master auth remains; 15-minute legacy-cookie migration supports first upgrade. | #72 / `a315aa87fc54cf244b5c6bf09b3e652e569eb155` |
| GG-AUD-020 | Legacy auth descriptor `owner/admin` was downgraded to FeatureGate `all`. Side-effect-free mapper now converts it to `admin`; inner authorization checks remain defense in depth. | #73 / `338ef647d12fd650da4f8f58d29c0c8663a5ff20` |
| GG-AUD-027 | Initial hypothesis that forged `sender.role` could directly elevate sensitive commands was disproved: FeatureGate uses live `get_group_member_info`. The real flaw was malformed group identity: missing `group_id` became literal `"undefined"` and could skip a license guard. OneBot IDs/event shapes and both runtime pipelines now fail closed. | #74 / `123c289304a3daa60b2f25333fbc8bdb45ac0d47` |

All items above were merged only after PR validation and then re-verified on their corresponding `main` push. Do not reopen one solely from the original audit note; first inspect current `main` and this tracker.

## Completed code-quality/test-infrastructure work

| ID | Final result | PR / accepted runtime commit |
| --- | --- | --- |
| GG-AUD-002 | Repository had no dedicated lint gate. Added a no-dependency semantic TypeScript control-flow gate using `tsconfig.lint.json` with `noImplicitReturns` + `noFallthroughCasesInSwitch`. This is a stable first-stage gate, **not** a claim of full typescript-eslint coverage. | #76 / `26e1b47711a441c9dd3aea2e2bb18c764ce8fd74` |
| GG-AUD-003 | `scripts/**/*.ts` were outside TypeScript checking. Added separate Node-script and Playwright browser-test typecheck profiles, each executed in the dependency environment where it is valid. | #77 / `291fa681275c7a94986a4e50880a522d3e602a7c` |
| GG-AUD-004/005 target-file hotspot | Target-file callback test used source-order/string matching and had previously produced false-positive CI failures after safe auth refactors. Replaced that hotspot with real HTTP behavior: callback token works without WebUI master token; WebUI master token cannot substitute for callback token. | #78 / `1c5a39237562d2b9f6dd7b57e5ee8a1eccfb9c12` |
| GG-AUD-004/005 WebUI hotspot | `verify-webui-ios-glass.ts` required exact `server.ts`/theme call-expression strings, so semantics-preserving rewrites could fail despite identical client-visible HTML. PR #83 replaces that WebUI server/theme source-shape cluster with authenticated temporary-port HTTP behavior over the actual admin routes. Production code is unchanged; the separate group-API source checks remain scoped for later classification. Initial PR validation passed GroupGuard CI #901 and GroupGuard Build #905 before this state-document update. | #83 / test-only; runtime baseline unchanged |
| GG-AUD-011 | Self-update security contract had important source-string tests. Download token-boundary, hostile ZIP/manifest, managed-runtime, completion and rollback paths are now behavior-tested through public runtime APIs. Static checks remain only where they describe real build/UI/process wiring contracts. GG-AUD-011 is closed. | #79 `44221560a65514bf51f4b97c0306ca8a260ec57e`; #80 `f2eccb4f3fa6053fab2fd12941778d22d5388bbc`; #81 `450c1d452856837c7f4f64cbc9081d00d52938eb` |

### GG-AUD-011 behavior coverage now proves

- GitHub repository token is sent to GitHub API/artifact REST hops but not to the signed HTTPS download URL.
- Non-HTTPS artifact redirects are rejected before the second-hop request.
- ZIP traversal entries, forged manifest SHA-256, and extra unlisted `dist` files are rejected before active `dist` switching.
- Failed archive/manifest validation preserves active `dist`, cleans staging, and creates no rollback directory.
- An unmanaged runtime entry is rejected before GitHub fetch, staging, rollback creation, or `dist` mutation.
- The exact managed `dist/snowluma-service.mjs` entry is recognized.
- Supervisor completion rejects a wrong worker commit and preserves rollback state.
- Correct worker commit marks the update complete and cleans only the updater-owned rollback path.
- Pending rollback restores the previous `dist`, removes the failed candidate, and records `rolled_back`.
- Rollback paths outside the app-owned prefix are rejected without mutation.
- Exit code `75` remains the explicit worker/supervisor self-update restart contract.

### GG-AUD-004/005 source-text inventory classification

- Behavior-critical and clearly brittle next candidate: `scripts/verify-four-query-three-mode.ts` still infers query preference behavior from whether runtime source literally contains `preferred: 'text'`; equivalent refactors can change that text without changing the request payload or resolved output mode.
- Still requiring a bounded decision: the remaining `group_api.ts` exact-source checks in `verify-webui-ios-glass.ts`, the unrelated source tail in `verify-project-wide-bugfixes.ts`, and output-locale adapter call-shape checks.
- Likely legitimate static contracts unless contrary evidence appears: retired hidden/video marker sweeps, client-boundary bans on direct `fetch`/business URLs, and deployment/workflow packaging or rollback wiring checks. Do not mechanically convert or delete these merely because they inspect source text.

## Failed/abandoned approaches and why

These are evidence from this campaign and should not be repeated without a new reason.

1. **Importing the full legacy runtime adapter into a Node 22 strip-only regression test.** PR #73 initially did this and failed before the test could run because a transitive TypeScript class used parameter-property syntax (`constructor(private readonly ...)`), which Node strip-only cannot transform (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). The fix was to isolate the security decision in a side-effect-free lightweight module consumed by both production and the test.
2. **Enabling `noUnusedLocals` / `noUnusedParameters` as part of the first lint gate.** The first #76 run surfaced 31 real TS6133/TS6196 diagnostics across historical production code. Turning that gate on immediately would have forced a broad unrelated cleanup. The rules were removed from the initial enforced baseline without suppressions; the debt is tracked as GG-AUD-030.
3. **One `scripts/**/*.ts` typecheck profile for every script.** Three Playwright specs depend on `@playwright/test`, which is intentionally installed only in Browser Acceptance. They must be checked there, not in normal `npm ci`. #77 split Node scripts and browser specs into two profiles.
4. **Treating test assertions as proof of TypeScript narrowing.** Around 40 strict errors in test/verifier scripts were fixed with real guards/assertions and typed tuples, not broad `as any` or `@ts-ignore`.
5. **Constructing `Response(Buffer)` in the archive behavior test.** Runtime behavior passed, but DOM/Node `BodyInit` typings rejected `Buffer`. Copy ZIP bytes to an explicit `ArrayBuffer` instead.
6. **Assuming `sender.role` was the real GG-AUD-027 authorization vulnerability.** Current sensitive FeatureGate paths do not trust it; they perform live OneBot role lookup. The concrete fail-open was malformed/missing group identity in the event pipeline. Preserve that distinction.
7. **Using source-code string/order checks to prove security behavior.** This caused real false-positive CI friction, including the WebUI session refactor. Prefer executing the public behavior boundary. Keep static assertions only for genuinely static release/wiring contracts.
8. **Reopening already fixed findings from stale notes.** GG-AUD-025 and GG-AUD-029 were accidentally revisited after their fixes had already landed. Always fetch latest `main`, read this tracker, then re-verify the exact callsite before creating a branch.
9. **Writing files to a guessed/nonexistent GitHub branch.** Several tool calls targeting a literal `nonexistent` branch returned 404 and made no repository mutation. Use the branch API first and verify the returned ref before file writes.
10. **Treating automated plugin metadata HEAD as the runtime release.** Plugin workflow commonly appends `chore: auto-update plugin.json [skip ci]`. The accepted runtime/self-update version is the parent commit that actually has a successful `main` GroupGuard Build artifact.

## Routes that must not be repeated

- Do not answer repository/product behavior from assumptions; inspect current code and CI evidence first.
- Do not reopen GG-AUD-019 through GG-AUD-029, GG-AUD-001/002/003, or GG-AUD-011 without current-main evidence that the fix regressed.
- Do not use inbound OneBot `sender.role` as a sensitive authorization fact.
- Do not treat recognizable activation-code prefixes, license existence alone, substring hostname matches, lexical path checks, or preflight DNS results without socket pinning as authorization/security proof.
- Do not weaken or delete a security regression merely because a safe refactor changed source shape; migrate it to behavior coverage when possible.
- Do not mass-refactor the whole OneBot protocol layer, StorageAdapter, or large runtime monolith while closing one narrow audit item.
- Do not enable all unused/strict lint debt in one PR and then silence it with ignores; clean it in a bounded follow-up.
- Do not merge the unrelated open PR #56 into this audit campaign without fresh scope review.
- Do not deploy/restart production after each merged audit PR. Keep accumulating fixes for one later WebUI one-click upgrade.
- Do not tell the operator that a newer `main`/artifact commit is live until runtime evidence confirms it.
- Do not create dated `GPT_NEXT_TASK_HANDOFF_*`, `final-notes`, `v2`, or other parallel handoff documents. Maintain canonical files.

## Remaining audit backlog

The following original findings remain open or require fresh re-verification before closure:

- **GG-AUD-004 / GG-AUD-005** — target-file callback, self-update security, and WebUI server/theme hotspots have behavior coverage, but other source-shape debt remains. The clearest next behavior-critical item is the `preferred: 'text'` literal check in `verify-four-query-three-mode.ts`; group-API/source-tail checks still need classification. Keep legitimate architecture/release static contracts.
- **GG-AUD-006** — very large serial test suite / verifier concentration; assess runtime and maintenance cost before splitting.
- **GG-AUD-007** — substantial `any` usage; quantify and prioritize by trust boundary rather than broad mechanical replacement.
- **GG-AUD-008** — large monolithic modules; identify one ownership boundary at a time, not a repository-wide rewrite.
- **GG-AUD-009** — `infra` / `infrastructure` duplication; map actual imports/ownership before consolidation.
- **GG-AUD-010** — repository-level code-quality guidance was originally weak. `AGENTS.md` is now strong on workflow/evidence, but re-check whether source-level coding rules still need a bounded addition before treating this closed.
- **GG-AUD-012** — import-side-effect monkey patching; re-inspect current callsites and decide whether it is still active production debt.
- **GG-AUD-013** — `StorageAdapter` monolith; re-measure current file/responsibilities before splitting.
- **GG-AUD-014** — stale schema/types; identify concrete drift before editing.
- **GG-AUD-015** — Node 22/24 behavior drift; current CI/runtime assumptions need explicit matrix review.
- **GG-AUD-016** — memory smoke test is not a required release gate; verify present workflow before changing.
- **GG-AUD-017** — duplicated WebUI tests; consolidate only where behavior coverage remains equivalent.
- **GG-AUD-018** — architecture lint scope is too local; map important cross-module boundaries first.
- **GG-AUD-030 P3 / code quality** — first lint attempt found 31 unused symbols/parameters/types in production `src`. This is real cleanup debt and intentionally not hidden by ignores.

Independent operational/product issues that existed before this campaign (for example intermittent OneBot `send_group_msg` result `120`, query-delivery observability PR #56, legacy/historical per-group config cleanup) are **not automatically part of the next audit round**. Scope them separately.

## Next operation for a new ChatGPT/Codex session

1. Read `AGENTS.md`, `docs/AI_CONTEXT.md` when present, this `PROJECT_STATE.md`, `docs/PITFALLS.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/AI_WORKSTYLE.md` when present.
2. Fetch latest `main` and distinguish its HEAD from the latest runtime/self-update artifact commit. Do not assume the SHA in this document is still HEAD.
3. Confirm no production update/restart has happened since the operator-confirmed `9318d864...` runtime before making any live-state claim.
4. Continue with **one medium unresolved issue only**. Best immediate candidate is the remaining GG-AUD-004/005 query-mode source-shape debt in `scripts/verify-four-query-three-mode.ts`: prove the literal `preferred: 'text'` check is replaceable by request/output behavior coverage, migrate only that coherent cluster, then PR/CI/merge/main-artifact verification.
5. After that migration, reclassify the remaining source-text checks. If only legitimate static architecture/release contracts remain, close/reclassify GG-AUD-004/005 with evidence instead of forcing more changes; otherwise select one bounded residual hotspot.
6. Keep production unchanged until the operator explicitly decides the audit batch is ready for the single WebUI one-click upgrade.