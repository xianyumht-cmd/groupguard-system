# GroupGuard Project State

Updated: 2026-09-16

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- Before PR #91, GitHub `main` HEAD was `48502903d38ada97323c147972ea5ad22a3d2373`.
- `48502903...` is a metadata-only `chore: auto-update plugin.json [skip ci]` child of accepted runtime/artifact commit `0d79a4801e8e7c128d60181f9b82aff72458f3d8` (merge of PR #90). Its only source-tree change is `plugin.json.updateTime`, from `2026-09-15T13:55:40Z` to `2026-09-16T10:39:24Z`.
- PR #90 exact main verification for `0d79a480...` succeeded:
  - GroupGuard CI #939, run `35086058504`;
  - GroupGuard Build #943, run `35086058590`;
  - Build SnowLuma Service #136, run `35086058528`;
  - Build & Release Plugins #201, run `35086059084`.
- PR #90 accepted artifacts from GroupGuard Build #943:
  - self-update artifact id `10441948912`, SHA-256 `34e1868c7d8c424a66b3a228a5d20a5886a5f1118327410b57759007ba9774f7`;
  - deployment bundle id `10442302611`, SHA-256 `000a76102c0a915863d38763d31f508205b2ee3833c4b9904635dbea9cc658ca`;
  - build log id `10442471175`, SHA-256 `f969a8a2294de3e861399fe66ef73c2c8e82c276fbec698cc774c580b4222d7b`.
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

PR #90 is fully closed on `main`: merge `0d79a4801e8e7c128d60181f9b82aff72458f3d8`, all four exact push workflows succeeded, accepted artifacts are recorded above, and the later `48502903...` child is metadata-only.

### GG-AUD-014 stale schema/types — PR #91 closure in progress

Current finding: stored per-group configuration rows are sparse overrides, but several TypeScript boundaries still modeled them as complete `GroupGuardSettings` snapshots. That stale model hid real ownership mistakes and encouraged reverse casts.

PR #91 aligns the type model with the already-established runtime/storage contract:

- `PluginConfig.groups` is a map of sparse `GroupSettingsOverride` values;
- config state service, adapter, gateway, persistence guard, and system-write port expose stored group rows as sparse overrides;
- effective runtime settings remain complete `GroupGuardSettings` and are produced by the canonical `resolveEffectiveGroupSettings()` resolver;
- legacy `PluginState.getGroupSettings()` now uses the same deep resolver instead of a shallow object spread;
- SQLite group persistence is typed to accept sparse rows without pretending they are complete runtime settings;
- config-inheritance verification typechecks sparse nested group literals directly, without `as GroupGuardSettings` reverse casts.

The audit also exposed one real behavior bug in the system-write adapter: the first mutation of a never-configured group cloned the entire effective global snapshot into a new group row, freezing fields that should continue to inherit later global changes. PR #91 now creates only `{ useGlobal: false }` plus the field actually written. The behavior verifier proves a first welcome-message mutation leaves unrelated settings inherited from global.

Latest code/test head before this documentation update: `d081ccf67e25471c3d3fc601e4177736ec33009d`. On that head, TypeScript typecheck, full `npm test`, semantic TypeScript lint, scripts typecheck, deployment safety checks, and Windows PowerShell 5.1 preflight reached success; final CI/Build tail and the documentation head still require exact verification before merge.

Once PR #91 is fully merged and exact-main verified, GG-AUD-014 is closed and the broader backlog falls from 13 to **12 categories to triage**.

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
- Node/TS loader incompatibility is not product failure; test through the supported loader/build path. If a touched runtime module must be imported by strip-types verifiers, avoid TypeScript syntax that Node strip-only mode cannot erase, such as constructor parameter properties.
- SQLite persistence may normalize sparse legacy shapes; behavior tests should protect ownership/value semantics rather than forbid documented normalization unless exact shape is itself the contract.
- Stored group overlays and effective runtime group settings are different types and ownership states. Do not cast a sparse row into complete `GroupGuardSettings`; resolve it at the runtime boundary.
- `main` metadata HEAD, accepted runtime artifact commit, and live production are distinct.
- Do not mass-refactor unrelated architecture while closing one bounded audit item.

Detailed recurring failure patterns belong in `docs/PITFALLS.md`.

## Broader audit backlog — next phase

After PR #91 closes GG-AUD-014, the campaign has **12 backlog categories to triage**, not 12 guaranteed code changes:

- GG-AUD-006 — very large serial test/verifier concentration;
- GG-AUD-007 — substantial `any` usage;
- GG-AUD-008 — monolithic modules;
- GG-AUD-009 — `infra` / `infrastructure` duplication;
- GG-AUD-010 — source-level coding guidance gap, if still present;
- GG-AUD-012 — import-side-effect monkey patching;
- GG-AUD-013 — StorageAdapter monolith;
- GG-AUD-015 — Node 22/24 behavior drift;
- GG-AUD-016 — memory smoke test release-gate status;
- GG-AUD-017 — duplicated WebUI tests;
- GG-AUD-018 — architecture lint scope;
- GG-AUD-030 P3 — unused production symbols/parameters/types.

These should be mapped before editing. Some may be high-value fixes, some bounded cleanup, and some may be reclassified/closed after current-main inspection. Independent operational/product issues such as OneBot result `120` and PR #56 are not automatically part of this campaign.

## Next operation

1. Finish PR #91 final documentation-head CI/Build, merge with exact expected head SHA, then verify exact main CI/Build/SnowLuma/Plugins runs and artifact IDs/digests.
2. Production remains untouched unless explicitly authorized.
3. After #91 is fully closed, continue one bounded high-value category per user `继续` round, always showing the remaining-category count.
