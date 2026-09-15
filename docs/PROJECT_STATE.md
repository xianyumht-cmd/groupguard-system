# GroupGuard Project State

Updated: 2026-09-15

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical branch: `main`.
- At the start of PR #89, GitHub `main` HEAD was `e9130bb66f0ccdbb9a250572685238f1062339ed`.
- `e9130bb6...` is a metadata-only `chore: auto-update plugin.json [skip ci]` child of accepted runtime/artifact commit `47484fe30e3a7dd8aef1966d42543c55157baed8` (merge of PR #88). Its only source-tree change is `plugin.json.updateTime`.
- PR #88 main verification for `47484fe3...` succeeded:
  - GroupGuard CI #929;
  - GroupGuard Build #933;
  - Build SnowLuma Service #134;
  - Build & Release Plugins #199.
- PR #88 accepted artifacts from GroupGuard Build #933:
  - self-update artifact id `10397854054`, SHA-256 `097bf71374abeb12871fcea907305d2947a7e13579858b3d99e68acb188315ad`;
  - deployment bundle id `10398502173`, SHA-256 `e2437957839131327442d6ffff49fadb4d3e49572a9fef0fca8975c3ac1d48b5`;
  - build log id `10397644861`, SHA-256 `c5543c2d76aff1bbf66ca8176580d021214295e7fb92dab49799cb7a1cf4380a`.
- Always re-fetch `main` in a new session because later merges and plugin metadata automation may advance it.

## Production/runtime evidence boundary

- Last operator-confirmed live ARM runtime: `9318d86415cbb726b022511d11d6a598b4237216`.
- No audit round after that confirmation has deployed, restarted, or otherwise mutated production.
- Repository `main`, accepted build/artifact commit, Windows checkout, and live ARM runtime are separate evidence states.
- Audit fixes continue to accumulate in Git; production remains unchanged until the operator explicitly authorizes the later batched WebUI one-click upgrade.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into the audit without fresh scope review.
- Several already-merged historical task branches may still exist remotely. Do not delete unique history without proving it is safely reachable/archived.

## Audit progress and remaining-count view

The user wants progress expressed as a visible remaining count, not only as process steps.

### Current GG-AUD-004/005 source-shape cleanup

Completed behavior migrations:

1. target-file callback authorization — PR #78;
2. self-update security behavior — PRs #79–#81;
3. WebUI page/theme serving — PR #83;
4. four-query delivery preference — PR #84;
5. Admin group-config mutation/inheritance — PR #85;
6. output-locale Q群管家 adapter routing — PR #86;
7. explicit force-send semantics — PR #87;
8. runtime version/build metadata — PR #88;
9. global config save preserving SQLite-owned group settings — PR #89 in progress.

PR #89 scope:

- replaces the `config_api.ts` source-string assertion with real `saveRawConfig()` execution against isolated temporary SQLite/config state;
- requires a raw global save containing `groups: {}` to preserve the in-memory group map and SQLite group-row set/semantics while keeping `config.json.groups` empty;
- production implementation code is unchanged.

PR #89 validation so far:

- initial head `39e2b88d6af265205e61bd46ba8ac8bf12ff0634` failed GroupGuard CI #931 only because the test incorrectly required sparse SQLite rows to round-trip byte-for-byte; SQLite correctly normalizes missing `qaList` to `[]`;
- corrected head `00b0cdc8dca7b913b980eed7c260e1a04fe10135` compares the durable semantics instead of forbidding normal persistence normalization;
- corrected head passed GroupGuard CI #933 and GroupGuard Build #937, including full `npm test`, semantic lint, scripts typecheck, deployment safety checks, SnowLuma build, Windows PowerShell 5.1 preflight, and artifact creation.

### Remaining count after PR #89

For the current `scripts/verify-project-wide-bugfixes.ts` source-shape tail, exactly **2 behavior classes remain**:

1. **empty-runtime persistence guard/warning integration** — current source assertions check `allowEmptyRuntime: options.allowEmptyGroupPersistence === true` and the warning text `已阻止空分群配置覆盖 SQLite`;
2. **explicit group-row deletion / intentional empty persistence** — current source assertions check `storageAdapter.deleteGroupConfig(id)` and `allowEmptyGroupPersistence: explicitlyBecameEmpty`.

These two concerns are closely related but must first be mapped to existing PR #85 behavior coverage. If they can be proved through one stable persistence boundary without duplicate coverage, one later round may close both; otherwise expect two bounded rounds. Do not manufacture duplicate tests just to reduce the count.

After these reach zero, GG-AUD-004/005 source-shape cleanup is complete. The broader audit campaign still has separate backlog items below; that is a new phase, not hidden work inside this source-shape cleanup.

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

Do not reopen these from stale notes without current-main evidence of regression.

## Reusable audit rules

- Runtime/security behavior is not proved by source strings. Prefer real execution boundaries and preserve negative contracts.
- Keep genuinely static build/release wiring checks static.
- Re-fetch current `main` before reopening old findings.
- Node/TS loader incompatibility is not product failure; test through the supported loader/build path.
- SQLite persistence may normalize sparse legacy shapes; behavior tests should protect ownership/value semantics rather than forbid documented normalization unless exact shape is itself the contract.
- `main` metadata HEAD, accepted runtime artifact commit, and live production are distinct.
- Do not mass-refactor unrelated architecture while closing one bounded audit item.

Detailed recurring failure patterns belong in `docs/PITFALLS.md`.

## Broader audit backlog after GG-AUD-004/005

- GG-AUD-006 — very large serial test/verifier concentration; assess cost before splitting.
- GG-AUD-007 — substantial `any` usage; quantify and prioritize by trust boundary.
- GG-AUD-008 — monolithic modules; identify one ownership boundary at a time.
- GG-AUD-009 — `infra` / `infrastructure` duplication; map ownership/imports first.
- GG-AUD-010 — re-check whether bounded source-level coding guidance is still missing.
- GG-AUD-012 — import-side-effect monkey patching; re-inspect current callsites.
- GG-AUD-013 — StorageAdapter monolith; re-measure responsibilities before splitting.
- GG-AUD-014 — stale schema/types; identify concrete drift before editing.
- GG-AUD-015 — Node 22/24 behavior drift; review CI/runtime matrix.
- GG-AUD-016 — memory smoke test is not a required release gate; verify workflow before changing.
- GG-AUD-017 — duplicated WebUI tests; consolidate only with equivalent coverage.
- GG-AUD-018 — architecture lint scope is too local; map important boundaries first.
- GG-AUD-030 P3 — unused production symbols/parameters/types remain cleanup debt; do not hide them with ignores.

Independent operational/product issues such as OneBot result `120` and PR #56 are not automatically part of this campaign.

## Next operation

1. Re-read canonical docs and re-fetch `main`.
2. Distinguish current metadata HEAD, accepted artifact commit, and live production.
3. Confirm no same-task active PR/branch; PR #56 stays independent.
4. Inspect the two remaining persistence source-shape classes against current `saveConfigStrict`, `group_api.ts`, StorageAdapter behavior, and PR #85 coverage.
5. Prefer one stable behavior boundary if it can cover the shared persistence contract without duplicating tests; otherwise close one class only.
6. PR -> final-head CI/Build -> merge with expected head SHA -> exact main CI/Build/SnowLuma/Plugins verification -> artifact IDs/digests -> metadata-child classification.
7. Production remains untouched unless explicitly authorized.
