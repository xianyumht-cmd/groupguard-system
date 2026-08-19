# GroupGuard Operations

## Production boundary

Canonical development happens in `D:\project2\groupguard-system` on Windows. The ARM host `192.168.3.89` is a separate production runtime. Repository changes do not imply a production deployment.

Do not deploy or restart production merely because a branch, PR, build, or CI run succeeded. Production deployment/restart requires explicit user intent in the current task.

## Standard Windows update workflow

After the accepted change has been merged to `main`, run:

```text
GROUPGUARD-UPDATE.cmd
```

The launcher calls `scripts/windows/groupguard-update.ps1` and performs:

1. verify required native tools (`git`, `npm`, `ssh`, `scp`, `tar`);
2. require a clean local worktree;
3. update local `main` using fetch + strict fast-forward only;
4. `npm ci` from the lockfile;
5. run the full automated test suite;
6. build the SnowLuma production `dist` with commit metadata;
7. package the immutable candidate and calculate SHA-256;
8. verify SSH connectivity to `root@192.168.3.89`;
9. upload only the candidate package and audited remote helper;
10. create a timestamped code backup and deployment manifest before switching code;
11. atomically switch the built plugin `dist` without overwriting runtime config/data/logs/secrets;
12. restart `groupguard-snowluma` and perform readiness/health verification;
13. automatically attempt restoration if post-switch verification fails;
14. copy the deployment manifest back to `%LOCALAPPDATA%\GroupGuard\deployment-state`.

### Safety rules

- Never use force push, hard reset, rebase, clean, or stash as an automatic deployment recovery mechanism.
- If the local worktree is dirty or `main` cannot fast-forward to `origin/main`, stop and report the state.
- The ARM host is not assumed to have a usable Node build toolchain; build and TypeScript verification run on Windows.
- PowerShell 5.1 may expose normal SSH stderr as error records; deployment decisions use the native process exit code, not stderr text by itself.
- The deployment package is code-only. Runtime `config.json`, SQLite/data, logs, credentials, and secrets are outside the replacement set.
- Backup and manifest creation must happen before the production code switch.
- A failed post-switch health check must trigger the remote helper's automatic restoration attempt before the Windows launcher returns failure.

## Manual rollback

For a business-level problem discovered after a technically healthy deployment, run:

```text
ROLLBACK-GROUPGUARD.cmd
```

The launcher calls `scripts/windows/groupguard-rollback.ps1`, reads the most recent recorded deployment state, asks the remote rollback helper to restore the corresponding backup, restarts the production container, and verifies service health.

Rollback is for plugin code. It must not roll back or replace runtime SQLite/data, `config.json`, logs, or secrets.

## Production paths recorded for the current deployment model

- host: `192.168.3.89`
- user: `root`
- application root: `/mnt/sda1/groupguard/app`
- backup root: `/mnt/sda1/groupguard/backups`
- container: `groupguard-snowluma`

These defaults are encoded as overridable PowerShell parameters. If production topology changes, verify the live environment before updating the defaults.

## Config-maturity acceptance sequence

For the 2026-08-19 configuration-maturity task, manual product testing is intentionally deferred until the 1–6 engineering stages are complete. Before asking for that single final manual acceptance round:

1. implementation and documentation are complete on the task branch;
2. PR CI passes the repository's TypeScript, architecture, OneBot/SnowLuma, configuration-inheritance, and WebUI acceptance gates;
3. the PR is merged to `main`;
4. `main` is verified to contain the accepted commit;
5. only then use the Windows update launcher to synchronize the local checkout and production plugin code;
6. keep the rollback launcher available during the manual product test.
