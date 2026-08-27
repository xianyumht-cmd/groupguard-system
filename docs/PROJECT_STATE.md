# GroupGuard Project State

Updated: 2026-08-27

## Canonical repository

- Canonical development branch: `main`.
- Repository workflow rules are defined by `AGENTS.md` and require task branches, CI, PR merge, main verification, and cleanup before a development task is considered complete.
- PR `#46 feat: add global bot output language and dual-host deploy` is the implementation record for the 2026-08-27 multilingual-output and 89/121 deployment-package task. Check the PR/main history before treating the feature as merged or production-deployed.

## Global output-language implementation

The 2026-08-27 implementation adds a global output locale with three supported values:

- `zh-CN` — Simplified Chinese, default and backward-compatible mode;
- `zh-TW` — Traditional Chinese;
- `en` — English.

Important boundaries:

- command/input language is unchanged; existing Chinese commands continue to work;
- localization happens at the final OneBot text egress path so Q&A, query/system notices, reply templates, link-risk notices, ordinary group/private messages, and forward-node text share one output-language boundary;
- images/files are not rewritten;
- URLs, CQ codes, placeholders, Windows/POSIX paths, inline code, and fenced code are protected from Traditional-Chinese conversion and remote translation;
- administrator-authored Q&A source data is not rewritten in storage;
- common built-in notices have local fast translations;
- arbitrary English custom content uses translation providers with in-memory caching and fails closed with an English temporary-unavailable notice if translation is unavailable;
- Traditional Chinese has a deterministic local conversion fallback for common GroupGuard text.

The SnowLuma WebUI exposes the selector under global/advanced configuration and saves `global.outputLocale` without changing command recognition.

## Deployment tooling for 192.168.3.89 and 192.168.3.121

Two dual-host paths are represented in the task:

1. repository-based local build/update: `DEPLOY-GROUPGUARD-89-121.cmd` -> `scripts/windows/groupguard-update-89-121.ps1`;
2. immutable prebuilt bundle: GitHub Actions `GroupGuard Build` -> `groupguard-deployment-bundle-<commit>`.

The immutable bundle contains a prebuilt SnowLuma `dist`, exact commit/build manifest, SHA-256, Windows one-click runner, and the audited remote deploy helper. It deploys sequentially to 89 and then 121.

Both deployment paths are code-only and preserve runtime `config.json`, SQLite/data, logs, credentials, and secrets. The remote helper creates a code backup before switching, restarts `groupguard-snowluma`, and requires authenticated `/api/build-info` plus `/api/health` verification of the exact target commit. A failed post-switch health/build-identity check triggers an automatic code-restoration attempt on the failing host.

Production should use a deployment bundle produced from the accepted `main` commit, not a PR-head artifact.

## Engineering verification for PR #46

During development, CI caught and prevented a real Traditional-Chinese edge case where `然后` remained partially simplified. The egress guard was corrected and regression coverage now checks that ordinary Chinese is converted while URLs, inline code, fenced code, image segments, and forward-node protected text remain unchanged.

Required verification includes:

- TypeScript typecheck;
- output-locale regression suite;
- full `npm test` suite;
- architecture/risk/query/runtime regression gates;
- PowerShell syntax and Windows launcher safety checks;
- LF-only remote shell transport checks;
- unsafe remote-path rejection;
- authenticated exact-build deployment health checks;
- SnowLuma production build;
- cross-repository mock contracts;
- Chromium desktop/mobile WebUI acceptance;
- immutable deployment-bundle build and artifact upload.

Use the final PR head/main workflow results as the source of truth; do not rely on an earlier successful run after later commits were added.

## Verified production evidence

The latest production state that is explicitly recorded and verified in repository documentation remains the historical 2026-08-09 deployment on `192.168.3.89`:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`;
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`;
- container: `groupguard-snowluma`;
- authenticated HTTP verification: `200`;
- backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`.

No repository evidence currently proves that the 2026-08-27 multilingual build has been deployed successfully to either host, and no historical verified production manifest for `192.168.3.121` is recorded here. The first successful dual-host deployment must verify both hosts independently and preserve the resulting manifests.

## Retained production invariant: target-file push

The target-file push root `/` remains an exclusive managed QQ group-file directory for its configured target group. The accepted invariant is that successful reconciliation converges the managed root to exactly one authoritative latest file.

## Operational handoff

For a production deployment of the multilingual change:

- require the accepted change to be present on `main`;
- prefer the immutable `groupguard-deployment-bundle-<main-commit>` artifact when a downloadable one-click package is desired;
- deploy 89 first and require exact-build health before starting 121;
- preserve per-host deployment manifests under `%LOCALAPPDATA%\GroupGuard\deployment-state`;
- if business behavior is wrong despite technical health, use the host-specific rollback workflow rather than replacing runtime configuration or data.
