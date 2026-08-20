# Windows PowerShell 5.1 acceptance hotfix (2026-08-20)

Status: `fixed_and_merged`

Related PR: `#43 fix: make one-click scripts safe on Windows PowerShell 5.1`  
Merge commit: `c2b1281c907d60d0c8945bdec665f4182fb79fc0`

## Symptom

The first owner acceptance run reached the repository's official launcher and failed while Windows PowerShell 5.1 parsed `scripts/windows/groupguard-update.ps1`.

The console showed mojibake such as `鍛戒护...` followed by `Unexpected token` / unterminated-string parser errors.

## Root cause

The `.ps1` files contained UTF-8 Chinese text without a BOM. Windows PowerShell 5.1 does not reliably treat UTF-8-without-BOM files as UTF-8; on the owner's Windows environment it decoded those bytes using the legacy ANSI code page. The resulting corrupted characters changed PowerShell tokenization and broke parsing.

This happened before the `try` body ran, so the failed attempt did not reach SSH, SCP, production backup, container restart, code switch, config persistence, or SQLite persistence.

## Fix

- `scripts/windows/groupguard-update.ps1` is now intentionally ASCII-only.
- `scripts/windows/groupguard-rollback.ps1` is now intentionally ASCII-only.
- Human-facing launcher messages in those two PowerShell files use English ASCII so Windows PowerShell 5.1 and PowerShell 7 read identical source bytes.
- Deployment and rollback behavior, path/origin safety checks, backup-first switching, authenticated exact-build health verification, and code-only rollback semantics are unchanged.
- `GroupGuard CI` now rejects any non-ASCII byte in these two launch-critical PowerShell files, preventing an accidental return to UTF-8-without-BOM source text.

## Verification

PR #43 GroupGuard CI run `32317249925` completed successfully. Verified steps included:

- full `npm test`;
- production dependency audit;
- Windows PowerShell 5.1-safe launcher encoding guard;
- PowerShell syntax parser;
- remote shell syntax;
- unsafe remote-path rejection;
- wrong-origin rejection;
- deployment-state execution ban;
- authenticated exact-build deployment health contract;
- SnowLuma production build;
- cross-repository mock contracts.

## Acceptance continuation

The first attempt did not modify production. Resume the same single acceptance round by updating local `main` and running the corrected `GROUPGUARD-UPDATE.cmd` flow. If deployment technically succeeds but real bot behavior is wrong, use `ROLLBACK-GROUPGUARD.cmd`; rollback restores plugin code only and preserves config, SQLite/data, logs, credentials, and secrets.
