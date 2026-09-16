# GroupGuard Project State

Updated: 2026-09-16

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- At the start of PR #90, GitHub `main` HEAD was `cecd9a7816a293f07e4bca4a55dae85d320d0b66`.
- `cecd9a78...` is a metadata-only `chore: auto-update plugin.json [skip ci]` child of accepted runtime/artifact commit `7cccbf9612b4dd0dd3f62854fe944eee014e14b7` (merge of PR #89). Its only source-tree change is `plugin.json.updateTime`.
- PR #89 main verification for `7cccbf96...` succeeded:
  - GroupGuard CI #935;
  - GroupGuard Build #939;
  - Build SnowLuma Service #135;
  - Build & Release Plugins #200.
- PR #89 accepted artifacts from GroupGuard Build #939:
  - self-update artifact id `10400361465`, SHA-256 `b746ea833451c2528e336335cf062a5cd4de524da388d3b916d005b61fde3d72`;
  - deployment bundle id `10400361470`, SHA-256 `ca203b0afd68ac51d7e376876d0422207c2f4c9262a2f7390f882f15644c15d9`;
  - build log id `10400162566`, SHA-256 `2945882db2cf87037a9f1184ae8c986fe35ec4981e369a221978a7ae8f2f7bfd`.
- Always re-fetch `main` in a new session because later merges and plugin metadata automation may advance it.

## Production/runtime evidence boundary

- Last operator-confirmed live ARM runtime: `9318d86415cbb726b022511d11d6a598b4237216`.
- No audit round after that confirmation has deployed, restarted, or otherwise mutated production.
- Repository `main`, accepted build/artifact commit, Windows checkout, and live ARM runtime are separate evidence states.
- Audit fixes continue to accumulate in Git; production remains unchanged until the operator explicitly authorizes the later batched WebUI one-click upgrade.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into the audit without fresh scope review.
- Several already-merged historical task branches may still exist remotely. Do not claim branch cleanup unless the branch is actually deleted after fresh safety checks.

## Audit progress and remaining-count view

The user wants progress expressed as a visible remaining count, not only as process steps.

### GG-AUD-004/005 source-shape cleanup — complete

Behavior migrations completed:

1. target-file callback authorization — PR #78;
2. self-update security behavior — PRs #79–#81;
3. WebUI page/theme serving — PR #83;
4. four-query delivery preference — PR #84;
5. Admin group-config mutation/inheritance — PR #85;
6. output-locale Q群管家 adapter routing — PR #86;
7. explicit force-send semantics — PR #87;
8. runtime version/build metadata — PR #88;
9. global config save preserving SQLite-owned group settings — PR #89;
10. final empty-runtime guard / intentional-empty persistence / explicit final-row deletion behavior — PR #90.

Current remaining count for the `scripts/verify-project-wide-bugfixes.ts` source-shape cleanup: **0 behavior classes**.

PR #90 replaces the final four implementation-string assertions with one isolated temporary SQLite/config behavior fixture. It proves:

- an ordinary save with an unexpectedly empty runtime group map preserves the last SQLite-owned group row and emits the operator-visible persistence warning;
- restoring the final explicit group override is recognized as intentional and persists an empty runtime/SQLite group set;
- explicit `deleteGroupConfig()` removes the final runtime and SQLite row;
- production implementation code is unchanged.

PR #90 code head `e9162c6e94e871fe16020371ba6f0b15f0f86eee` passed GroupGuard CI #937 and GroupGuard Build #941, including full `npm test`, semantic lint, scripts typecheck, deployment safety checks, SnowLuma build, Windows PowerShell 5.1 preflight, and artifact creation. Final docs-head/main verification is still required before the PR is considered fully closed.

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

## Reusable audit rules

- Runtime/security behavior is not proved by source strings. Prefer real execution boundaries and preserve negative contracts.
- Keep genuinely static build/release wiring checks static.
- Re-fetch current `main` before reopening old findings.
- Node/TS loader incompatibility is not product failure; test through the supported loader/build path.
- SQLite persistence may normalize sparse legacy shapes; behavior tests should protect ownership/value semantics rather than forbid documented normalization unless exact shape is itself the contract.
- `main` metadata HEAD, accepted runtime artifact commit, and live production are distinct.
- Do not mass-refactor unrelated architecture while closing one bounded audit item.

Detailed recurring failure patterns belong in `docs/PITFALLS.md`.

## Broader audit backlog — next phase

The completed source-shape cleanup is no longer the active tail. The broader campaign still has **13 backlog categories to triage**, not 13 guaranteed code changes:

- GG-AUD-006 — very large serial test/verifier concentration;
- GG-AUD-007 — substantial `any` usage;
- GG-AUD-008 — monolithic modules;
- GG-AUD-009 — `infra` / `infrastructure` duplication;
- GG-AUD-010 — source-level coding guidance gap, if still present;
- GG-AUD-012 — import-side-effect monkey patching;
- GG-AUD-013 — StorageAdapter monolith;
- GG-AUD-014 — stale schema/types;
- GG-AUD-015 — Node 22/24 behavior drift;
- GG-AUD-016 — memory smoke test release-gate status;
- GG-AUD-017 — duplicated WebUI tests;
- GG-AUD-018 — architecture lint scope;
- GG-AUD-030 P3 — unused production symbols/parameters/types.

These should be mapped before editing. Some may be high-value fixes, some bounded cleanup, and some may be reclassified/closed after current-main inspection. Independent operational/product issues such as OneBot result `120` and PR #56 are not automatically part of this campaign.

## Next operation

1. Finish PR #90 final-head CI/Build, merge with exact expected head SHA, verify exact main CI/Build/SnowLuma/Plugins runs, artifact IDs/digests, and metadata-only child.
2. Production remains untouched unless explicitly authorized.
3. After #90 is fully closed, do **not** blindly open another code PR. First build a current-main backlog map for the 13 remaining categories: `must fix / worth fixing / defer / close or reclassify`, with concrete code evidence and an approximate remaining-round count.
4. Then continue one bounded high-value issue per user `继续` round.
