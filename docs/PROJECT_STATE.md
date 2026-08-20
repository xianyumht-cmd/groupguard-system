# GroupGuard Project State

Updated: 2026-08-20

## Canonical repository

- Canonical development branch: `main`.
- Configuration-maturity PR `#42 refactor: mature global and group config inheritance` is merged.
- Maturity merge commit: `9427c6577439acf8987a208909fa8ae3e9c09e2d`.
- Windows PowerShell 5.1 acceptance hotfix PR `#43 fix: make one-click scripts safe on Windows PowerShell 5.1` is merged.
- Hotfix merge commit: `c2b1281c907d60d0c8945bdec665f4182fb79fc0`.
- The completed task covered all 1–6 maturity phases: configuration domain semantics, data ownership, runtime Effective Config, WebUI global/group behavior, safety/observability, repository hygiene, and release/rollback tooling.
- Production remains unchanged by the failed first Windows acceptance attempt: PowerShell failed while parsing the local `.ps1` before the script body executed, so no SSH/upload/restart/code switch/config or SQLite write happened.

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
- CI coverage for PowerShell syntax, shell syntax, unsafe paths, wrong Git origin, deployment-state execution, authenticated exact-build health verification, rollback-preserving reconciliation, and Windows PowerShell 5.1-safe launcher encoding;
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

## Verified production state

The latest production state currently documented remains the 2026-08-09 ARM GroupGuard deployment at `192.168.3.89`:

- release commit: `b5d09d2287a937046c918353fbbcd3785650294a`
- previous release: `f1bbc194e3bced122b43f3811432eb6b224b4068`
- container: `groupguard-snowluma`
- authenticated HTTP verification: `200`
- deployment backup: `/mnt/sda1/groupguard/backups/20260809-050151-target-root-reconcile-b5d09d2287a9`

This is historical verified production evidence. The config-maturity changes have not yet superseded it in production. The first Windows acceptance attempt failed locally during PowerShell parsing before any production operation, so production still remains on the historical release above.

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

The engineering work and the Windows PowerShell 5.1 hotfix are merged. Resume the same single production/manual acceptance round from Windows by rerunning the ASCII bootstrap updater (or, after local main is updated, `GROUPGUARD-UPDATE.cmd`).

The updater requires a clean canonical repository and Node.js >= 22, fast-forwards local `main`, reruns the full automated tests/build, creates and validates a code-only production backup/candidate, switches only plugin `dist`, restarts `groupguard-snowluma`, and accepts the deployment only after authenticated readiness plus exact-build verification.

If real business behavior is wrong despite technical health, run:

```text
ROLLBACK-GROUPGUARD.cmd
```

Rollback restores the recorded pre-deployment plugin code and does not replace `config.json`, SQLite/data, logs, credentials, or secrets.
