# GroupGuard Project State

Updated: 2026-09-15

## Current canonical state

- Canonical repository: `xianyumht-cmd/groupguard-system`.
- Canonical development branch: `main`.
- At the start of the current PR #87 round, GitHub `main` HEAD was `6e5dc89650f4548db92a3e78914fec98998ab8ce`.
- `6e5dc896...` is an automated `chore: auto-update plugin.json [skip ci]` metadata-only child of the latest accepted code/artifact commit `1fcc85470d03d14b22dcffb13867a13b064cf971` (merge of PR #86). Its only change is `plugin.json.updateTime`.
- Latest fully verified `main` workflows for artifact commit `1fcc854...` all succeeded:
  - GroupGuard CI #919;
  - GroupGuard Build #923;
  - Build SnowLuma Service #132;
  - Build & Release Plugins #197.
- Latest verified WebUI self-update artifact for `1fcc854...`:
  - artifact id `10392718768`;
  - SHA-256 `6b5381805efa15f0c16e308d2ba247e27d3c289b780e29832b1945c8a9f448f7`.
- Matching deployment bundle:
  - artifact id `10392584350`;
  - SHA-256 `69f9c503a64f978bfca88ab79e9483f139a3d162ee56a708827f419e67c880d5`.
- Matching build log:
  - artifact id `10392872060`;
  - SHA-256 `266dcd5214c2bf729b37e7ed41c451cb2d875bad58bf9a4314ee9f42284b2d1b`.
- Always re-fetch `main` in a new session because later audit merges or plugin metadata automation may advance it.

### Production/runtime evidence boundary

- The operator last explicitly confirmed the live ARM runtime at `9318d86415cbb726b022511d11d6a598b4237216` after a successful WebUI one-click update.
- No later audit round deployed, restarted, or otherwise mutated production.
- Therefore do **not** claim that production is running `1fcc854...`, `6e5dc896...`, PR #87, or any later audit commit without fresh runtime/operator evidence.
- The audit strategy is to accumulate reviewed fixes and later perform one operator-authorized WebUI one-click upgrade, not one production update per PR.
- Repository `main`, accepted build/artifact commit, Windows checkout, and ARM runtime are separate evidence states.

### Repository hygiene snapshot

- Several already-merged historical audit/feature branches remain remotely. Do not delete them without proving their unique history is reachable from `main` or safely archived.
- PR #56 (`perf: trace queued query delivery stages`) remains open and independent. Do not merge, close, or fold it into this audit without fresh scope review.

## Audit campaign working rule

One user `继续` round handles one medium issue end-to-end, or at most two tightly related small issues: latest-main inspection, bounded change/test when warranted, PR, final PR CI/Build, merge, exact `main` verification, artifact verification, and canonical state reconciliation. Production remains unchanged unless the operator explicitly authorizes deployment/restart in that task.

## Completed security/reliability findings

| ID | Final result | PR / accepted commit |
| --- | --- | --- |
| GG-AUD-019 P0 + GG-AUD-026 P2 | Prefix-only activation authority disabled; malformed duration handling fails closed. | #64 / `9318d864...` |
| GG-AUD-001 | Auth timer/send rejection regression now behavior-covered. | #64 + #75 |
| GG-AUD-021 P1 | Authenticated query-test SSRF/unbounded response path constrained to configured targets with bounded/manual-redirect behavior. | #66 |
| GG-AUD-022 P1 | DNS validation/fetch TOCTOU hardened with per-hop resolution, validation, and socket pinning. | #67 |
| GG-AUD-023 P2 | Unsafe cookie-auth mutations require same-host Origin; explicit token clients remain supported. | #68 |
| GG-AUD-024 P2 | SUB resource containment uses realpath + regular-file checks; symlink escape rejected. | #69 |
| GG-AUD-029 P2 | Lanzou host validation uses exact/subdomain boundaries and HTTP(S), not substring matching. | #70 |
| GG-AUD-025 P1 | Stored `free` license no longer satisfies paid runtime gates; explicit Enterprise minimum supported. | #71 |
| GG-AUD-028 P2 | Browser no longer stores the WebUI master token; opaque signed session is used. | #72 |
| GG-AUD-020 | Legacy `owner/admin` permission maps to `admin`, not public `all`. | #73 |
| GG-AUD-027 | Malformed/missing group identity now fails closed; forged protocol role was disproved as the actual vulnerability. | #74 |

Do not reopen these from stale audit notes without current-main evidence that they regressed.

## Completed code-quality / test-infrastructure work

| ID | Final result | PR |
| --- | --- | --- |
| GG-AUD-002 | Added semantic TypeScript control-flow lint gate (`noImplicitReturns`, `noFallthroughCasesInSwitch`). | #76 |
| GG-AUD-003 | Added separate Node-script and Playwright browser-test typecheck profiles in their correct dependency environments. | #77 |
| GG-AUD-004/005 target-file hotspot | Source-order callback auth assertion replaced with real HTTP callback-token vs WebUI-token behavior. | #78 |
| GG-AUD-011 | Self-update download-token, hostile archive/manifest, managed-runtime, completion and rollback contracts behavior-tested; static release wiring kept static. | #79–#81 |
| GG-AUD-004/005 WebUI hotspot | Exact server/theme call-shape assertions replaced with authenticated temporary-port Admin HTTP behavior. | #83 |
| GG-AUD-004/005 four-query hotspot | Exact `preferred: 'text'` source check replaced with real lolban/scammer/peer/dynamic delivery request behavior for `text`, `forward`, `image`. | #84 |
| GG-AUD-004/005 group-config mutation hotspot | `group_api.ts` source markers replaced by authenticated Admin API + isolated SQLite behavior for set/restore/inheritance/dormant-row/ownership semantics. | #85 |
| GG-AUD-004/005 output-locale adapter hotspot | Adapter call-shape strings replaced with real `PluginStateContextAdapter` behavior: Q群管家 gets localized copy; fallback OneBot receives original and localizes exactly once at egress. | #86 / accepted artifact `1fcc854...` |
| GG-AUD-004/005 force-send hotspot | Historical GG-BUG-004 `force` regression no longer checks for exact `state.ts` text. PR #87 executes the real `pluginState` public send entry points with reply probability `0`: `sendGroupText`, `sendGroupMsg`, and `sendPrivateMsg` do not send when `force` is omitted; a truthy non-boolean runtime value is not force; explicit `force:true` bypasses the probability gate. Fake in-memory actions prevent QQ/network side effects. Production implementation code is unchanged. Code-only head `09d062f58d8197dd66e8307b792b462583bc4832` passed GroupGuard CI #921 and GroupGuard Build #925. | #87 / test-only; awaiting final docs-head/main verification |

### GG-AUD-004/005 source-text inventory classification

Migrated behavior-critical hotspots now include:

- target-file callback authorization;
- self-update security behavior;
- WebUI page/theme serving;
- four-query three-mode delivery preference;
- Admin group-config mutation/inheritance semantics;
- output-locale Q群管家 adapter routing;
- GG-BUG-004 explicit force-send semantics.

Intentional static contracts remain static where source/build shape is itself the contract, including the PowerShell/workflow rollback assertions in `verify-output-locale.ts` and other release/packaging wiring checks.

The heterogeneous tail of `scripts/verify-project-wide-bugfixes.ts` must still **not** be migrated wholesale. After PR #87, its remaining source-shape concerns are:

- version fallback / runtime version resolution;
- empty-group persistence call wiring and warning path;
- config API preservation of existing groups;
- group-row deletion + explicit-empty persistence wiring.

Review exactly one coherent boundary per round. If a concern is genuinely static wiring rather than observable runtime behavior, retain/reclassify it with evidence instead of forcing a behavior rewrite.

## Reusable pitfalls from this campaign

- Runtime/security behavior is not proved by source strings. Prefer public execution boundaries and preserve the negative contract.
- Re-fetch current `main` and canonical state before reopening any old finding.
- Node 22 strip-only TypeScript cannot import every production dependency graph; distinguish harness incompatibility from product failure.
- Script and Playwright typechecks must run in the dependency environments they model.
- `main` metadata HEAD, accepted runtime artifact commit, and live ARM production are distinct states.
- Sparse persisted group overrides should be typed as sparse fixtures; do not broaden production types just to satisfy a test fixture.
- Do not mass-refactor unrelated protocol/storage/monolith code while closing a narrow audit item.
- Do not weaken or delete a regression merely because a safe refactor changed source shape; migrate it when practical.

Detailed recurring failure patterns and prevention rules live in `docs/PITFALLS.md`.

## Remaining audit backlog

- **GG-AUD-004 / GG-AUD-005** — continue bounded classification/migration of the remaining `verify-project-wide-bugfixes.ts` source-shape tail. If only legitimate static contracts remain, close/reclassify with evidence rather than manufacturing changes.
- **GG-AUD-006** — very large serial test/verifier concentration; assess cost before splitting.
- **GG-AUD-007** — substantial `any` usage; quantify and prioritize by trust boundary.
- **GG-AUD-008** — monolithic modules; identify one ownership boundary at a time.
- **GG-AUD-009** — `infra` / `infrastructure` duplication; map real ownership/imports first.
- **GG-AUD-010** — re-check whether bounded source-level coding guidance is still missing beyond strong workflow/evidence rules.
- **GG-AUD-012** — import-side-effect monkey patching; re-inspect current callsites.
- **GG-AUD-013** — StorageAdapter monolith; re-measure responsibilities before splitting.
- **GG-AUD-014** — stale schema/types; identify concrete drift before editing.
- **GG-AUD-015** — Node 22/24 behavior drift; review CI/runtime matrix.
- **GG-AUD-016** — memory smoke test is not a required release gate; verify current workflow before changing.
- **GG-AUD-017** — duplicated WebUI tests; consolidate only with equivalent behavior coverage.
- **GG-AUD-018** — architecture lint scope is too local; map important boundaries first.
- **GG-AUD-030 P3** — 31 unused production symbols/parameters/types remain real cleanup debt; do not hide them with ignores.

Independent operational/product issues such as OneBot result `120` and PR #56 are not automatically part of this audit campaign.

## Next operation for a new ChatGPT/Codex session

1. Read `AGENTS.md`, `docs/AI_CONTEXT.md` when present, this file, `docs/PITFALLS.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/AI_WORKSTYLE.md`.
2. Re-fetch latest `main`; distinguish current HEAD from the latest successful runtime/self-update artifact commit and from live production `9318d864...`.
3. Confirm no same-task active PR/branch before writing. PR #56 remains independent.
4. Continue **one** remaining `verify-project-wide-bugfixes.ts` concern only. The next coherent candidate is the runtime-version fallback assertion (`!state.includes("return '1.0.0'")`): inspect the current version-resolution implementation and SnowLuma build/runtime seam, then decide whether runtime version is behavior-observable under a stable test boundary. Do not assume the exact implementation or add production seams merely for test convenience.
5. Do not also touch empty-group persistence/config-API/group-row deletion in that same round.
6. Keep legitimate release/build wiring assertions static when source/build shape is the real contract.
7. PR -> final-head CI/Build -> merge using expected head SHA -> verify exact `main` CI, Build, SnowLuma, Plugins workflows -> record exact artifact IDs/digests -> classify any metadata-only plugin child.
8. Keep production unchanged until the operator explicitly authorizes the later batched WebUI one-click upgrade.
