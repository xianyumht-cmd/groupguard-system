# GroupGuard AI Context

Updated: 2026-09-17

This file contains stable project facts and boundaries. Time-sensitive state belongs in `PROJECT_STATE.md`; recurring failure patterns belong in `PITFALLS.md`.

## Project purpose

GroupGuard is the repository's QQ group-management and query plugin/service. The current production shape uses GroupGuard as a SnowLuma/OneBot consumer with a WebUI for configuration, authorization, query providers, health, backups and code-only self-update.

Canonical repository: `xianyumht-cmd/groupguard-system`.
Canonical development branch: `main`.
Canonical Windows development checkout: `D:\project2\groupguard-system`.

## Runtime topology

Production/runtime state is separate from GitHub state. Two ARM hosts have been used as independent GroupGuard runtimes:

- `192.168.3.89`: historical application root `/mnt/sda1/groupguard/app`, container `groupguard-snowluma`.
- `192.168.3.121`: application root `/mnt/groupguard-data/groupguard/app` bound to container workdir `/app`, container `groupguard-snowluma`, WebUI/query listener `6108`.

Do not assume the two hosts have identical host paths. Resolve topology from the live container/mounts before any host mutation.

SnowLuma and GroupGuard may run in separate network namespaces. A SnowLuma OneBot listener bound only to container `127.0.0.1` is not reachable through the host's published port from a host-network GroupGuard container. For that topology the active OneBot HTTP/WS server must bind a reachable container interface such as `0.0.0.0`, or the network design must explicitly provide another reachable path.

After SnowLuma recreation, inspect the active per-account OneBot configuration actually loaded by the running SnowLuma process. Do not assume a persistent-looking secondary config directory is the active source. OneBot credentials/tokens are runtime secrets and must never be committed or copied into repository documentation.

## Repository, artifact and production identities

Always distinguish these evidence states:

1. current GitHub `main` HEAD;
2. accepted runtime/build commit;
3. immutable GitHub Actions artifact built from that commit;
4. Windows checkout state;
5. actual ARM runtime commit on each production host.

Metadata-only `plugin.json` children and docs-only commits can make `main` newer than the accepted runtime artifact without changing runtime code. Never infer a production version from `main` or CI alone.

## Configuration ownership

Group configuration has three different ownership states:

- `config.global`: complete global defaults;
- SQLite `group_config`: sparse per-group overrides;
- effective group settings: runtime-only deep-merged complete settings.

Missing group fields inherit. Explicit `false`, `0` and empty string remain real overrides. Arrays replace atomically; nested plain objects merge recursively. `useGlobal=true` makes stored historical group overrides dormant rather than deleting them.

Do not persist rendered effective values merely because the WebUI displayed them. Effective preview is not proof of group ownership.

## Persistence and migration boundary

SQLite and runtime state must remain consistent. Prefer authenticated application APIs for group/config/license migrations so persistence and in-memory state move together.

A live `groupguard.db` + WAL + SHM file trio copied independently is not a transactionally consistent portable backup. Use SQLite online backup/`VACUUM INTO`, or stop the writer before a raw database copy.

Do not copy an entire GroupGuard database or SnowLuma account/login state between independent production hosts merely to synchronize configuration. Migrations should be selective and preserve host-specific account state, credentials, runtime history and secrets.

A changed OneBot token is startup state for the existing client. Persisting a new token does not prove the running client adopted it; restart/recreation and authenticated connected/ready verification are required when that token actually changes.

## External boundaries

Inbound OneBot fields are untrusted protocol data until normalized and validated. Sensitive authorization must fail closed on malformed identity and must not trust protocol role metadata as sole authority.

Outbound translation is an explicit privacy boundary. Network translation is disabled unless configured by the operator; public fallback requires its separate opt-in.

Target-file downloads and query-test network calls must preserve SSRF protections across redirects/DNS resolution and must not forward repository credentials to artifact/CDN origins.

## Build and release model

GitHub Actions is the normal source of immutable build/deployment packages. The formal GroupGuard Build produces both a self-update artifact and a deployment bundle from an exact commit.

The SnowLuma WebUI self-updater is code-only:

- discover a recent successful `main` build;
- download `groupguard-self-update-<commit>`;
- validate archive paths/types/size, exact manifest file set, SHA-256 and build-info commit;
- atomically replace only `dist` while retaining the previous `dist` as rollback material;
- request supervisor restart;
- accept only the exact target commit; otherwise restore the previous `dist`.

Runtime `config`, SQLite/data, logs, credentials and secrets are outside the replacement set.

For a two-host production rollout, update and verify one host before moving to the next. Never deliberately leave a known failed release split across the fleet.

## Current engineering posture

The 2026-09 security/reliability audit campaign is complete. Runtime/security contracts should be tested through behavior/public boundaries where practical rather than implementation-string matching.

Deferred maintenance such as broad `any` reduction, `StorageAdapter` decomposition, additional architecture-lint coverage and unused-symbol cleanup is not a release blocker. Reopen such work only as an explicit bounded maintenance task with fresh current-main evidence.

PR #56 (`perf: trace queued query delivery stages`) is an independent performance-observability change. Do not merge or fold it into unrelated maintenance without fresh scope review.
