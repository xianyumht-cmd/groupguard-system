# GroupGuard Operations

## Production boundary

Canonical development happens in `D:\project2\groupguard-system` on Windows. ARM runtimes such as `192.168.3.89` and `192.168.3.121` are separate production hosts. Repository changes do not imply a production deployment.

Do not deploy or restart production merely because a branch, PR, build, or CI run succeeded. Production deployment/restart requires explicit user intent in the current task.

## Global output-language operations

The WebUI advanced/global configuration includes `机器人全局输出语言`:

- `zh-CN` — 简体中文（默认）;
- `zh-TW` — 繁體中文;
- `en` — English.

Saving the selector patches `global.outputLocale` and refreshes runtime configuration immediately. It does not rewrite stored Q&A or other administrator-authored source text.

Only outgoing OneBot text is localized. Images/files, command recognition, URLs, CQ codes, placeholders, paths, and code blocks are outside the translation set.

High-frequency built-in system notices use local translations. Arbitrary custom content uses the in-memory translation cache after its first translation. Optional translation-provider overrides are available through:

```text
GROUPGUARD_TRANSLATE_ENDPOINT
GROUPGUARD_TRANSLATE_API_KEY
```

If `GROUPGUARD_TRANSLATE_ENDPOINT` is unset, the runtime uses the built-in public provider chain. If it is set to `off`, arbitrary remote translation is disabled; `zh-TW` still has local fallback conversion, while unseen arbitrary English content fails closed with an English temporary-unavailable notice instead of emitting Chinese.

## Standard Windows single-host update workflow

After the accepted change has been merged to `main`, run:

```text
GROUPGUARD-UPDATE.cmd
```

The launcher calls `scripts/windows/groupguard-update.ps1` and performs:

1. verify required native tools (`git`, `node`, `npm`, `ssh`, `scp`, `tar`) and require Node.js >= 22;
2. require a clean local worktree and the canonical `xianyumht-cmd/groupguard-system` origin;
3. update local `main` using fetch + strict fast-forward only, then require local `HEAD == origin/main`;
4. `npm ci` from the lockfile;
5. run the full automated test suite;
6. build the SnowLuma production `dist` with exact commit metadata and reject dirty build metadata;
7. package the immutable candidate and calculate SHA-256;
8. verify SSH connectivity to the selected remote host (default `root@192.168.3.89`);
9. upload only the candidate package and audited remote helper;
10. create a timestamped code backup and pending deployment state before switching code;
11. atomically switch the built plugin `dist` without overwriting runtime config/data/logs/secrets;
12. restart `groupguard-snowluma`;
13. resolve the WebUI token inside the container and make authenticated `/api/build-info` + `/api/health` requests;
14. require `health.ready === true`, exact running commit identity, and a non-dirty build before declaring deployment success;
15. automatically attempt restoration of the pre-switch code if post-switch verification fails, then verify the restored commit with the same authenticated check;
16. save the deployment manifest and copy it back to `%LOCALAPPDATA%\GroupGuard\deployment-state`.

If an interrupted deployment is rerun after the target commit is already live, reconciliation succeeds only when the helper can also recover a valid matching rollback backup. It fails closed rather than replacing the latest rollback pointer with an empty or unverified backup path.

## One-click dual-host deployment: 89 + 121

When the current task explicitly authorizes deployment to both ARM hosts, run:

```text
DEPLOY-GROUPGUARD-89-121.cmd
```

The launcher calls `scripts/windows/groupguard-update-89-121.ps1`, which invokes the standard single-host workflow sequentially for:

1. `192.168.3.89`;
2. `192.168.3.121`.

The wrapper intentionally does not duplicate SSH, backup, switching, rollback, or health-verification logic. Host 121 starts only after host 89 has completed its exact-build health check successfully. If 121 fails after 89 succeeded, the wrapper reports that partial state explicitly; the failing host still receives the single-host helper's automatic restoration attempt when applicable.

The dual-host wrapper uses these defaults for both hosts unless its PowerShell parameters are intentionally overridden after verifying the live topology:

- user: `root`;
- application root: `/mnt/sda1/groupguard/app`;
- backup root: `/mnt/sda1/groupguard/backups`;
- container: `groupguard-snowluma`.

### Safety rules

- Never use force push, hard reset, rebase, clean, or stash as an automatic deployment recovery mechanism.
- If the local worktree is dirty or `main` cannot fast-forward to `origin/main`, stop and report the state.
- The ARM hosts are not assumed to have a usable Node build toolchain; build and TypeScript verification run on Windows.
- PowerShell 5.1 may expose normal SSH stderr as error records; deployment decisions use the native process exit code, not stderr text by itself.
- The deployment package is code-only. Runtime `config.json`, SQLite/data, logs, credentials, and secrets are outside the replacement set.
- Backup and manifest creation must happen before the production code switch.
- Persisted deployment state is untrusted data: remote helpers parse it as data and never `source`, dot-load, or `eval` it.
- A successful deployment/reconcile must retain a real validated rollback point.
- A failed post-switch health/build-identity check must trigger the remote helper's automatic restoration attempt before the Windows launcher returns failure.

## Manual rollback

For a business-level problem discovered after a technically healthy deployment, run:

```text
ROLLBACK-GROUPGUARD.cmd
```

The launcher calls `scripts/windows/groupguard-rollback.ps1`, reads the most recent recorded deployment state, asks the remote rollback helper to restore the corresponding backup, restarts the selected production container, and verifies the restored commit using the same authenticated `/api/build-info` + `/api/health` contract. Before changing code, the rollback helper also creates a preimage of the currently running `dist`; if the rollback target is unhealthy, it attempts to restore that preimage.

Rollback is for plugin code. It must not roll back or replace runtime SQLite/data, `config.json`, logs, or secrets.

For a dual-host release, treat rollback as host-specific: identify which host has the business problem and run the rollback workflow against that host rather than assuming both runtimes must be moved together.

## Production paths recorded for the current deployment model

Verified historical repository evidence records `192.168.3.89` with:

- user: `root`
- application root: `/mnt/sda1/groupguard/app`
- backup root: `/mnt/sda1/groupguard/backups`
- container: `groupguard-snowluma`

The 2026-08-27 dual-host launcher uses the same topology defaults for `192.168.3.121` because that is the requested deployment target. This is a deployment default, not proof that 121 has already been production-verified by repository evidence. Verify its live manifest/health during the first deployment.

These defaults are encoded as overridable PowerShell parameters. If production topology changes, verify the live environment before updating the defaults.

## Config-maturity acceptance sequence

For the 2026-08-19 configuration-maturity task, manual product testing is intentionally deferred until the 1–6 engineering stages are complete. Before asking for that single final manual acceptance round:

1. implementation and documentation are complete on the task branch;
2. PR CI passes the repository's TypeScript, architecture, OneBot/SnowLuma, configuration-inheritance, deployment-safety, and real Chromium WebUI acceptance gates;
3. final diff review has no unresolved High/Critical finding;
4. the PR is merged to `main`;
5. `main` is verified to contain the accepted merge and required push-side CI passes;
6. only then use the Windows update launcher to synchronize the local checkout and production plugin code;
7. keep the rollback launcher available during the single manual product test.
