# GroupGuard AI Workstyle

Updated: 2026-09-15

These are stable repository-work preferences. They supplement `AGENTS.md`; repository/runtime evidence remains the source of truth.

## Evidence first

- Do not answer GroupGuard behavior, security, deployment, or architecture questions from guesses when the repository can be inspected.
- Before declaring a finding open or fixed, read the current `main` implementation and the relevant tests/CI. Old chat notes and audit lists can be stale.
- Distinguish four states explicitly when relevant: repository `main`, accepted runtime/build commit, GitHub Actions artifact, and actual ARM production runtime.
- If a previous answer was based on assumptions rather than actual code, correct it from repository evidence instead of defending the earlier answer.

## Audit round size

When the user says `继续` during a repository audit:

- take one medium issue end-to-end, or at most two small tightly related issues;
- do not start a second unrelated issue in the same round;
- do not make rounds so tiny that the user must repeatedly send `继续` for trivial progress;
- a normal round should include current-main inspection, evidence-based classification, the smallest safe fix when needed, behavior tests, PR, CI/Build, merge, `main` verification, and artifact verification;
- if re-verification shows the finding is already fixed or not materially exploitable, close/reclassify it with evidence instead of forcing code changes.

## Change discipline

- Prefer behavior-level regression tests for runtime/security behavior. Do not replace a brittle grep/source-string test with no test; preserve the intended contract and exercise it through a public boundary when practical.
- Keep genuinely static release/build/wiring contracts as static checks when that is the correct abstraction.
- Avoid broad mechanical cleanup while closing one security or reliability issue. Track newly discovered debt separately.
- Do not mass-refactor monoliths, protocol layers, storage layers, or permission systems as a side effect of a narrow audit finding.
- Use side-effect-free/lightweight modules for focused Node test imports when the full runtime dependency graph is incompatible with Node strip-only TypeScript execution.

## Production strategy

- Audit fixes are accumulated in Git first. Do not deploy/restart production after each PR.
- The operator prefers one later WebUI one-click upgrade after the audit batch has enough value and the accepted `main` build is verified.
- Never claim a merged commit is live merely because CI/Build succeeded. Require operator/runtime evidence.
- Do not deploy, restart, or mutate the ARM production runtime unless the user explicitly asks for that live operation in the current task.

## Communication and handoff

- Keep repository answers direct and grounded; avoid generic AI-style speculation or filler.
- Do not ask the user to repeat project facts already available in canonical docs/current conversation.
- Do not create dated parallel handoff files. Maintain `PROJECT_STATE.md`, `PITFALLS.md`, and the other canonical knowledge files from `AGENTS.md`.
- For a new conversation, the expected takeover path is: read canonical docs, fetch current `main`, verify runtime evidence boundaries, then continue the next unresolved medium issue.
- English execution PMTs for Codex are useful when the user explicitly asks to hand a task to Codex; do not substitute a PMT for actually inspecting or completing work when repository tools are available in the current session.
