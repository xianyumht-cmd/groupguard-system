# System Write Architecture 2.0

## Status

- system_write is evolvable architecture locked
- reference flow is mandatory for all future changes
- rules version: `2.3.0`
- lint modes:
  - `strict`
  - `development`
  - `migration`
  - `learning`

## Change Log

- `1.0.0`
  - initial architecture lock
  - static guard introduced
- `2.0.0`
  - config-driven architecture rule engine introduced
  - multi-mode linting introduced
  - safe extension path documented
  - non-breaking rule evolution enabled
- `2.1.0`
  - governance core consolidated
  - tools now share a single deterministic rule interpretation
  - developer guidance remains aligned with the same rule source
- `2.2.0`
  - policy layer converted to structured rule objects
  - engine layer reduced to deterministic evaluation only
  - presentation layer owns all human-readable guidance
- `2.3.0`
  - rule policy normalized into unified Rule IR schema
  - engine consumes normalized rule nodes without semantic changes
  - governance remains graph-ready and deterministic

## Allowed Dependency Flow

```text
Command -> Dispatcher -> UseCase -> Ports -> Adapters -> Infra
```

## Layer Responsibilities

- **Command**
  - parses raw text
  - builds `SystemWriteCommand`
- **Dispatcher**
  - orchestrates policy, use-case routing, presenter, and adapter factory
  - never talks to infrastructure services directly
- **UseCase**
  - accepts typed input and port context only
  - returns `SystemWriteUseCaseResult`
- **Ports**
  - define the only application boundary contract
  - contain type and interface declarations only
- **Adapters**
  - translate port calls to infrastructure services
  - contain no domain decisions or business rules
- **Infra**
  - concrete runtime, persistence, queue, messaging, filesystem, and logging services

## Forbidden Dependencies

- `UseCase -> infra`
- `UseCase -> services`
- `UseCase -> core state services`
- `UseCase -> commands/common`
- `UseCase -> fs`
- `UseCase -> path`
- `Dispatcher -> infra services`
- `Dispatcher -> core state services`
- `Dispatcher -> commands/common`
- `Adapter -> domain`
- `Adapter -> policy layer`
- `Adapter -> presenter layer`
- `Factory -> business logic`
- `Factory -> conditional action routing`

## Rule Evolution Guidelines

- additive rules are preferred over breaking rewrites
- deprecated rules must remain documented until all dependent code is removed
- migration mode is the safe path for temporary relaxation during controlled refactors
- development mode may warn without blocking, but strict mode remains the CI gate
- any rule change that alters allowed dependency direction requires version update and explicit review

## Ports Contract Freeze

- file: [ports.ts](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/src/app/use-cases/system/write/ports.ts)
- ports are the only contract boundary for system_write use-cases
- any modification requires explicit architecture review
- ports must not contain:
  - function bodies
  - classes
  - runtime conditionals
  - business logic

## Factory Boundary

- file: [systemWriteAdapterFactory.ts](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/src/infra/adapters/systemWriteAdapterFactory.ts)
- factory is the only assembly point used by dispatcher
- factory may instantiate adapters only
- factory must not:
  - call domain services
  - evaluate permissions
  - branch on command actions
  - format responses

## Static Guard

- script: `npm run arch:check:system-write`
- strict CI mode: `npm run arch:check:system-write:strict`
- development warning mode: `npm run arch:check:system-write:dev`
- migration mode: `npm run arch:check:system-write:migration`
- learning mode: `npm run arch:check:system-write:learning`
- build integration: `npm run build`
- the guard uses versioned rule config from:
  - [system-write.rules.ts](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/config/architecture/system-write.rules.ts)
- the guard reports:
  - infra leaks inside use-cases
  - dispatcher infra coupling
  - adapter imports from domain or orchestration layers
  - factory overreach
  - ports file contract violations

## Safe Extension Path

- allowed future changes:
  - additive ports in [ports.ts](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/src/app/use-cases/system/write/ports.ts)
  - new adapter implementations under [system-write](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/src/infra/adapters/system-write)
  - new use-cases under [system/write](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/src/app/use-cases/system/write)
  - controlled new dispatcher actions that preserve orchestration-only flow
- forbidden extension paths:
  - bypassing ports
  - direct infra usage in use-cases
  - direct infra usage in dispatcher
  - business logic in adapters
  - business logic in factory

## Developer Guidance

- hint command:
  - `npm run arch:hints:system-write -- --file=<path>`
- architecture help:
  - `npm run arch:help`
- fix templates:
  - [move-infra-call-to-adapter.md](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/docs/architecture/fix-templates/move-infra-call-to-adapter.md)
  - [extract-business-logic-to-use-case.md](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/docs/architecture/fix-templates/extract-business-logic-to-use-case.md)
  - [fix-dispatcher-orchestration.md](file:///D:/project2/napcatplugin/lengxi_repo/napcat-plugin-groupguard/docs/architecture/fix-templates/fix-dispatcher-orchestration.md)

## Review Rule

- any new system_write code must preserve the locked dependency flow
- if a change requires bypassing ports, the change is invalid until architecture review is completed
