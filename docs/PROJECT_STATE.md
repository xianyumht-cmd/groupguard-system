# GroupGuard Project State

Updated: 2026-09-17

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- Latest accepted runtime/artifact commit: `0d074d71cb9a88c7499edde64ab4a4b8498070b9` (merge of PR #91 / GG-AUD-014).
- Exact-main verification for `0d074d71...` succeeded:
  - GroupGuard CI #964, run `35108575483`;
  - GroupGuard Build #968, run `35108575392`;
  - Build SnowLuma Service #137, run `35108575476`;
  - Build & Release Plugins #202, run `35108575486`.
- Accepted GroupGuard Build #968 artifacts:
  - self-update artifact id `10451616228`, SHA-256 `89a0c8d00361d0fc0279bc0c565a3c2cc29403394a5e478e7ba0fd39a5a2bac8`;
  - deployment bundle id `10451616232`, SHA-256 `5b9bb9db56418e45ff912b12dbc2ada0a96e326041977204954c6abf0c339afa`;
  - build log id `10451062764`, SHA-256 `8fb7e5a57a083a826064e75ff2b47b7aa8158255fe93e4878855cc696cdf4905`.
- Plugin release #202 created metadata-only child `ef040ab40d7f40fa21c1bc0a8a8a626857bbb4a4`, changing only `plugin.json.updateTime`.
- A later docs-only closeout commit `76819c5239e2421f441843c44d86ebcfae92d6a8` advanced `main` without changing runtime code or accepted artifacts. Always re-fetch `main` in a new session.

## Production/runtime evidence boundary

- Last operator-confirmed live ARM runtime: `9318d86415cbb726b022511d11d6a598b4237216`.
- No audit round after that confirmation has deployed, restarted, or otherwise mutated production.
- Repository `main`, accepted build/artifact commit, Windows checkout, and live ARM runtime are separate evidence states.
- Audit fixes continue to accumulate in Git; production remains unchanged until the operator explicitly authorizes the later batched WebUI one-click upgrade.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into the audit without fresh scope review.
- PR #45 is also still open and is unrelated historical documentation work.
- Do not claim temporary-branch cleanup unless the branch is actually deleted after fresh safety checks.

## Audit progress

The user wants progress expressed as a visible remaining count, not only as process steps.

### Source-shape cleanup — complete

GG-AUD-004/005 is complete. `scripts/verify-project-wide-bugfixes.ts` has **0 remaining source-shape behavior classes**. Runtime/security behavior should remain verified through real execution boundaries rather than implementation-string assertions unless the contract is genuinely static.

### GG-AUD-014 stale configuration types — complete via PR #91

Stored per-group configuration is modeled as sparse `GroupSettingsOverride`; effective runtime settings remain complete `GroupGuardSettings` produced by the canonical resolver. PR #91 also fixed first-write behavior so a new group mutation no longer freezes unrelated global values into the stored row.

Accepted runtime/artifact commit: `0d074d71cb9a88c7499edde64ab4a4b8498070b9`. Production was not deployed or restarted.

### GG-AUD-015 Node 22/24 behavior drift — closed from current-main evidence

No code change is required.

Current evidence:

- `onebot-plugin-groupguard/package.json` does **not** declare an `engines` field, so there is no current package-level promise that was being verified only on one Node major.
- `.github/workflows/groupguard-ci.yml` runs the full primary verification path on Node 22: `npm ci`, production dependency audit, `npm test`, semantic TypeScript lint, scripts typecheck, deployment safety checks, `npm run build:snowluma`, and contract verification.
- `.github/workflows/groupguard-build.yml` independently runs the formal release/build path on Node 24, including `npm ci`, real `npm run build`, `npm run build:snowluma`, deployment-bundle creation, WebUI self-update artifact construction, and Windows PowerShell 5.1 preflight.
- `.github/workflows/build-snowluma-service.yml` and browser acceptance remain on Node 22, which is compatible with the primary runtime lane rather than evidence of an untested Node 24 release path.
- On accepted runtime commit `0d074d71...`, Node-22 GroupGuard CI #964 (`35108575483`) and Node-24 GroupGuard Build #968 (`35108575392`) both completed successfully. SnowLuma #137 also succeeded on Node 22.

Therefore the old GG-AUD-015 hypothesis is not a current actionable defect. Do not add an extra compatibility matrix merely to duplicate already-successful expensive verification. Reopen only if supported Node policy changes, a Node-major-specific failure appears, or a release path stops exercising one of the majors.

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

## Remaining broader audit backlog

The 12-category current-main triage is now resolved as follows:

### Worth one bounded execution round

- **GG-AUD-006** — very large serial test/verifier concentration. Current `npm test` and build scripts repeat long `&&` chains. This is primarily maintainability/diagnostic debt, not a runtime correctness bug. Any change must preserve current ordering, fail-fast behavior, and verifier coverage.

### Deferred maintenance debt

- **GG-AUD-007** — substantial `any` usage. Tighten only specific external/trust boundaries; do not perform a repo-wide mechanical purge.
- **GG-AUD-013** — `StorageAdapter` remains a multi-domain monolith. High regression surface; split only with a dedicated architecture plan and behavior coverage.
- **GG-AUD-018** — architecture lint exists for system-write and risk-policy boundaries. Additional coverage is preventive governance work, not a current defect.
- **GG-AUD-030 P3** — unused symbols/parameters/types can accumulate because unused checks are not global gates. Treat as bounded cleanup, not release-blocking work.

### Closed/reclassified from current-main evidence

- **GG-AUD-008** — generic monolithic-module finding duplicates concrete GG-AUD-013 and is too broad to remain independently actionable.
- **GG-AUD-009** — `infra` and `infrastructure` currently own different responsibilities; no current duplicate implementation defect was found.
- **GG-AUD-010** — source-level coding guidance gap is closed by current `AGENTS.md`, TypeScript checks, and repository rules.
- **GG-AUD-012** — no current evidence of the old import-side-effect monkey-patching pattern.
- **GG-AUD-015** — Node 22 and Node 24 are already exercised by successful primary CI/build lanes; closed above.
- **GG-AUD-016** — the old memory-smoke release-gate premise is not present in the current package/workflow state.
- **GG-AUD-017** — HTTP/SQLite WebUI verification and Playwright browser acceptance cover different evidence layers rather than being simple duplicates.

Current triage totals: **0 must-fix / 1 worth-doing / 4 deferred / 7 closed or reclassified**.

## Reusable audit rules

- Runtime/security behavior is not proved by source strings. Prefer real execution boundaries and preserve negative contracts.
- Re-fetch current `main`, package metadata, all relevant workflows, and exact successful runs before reopening an old CI/runtime-version finding; one workflow alone is not repository-wide compatibility evidence.
- Keep genuinely static build/release wiring checks static.
- SQLite persistence may normalize sparse legacy shapes; protect ownership/value semantics rather than undocumented exact shapes.
- Stored group overlays and effective runtime group settings are different types and ownership states.
- `main` metadata/documentation HEAD, accepted runtime artifact commit, and live production are distinct.
- Do not mass-refactor unrelated architecture while closing one bounded audit item.

Detailed recurring failure patterns belong in `docs/PITFALLS.md`.

## Next operation

Visible audit-closeout progression after closing GG-AUD-015: **2 → 1 → 0**.

1. Next bounded execution round: **GG-AUD-006**, current-main test/verifier concentration. First determine whether a manifest/runner can reduce duplication without changing verifier semantics or materially increasing CI time.
2. Final round: re-fetch current `main`, verify canonical docs and open PRs, record the deferred/closed backlog disposition, and declare the current audit campaign complete if no new current-main defect appears.
3. Production remains untouched unless explicitly authorized.
