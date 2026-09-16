# GroupGuard Project State

Updated: 2026-09-17

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- Latest accepted runtime/artifact commit: `ca40e3159b374589bdf3403b2030bd773b1ce5d2` (merge of PR #93 / GG-AUD-006).
- Exact-main verification for `ca40e315...` succeeded:
  - GroupGuard CI #974, run `35138970422`;
  - GroupGuard Build #978, run `35138970437`;
  - Build SnowLuma Service #138, run `35138970413`;
  - Build & Release Plugins #203, run `35138970283`.
- Accepted GroupGuard Build #978 artifacts:
  - self-update artifact id `10464074840`, size `1,408,821` bytes, SHA-256 `81b464c2c756e1c2ef718f09ae2a56b5f4a1982696aa7a0c520e6659a0bb363b`, expires `2026-10-16T19:12:26Z`;
  - deployment bundle id `10464860135`, size `1,316,472` bytes, SHA-256 `873f6a7e06d19dbd99ee8caa29f3c25edf5ee82f3c8d9f95e2371b43c666a9ff`, expires `2026-12-15T19:10:44Z`;
  - build log id `10464439529`, size `2,528` bytes, SHA-256 `a60d472eeea7e8af284a7495026afa1ad04f301e04598bbf5d18e764a9441d87`, expires `2026-12-15T19:10:44Z`.
- Plugin release #203 created metadata-only child `e21535728a9a3e8a47020a6af9f06d7efd0b3c41`, whose parent is exactly `ca40e315...`; it changes only `plugin.json.updateTime` from `2026-09-16T14:27:55Z` to `2026-09-16T19:11:53Z`.
- Repository `main` may therefore be ahead of the accepted runtime/artifact commit by metadata-only or documentation-only commits. Always re-fetch `main` and classify the delta before treating a newer SHA as runtime code.

## Production/runtime evidence boundary

- Last operator-confirmed live ARM runtime: `9318d86415cbb726b022511d11d6a598b4237216`.
- No audit round after that confirmation has deployed, restarted, or otherwise mutated production.
- Repository `main`, accepted build/artifact commit, Windows checkout, and live ARM runtime are separate evidence states.
- Audit fixes have accumulated in Git; production remains unchanged until the operator explicitly authorizes a later batched WebUI one-click upgrade.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into this audit without fresh scope review.
- PR #45 (`docs: record runtime recovery and config migration`) remains open and is unrelated historical documentation work.
- Do not claim temporary-branch cleanup unless the branch is actually deleted after fresh safety checks.

## Audit campaign status — complete

Visible substantive audit execution has reached **1 → 0**.

### Source-shape cleanup — complete

GG-AUD-004/005 is complete. `scripts/verify-project-wide-bugfixes.ts` has **0 remaining source-shape behavior classes**. Runtime/security behavior should remain verified through execution boundaries rather than implementation-string assertions unless the contract is genuinely static.

### GG-AUD-014 stale configuration types — complete via PR #91

Stored per-group configuration is modeled as sparse `GroupSettingsOverride`; effective runtime settings remain complete `GroupGuardSettings` produced by the canonical resolver. PR #91 also fixed first-write behavior so a new group mutation no longer freezes unrelated global values into the stored row.

### GG-AUD-015 Node 22/24 behavior drift — closed via PR #92

No code change was required. Current repository verification already exercises the primary path on Node 22 and the formal release/build path on Node 24. Reopen only if supported Node policy changes, a Node-major-specific failure appears, or a release path stops exercising one of the majors.

### GG-AUD-006 serial verifier concentration — complete via PR #93

PR #93 replaced four duplicated aggregate `&&` command chains with a single declarative verifier-suite manifest plus a synchronous fail-fast runner:

- `npm test` keeps the same 34 verifier steps and order;
- `build:onebot` and `build:snowluma` share one release verifier sequence and retain distinct Vite modes;
- `build:debug` keeps its historical smaller sequence;
- every step still calls the existing `npm run <script>` command; no verifier implementation was removed, parallelized, or reordered;
- `build:all` still builds OneBot first and SnowLuma second;
- the runner validates missing/duplicate/recursive steps before execution and reports exact `step/total` progress and the first failing script.

The first PR head exposed one stale wiring self-check in `verify:per-group-self-recall`: it inspected the literal `package.json.test` command string. That check was moved to the canonical suite manifest, preserving the contract while removing command-string coupling.

Final evidence:

- PR final-head CI #973 and Build #977 succeeded after the canonical docs update.
- Exact-main CI #974 succeeded, including `npm test`, semantic TypeScript lint, scripts typecheck, deployment safety checks, SnowLuma build, and cross-repository mock contracts.
- Exact-main Build #978 succeeded, including the real Node-24 `npm run build`, OneBot and SnowLuma release suites, Windows PowerShell 5.1 preflight, immutable deployment candidate, self-update artifact, deployment bundle, and build-log uploads.
- Exact-main SnowLuma #138 and Plugins #203 also succeeded.
- Production was not deployed or restarted.

GG-AUD-006 is fully closed.

## Completed security/reliability findings

- GG-AUD-019 P0 + GG-AUD-026 P2 — prefix-only activation authority disabled; malformed duration handling fails closed (#64).
- GG-AUD-001 — auth timer/send rejection behavior covered (#64 + #75).
- GG-AUD-021 P1 — authenticated query-test SSRF/unbounded response constrained (#66).
- GG-AUD-022 P1 — DNS TOCTOU hardened with per-hop validation/socket pinning (#67).
- GG-AUD-023 P2 — unsafe cookie-auth mutations require same-host Origin (#68).
- GG-AUD-024 P2 — SUB resource containment uses realpath + regular-file checks (#69).
- GG-AUD-029 P2 — Lanzou domain validation uses exact/subdomain boundaries (#70).
- GG-AUD-025 P1 — stored free license no longer satisfies paid runtime gates (#71).
- GG-AUD-028 P2 — browser uses opaque signed WebUI session instead of storing master token (#72).
- GG-AUD-020 — legacy `owner/admin` maps to `admin`, not public access (#73).
- GG-AUD-027 — malformed/missing group identity fails closed (#74).

Do not reopen completed findings from stale notes without current-main evidence of regression.

## Broader audit backlog disposition

The current audit has **0 must-fix / 0 worth-doing active categories**.

### Deferred maintenance debt

- **GG-AUD-007** — substantial `any` usage. Tighten only specific external/trust boundaries; do not perform a repo-wide mechanical purge.
- **GG-AUD-013** — `StorageAdapter` remains a multi-domain monolith. High regression surface; split only with a dedicated architecture plan and behavior coverage.
- **GG-AUD-018** — architecture lint exists for system-write and risk-policy boundaries. Additional coverage is preventive governance work, not a current defect.
- **GG-AUD-030 P3** — unused symbols/parameters/types can accumulate because unused checks are not global gates. Treat as bounded cleanup, not release-blocking work.

### Closed, completed, or reclassified from current-main evidence

- **GG-AUD-006** — aggregate verifier/build command concentration centralized through PR #93.
- **GG-AUD-008** — generic monolithic-module finding duplicates concrete GG-AUD-013 and is too broad to remain independently actionable.
- **GG-AUD-009** — `infra` and `infrastructure` currently own different responsibilities; no current duplicate implementation defect was found.
- **GG-AUD-010** — source-level coding guidance gap is closed by current `AGENTS.md`, TypeScript checks, and repository rules.
- **GG-AUD-012** — no current evidence of the old import-side-effect monkey-patching pattern.
- **GG-AUD-015** — Node 22 and Node 24 are already exercised by successful primary CI/build lanes.
- **GG-AUD-016** — the old memory-smoke release-gate premise is not present in the current package/workflow state.
- **GG-AUD-017** — HTTP/SQLite WebUI verification and Playwright browser acceptance cover different evidence layers rather than being simple duplicates.

Current triage totals: **0 must-fix / 0 worth-doing / 4 deferred / 8 closed, completed, or reclassified**.

## Reusable audit rules

- Runtime/security behavior is not proved by source strings. Prefer real execution boundaries and preserve negative contracts.
- Aggregate test membership belongs in the canonical suite definition, not in assertions that grep one `package.json` command-string representation.
- Keep aggregate verifier execution serial and fail-fast unless a separate task proves that parallelization is safe.
- Re-fetch current `main`, package metadata, workflows, and exact successful runs before reopening an old CI/runtime-version finding.
- SQLite persistence may normalize sparse legacy shapes; protect ownership/value semantics rather than undocumented exact shapes.
- Stored group overlays and effective runtime group settings are different types and ownership states.
- `main` metadata/documentation HEAD, accepted runtime artifact commit, and live production are distinct.
- Do not mass-refactor unrelated architecture while closing one bounded audit item.

Detailed recurring failure patterns belong in `docs/PITFALLS.md`.

## Next operation

The current audit campaign is complete. Do not automatically start GG-AUD-007/013/018/030; they are deferred maintenance debt, not audit blockers.

Future work should begin only from a freshly re-fetched `main` and one explicit scope. The two obvious next classes are:

1. an operator-authorized production upgrade using an accepted immutable artifact, with preflight/backup/exact-build verification and rollback boundaries; or
2. a separately scoped maintenance task selected from the deferred backlog.

PR #56 remains independent from both. Production stays untouched until explicitly authorized.
