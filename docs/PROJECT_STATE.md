# GroupGuard Project State

Updated: 2026-09-05

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

The preferred production handoff is the `GroupGuard Build` artifact produced from an accepted `main` commit, not a PR-head artifact.

To avoid losing the ability to produce a current deployment bundle after stored Actions artifacts expire, `GroupGuard Build` supports manual `workflow_dispatch`. An operator can open GitHub Actions, run `GroupGuard Build` on `main`, and receive a fresh `groupguard-deployment-bundle-<current-main-commit>` without changing production first.

## Deployment safety invariant

The immutable bundle is code-only and contains the prebuilt SnowLuma `dist`, exact commit/build manifest, archive SHA-256, one-click Windows launcher, topology resolver, deploy helper, and rollback helper.

Before either host changes code, the bundle must resolve and verify both host topologies. The fleet invariant remains:

> both hosts finish on the accepted new commit, or every host already completed by that release attempt is rolled back to its recorded pre-deployment code.

Never create a guessed application directory merely to make deployment proceed. Runtime configuration/data/logs/secrets stay outside the replacement set.

## Next engineering priorities

The battle output-precedence defect is closed at code level and has passed 121 production acceptance. Remaining independent findings from the 121 configuration audit are separate tasks, especially:

- intermittent OneBot `send_group_msg` rejection with result `120`;
- dynamic-command validation failures for legacy/identifier mappings;
- historical per-group configuration snapshots that may need controlled compaction rather than blind overwrite.

Do not conflate those items with the now-fixed battle image-preference bug.
