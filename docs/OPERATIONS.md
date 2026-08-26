# GroupGuard Operations

## Production boundary

Canonical development happens in `D:\project2\groupguard-system` on Windows. The ARM host `192.168.3.89` is a separate production runtime. The ARM host `192.168.3.121` is an additional independent robot runtime and is not a migration or replacement for `192.168.3.89`. Repository changes do not imply a runtime deployment.

Do not deploy or restart production merely because a branch, PR, build, or CI run succeeded. Production deployment/restart requires explicit user intent in the current task.

## Standard Windows update workflow

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
8. verify SSH connectivity to `root@192.168.3.89`;
9. upload only the candidate package and audited remote helper;
10. create a timestamped code backup and pending deployment state before switching code;
11. atomically switch the built plugin `dist` without overwriting runtime config/data/logs/secrets;
12. restart `groupguard-snowluma`;
13. resolve the WebUI token inside the container and make authenticated `/api/build-info` + `/api/health` requests;
14. require `health.ready === true`, exact running commit identity, and a non-dirty build before declaring deployment success;
15. automatically attempt restoration of the pre-switch code if post-switch verification fails, then verify the restored commit with the same authenticated check;
16. save the deployment manifest and copy it back to `%LOCALAPPDATA%\GroupGuard\deployment-state`.

If an interrupted deployment is rerun after the target commit is already live, reconciliation succeeds only when the helper can also recover a valid matching rollback backup. It fails closed rather than replacing the latest rollback pointer with an empty or unverified backup path.

### Safety rules

- Never use force push, hard reset, rebase, clean, or stash as an automatic deployment recovery mechanism.
- If the local worktree is dirty or `main` cannot fast-forward to `origin/main`, stop and report the state.
- The ARM host is not assumed to have a usable Node build toolchain; build and TypeScript verification run on Windows.
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

The launcher calls `scripts/windows/groupguard-rollback.ps1`, reads the most recent recorded deployment state, asks the remote rollback helper to restore the corresponding backup, restarts the production container, and verifies the restored commit using the same authenticated `/api/build-info` + `/api/health` contract. Before changing code, the rollback helper also creates a preimage of the currently running `dist`; if the rollback target is unhealthy, it attempts to restore that preimage.

Rollback is for plugin code. It must not roll back or replace runtime SQLite/data, `config.json`, logs, or secrets.

## Production paths recorded for the current deployment model

- host: `192.168.3.89`
- user: `root`
- application root: `/mnt/sda1/groupguard/app`
- backup root: `/mnt/sda1/groupguard/backups`
- container: `groupguard-snowluma`

These defaults are encoded as overridable PowerShell parameters. If production topology changes, verify the live environment before updating the defaults.

## Independent `192.168.3.121` runtime

The independently deployed secondary robot uses:

- host: `192.168.3.121`
- external storage mount: `/mnt/groupguard-data`
- Docker root: `/mnt/groupguard-data/docker`
- containerd root: `/mnt/groupguard-data/containerd`
- GroupGuard application root: `/mnt/groupguard-data/groupguard/app`
- GroupGuard secret env file: `/mnt/groupguard-data/groupguard/groupguard.env` (mode `0600`; never commit or print its value)
- SnowLuma persistent root: `/mnt/groupguard-data/snowluma`
- containers: `snowluma` and `groupguard-snowluma`
- manual-login endpoints: SnowLuma WebUI `http://192.168.3.121:5099/` and noVNC `http://192.168.3.121:6081/`

Operational invariants for this host:

- Never copy account state, SnowLuma login data, credentials, or the whole SQLite database from `192.168.3.89`. A user-authorized selective GroupGuard configuration migration may copy global settings, selected `group_config`/`group_qa` rows, and—when explicitly requested—group `licenses` after backing up 121, while preserving 121's account, `licenseKey`, and runtime tables.
- Both Docker and containerd must depend on `/mnt/groupguard-data`; do not allow either service to fall back to the internal eMMC when the external disk is absent.
- Docker `data-root` alone is insufficient with Docker 29's containerd image store; containerd `root` must also point to the external disk.
- The Chipsbank `0204:6025` bridge uses the boot argument `usb-storage.quirks=0204:6025:u` so it runs through `usb-storage` instead of UAS.
- SnowLuma requires `CAP_SYS_PTRACE` and `seccomp=unconfined`, matching the verified `192.168.3.89` container runtime parameters.
- SnowLuma and GroupGuard run in separate container network namespaces. The active per-account SnowLuma OneBot `wsServers` entry must bind `0.0.0.0` (or the GroupGuard container must share SnowLuma's network namespace); `127.0.0.1` inside SnowLuma is not reachable through the published Docker port from GroupGuard's host network.
- After a SnowLuma image recreation, inspect the active per-account files under `/app/data/config/onebot_<uin>.json`. Do not assume `/app/snowluma-data/config` is the file currently loaded by the running process; synchronize the GroupGuard token from the active file without printing it.
- GroupGuard reads the OneBot token at startup. If the synchronized token differs from the running value, an explicitly authorized GroupGuard container restart/recreation is required before acceptance; changing `groupguard.env` alone does not refresh the existing client. If restart is not authorized, report the token refresh as pending rather than claiming the consumer has been updated.
- OneBot disconnection before the fresh account login is expected. After login, require connected OneBot status and healthy GroupGuard readiness before business acceptance.

## Selective GroupGuard configuration migration

When 121 needs the same GroupGuard behavior as 89, migrate configuration by category rather than replacing the runtime directory:

1. Back up `/mnt/groupguard-data/groupguard/app/config/config.json`, `group-file-mirror.json`, and any dynamic-command file. For SQLite, create a transactionally consistent snapshot with SQLite's online backup mechanism or `VACUUM INTO`; if neither is available, stop the GroupGuard writer before copying the database. Do not copy `groupguard.db`, `groupguard.db-wal`, and `groupguard.db-shm` separately while the container is running or treat that file set as a portable backup.
2. Merge shared `config.json` settings, retaining 121's `licenseKey`, `ownerQQs`, and external service tokens. Migrate the group `licenses` object only when the user explicitly requests it.
3. Prefer authenticated per-group APIs to create or update the intended `group_config`, `group_qa`, and license rows so the running state and SQLite remain aligned. If raw SQLite import is unavoidable, reload and verify the imported group rows in runtime before any config save/refresh; a stale nonempty in-memory group map can replace newly imported IDs. Do not copy audit, action-queue, message, login, or other runtime-history tables.
4. Copy optional dynamic commands and group-file-mirror configuration, then refresh the running configuration through the authenticated admin API when a restart is not authorized. This refresh is not a substitute for the authorized GroupGuard restart required after changing the OneBot token.
5. Verify the target container remains running, OneBot still listens on port 3001, and the migrated row counts match the source.

The 2026-08-27 migration to 121 used the selective data scope above. Its pre-change file copies are retained at `/mnt/groupguard-data/groupguard/migration-backup-20260827-063327`; they are a migration recovery copy, not a general live-WAL backup. Future live SQLite backups must follow step 1.

## Config-maturity acceptance sequence

For the 2026-08-19 configuration-maturity task, manual product testing is intentionally deferred until the 1–6 engineering stages are complete. Before asking for that single final manual acceptance round:

1. implementation and documentation are complete on the task branch;
2. PR CI passes the repository's TypeScript, architecture, OneBot/SnowLuma, configuration-inheritance, deployment-safety, and real Chromium WebUI acceptance gates;
3. final diff review has no unresolved High/Critical finding;
4. the PR is merged to `main`;
5. `main` is verified to contain the accepted merge and required push-side CI passes;
6. only then use the Windows update launcher to synchronize the local checkout and production plugin code;
7. keep the rollback launcher available during the single manual product test.
