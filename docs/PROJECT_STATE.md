# GroupGuard Project State

Updated: 2026-08-19

## Canonical repository

- Canonical development branch: `main`.
- Active task branch: `audit/config-maturity-20260819`.
- Active PR: `#42 refactor: mature global and group config inheritance` (Draft while final engineering gates run).
- The active task is the 1–6 maturity audit/remediation: configuration domain semantics, data ownership, runtime effective config, WebUI global/group behavior, safety/observability, repository hygiene, and release/rollback tooling.
- The task branch remains separate from production until PR/CI completion and merge.

## Active config-maturity task

Current verified branch work includes:

- `docs/GROUPGUARD_CONFIG_MATURITY_AUDIT_2026-08-19.md` with reconciled phase 1–6 findings and remediation status;
- centralized effective-config logic in `onebot-plugin-groupguard/src/config_effective.ts`;
- sparse group-row normalization and nested deep-merge semantics;
- backward-compatible handling for historical group rows that have no `useGlobal` field;
- one resolver path shared between config state and legacy PluginState compatibility code;
- admin group API support for `global` / stored `group` / runtime `effective` / field `sources`;
- field-level restore-inheritance (`restore-path`), explicit single-field overrides (`set-path`), and whole-group inheritance as separate operations;
- protection for `useGlobal=true` rows with dormant historical overrides: explicit single-field writes do not erase or silently reactivate unrelated dormant values;
- WebUI distinction between “全局配置” and advanced “全量配置”, per-field source badges, “恢复继承”, and bulk controls whose labels reflect persistence semantics;
- regression coverage through `verify:config-inheritance`, static WebUI verification, and a dedicated real-Chromium config-maturity spec;
- CI coverage for the new Windows PowerShell deployment/rollback scripts and remote shell helpers;
- Windows update/rollback launchers and remote code-only deployment helpers;
- canonical architecture/decision/operations documentation for the new configuration model;
- repository hygiene cleanup of `$null`, `.gitguu`, and `push.log`, with ignore rules added for repeat local artifacts.

One historical Trae terminal artifact with an abnormal tracked filename remains a non-runtime repository-hygiene residual because the GitHub connector blocks mutation of that hostile-looking path. It is ignored for future occurrences and does not participate in build/runtime. Final cleanup can be done from a local/Codex Git environment that can address the exact tracked path safely.

No production change has been made by this task. The planned user workflow remains one final manual acceptance round after engineering/CI completion rather than manual testing after each internal stage.

## Verified production state

The latest production state currently documented remains the 2026-08-09 deployment on the ARM GroupGuard runtime at `192.168.3.89`:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`

This is historical verified production evidence. The config-maturity branch has not superseded it in production.

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

Finish the final PR diff review and GitHub Actions gates on PR #42. Repair any failure on the same task branch. When all required checks pass, mark the PR ready, merge to `main`, verify `main` contains the result, and close the temporary branch according to repository policy. Only then hand the owner the final `GROUPGUARD-UPDATE.cmd` / `ROLLBACK-GROUPGUARD.cmd` workflow for the single production/manual acceptance round. Do not deploy or restart `192.168.3.89` as part of branch development.
