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
- Q群管家 delegated text is localized before successful delegated delivery; if routing falls back to the normal bot, the original message is preserved so OneBot egress localizes it exactly once;
- images/files are not rewritten;
- URLs, CQ codes, placeholders, Windows/POSIX paths, inline code, and fenced code are protected from Traditional-Chinese conversion and remote translation;
- administrator-authored Q&A source data is not rewritten in storage;
- common built-in notices have local fast translations;
- arbitrary custom content uses translation providers with in-memory caching;
- Traditional Chinese has deterministic local conversion/fixups for common GroupGuard text and preserves protected machine-sensitive spans byte-for-byte;
- English fails closed with an English temporary-unavailable notice if unseen arbitrary content cannot be translated, so selecting English does not intentionally leak Simplified Chinese.

The SnowLuma WebUI exposes the selector under global/advanced configuration, saves `global.outputLocale`, and synchronizes the generic advanced-form field so a later unrelated global save cannot silently revert the language selector.

## Translation provider/privacy policy

Translation networking is explicit:

- with no `GROUPGUARD_TRANSLATE_ENDPOINT` environment variable, the built-in public provider chain is allowed;
- an explicitly empty endpoint or `GROUPGUARD_TRANSLATE_ENDPOINT=off` disables arbitrary remote translation;
- a configured custom/private endpoint is exclusive by default;
- only `GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK=1|true|yes|on` permits fallback from a failed custom endpoint to the public provider;
- `GROUPGUARD_TRANSLATE_API_KEY` is sent only to the configured POST translation endpoint.

This prevents a private-endpoint failure from silently forwarding administrator-authored Q&A or other output text to a different public translation service.

## Deployment tooling for 192.168.3.89 and 192.168.3.121

Two dual-host paths are represented in the task:

1. repository-based local build/update: `DEPLOY-GROUPGUARD-89-121.cmd` -> `scripts/windows/groupguard-update-89-121.ps1`;
2. immutable prebuilt bundle: GitHub Actions `GroupGuard Build` -> `groupguard-deployment-bundle-<commit>`.

The immutable bundle contains a prebuilt SnowLuma `dist`, exact commit/build manifest, SHA-256, Windows one-click runner, audited remote deploy helper, and audited remote rollback helper. It deploys sequentially to 89 and then 121.

Both deployment paths are code-only and preserve runtime `config.json`, SQLite/data, logs, credentials, and secrets. The remote deploy helper creates a code backup before switching, restarts `groupguard-snowluma`, and requires authenticated `/api/build-info` plus `/api/health` verification of the exact target commit. A failed post-switch health/build-identity check triggers an automatic code-restoration attempt on the failing host.

The dual-host fleet invariant is now transactional at the release level:

> both hosts finish on the accepted new commit, or every host already completed by that release attempt is rolled back to its recorded pre-deployment code before the launcher returns ordinary failure.

If 89 succeeds and 121 later fails, 121 first uses its own automatic restoration path when applicable, then 89 is rolled back using the normal audited rollback helper. Completed hosts are reconciled in reverse order. If any reconciliation rollback fails, the launcher returns a dedicated fleet-reconciliation failure and names the host requiring manual attention instead of reporting success with an intentionally split fleet.

Production should use a deployment bundle produced from the accepted `main` commit, not a PR-head artifact.

## Engineering verification for PR #46

During development, CI caught and prevented a real Traditional-Chinese edge case where `然后` remained partially simplified. The egress guard was corrected and regression coverage checks that ordinary Chinese is converted while URLs, inline code, fenced code, image segments, and forward-node protected text remain unchanged.

PR review also caught four material integration/safety issues before merge, all addressed on the task branch:

- Q群管家 could bypass the final locale transform;
- a private translation endpoint failure could fall through to a public translator without an explicit privacy opt-in;
- the output-language selector could be reverted by a stale generic advanced-form value;
- a later-host deployment failure could leave an earlier host intentionally on the new release.

Required final verification includes:

- TypeScript typecheck;
- output-locale and translation-policy regression suite;
- full `npm test` suite;
- architecture/risk/query/runtime regression gates;
- PowerShell syntax and Windows launcher safety checks;
- LF-only remote shell transport checks;
- unsafe remote-path rejection;
- authenticated exact-build deployment health checks;
- reverse-order fleet rollback/reconciliation behavior;
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
- if a later host fails, require reverse-order rollback of hosts already completed by that release attempt;
- preserve per-host deployment manifests under `%LOCALAPPDATA%\GroupGuard\deployment-state`;
- if business behavior is wrong despite a fully successful technical deployment, use the audited rollback workflow with scope chosen from the observed problem rather than replacing runtime configuration or data.
