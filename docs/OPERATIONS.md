# GroupGuard Operations

## Query delivery trace verification

The observability-only query change must be verified in the same distributable
path used for SnowLuma deployment:

1. Run `npm run typecheck` and the full `npm test` suite in
   `onebot-plugin-groupguard`.
2. Run `npm run build:onebot` and inspect the produced `dist` for stable trace
   identifiers including `query_delivery_observability`, T5, T6, T7,
   `t7_payload_prepare_started_at`, `onebot_processing_ms`, and
   `queue_wait_ms`.
3. Run the contract and query verification scripts against both a response
   with `meta.timing` and an older response whose `meta` has no timing object.
4. Confirm that API `api_stage_offsets_ms` and image asset offsets are retained
   while unknown timing keys and credentials are discarded. Do not deploy or
   restart production as part of this verification. A later approved
   deployment must collect fresh T0-T9 samples before any latency policy
   decision.

## Production boundary

Canonical development happens in `D:\project2\groupguard-system` on Windows. ARM runtimes such as `192.168.3.89` and `192.168.3.121` are separate production hosts.

Repository changes, successful CI, or a downloadable artifact do not by themselves authorize a production change. Production deployment/restart requires explicit user intent in the current task.

Production code deployment is code-only. Do not overwrite runtime `config.json`, SQLite/data, logs, credentials, or secrets.

## Current host topology

The two production hosts are not layout-identical.

### 192.168.3.89

Historical verified topology:

- SSH user: `root`;
- container: `groupguard-snowluma`;
- application root: `/mnt/sda1/groupguard/app`;
- backup root: `/mnt/sda1/groupguard/backups`.

### 192.168.3.121

Read-only runtime diagnostics on 2026-08-28 observed:

- SSH user: `root`;
- container: `groupguard-snowluma`;
- container workdir: `/app`;
- host bind mount: `/mnt/groupguard-data/groupguard/app -> /app`;
- WebUI/query listener: `6108`.

Do not use `/mnt/sda1/groupguard/app` as a hard-coded 121 path. The deploy flow must resolve each host independently from live container mounts and verify existing `config/`, `data/`, and `dist/snowluma-service.mjs` before mutation.

## Accepted battle-query production baseline

PR `#50` fixed battle output-preference ownership. The accepted implementation commit is:

```text
23ed0084eb2214e591a0108b5b82d33fb10b00ba
```

The operator reported replacing the same accepted SnowLuma `dist` on both 89 and 121. 121 was then tested with `查战绩` and returned the expected image result.

Battle output precedence is:

```text
active explicit group lolQueryOutputFormat
    > queryCommandProfiles.lol_battle.outputFormat
    > built-in image default
```

A `useGlobal=true` row does not reactivate dormant historical group values.

## Standard Windows single-host update workflow

After an accepted change has been merged to `main`, the repository-based single-host launcher is:

```text
GROUPGUARD-UPDATE.cmd
```

The workflow must:

1. require the canonical repository and a clean worktree;
2. update local `main` using strict fast-forward only;
3. require local `HEAD == origin/main`;
4. install dependencies from the lockfile;
5. run the automated test suite;
6. build SnowLuma `dist` with exact commit metadata;
7. package the candidate and calculate SHA-256;
8. verify SSH connectivity;
9. resolve/verify the target app topology;
10. create a timestamped code backup and pending deployment state;
11. switch only plugin code;
12. restart `groupguard-snowluma`;
13. make authenticated `/api/build-info` and `/api/health` checks;
14. require exact running commit identity, non-dirty build metadata, and ready health;
15. automatically restore the previous code when post-switch verification fails;
16. persist deployment state under `%LOCALAPPDATA%\GroupGuard\deployment-state`.

Native process exit codes are authoritative. Windows PowerShell 5.1 SSH stderr text alone is not treated as failure.

## One-click dual-host deployment

For an explicitly authorized 89 + 121 deployment, use the audited dual-host bundle or repository launcher.

Before either host changes code, the launcher must perform a read-only topology preflight on both hosts. The resolver may accept a configured path only when it is associated with the live container and contains the required existing runtime layout. If the configured path is wrong, it may select one unique safe candidate from the live container mounts. If topology cannot be proved uniquely, deployment stops before mutation.

The deployment order is:

1. verify both host topology profiles;
2. deploy 89;
3. require exact-build health on 89;
4. deploy 121;
5. require exact-build health on 121.

Fleet invariant:

> Either both hosts finish on the accepted new commit, or hosts already completed by that release attempt are rolled back in reverse order to their recorded pre-deployment code.

Never deliberately leave a release split across 89 and 121 after a later-host failure.

## Immutable GitHub Actions deployment bundle

`GroupGuard Build` produces an artifact named:

```text
groupguard-deployment-bundle-<commit>
```

This is the preferred download-and-run handoff when the operator does not want to compile locally.

The bundle contains:

- `DEPLOY-GROUPGUARD-89-121.cmd`;
- `groupguard-deploy-bundle.ps1`;
- `groupguard-remote-topology.sh`;
- `groupguard-remote-deploy.sh`;
- `groupguard-remote-rollback.sh`;
- `groupguard-dist.tar.gz` with prebuilt SnowLuma `dist`;
- `manifest.json` with exact commit, release id, SHA-256, build time, and workflow-run id;
- `README.txt`.

The build validates `dist/build-info.json`, hashes the archive, runs the bundle preflight, tests topology fallback behavior, and runs a Windows PowerShell 5.1 startup preflight.

Use a bundle produced from an accepted `main` commit, not a PR-head artifact, for production.

### Rebuild the latest downloadable bundle

Actions artifacts have finite retention. `GroupGuard Build` therefore supports manual `workflow_dispatch`.

If the previously accepted artifact has expired or a fresh package is needed without changing source code:

1. open the repository's **Actions** page;
2. select **GroupGuard Build**;
3. choose **Run workflow** on `main`;
4. wait for both the Linux build and Windows PowerShell 5.1 preflight to succeed;
5. download `groupguard-deployment-bundle-<current-main-commit>`.

A manually dispatched run builds the exact current `main` commit and embeds that SHA in `dist/build-info.json` and the bundle manifest. This makes the current repository state reproducibly downloadable even after older artifacts expire.

For the accepted PR #50 merge, the successful main build run `33133786572` produced:

```text
groupguard-deployment-bundle-23ed0084eb2214e591a0108b5b82d33fb10b00ba
```

Artifact id: `9671262220`  
Digest: `sha256:9583d103d6783a0bc321d8bf83768380006f34b1c0fb3f31cc042650d5870e6e`

## Manual `dist` replacement

Manual `dist` replacement is acceptable only when the operator explicitly chooses it and understands that it bypasses the bundle's automatic backup/topology/rollback orchestration.

When doing it manually:

- replace only the built `dist` directory;
- preserve `config`, `data`, SQLite, logs, credentials, and secrets;
- restart only the intended `groupguard-snowluma` container;
- verify `/api/build-info` and `/api/health` afterward when possible;
- run a business-level query test for the behavior being changed.

For the 2026-08-28 battle fix, the operator replaced `dist` on both 89 and 121 and confirmed the 121 battle image path works.

## Manual rollback

For a business-level problem discovered after a technically healthy deployment, use the recorded rollback workflow rather than replacing arbitrary historical files.

The rollback path restores the recorded code backup, restarts the intended `groupguard-snowluma` container, and verifies the restored build using authenticated `/api/build-info` and `/api/health` checks. Runtime config/data/logs/secrets remain untouched.

For a failed multi-host deployment, automatic fleet reconciliation is separate from a later business rollback: hosts completed by the failed release attempt are rolled back in reverse order so the fleet does not remain intentionally split.

## Global output-language operations

The WebUI advanced/global configuration includes `机器人全局输出语言`:

- `zh-CN` — 简体中文（默认）;
- `zh-TW` — 繁體中文;
- `en` — English.

Saving the selector patches `global.outputLocale`. Input command recognition is unchanged. Images/files are not translated. Stored administrator-authored Q&A/source text is not rewritten.

Translation-provider controls are:

```text
GROUPGUARD_TRANSLATE_ENDPOINT
GROUPGUARD_TRANSLATE_API_KEY
GROUPGUARD_TRANSLATE_ALLOW_PUBLIC_FALLBACK
```

Never commit translation API keys or other runtime secrets.

## Safety rules

- No force push, hard reset, history-rewriting rebase, clean, or stash as automatic deployment recovery.
- Stop if local history cannot strict-fast-forward to canonical `origin/main`.
- Do not build on ARM production hosts when a Windows/GitHub Actions build is available.
- Verify both host topologies before a multi-host code switch.
- Never create a guessed application directory to make deployment proceed.
- Keep runtime configuration/data/logs/secrets outside the replacement set.
- Create and validate a rollback point before code switch when using the audited deploy workflow.
- Persisted deployment state is untrusted data; remote helpers parse it as data and never `source`, dot-load, or `eval` it.
- A failed post-switch exact-build/health check must restore the previous code or clearly surface incomplete recovery.
