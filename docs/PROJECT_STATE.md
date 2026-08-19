# GroupGuard Project State

Updated: 2026-08-20

## Canonical repository

- Canonical development branch: `main`.
- Active task branch: `audit/config-maturity-20260819`.
- Active PR: `#42 refactor: mature global and group config inheritance`.
- The active task is the 1–6 maturity audit/remediation: configuration domain semantics, data ownership, runtime effective config, WebUI global/group behavior, safety/observability, repository hygiene, and release/rollback tooling.
- Engineering implementation and final diff review are complete on the task branch. Production remains untouched until PR merge plus the owner's explicit Windows deployment.

## Config-maturity engineering result

Verified branch work includes:

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
- regression coverage through `verify:config-inheritance`, static WebUI verification, and a dedicated real-Chromium config-maturity spec;
- explicit empty-group persistence only for authorized group mutations, while generic empty `groups` still cannot delete SQLite rows;
- Windows update/rollback launchers and remote code-only deployment helpers;
- deployment state parsed strictly as data, never `source`/dot/`eval` executed;
- authenticated post-switch `/api/build-info` + `/api/health` verification with exact commit identity;
- resume/reconcile protection that refuses to declare success unless a real validated rollback point is still available;
- CI coverage for PowerShell syntax, shell syntax, unsafe paths, wrong Git origin, deployment-state execution, authenticated exact-build health verification, and rollback-preserving reconciliation;
- canonical architecture/decision/operations documentation for the new configuration and release model;
- repository hygiene cleanup of `$null`, `.gitguu`, and `push.log`, with ignore rules added for repeat local artifacts.

One historical Trae terminal artifact with an abnormal tracked filename remains a non-runtime repository-hygiene residual because the GitHub connector blocks mutation of that hostile-looking path. It is ignored for future occurrences and does not participate in build/runtime. Final cleanup can be done from a local/Codex Git environment that can address the exact tracked path safely.

## Final task-branch verification

Exact head `cea0587ac179072a0c4639ae5b24012c3d86cfec` completed all three required PR gates successfully before final documentation-only state updates:

- GroupGuard CI run `32279121749`: **success**;
- GroupGuard Build run `32279121847`: **success**;
- WebUI Browser Acceptance run `32279122039`: **success**.

That head includes the final deployment safety changes for authenticated exact-build verification and rollback-preserving reconciliation. Subsequent documentation-only commits must also remain green if the PR path filters trigger another exact-head pass.

Final diff review found no unresolved High/Critical issue after the recorded FINAL-* remediations. The task branch was also verified ahead of `main` and not behind before final documentation updates.

## Verified production state

The latest production state currently documented remains the 2026-08-09 deployment on the ARM GroupGuard runtime at `192.168.3.89`:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`

This is historical verified production evidence. The config-maturity task has not superseded it in production and has not deployed or restarted `192.168.3.89`.

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

Wait only for any exact-head checks triggered by the final documentation commits. If they remain green and the branch is still not behind `main`, mark PR #42 ready and merge it to `main`. Verify the merge exists on `main` and let push-side CI finish. Do not deploy or restart `192.168.3.89` during this step.

After the merged `main` is green, the owner performs the single manual/production acceptance round by running `GROUPGUARD-UPDATE.cmd` from the clean Windows repository. If real business behavior is wrong despite technical health checks, run `ROLLBACK-GROUPGUARD.cmd` to restore the recorded pre-deployment plugin code without replacing config or SQLite/data.
