# GroupGuard Project State

Updated: 2026-09-14

## Authorization security release ready for WebUI self-update — 2026-09-14

- PR #64 (`fix: harden authorization before WebUI self-update`) is merged into `main` at `9318d86415cbb726b022511d11d6a598b4237216`.
- The unsafe legacy group activation path no longer treats `PRO-30-*` or `PRO-PERM-*` prefixes as valid paid activation codes. Group activation is fail-closed until a verifiable activation mechanism exists; authorization/renewal remains available through the robot-owner flow and authenticated WebUI.
- Owner-granted durations now accept only a positive integer number of days or `永久`. WebUI license writes reject malformed/negative/non-integer durations rather than converting invalid input into a permanent authorization. Stored `expireTime=0` is rendered consistently as permanent.
- The hourly `AuthManager` sweep consumes its timer Promise rejection locally and isolates each group-notification send failure, so one OneBot send rejection does not abort the remaining license sweep or reach the worker-level fatal `unhandledRejection` handler.
- Authorization security behavior is covered by the existing `verify:project-wide-bugfixes` gate inside normal `npm test`.
- PR validation passed `GroupGuard CI`, `GroupGuard Build`, and `WebUI Browser Acceptance`.
- The accepted `main` push `GroupGuard Build` run `34851006479` completed successfully and produced `groupguard-self-update-9318d86415cbb726b022511d11d6a598b4237216` (artifact id `10351326649`, digest `sha256:2e1cd58e743e8dec80d8772123d02dcb3a2c75522f13f38cf36f25ace6506bf3`, retained through 2026-10-14).
- The same `main` commit passed `GroupGuard CI` run `34851006474`, including `npm test`, production dependency audit, deployment safety checks, SnowLuma build, and cross-repository mock contracts.
- Automated plugin metadata then advanced `main` to `25ab5e0a33d8eb9d4eb84bb9b9843df674b126f8` with `chore: auto-update plugin.json [skip ci]`. This does not invalidate the updater candidate: the WebUI updater selects successful `main` `GroupGuard Build` runs with an exact matching `groupguard-self-update-<run-head-sha>` artifact, so `9318d864...` remains the newest verified self-update candidate for this release.
- No ARM runtime was changed or restarted by this repository task. The operator may use the already accepted WebUI **系统更新 → 检查更新 → 一键更新** flow on a self-update-capable runtime whose private-repository update token is configured.

## Accepted per-group controls + WebUI self-update — 2026-09-11

- PR #59 (per-group self-recall) is merged into `main`.
- PR #60 (selected-group LOL patch notices + SnowLuma WebUI self-update) is merged into `main`.
- PR #61 fixes the production `self_update_artifact_http_415` failure and is merged into `main`; accepted updater implementation commit is `38fa481e1c1dec41f5fa3c05f94bb9a08711c5d1`.
- LOL patch `@全体` recipients are explicit `lolPatchNotifyGroupIds` intersected with currently valid authorized groups; missing/empty means no destinations.
- Per-group self-recall is independently configurable and preserves sparse inheritance semantics instead of materializing inherited values as new group overrides.
- SnowLuma admin WebUI exposes authenticated update status/token/check/apply controls under **系统更新**. Update source is fixed to the private canonical repository and successful `main` `GroupGuard Build` artifacts named `groupguard-self-update-<commit>`.
- Private-repository updater credentials are accepted from `GROUPGUARD_UPDATE_GITHUB_TOKEN` or the private data file `self-update/github-actions-token.txt`; they are not written back to `config.json` or exposed by the status UI.
- Candidate validation covers managed runtime entry, archive path/type/size limits, exact `dist` file-set manifest, per-file SHA-256/size, build-info commit, supervised exact-commit startup, automatic rollback, and updater-owned temporary-directory cleanup.
- GitHub Actions artifact download follows the verified two-step protocol: authenticated REST request with `Accept: application/vnd.github+json` and `redirect: manual`, require HTTP 302 + HTTPS `Location`, then download the signed URL without forwarding the repository token.
- A live protocol test against a real private `main` artifact passed before PR #61 merge.
- Operator-provided ARM Docker acceptance evidence confirms one live SnowLuma deployment completed a real WebUI one-click update to `38fa481e1c1dec41f5fa3c05f94bb9a08711c5d1` with `受管运行入口=是`, `complete / complete`, `100%`, and “新版本已启动并通过提交校验”。No manual container restart was used after pressing the update button.
- This acceptance proves the end-to-end path for that live deployment: private-repo authentication → artifact discovery/download → ZIP/manifest/hash validation → `dist` switch → supervisor restart → exact commit ready check. It does **not** by itself assert that every historical ARM host has been upgraded to the same commit.

The earlier “candidate / production unchanged” notes for this feature are superseded by this accepted state.

## Reliability hardening candidate — 2026-09-05

- Development candidate: `codex/reliability-hardening`, based on freshly fetched `origin/main@ec633573c0dc1056e8d861429312983ed9f107e7`.
- Scope: repair the verified P1 reliability findings and related P2 safety issues from the 2026-09-05 audit: ordered/bounded OneBot intake, verification prompt ordering, bounded caches/queues/media work, durable target-file ordering, action-result correctness, graceful shutdown, storage retention/integrity, dynamic-command validation, WebUI authentication hardening, SSRF protection, explicit translation consent, and Windows EOL normalization.
- Local validation: full `npm test`, `npm run build:all`, and production dependency audit pass. This is development evidence only; CI/PR review and production runtime validation remain separate.
- Production remains unchanged. No ARM deployment or restart is authorized by this development task.

## Canonical repository

- Canonical development branch: `main`.
- PR `#50 fix: make battle image delivery the feature default` is merged.
- The accepted battle-query implementation commit is `23ed0084eb2214e591a0108b5b82d33fb10b00ba`.
- The later `main` commit `1c36c9e8fb9f86577f1c6cf5e3396041e73b4664` is the automated `plugin.json` refresh whose parent is `23ed0084...`; therefore current `main` contains the accepted battle fix.
- Issue `#51` tracks the production-state handoff and rebuildable-download follow-up.

## Accepted production state — 2026-08-28

Operator-reported production state after PR #50:

- the SnowLuma/GroupGuard `dist` built from `23ed0084eb2214e591a0108b5b82d33fb10b00ba` was manually replaced on both `192.168.3.89` and `192.168.3.121`;
- `192.168.3.121` was functionally tested with `查战绩` after replacement and returned the expected image result;
- `192.168.3.89` was replaced with the same accepted `dist`, but no new business-level query probe for 89 was captured in this task;
- runtime `config.json`, SQLite/data, logs, credentials, and secrets were not part of the code replacement.

The accepted production behavior for `查战绩` is:

1. active explicit group `lolQueryOutputFormat` override;
2. `queryCommandProfiles.lol_battle.outputFormat`;
3. built-in battle default `image`.

A stored row with `useGlobal=true` does not reactivate dormant group output values. WebUI and runtime now use the same battle precedence semantics.

## Production topology evidence

Verified/observed topology is host-specific and must not be assumed identical:

### 192.168.3.89

- container: `groupguard-snowluma`;
- historical verified application root: `/mnt/sda1/groupguard/app`;
- historical verified backup root: `/mnt/sda1/groupguard/backups`.

### 192.168.3.121

Read-only runtime diagnostics on 2026-08-28 observed:

- container: `groupguard-snowluma`;
- container workdir: `/app`;
- host bind mount: `/mnt/groupguard-data/groupguard/app -> /app`;
- query/WebUI listener: port `6108`.

The old requested path `/mnt/sda1/groupguard/app` is not a valid assumption for 121. Deployment helpers must continue resolving each host from live container mounts and existing `config/`, `data/`, and `dist/` layout before mutation.

## Downloadable deployment artifacts

The accepted merge commit `23ed0084...` has successful `main` push builds:

- `Build SnowLuma Service` run `33133786561` produced `groupguard-snowluma-service`;
- `GroupGuard Build` run `33133786572` produced `groupguard-deployment-bundle-23ed0084eb2214e591a0108b5b82d33fb10b00ba`;
- the immutable deployment bundle artifact id is `9671262220` with digest `sha256:9583d103d6783a0bc321d8bf83768380006f34b1c0fb3f31cc042650d5870e6e`;
- that Actions artifact is currently retained until `2026-11-26T01:44:40Z`.

For current self-update capable builds, `GroupGuard Build` also produces `groupguard-self-update-<commit>` artifacts consumed by the WebUI updater. The updater only considers successful `main` push builds and validates the exact target commit before switching runtime code.

The preferred production handoff is the `GroupGuard Build` artifact produced from an accepted `main` commit, not a PR-head artifact.

To avoid losing the ability to produce a current deployment bundle after stored Actions artifacts expire, `GroupGuard Build` supports manual `workflow_dispatch`. An operator can open GitHub Actions, run `GroupGuard Build` on `main`, and receive a fresh `groupguard-deployment-bundle-<current-main-commit>` without changing production first.

## Deployment safety invariant

The immutable bundle is code-only and contains the prebuilt SnowLuma `dist`, exact commit/build manifest, archive SHA-256, one-click Windows launcher, topology resolver, deploy helper, and rollback helper.

Before either host changes code, the bundle must resolve and verify both host topologies. The fleet invariant remains:

> both hosts finish on the accepted new commit, or every host already completed by that release attempt is rolled back to its recorded pre-deployment code.

The WebUI self-updater has a separate single-runtime invariant: it may only replace the managed application `dist`; it keeps the previous `dist` as a rollback candidate, starts the new worker through the supervisor, and accepts the switch only after an exact target-commit ready signal. Runtime configuration/data/logs/secrets remain outside the replacement set.

Never create a guessed application directory merely to make deployment proceed. Runtime configuration/data/logs/secrets stay outside the replacement set.

## Next engineering priorities

The battle output-precedence defect is closed at code level and has passed 121 production acceptance. The per-group self-recall, selected-group LOL patch notification routing, and WebUI self-update work are also closed at code level, with one live ARM Docker self-update acceptance recorded above. The 2026-09-14 authorization security release is merged and has a verified `main` self-update artifact; production remains unchanged until an operator applies it.

Remaining independent findings are separate tasks, especially:

- authenticated query-console SSRF hardening and response-byte limits;
- explicit WebUI Origin/CSRF defense for cookie-authenticated mutation routes;
- target-file DNS rebinding/connection pinning hardening;
- intermittent OneBot `send_group_msg` rejection with result `120`;
- dynamic-command validation failures for legacy/identifier mappings;
- historical per-group configuration snapshots that may need controlled compaction rather than blind overwrite.

Do not conflate those items with the now-fixed battle image-preference, self-update implementation, or authorization activation bypass.
