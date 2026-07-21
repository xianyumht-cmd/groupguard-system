import type { ArchitectureFixCode, ArchitectureLayerId } from '../../config/architecture/system-write.rules.ts';

export interface LayerPresentation {
  title: string;
  responsibilities: string[];
  quickChecks?: {
    allowed: string[];
    forbidden: string[];
  };
}

export interface RulePresentation {
  title: string;
  why: string;
  moveTo: string;
  exampleFix: string;
}

const layerPresentationMap: Record<ArchitectureLayerId, LayerPresentation> = {
  command: {
    title: 'Command layer',
    responsibilities: [
      'Parses raw text into SystemWriteCommand.',
      'Contains no business logic.',
      'Delegates orchestration to the dispatcher.'
    ]
  },
  dispatcher: {
    title: 'Dispatcher layer',
    responsibilities: [
      'Orchestrates policy, use-case routing, presenter, and factory only.',
      'Does not import infrastructure services directly.',
      'Adds new action routing only when orchestration changes.'
    ]
  },
  'use-case': {
    title: 'UseCase layer',
    responsibilities: [
      'Keeps orchestration and domain calls only.',
      'Depends only on ports, domain services, and local types.',
      'Moves direct runtime or filesystem work into adapters.'
    ],
    quickChecks: {
      allowed: ['domain services', 'ports', 'local types'],
      forbidden: ['infra', 'services', 'core state', 'commands/common', 'fs', 'path']
    }
  },
  port: {
    title: 'Port layer',
    responsibilities: [
      'Keeps the contract declarative.',
      'Exposes only types and interfaces.',
      'Contains no function bodies or runtime logic.'
    ]
  },
  adapter: {
    title: 'Adapter layer',
    responsibilities: [
      'Wraps infrastructure services only.',
      'Does not evaluate policy or business rules.',
      'Returns raw infrastructure behavior through port contracts.'
    ]
  },
  infra: {
    title: 'Infra layer',
    responsibilities: [
      'Contains concrete runtime, persistence, messaging, queue, and filesystem services.',
      'Must be consumed through adapters only.'
    ]
  }
};

const fixStrategyPresentationMap: Record<ArchitectureFixCode, Omit<RulePresentation, 'title'>> = {
  'move-infra-to-adapter': {
    why: 'Use-cases must stay deterministic and depend only on domain services and ports.',
    moveTo: 'Move the infrastructure call into an adapter implementation and expose it through ports.ts.',
    exampleFix: 'Replace direct saveConfig/fs/runtime imports with context.configPort or another injected port.'
  },
  'move-dispatcher-dependency-to-factory': {
    why: 'Dispatcher should orchestrate only and must stay infrastructure-agnostic.',
    moveTo: 'Move runtime or service calls into adapters and obtain them through the adapter factory.',
    exampleFix: 'Replace direct sendGroupScene or state-service usage with createSystemWriteContext() and port calls.'
  },
  'keep-adapter-thin': {
    why: 'Adapters translate infrastructure APIs only and must not pull business or orchestration logic downward.',
    moveTo: 'Keep business rules in use-cases/domain and let adapters wrap only external services.',
    exampleFix: 'If an adapter needs a decision, return raw infra data and let the use-case or policy layer interpret it.'
  },
  'keep-factory-wiring-only': {
    why: 'The factory is an assembly boundary and must not contain business or routing logic.',
    moveTo: 'Instantiate adapters in the factory and keep all behavior in dispatcher/use-cases/adapters.',
    exampleFix: 'Create all adapters declaratively and let dispatcher choose which use-case/action runs.'
  },
  'keep-ports-declarative': {
    why: 'Ports are the contract boundary and must remain independent from implementation details.',
    moveTo: 'Keep only type/interface declarations in ports and place implementation details in adapters.',
    exampleFix: 'Export interfaces and data types only; move any function body or helper into a dedicated module.'
  }
};

const ruleTitleMap: Record<string, string> = {
  'use-case-no-infra-imports': 'Use-cases must not import infrastructure or runtime layers',
  'dispatcher-allowed-imports': 'Dispatcher imports must stay orchestration-only',
  'adapter-forbidden-imports': 'Adapters must not import orchestration or domain layers',
  'adapter-business-logic-heuristic': 'Adapters should not contain business-logic shaped symbols',
  'factory-allowed-imports': 'Factory imports must stay inside ports and adapter assembly',
  'factory-no-control-flow': 'Factory must not contain business or routing control flow',
  'ports-forbidden-imports': 'Ports must not import infrastructure or runtime layers',
  'ports-no-executable-logic': 'Ports contract must remain declarative only'
};

export const architectureHelpPresentation = {
  allowedPatterns: [
    'new ports added to the ports contract without embedding logic',
    'new adapters that implement existing or additive ports',
    'new use-cases that depend only on domain services and ports',
    'new dispatcher action mappings that preserve orchestration-only behavior'
  ],
  forbiddenPatterns: [
    'direct infrastructure usage inside use-cases',
    'direct infrastructure usage inside dispatcher',
    'business logic inside adapters',
    'business logic or action routing inside the adapter factory'
  ],
  examples: [
    'Example 1: direct saveConfig in a use-case -> move to config adapter and call context.configPort.saveConfig().',
    'Example 2: permission check in adapter -> move to policy or use-case layer and keep adapter as thin wrapper.',
    'Example 3: sendGroupScene in dispatcher helper -> use messaging port from systemWriteAdapterFactory.'
  ],
  commands: [
    'npm run arch:check:system-write:strict',
    'npm run arch:check:system-write:dev',
    'npm run arch:check:system-write:migration',
    'npm run arch:check:system-write:learning',
    'npm run arch:hints:system-write -- --file=src/app/use-cases/system/write/config/create_scheduled_task.ts',
    'npm run arch:help'
  ]
};

export function getLayerPresentation(layerId: ArchitectureLayerId): LayerPresentation {
  return layerPresentationMap[layerId];
}

export function getRulePresentation(ruleId: string, fixCode: ArchitectureFixCode): RulePresentation {
  return {
    title: ruleTitleMap[ruleId] || ruleId,
    ...fixStrategyPresentationMap[fixCode]
  };
}
