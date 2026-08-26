# GroupGuard Project State

Updated: 2026-08-27

## Canonical repository

- Canonical development branch: `main`.
- Configuration-maturity PR `#42 refactor: mature global and group config inheritance` is merged.
- Maturity merge commit: `9427c6577439acf8987a208909fa8ae3e9c09e2d`.
- Windows PowerShell 5.1 acceptance hotfix PR `#43 fix: make one-click scripts safe on Windows PowerShell 5.1` is merged.
- PowerShell hotfix merge commit: `c2b1281c907d60d0c8945bdec665f4182fb79fc0`.
- Windows shell line-ending hotfix PR `#44 fix: normalize remote shell helpers to LF on Windows` is merged.
- Shell line-ending hotfix merge commit: `ad738f02089ba228e7eb67085120ede29fed32d6`.
- The completed task covered all 1–6 maturity phases: configuration domain semantics, data ownership, runtime Effective Config, WebUI global/group behavior, safety/observability, repository hygiene, and release/rollback tooling.
- Production remains unchanged by the first two Windows acceptance failures. The first failed while Windows PowerShell 5.1 parsed a UTF-8-without-BOM `.ps1`. The second reached the uploaded POSIX helper but failed on line 2 because a Windows CRLF checkout was transported to `/bin/sh`; the helper exited before argument parsing, backup creation, code switch, restart, config persistence, or SQLite persistence.

## Config-maturity engineering result

Merged work includes:

- `docs/GROUPGUARD_CONFIG_MATURITY_AUDIT_2026-08-19.md` with phase 1–6 findings and remediation decisions;
- `docs/GROUPGUARD_CONFIG_MATURITY_FINAL_REVIEW_ADDENDUM_2026-08-19.md` with final review findings for persistence, WebUI save scope, CI and deployment/rollback safety;
- centralized effective-config logic in `onebot-plugin-groupguard/src/config_effective.ts`;
- sparse group-row normalization and nested deep-merge semantics;
- backward-compatible handling for historical group rows that have no `useGlobal` field;
- one resolver path shared between config state and legacy PluginState compatibility code;
- admin group API support for `global` / stored `group` / runtime `effective` / field `sources`;
- field-level restore-inheritance (`restore-path`), explicit single-field overrides (`set-path`), and whole-group inheritance as separate operations;
- protection for `useGlobal=true` rows with dormant historical overrides: explicit single-field writes do not erase or silently reactivate unrelated dormant values;
- WebUI distinction between “全局配置” and advanced “全量配置”, per-field source badges, “恢复继承”, and bulk controls whose labels reflect persistence semantics;
- global-page save isolation: only `global.*` fields can be emitted by that mode, covered by a real Chromium probe;
- explicit empty-group persistence only for authorized group mutations, while generic empty `groups` still cannot delete SQLite rows;
- Windows update/rollback launchers and remote code-only deployment helpers;
- deployment state parsed strictly as data, never `source`/dot/`eval` executed;
- authenticated post-switch `/api/build-info` + `/api/health` verification with exact commit identity;
- resume/reconcile protection that refuses to declare success unless a real validated rollback point is still available;
- Windows PowerShell 5.1 launch-critical `.ps1` files are ASCII-only;
- remote `.sh` helpers are pinned to LF in `.gitattributes`, and both Windows launchers create a verified LF-only UTF-8-no-BOM transport copy before SCP;
- CI coverage for PowerShell syntax, shell syntax, unsafe paths, wrong Git origin, deployment-state execution, authenticated exact-build health verification, rollback-preserving reconciliation, Windows PowerShell 5.1-safe launcher encoding, and CR-free remote shell transport;
- canonical architecture/decision/operations documentation for the new configuration and release model;
- repository hygiene cleanup of `$null`, `.gitguu`, and `push.log`, with ignore rules added for repeat local artifacts.

One historical Trae terminal artifact with an abnormal tracked filename remains a non-runtime repository-hygiene residual because the GitHub connector blocks mutation of that hostile-looking path. It is ignored for future occurrences and does not participate in build/runtime. Final cleanup can be done from a local/Codex Git environment that can address the exact tracked path safely.

## Final engineering verification

The final PR #42 head `35e069cf6e590480cfc57f58b2f8a5cfbc9f3136` completed all three required PR gates successfully:

- GroupGuard CI run `32279570278`: **success**;
- GroupGuard Build run `32279570228`: **success**;
- WebUI Browser Acceptance run `32279570212`: **success**.

The same tree was merged to `main` as `9427c6577439acf8987a208909fa8ae3e9c09e2d`; the merge commit and final PR head share tree `bf6f5f2b8fc0ffc1c6cdaa8ad1a6f50dcff7e317`. Final diff review left no unresolved High/Critical finding.

After the first real Windows acceptance attempt exposed the Windows PowerShell 5.1 UTF-8-without-BOM parser incompatibility, PR #43 changed both launch-critical `.ps1` files to ASCII-only and added a byte-level CI guard. GroupGuard CI run `32317249925` passed all steps, including the encoding guard, PowerShell syntax parsing, unsafe-path/origin checks, full `npm test`, SnowLuma build, and cross-repository mock contracts. PR #43 was merged as `c2b1281c907d60d0c8945bdec665f4182fb79fc0`.

The second acceptance attempt then exposed a Windows CRLF transport issue for the POSIX remote helper. PR #44 added `.gitattributes` LF policy plus explicit `New-LfHelperCopy()` normalization in both update and rollback launchers. GroupGuard CI run `32319663714` passed the new LF-only transport gate, PowerShell syntax, POSIX shell syntax, unsafe-path/origin checks, full `npm test`, SnowLuma build, and cross-repository mock contracts. PR #44 was merged as `ad738f02089ba228e7eb67085120ede29fed32d6`.

## Verified production state

A read-only runtime inspection on 2026-08-26 verified the current ARM GroupGuard deployment at `192.168.3.89`:

- GroupGuard version: `1.3.0`
- running commit: `2c729b1791d3ee2cc3d94f9e8ebf808a6de541c3`
- build time: `2026-08-20T01:16:58.5610872Z`
- container: `groupguard-snowluma` (running)
- Docker root: `/mnt/sda1/docker`
- SnowLuma image: `motricseven7/snowluma:v1.14.11` (current local image ID `sha256:ff3d56d996ec86412368b62004b48745480af19e33911df97a72cdf2e3743500`)

No account, configuration, database, or runtime data was copied from or changed on `192.168.3.89` while preparing the independent `192.168.3.121` runtime on 2026-08-26. A separate, explicitly authorized selective GroupGuard configuration migration was completed on 2026-08-27; see the current-state entry below.

The earlier 2026-08-09 deployment evidence remains as a historical rollback reference:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`

The 2026-08-09 evidence above is historical and has been superseded by the verified 2026-08-26 runtime identity. The earlier failed Windows acceptance attempts remain relevant to the launcher hardening history, but they no longer describe the live GroupGuard build on `192.168.3.89`.

## Verified independent `192.168.3.121` runtime

On 2026-08-26, `192.168.3.121` was prepared as an additional independent robot host, not as a migration or replacement for `192.168.3.89`:

- initially provisioned with fresh SnowLuma account/configuration/data; the account was manually logged in on 2026-08-27 and the GroupGuard plugin recovered;
- external SSD: ext4 label `GROUPGUARD_DATA`, UUID `1c75bad2-b85b-4a87-adc8-dbcf39f361e8`, mounted at `/mnt/groupguard-data`;
- Docker `29.1.3`, with Docker root `/mnt/groupguard-data/docker` and containerd root `/mnt/groupguard-data/containerd`;
- GroupGuard code/config/data/backups under `/mnt/groupguard-data/groupguard/app`;
- SnowLuma persistent data under `/mnt/groupguard-data/snowluma`;
- SnowLuma image: `motricseven7/snowluma:v1.14.11` (current local image ID `sha256:31bc52f885d1457a57e35c8bb9faef759d0619008e86913bd6fc9732c696bd72`);
- GroupGuard `1.3.0`, commit `2c729b1791d3ee2cc3d94f9e8ebf808a6de541c3`;
- containers `snowluma` and `groupguard-snowluma` use `unless-stopped` and survived a reboot validation;
- SnowLuma WebUI `5099`, noVNC `6081`, and authenticated GroupGuard build-info on `6108` responded successfully after reboot;
- after the 2026-08-27 login, OneBot port 3001 is listening on `0.0.0.0` and the GroupGuard plugin is operating again.

## 2026-08-27 OneBot connectivity repair

The SnowLuma image update exposed a container-network boundary issue on both ARM hosts:

- SnowLuma's active per-account `wsServers` entry was bound to `127.0.0.1` inside the SnowLuma container.
- GroupGuard runs with host networking and reached the published Docker port, which forwards to the SnowLuma container network interface rather than its loopback interface. The resulting WebSocket failure was a reset/non-101 response, producing the repeated reconnect counter.
- A controlled comparison on `192.168.3.121` succeeded from inside the SnowLuma container and failed from GroupGuard, proving the boundary rather than a GroupGuard business-code failure.

The recovery work, authorized in the current task, was:

- synchronize each GroupGuard runtime token from the currently active SnowLuma per-account config without printing the token;
- back up and recreate `groupguard-snowluma` on both hosts, retaining the old containers as timestamped rollback backups;
- change the active `onebot_<uin>.json` WS server host to `0.0.0.0`, back up the original JSON in the same SnowLuma data directory, and restart SnowLuma.

After the 2026-08-27 manual login, both hosts have an active `0.0.0.0:3001` OneBot listener; the user confirmed the GroupGuard plugin recovered, and the 121 container remained running with zero restarts. No QQ account data, SnowLuma login state, or credentials were copied between hosts.

## 2026-08-27 selective GroupGuard configuration migration

At the user's explicit request, 89's reusable GroupGuard configuration was selectively migrated to 121:

- 121's current `config.json`, SQLite database, and SQLite `-wal`/`-shm` files were backed up at `/mnt/groupguard-data/groupguard/migration-backup-20260827-063327` before changes;
- shared GroupGuard settings were merged into 121 while preserving 121's `licenseKey`, `ownerQQs`, `licenses`, and external service tokens; group licenses were intentionally excluded at that stage;
- 16 `group_config` rows and 23 `group_qa` rows were upserted into 121;
- `group-file-mirror.json` and one dynamic command were copied;
- the whole 89 database, SnowLuma account data, login state, and credentials were not copied;
- the authenticated GroupGuard config API refreshed the running in-memory configuration without a container restart. The target remained running with zero restarts.

## 2026-08-27 group authorization migration

At a follow-up explicit request, the 14 group license records from 89 were copied to 121 through the authenticated per-group license API. The pre-change 121 configuration is retained at `/mnt/groupguard-data/groupguard/migration-backup-license-20260827-064420/config.json`. Verification showed 14 licensed records in the target API list, with 2 additional configured groups remaining unlicensed, matching the source's distinction between group configuration and group authorization. The 121 container remained running with zero restarts and OneBot port 3001 remained active.

The Chipsbank `0204:6025` USB bridge required `usb-storage.quirks=0204:6025:u` to disable unstable UAS operation. After filesystem repair, the disk completed 1 GiB sequential write/read tests at about 38 MB/s, mounted after reboot, and showed no new I/O errors after the stable mount. Keep this bridge/cable/power path under observation because USB enumeration retried during boot before stabilizing.

## Production acceptance retained from target-file work

Production acceptance remains complete for the exclusive-root reconciliation behavior.

Observed after running WebUI `立即检查并整理`:

- the real QQ group-file root converged from multiple files to exactly one file;
- the remaining file was the latest intended target file;
- subsequent observation did not reveal a functional problem with the one-file retention behavior;
- the earlier WebUI `GroupGuard 回调失败 HTTP 502` message did not prevent the group-file reconciliation itself from succeeding and was not reproduced as a blocking functional defect during observation.

The accepted production invariant remains:

> The target group-file root `/` is exclusively managed by this feature and converges to exactly one authoritative latest file.

## Next action

For `192.168.3.121`, continue normal business verification using the migrated group settings. Future data migrations must remain selective and preserve the independent SnowLuma account and credentials.

Separately, retain the standard Windows updater/rollback workflow for future `192.168.3.89` production code changes. It must still fast-forward local `main`, rerun automated tests/build, create and validate a code-only backup/candidate, switch only plugin `dist`, and accept a deployment only after authenticated health plus exact-build verification.

The Vite `file-type` eval warning and dynamic/static import chunk warnings observed during the second attempt are build warnings only; the build completed and the immutable candidate was created. They are not the cause of the deployment failure.

If real business behavior is wrong despite technical health, run:

```text
ROLLBACK-GROUPGUARD.cmd
```

Rollback restores the recorded pre-deployment plugin code and does not replace `config.json`, SQLite/data, logs, credentials, or secrets.
