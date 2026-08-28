# GroupGuard Project State

Updated: 2026-08-28

## Canonical repository

- Canonical development branch: `main`.
- Repository workflow rules are defined by `AGENTS.md` and require task branches, CI, PR merge, main verification, and cleanup before a development task is considered complete.
- PR `#46 feat: add global bot output language and dual-host deploy` is the implementation record for the multilingual-output and immutable 89/121 deployment package.
- PRs `#47` and `#48` hardened the Windows immutable-bundle launcher after real Windows PowerShell 5.1 startup failures.
- PR `#50 fix: make battle image delivery the feature default` is the implementation record for the battle-query output-preference repair.

## Battle query delivery default

The `查战绩` intranet command now treats output preference as an explicit battle-delivery concern instead of inferring group intent from already-merged effective settings:

- a stored active group `lolQueryOutputFormat` override wins first;
- a stored `useGlobal=true` row does not reactivate dormant output-format values;
- an explicit `queryCommandProfiles.lol_battle.outputFormat` wins next;
- when neither group nor battle profile specifies a format, battle uses the feature default `image`;
- the intranet request continues to advertise `capabilities.image=true`;
- the SnowLuma query WebUI presents the same battle default and precedence.

This repository change does not by itself deploy or restart an ARM production runtime. Runtime state must be verified separately before any later production rollout.

## Global output-language implementation

The global output locale supports:

- `zh-CN` — Simplified Chinese, default and backward-compatible mode;
- `zh-TW` — Traditional Chinese;
- `en` — English.

Important boundaries:

- command/input language is unchanged;
- localization happens at final OneBot text egress and on successful Q群管家 delegated text;
- images/files are not rewritten;
- URLs, CQ codes, placeholders, Windows/POSIX paths, inline code, and fenced code are protected;
- administrator-authored Q&A source data is not rewritten in storage;
- common built-in notices use local translations;
- arbitrary custom content uses translation providers with in-memory caching;
- English fails closed with an English temporary-unavailable notice when unseen arbitrary content cannot be translated.

The SnowLuma WebUI exposes `global.outputLocale` under global/advanced configuration and synchronizes the generic advanced-form field after save.

## Translation provider/privacy policy

Translation networking is explicit:

- no `GROUPGUARD_TRANSLATE_ENDPOINT`: built-in public provider chain is allowed;
- explicit empty endpoint or `GROUPGUARD_TRANSLATE_ENDPOINT=off`: arbitrary remote translation disabled;
- custom/private endpoint: exclusive by default;
- only `GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK=1|true|yes|on` permits fallback to a public provider;
- `GROUPGUARD_TRANSLATE_API_KEY` is sent only to the configured POST translation endpoint.

## Dual-host deployment model

Two dual-host entry points exist:

1. repository-based local build/update: `DEPLOY-GROUPGUARD-89-121.cmd` -> `scripts/windows/groupguard-update-89-121.ps1`;
2. immutable prebuilt bundle: GitHub Actions `GroupGuard Build` -> `groupguard-deployment-bundle-<commit>`.

The immutable bundle contains prebuilt SnowLuma `dist`, exact commit/build manifest, SHA-256, Windows one-click runner, remote topology helper, audited deploy helper, and audited rollback helper.

Deployment remains code-only and preserves runtime `config.json`, SQLite/data, logs, credentials, and secrets. The deploy helper creates a code backup before switching, restarts the verified container, and requires authenticated `/api/build-info` plus `/api/health` verification of the exact target commit. Failed post-switch verification triggers automatic restoration.

Fleet invariant:

> both hosts finish on the accepted new commit, or every host already completed by that release attempt is rolled back to its recorded pre-deployment code.

## Per-host topology preflight

The 2026-08-28 production attempt proved that treating the 89 and 121 host layouts as identical is unsafe. Dual-host launchers are being hardened so **both host topologies must be verified before either host changes code**.

`scripts/windows/groupguard-remote-topology.sh` is read-only apart from its temporary transport file. It verifies the existing container and resolves an app root only when all of these are true:

- the path is safely below `/mnt/sda1/groupguard/`;
- existing `config/`, `data/`, and `dist/` directories are present;
- `dist/snowluma-service.mjs` exists;
- the candidate is associated with the live container mounts;
- exactly one safe candidate can be identified.

If the requested default path is missing, the helper may select a unique verified candidate from the live mount topology. If no unique candidate or container can be proved, the release fails closed before any host code switch and prints topology candidates for diagnosis. The launcher retains a separate app/backup/container profile for every host and uses the same profile for rollback.

Never create a guessed app directory merely to make deployment proceed.

## Windows immutable-bundle hardening

Real local runs exposed and fixed two Windows PowerShell 5.1 startup issues:

1. quoted `%~dp0` with a trailing backslash could pass an illegal quote into `-PackageDir`;
2. `[string]$PackageDir = $PSScriptRoot` could evaluate before `$PSScriptRoot` was populated, producing an empty `Join-Path` input.

The current launcher no longer passes the dangerous `%~dp0` directory argument, resolves `$PSScriptRoot` inside the script body, validates/normalizes the package root, and supports `-PreflightOnly`.

`GroupGuard Build` includes a dedicated Windows PowerShell 5.1 startup-preflight job and executes the generated bundle's local preflight before artifact upload.

## 2026-08-28 production attempt evidence

A real run of immutable bundle commit `719451423ce576e527513780b7df7fb8199c67f7` established:

- local package root, manifest, and archive SHA validation succeeded;
- `192.168.3.89` accepted `/mnt/sda1/groupguard/app`, deployed the target build, and passed deployment verification;
- `192.168.3.121` returned `APP_DIR_MISSING=/mnt/sda1/groupguard/app` before its code switch;
- fleet reconciliation then rolled 89 back to its recorded pre-deployment code and verified that rollback;
- 121 was not switched to the candidate;
- therefore the release did **not** complete on either host as a dual-host production release;
- `/mnt/sda1/groupguard/app` is now explicitly disproved as a verified 121 app root.

The final production topology on 121 remains unknown. The next attempt must run all-host topology preflight before deploying 89. If 121 has no initialized GroupGuard runtime that can be uniquely identified, initialization/bootstrap of 121 is a separate task and must not be guessed by the updater.

## Historical production evidence

Historical repository evidence for `192.168.3.89` records:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`;
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`;
- container: `groupguard-snowluma`;
- authenticated HTTP verification: `200`;
- backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`.

No historical verified production manifest for `192.168.3.121` has been recorded.

## Retained production invariant: target-file push

The target-file push root `/` remains an exclusive managed QQ group-file directory for its configured target group. Successful reconciliation converges the managed root to exactly one authoritative latest file.

## Operational handoff

For the next multilingual production deployment:

- require the accepted change on `main`;
- prefer the immutable `groupguard-deployment-bundle-<main-commit>` artifact;
- require successful topology preflight on **both** 89 and 121 before any code switch;
- deploy 89 first only after both profiles have been resolved;
- require exact-build health on 89 before 121 deploy begins;
- if a later host fails after deployment starts, use reverse-order fleet rollback with each host's verified topology profile;
- preserve per-host deployment manifests under `%LOCALAPPDATA%\GroupGuard\deployment-state`;
- if topology cannot be proved, stop instead of creating or overwriting a guessed runtime location.
