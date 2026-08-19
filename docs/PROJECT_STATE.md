# GroupGuard Project State

Updated: 2026-08-19

## Canonical repository

- Canonical development branch: `main`.
- Active task branch: `audit/config-maturity-20260819`.
- The active task is the 1–6 configuration-maturity audit/remediation: inheritance semantics, config ownership, runtime effective config, WebUI global/group behavior, safety/observability, and release/rollback tooling.
- The task branch is based on current `main` and is being kept separate from production until PR/CI completion and merge.

## Active config-maturity task

Current verified branch work includes:

- `docs/GROUPGUARD_CONFIG_MATURITY_AUDIT_2026-08-19.md` with staged findings and remediation decisions;
- centralized effective-config logic in `onebot-plugin-groupguard/src/config_effective.ts`;
- sparse group-row normalization and deep merge semantics;
- one resolver path shared between config state and legacy PluginState compatibility code;
- admin group API support for `global` / stored `group` / runtime `effective` / field `sources`;
- field-level restore-inheritance and batch set-path operations;
- WebUI distinction between “全局配置” and advanced “全量配置” plus per-field source badges and bulk actions;
- regression coverage through `verify:config-inheritance` and existing test/build gates;
- Windows update/rollback launchers and remote code-only deployment helpers;
- canonical architecture/decision/operations documentation for the new configuration model.

No production change has been made by this task yet. The planned user workflow is one final manual acceptance round after engineering/CI completion rather than manual testing after each internal stage.

## Verified production state

The latest production state currently documented remains the 2026-08-09 deployment on the ARM GroupGuard runtime at `192.168.3.89`:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`

This is historical verified production evidence. The config-maturity branch has not yet superseded it in production.

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

Complete branch-level review, open the config-maturity PR, run/repair CI until all required gates pass, merge to `main`, verify `main`, then hand the user the Windows one-click update and rollback workflow for the single final production/manual acceptance round. Do not deploy or restart `192.168.3.89` before that point.
