# GroupGuard Project State

Updated: 2026-10-19

## Current translation-fallback change (2026-10-19)

A narrowly scoped English output-translation fault-differentiation change is in progress on `fix/translation-error-fallback-20261019`. This branch does not modify lolapisevers, its sources, or the ARM runtime. Implemented: privacy-safe code-only translation fallback, conservative business-category notices, and output-locale regression coverage. PR / CI / merge / production identity must be verified separately; do not treat this branch as deployed.

## Phase status

The 2026-09 GroupGuard security/reliability audit and hardening campaign is **complete**.

Current audit disposition:

- must-fix active: **0**;
- worth-doing active: **0**;
- deferred maintenance: **4**;
- closed/completed/reclassified audit categories: **8**;
- source-shape behavior classes remaining in the project-wide verifier: **0**.

Do not automatically reopen completed findings from old chat notes. Start future work from fresh `main` evidence and one explicit scope.

## Canonical repository state

- Repository: `xianyumht-cmd/groupguard-system`.
- Branch: `main`.
- Phase-closeout PR #94 merged as `8e8cc4703265734505af93e694e2768c78484782` and added the canonical `docs/AI_CONTEXT.md` plus this compressed current-state record.
- No GitHub Actions runs were triggered for exact docs-only merge `8e8cc470...`.
- Latest accepted runtime/artifact commit remains `ca40e3159b374589bdf3403b2030bd773b1ce5d2` (PR #93 / GG-AUD-006).
- Plugin release #203 created metadata-only child `e21535728a9a3e8a47020a6af9f06d7efd0b3c41`; it changes only `plugin.json.updateTime`.

Exact-main verification for `ca40e315...` succeeded:

- GroupGuard CI #974 — run `35138970422`;
- GroupGuard Build #978 — run `35138970437`;
- Build SnowLuma Service #138 — run `35138970413`;
- Build & Release Plugins #203 — run `35138970283`.

Accepted Build #978 artifacts:

- self-update artifact `10464074840`, size `1,408,821` bytes, SHA-256 `81b464c2c756e1c2ef718f09ae2a56b5f4a1982696aa7a0c520e6659a0bb363b`, expires `2026-10-16T19:12:26Z`;
- deployment bundle `10464860135`, size `1,316,472` bytes, SHA-256 `873f6a7e06d19dbd99ee8caa29f3c25edf5ee82f3c8d9f95e2371b43c666a9ff`, expires `2026-12-15T19:10:44Z`;
- build log `10464439529`, size `2,528` bytes, SHA-256 `a60d472eeea7e8af284a7495026afa1ad04f301e04598bbf5d18e764a9441d87`, expires `2026-12-15T19:10:44Z`.

Repository `main`, accepted runtime artifact, Windows checkout and each ARM runtime are separate evidence states.

## Production rollout evidence

The operator explicitly authorized a production WebUI self-update after the audit campaign.

For the first host in the rollout sequence (89), operator-provided WebUI evidence showed:

- self-update state `complete / complete`;
- progress `100%`;
- message indicating the new version started and passed commit verification;
- writable application directory and managed runtime entry reported true.

The same captured page still displayed the pre-update `currentCommit` value while also reporting the newer successful candidate. That is internally inconsistent/stale presentation, so the exact post-refresh running commit has **not** been recorded as independently confirmed in canonical evidence yet. Do not replace this with an inferred value merely because the updater state said complete.

The second host (121) was discussed as the next rollout target, but no post-update exact-build/health evidence has been captured here yet.

A GitHub Actions PAT used by WebUI self-update was printed into the conversation during operator troubleshooting. Its value is intentionally not recorded here. Treat that credential as exposed and rotate/revoke it before relying on it for continued production operations.

Until fresh WebUI `/api/build-info`/health or equivalent operator evidence confirms each host, production runtime identity remains host-specific and not fully closed by repository evidence alone.

## Completed campaign highlights

Security/reliability work completed during the campaign includes:

- prefix-only activation authority disabled and malformed authorization durations fail closed (#64 / GG-AUD-019 + GG-AUD-026);
- authorization timer/send rejection handling hardened (#64 + #75 / GG-AUD-001);
- authenticated query-test SSRF and unbounded response constrained (#66 / GG-AUD-021);
- DNS TOCTOU hardened with per-hop validation/socket pinning (#67 / GG-AUD-022);
- unsafe cookie-auth mutations protected by same-host Origin checks (#68 / GG-AUD-023);
- SUB resource realpath/regular-file containment (#69 / GG-AUD-024);
- Lanzou domain boundary validation (#70 / GG-AUD-029);
- paid-license gating fixed (#71 / GG-AUD-025);
- opaque signed WebUI browser session introduced (#72 / GG-AUD-028);
- legacy authorization descriptor mapping fixed (#73 / GG-AUD-020);
- malformed/missing group identity now fails closed (#74 / GG-AUD-027);
- behavior coverage replaced the remaining source-shape runtime assertions;
- stored per-group config is typed as sparse overrides while effective settings remain complete (#91 / GG-AUD-014);
- first group system-write mutation no longer freezes unrelated inherited global values (#91);
- Node 22 primary CI and Node 24 formal build evidence were reconciled without forcing unnecessary code changes (#92 / GG-AUD-015);
- aggregate verifier/build chains were centralized into a serial fail-fast suite runner without changing verifier order or release behavior (#93 / GG-AUD-006).

## Deferred maintenance — not current blockers

Do not start these automatically:

- **GG-AUD-007** — tighten `any` only at specific external/trust boundaries; no repo-wide purge.
- **GG-AUD-013** — `StorageAdapter` remains a multi-domain monolith; decomposition requires a dedicated architecture plan and behavior coverage.
- **GG-AUD-018** — additional architecture-lint coverage is preventive governance work, not a current defect.
- **GG-AUD-030 P3** — unused symbols/parameters/types are bounded cleanup, not release-blocking work.

## Repository hygiene

- PR #56 (`perf: trace queued query delivery stages`) is the only open PR at this phase closeout and remains an independent performance-observability change. Do not merge, close or fold it into unrelated maintenance without fresh scope review.
- Historical PR #45 (`docs: record runtime recovery and config migration`) was closed unmerged on 2026-09-17 after its still-useful runtime/container/migration lessons were absorbed into canonical knowledge. Its old 2026-08 `PROJECT_STATE` snapshot must not be merged onto modern `main`.
- Temporary merged task branches may still exist remotely when the available connector cannot safely delete refs. Never claim deletion without performing it.

## Next operation

This engineering phase is closed.

The next task should be one of these explicit scopes only:

1. **production acceptance closeout** — rotate the exposed GitHub PAT, refresh/verify exact running commit + health on 89, complete and verify 121 if still pending, and record both host identities; or
2. **PR #56 review** — freshly rebase/reconcile its old observability branch against current `main`, then decide whether that performance instrumentation is still wanted; or
3. **new product/maintenance work** — start from current `main` and one bounded requirement.

Do not resume broad audit mode unless new current-main evidence justifies it.
