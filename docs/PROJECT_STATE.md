# GroupGuard Project State

Updated: 2026-09-17

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- Latest accepted runtime/artifact commit before PR #93: `0d074d71cb9a88c7499edde64ab4a4b8498070b9` (merge of PR #91 / GG-AUD-014).
- Exact-main verification for `0d074d71...` succeeded:
  - GroupGuard CI #964, run `35108575483`;
  - GroupGuard Build #968, run `35108575392`;
  - Build SnowLuma Service #137, run `35108575476`;
  - Build & Release Plugins #202, run `35108575486`.
- Accepted GroupGuard Build #968 artifacts:
  - self-update artifact id `10451616228`, SHA-256 `89a0c8d00361d0fc0279bc0c565a3c2cc29403394a5e478e7ba0fd39a5a2bac8`;
  - deployment bundle id `10451616232`, SHA-256 `5b9bb9db56418e45ff912b12dbc2ada0a96e326041977204954c6abf0c339afa`;
  - build log id `10451062764`, SHA-256 `8fb7e5a57a083a826064e75ff2b47b7aa8158255fe93e4878855cc696cdf4905`.
- Plugin release #202 created metadata-only child `ef040ab40d7f40fa21c1bc0a8a8a626857bbb4a4`.
- PR #92 then closed GG-AUD-015 by evidence only; docs-only merge commit `03fe487635f9c7dab1223fe7e2e96c7665d360c4` changed no runtime code or artifact baseline.
- PR #93 is the current GG-AUD-006 task. Its final accepted runtime/artifact commit must be recorded here only after merge and exact-main verification.

## Production/runtime evidence boundary

- Last operator-confirmed live ARM runtime: `9318d86415cbb726b022511d11d6a598b4237216`.
- No audit round after that confirmation has deployed, restarted, or otherwise mutated production.
- Repository `main`, accepted build/artifact commit, Windows checkout, and live ARM runtime are separate evidence states.
- Audit fixes accumulate in Git first; production remains unchanged until the operator explicitly authorizes the later batched WebUI one-click upgrade.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into the audit without fresh scope review.
- PR #45 is still open and is unrelated historical documentation work.
- Do not claim temporary-branch cleanup unless the branch is actually deleted after fresh safety checks.

## Audit progress

### Source-shape cleanup — complete

GG-AUD-004/005 is complete. `scripts/verify-project-wide-bugfixes.ts` has **0 remaining source-shape behavior classes**. Runtime/security behavior should remain verified through execution boundaries rather than implementation-string assertions unless the contract is genuinely static.

### GG-AUD-014 stale configuration types — complete via PR #91

Stored per-group configuration is modeled as sparse `GroupSettingsOverride`; effective runtime settings remain complete `GroupGuardSettings` produced by the canonical resolver. PR #91 also fixed first-write behavior so a new group mutation no longer freezes unrelated global values into the stored row.

### GG-AUD-015 Node 22/24 behavior drift — closed via PR #92

No code change was required. Current repository verification already exercises the primary path on Node 22 and the formal release/build path on Node 24. Reopen only if supported Node policy changes, a Node-major-specific failure appears, or a release path stops exercising one of the majors.

### GG-AUD-006 serial verifier concentration — implementation complete in PR #93

PR #93 replaces four duplicated aggregate `&&` command chains with a single declarative verifier-suite manifest plus a synchronous fail-fast runner:

- `npm test` keeps the same 34 verifier steps and order;
- `build:onebot` and `build:snowluma` share one release verifier sequence and retain their distinct Vite modes;
- `build:debug` keeps its historical smaller sequence;
- every step still calls the existing `npm run <script>` command; no verifier implementation is removed, parallelized, or reordered;
- `build:all` still builds OneBot first and SnowLuma second;
- the runner validates missing/duplicate/recursive steps before execution and reports exact `step/total` progress and the first failing script.

The first PR head exposed one stale wiring self-check in `verify:per-group-self-recall`: it inspected the literal `package.json.test` command string. That check now reads the canonical suite manifest, so it still proves the focused contract participates in `npm test` without coupling itself to one command-string representation.

Verified code head `7d18a6ec4b932676da9073fc0bb55c77ff5cbe45`:

- GroupGuard CI #972, run `35138034050`, Node 22: succeeded; suite output reached `test passed (34/34)`, then semantic lint, scripts typecheck, deployment safety checks, `build:snowluma` `22/22`, and cross-repository mock contracts all passed.
- GroupGuard Build #976, run `35138033706`, Node 24: succeeded; real `npm run build` ran `build:onebot` `22/22` followed by `build:snowluma` `22/22`; immutable deployment candidate, self-update artifact construction, uploads, and Windows PowerShell 5.1 preflight succeeded.

GG-AUD-006 has no remaining implementation work. PR #93 still requires final-head verification after this canonical documentation update, merge, and exact-main post-merge verification before it is fully closed.

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

After GG-AUD-006, the current audit has **0 must-fix / 0 worth-doing active categories**.

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

Visible substantive audit execution has reached **1 → 0**.

1. Complete PR #93 final-head CI/Build, merge, exact-main four-workflow verification, and artifact evidence recording.
2. Then perform one final read-only current-main campaign closeout: re-read canonical docs, inspect open PRs and current backlog evidence, and declare this audit campaign complete if no new current-main defect appears.
3. Do **not** automatically start GG-AUD-007/013/018/030; they are deferred maintenance debt, not current audit blockers.
4. Production remains untouched unless explicitly authorized.
