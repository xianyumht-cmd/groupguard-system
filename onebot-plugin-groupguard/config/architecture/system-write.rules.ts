export type ArchitectureLintMode = 'strict' | 'development' | 'migration' | 'learning';

export type ArchitectureSeverityLevel = 0 | 1 | 2;

export type ArchitectureLayerId = 'command' | 'dispatcher' | 'use-case' | 'port' | 'adapter' | 'infra';

export type ArchitectureScopeId = 'use-cases' | 'dispatcher' | 'adapters' | 'factory' | 'ports';

export type ArchitectureMatchType = 'import' | 'content' | 'structure';

export type ArchitectureMatchOperator = 'contains' | 'matches' | 'equals' | 'inSet';

export type ArchitectureEffectAction = 'report' | 'warn' | 'block';

export type ArchitectureFixCode =
  | 'move-infra-to-adapter'
  | 'move-dispatcher-dependency-to-factory'
  | 'keep-adapter-thin'
  | 'keep-factory-wiring-only'
  | 'keep-ports-declarative';

export interface ArchitectureLayerConfig {
  id: ArchitectureLayerId;
  detectPathPatterns: string[];
  detectImportPatterns?: string[];
}

export interface ArchitectureScopeConfig {
  id: ArchitectureScopeId;
  targets: string[];
  exclude?: string[];
}

export interface ArchitectureMatchCondition {
  type: ArchitectureMatchType;
  operator: ArchitectureMatchOperator;
  value: string | string[];
}

export interface ArchitectureRuleEffect {
  action: ArchitectureEffectAction;
  targetLayer: ArchitectureLayerId;
}

export interface ArchitectureRuleFix {
  strategyId: ArchitectureFixCode;
  targetLayer: ArchitectureLayerId;
  templateRef: string;
}

export interface ArchitectureRuleSeverityMap {
  strict: ArchitectureSeverityLevel;
  development: ArchitectureSeverityLevel;
  migration: ArchitectureSeverityLevel;
  learning: ArchitectureSeverityLevel;
}

export interface ArchitectureRuleIR {
  id: string;
  layer: ArchitectureLayerId;
  scope: ArchitectureScopeId[];
  match: ArchitectureMatchCondition;
  effect: ArchitectureRuleEffect;
  fix: ArchitectureRuleFix;
  severity: ArchitectureRuleSeverityMap;
}

export interface ArchitectureRulesConfig {
  module: string;
  version: string;
  status: string;
  defaultMode: ArchitectureLintMode;
  layers: ArchitectureLayerConfig[];
  scopes: ArchitectureScopeConfig[];
  rules: ArchitectureRuleIR[];
}

export const systemWriteArchitectureRules: ArchitectureRulesConfig = {
  module: 'system_write',
  version: '2.3.0',
  status: 'evolvable-architecture-locked',
  defaultMode: 'strict',
  layers: [
    {
      id: 'command',
      detectPathPatterns: ['src/commands/modules/system/write.ts']
    },
    {
      id: 'dispatcher',
      detectPathPatterns: ['src/services/system_write_dispatcher.ts'],
      detectImportPatterns: ['systemWriteAdapterFactory', 'system_write_presenter', 'system_write_policy']
    },
    {
      id: 'use-case',
      detectPathPatterns: ['src/app/use-cases/system/write/'],
      detectImportPatterns: ['/ports', '/domain/']
    },
    {
      id: 'port',
      detectPathPatterns: ['src/app/use-cases/system/write/ports.ts']
    },
    {
      id: 'adapter',
      detectPathPatterns: ['src/infra/adapters/system-write/', 'src/infra/adapters/systemWriteAdapterFactory.ts'],
      detectImportPatterns: ['/infra/', 'fs', 'path']
    },
    {
      id: 'infra',
      detectPathPatterns: []
    }
  ],
  scopes: [
    {
      id: 'use-cases',
      targets: ['src/app/use-cases/system/write'],
      exclude: ['src/app/use-cases/system/write/ports.ts']
    },
    {
      id: 'dispatcher',
      targets: ['src/services/system_write_dispatcher.ts']
    },
    {
      id: 'adapters',
      targets: ['src/infra/adapters/system-write']
    },
    {
      id: 'factory',
      targets: ['src/infra/adapters/systemWriteAdapterFactory.ts']
    },
    {
      id: 'ports',
      targets: ['src/app/use-cases/system/write/ports.ts']
    }
  ],
  rules: [
    {
      id: 'use-case-no-infra-imports',
      layer: 'use-case',
      scope: ['use-cases'],
      match: {
        type: 'import',
        operator: 'contains',
        value: ['/infra/', '/services/', '/core/', '/commands/', 'fs', 'path']
      },
      effect: {
        action: 'report',
        targetLayer: 'use-case'
      },
      fix: {
        strategyId: 'move-infra-to-adapter',
        targetLayer: 'adapter',
        templateRef: 'move-infra-call-to-adapter'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'dispatcher-allowed-imports',
      layer: 'dispatcher',
      scope: ['dispatcher'],
      match: {
        type: 'import',
        operator: 'inSet',
        value: [
          'napcat-types/napcat-onebot/network/plugin-manger',
          '../app/use-cases/system/write/',
          '../infra/adapters/systemWriteAdapterFactory',
          './system_write_policy',
          './system_write_presenter'
        ]
      },
      effect: {
        action: 'report',
        targetLayer: 'dispatcher'
      },
      fix: {
        strategyId: 'move-dispatcher-dependency-to-factory',
        targetLayer: 'adapter',
        templateRef: 'fix-dispatcher-orchestration'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'adapter-forbidden-imports',
      layer: 'adapter',
      scope: ['adapters'],
      match: {
        type: 'import',
        operator: 'contains',
        value: ['/domain/', 'system_write_policy', 'system_write_presenter', 'system_write_dispatcher']
      },
      effect: {
        action: 'report',
        targetLayer: 'adapter'
      },
      fix: {
        strategyId: 'keep-adapter-thin',
        targetLayer: 'use-case',
        templateRef: 'extract-business-logic-to-use-case'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'adapter-business-logic-heuristic',
      layer: 'adapter',
      scope: ['adapters'],
      match: {
        type: 'content',
        operator: 'matches',
        value: ['\\b(plan|validate|evaluate)[A-Z]\\w*']
      },
      effect: {
        action: 'report',
        targetLayer: 'adapter'
      },
      fix: {
        strategyId: 'keep-adapter-thin',
        targetLayer: 'use-case',
        templateRef: 'extract-business-logic-to-use-case'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'factory-allowed-imports',
      layer: 'adapter',
      scope: ['factory'],
      match: {
        type: 'import',
        operator: 'inSet',
        value: [
          'napcat-types/napcat-onebot/network/plugin-manger',
          '../../app/use-cases/system/write/ports',
          './system-write/'
        ]
      },
      effect: {
        action: 'report',
        targetLayer: 'adapter'
      },
      fix: {
        strategyId: 'keep-factory-wiring-only',
        targetLayer: 'adapter',
        templateRef: 'fix-dispatcher-orchestration'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'factory-no-control-flow',
      layer: 'adapter',
      scope: ['factory'],
      match: {
        type: 'content',
        operator: 'matches',
        value: ['\\bif\\s*\\(', '\\bswitch\\s*\\(', '\\bfor\\s*\\(', '\\bwhile\\s*\\(']
      },
      effect: {
        action: 'report',
        targetLayer: 'adapter'
      },
      fix: {
        strategyId: 'keep-factory-wiring-only',
        targetLayer: 'adapter',
        templateRef: 'fix-dispatcher-orchestration'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 1,
        learning: 1
      }
    },
    {
      id: 'ports-forbidden-imports',
      layer: 'port',
      scope: ['ports'],
      match: {
        type: 'import',
        operator: 'contains',
        value: ['/infra/', '/services/', '/core/', '/commands/', 'fs', 'path']
      },
      effect: {
        action: 'report',
        targetLayer: 'port'
      },
      fix: {
        strategyId: 'keep-ports-declarative',
        targetLayer: 'port',
        templateRef: 'move-infra-call-to-adapter'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 2,
        learning: 1
      }
    },
    {
      id: 'ports-no-executable-logic',
      layer: 'port',
      scope: ['ports'],
      match: {
        type: 'content',
        operator: 'matches',
        value: ['\\bclass\\s+\\w+', '\\bfunction\\s+\\w+', '=>', '\\bnew\\s+\\w+', '\\bif\\s*\\(']
      },
      effect: {
        action: 'report',
        targetLayer: 'port'
      },
      fix: {
        strategyId: 'keep-ports-declarative',
        targetLayer: 'port',
        templateRef: 'move-infra-call-to-adapter'
      },
      severity: {
        strict: 2,
        development: 1,
        migration: 2,
        learning: 1
      }
    }
  ]
};
