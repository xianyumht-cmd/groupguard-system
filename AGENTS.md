# AGENTS.md — Mandatory AI Repository Rules

> **ChatGPT / Codex / other coding agents: read this file before any repository action.**
> These are standing user instructions. Do not wait for the user to repeat them in a new chat.

## 1. Canonical state

- Canonical development branch: `main`.
- Normal development must start from the latest `main`.
- `archive/*` and release/production tags are historical references, not normal development bases.
- The live GroupGuard runtime may be on a separate ARM host; do not assume the local checkout equals the running production version.

## 2. Local/runtime separation

- Canonical Windows development checkout: `D:\project2\groupguard-system`.
- Production/runtime changes on the ARM host are separate from normal Git development.
- Local mainline synchronization must be strict fast-forward only when appropriate.
- If fast-forward is impossible or history diverges, stop and report instead of rebasing/resetting.
- Do not deploy/restart the ARM GroupGuard/SnowLuma runtime unless the user explicitly authorizes production deployment/restart in the current task.

## 3. One task = one temporary branch

- Before creating a branch, check whether the same task already has an active branch or PR. Reuse it only if it is genuinely the same task.
- Otherwise create exactly one short-lived branch from the latest `main`.
- Continue revisions on that same branch. Do **not** create `v2`, `v3`, `final`, `current`, `backup`, `test`, `build`, `deploy`, `handoff`, `note`, or similar auxiliary branches.
- Do not use branches as chat memory, backups, build containers, deployment packages, or status markers.
- Unfinished work belongs in a GitHub Issue or repository task-state document.

## 4. Builds, releases, and history

- Use GitHub Actions artifacts for build/deployment packages.
- Use immutable tags for accepted candidates, production versions, and historical snapshots.
- If unique old history must be retired, create and verify an `archive/*` tag before deleting its branch.
- Never delete unique history merely because a branch looks old or temporary.

## 5. Task completion

A development task is complete only when:

1. implementation is finished;
2. tests/CI pass;
3. the PR is merged;
4. `main` is verified to contain the result;
5. the temporary task branch is deleted;
6. the related Issue/task-state record is updated.

Do not leave merged/closed task branches behind by default.

## 6. Git safety — hard rules

Do not use unless the user explicitly authorizes a narrowly defined recovery operation:

- force push;
- `git reset --hard`;
- history-rewriting rebase;
- `git clean`;
- `git stash`;
- destructive branch/ref moves;
- automatic branch switching as an error-recovery shortcut.

If the worktree is dirty, origin is unexpected, history has diverged, or a fast-forward path is unclear: **stop and report the exact state instead of rewriting history**.

Never commit secrets, tokens, runtime credentials, local environment files, diagnostic dumps containing credentials, or unrelated generated files.

## 7. AI takeover protocol

At the start of every task:

1. read this `AGENTS.md` and any more specific nested `AGENTS.md`;
2. identify the current branch, canonical branch, origin, and working-tree status;
3. inspect the relevant Issue/PR when the task references one;
4. distinguish repository state from the actual ARM runtime state;
5. make the smallest safe change on one task branch.

For read-only diagnosis, do not create a branch just to investigate.

For destructive Git operations, production deployment, service restart, branch deletion, tag deletion, or history rewriting, require explicit user intent and perform fresh safety checks immediately before the action.

## 8. Long-term branch budget

The healthy persistent remote branch set for this repository is intentionally small: normally only `main`. Temporary feature/fix branches should exist only while their task is active.
