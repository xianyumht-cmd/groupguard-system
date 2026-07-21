import fs from 'fs';
import path from 'path';
import {
  systemWriteArchitectureRules,
  type ArchitectureLintMode,
  type ArchitectureRuleIR,
  type ArchitectureMatchCondition,
  type ArchitectureSeverityLevel
} from '../../config/architecture/system-write.rules.ts';

export type ViolationLevel = 'error' | 'warn';

export interface GovernanceViolation {
  file: string;
  ruleId: string;
  level: ViolationLevel;
  message: string;
}

export interface GovernanceRuleResult {
  ruleId: string;
  violations: GovernanceViolation[];
}

export interface GovernanceState {
  mode: ArchitectureLintMode;
  severityLevel: ViolationLevel | 'clean';
  guidanceLevel: 'compact' | 'guided' | 'learning';
}

export interface GovernanceEvaluation {
  state: GovernanceState;
  ruleResults: GovernanceRuleResult[];
  violations: GovernanceViolation[];
  errors: GovernanceViolation[];
  warnings: GovernanceViolation[];
}

const root = process.cwd();

export function parseMode(argv: string[]): ArchitectureLintMode {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const requestedMode = modeArg?.slice('--mode='.length) as ArchitectureLintMode | undefined;
  return requestedMode || systemWriteArchitectureRules.defaultMode;
}

export function validateMode(value: ArchitectureLintMode): void {
  const allowedModes: ArchitectureLintMode[] = ['strict', 'development', 'migration', 'learning'];
  if (!allowedModes.includes(value)) {
    throw new Error(`invalid mode: ${value}`);
  }
}

export function toAbsolute(target: string): string {
  return path.isAbsolute(target) ? target : path.join(root, target);
}

export function toRelative(filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

export function getImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');
  return Array.from(content.matchAll(/from\s+['"]([^'"]+)['"]/g), (match) => match[1]);
}

function collectTypeScriptFiles(targetPath: string): string[] {
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) return [targetPath];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

function matchesPattern(value: string, pattern: string): boolean {
  return value === pattern || value.includes(pattern) || new RegExp(pattern).test(value);
}

function mapSeverity(level: ArchitectureSeverityLevel): ViolationLevel | null {
  if (level === 2) return 'error';
  if (level === 1) return 'warn';
  return null;
}

function collectScopeFiles(scopeIds: string[]): string[] {
  const fileSet = new Set<string>();
  for (const scopeId of scopeIds) {
    const scope = systemWriteArchitectureRules.scopes.find((item) => item.id === scopeId);
    if (!scope) continue;
    const excluded = new Set((scope.exclude || []).map((target) => path.join(root, target)));
    for (const target of scope.targets) {
      const fullTarget = path.join(root, target);
      for (const file of collectTypeScriptFiles(fullTarget)) {
        if (!excluded.has(file)) fileSet.add(file);
      }
    }
  }
  return Array.from(fileSet);
}

function evaluateMatchCondition(file: string, condition: ArchitectureMatchCondition): string[] {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  if (condition.type === 'import') {
    const imports = getImports(file);
    if (condition.operator === 'contains') {
      return imports.filter((specifier) => values.some((pattern) => matchesPattern(specifier, pattern)))
        .map((specifier) => `forbidden import: ${specifier}`);
    }
    if (condition.operator === 'inSet') {
      return imports.filter((specifier) => !values.some((pattern) => matchesPattern(specifier, pattern)))
        .map((specifier) => `forbidden import: ${specifier}`);
    }
    if (condition.operator === 'equals') {
      return imports.filter((specifier) => !values.includes(specifier))
        .map((specifier) => `forbidden import: ${specifier}`);
    }
    return [];
  }
  if (condition.type === 'content') {
    const content = fs.readFileSync(file, 'utf8');
    if (condition.operator === 'matches') {
      return values.filter((pattern) => new RegExp(pattern).test(content))
        .map((pattern) => `forbidden content pattern: ${pattern}`);
    }
    if (condition.operator === 'contains') {
      return values.filter((pattern) => content.includes(pattern))
        .map((pattern) => `forbidden content pattern: ${pattern}`);
    }
  }
  return [];
}

function buildViolation(rule: ArchitectureRuleIR, file: string, level: ViolationLevel, message: string): GovernanceViolation {
  return {
    file: toRelative(file),
    ruleId: rule.id,
    level,
    message
  };
}

function evaluateRule(rule: ArchitectureRuleIR, mode: ArchitectureLintMode): GovernanceViolation[] {
  const severity = mapSeverity(rule.severity[mode]);
  if (!severity) return [];
  const files = collectScopeFiles(rule.scope);
  const violations: GovernanceViolation[] = [];
  for (const file of files) {
    for (const message of evaluateMatchCondition(file, rule.match)) {
      violations.push(buildViolation(rule, file, severity, message));
    }
  }
  return violations;
}

function buildState(mode: ArchitectureLintMode, violations: GovernanceViolation[]): GovernanceState {
  const severityLevel: GovernanceState['severityLevel'] =
    violations.some((item) => item.level === 'error') ? 'error' :
    violations.some((item) => item.level === 'warn') ? 'warn' :
    'clean';
  const guidanceLevel: GovernanceState['guidanceLevel'] =
    mode === 'learning' ? 'learning' :
    mode === 'development' || mode === 'migration' ? 'guided' :
    'compact';
  return {
    mode,
    severityLevel,
    guidanceLevel
  };
}

export function evaluateArchitecture(mode: ArchitectureLintMode): GovernanceEvaluation {
  validateMode(mode);
  const ruleResults: GovernanceRuleResult[] = systemWriteArchitectureRules.rules.map((rule) => ({
    ruleId: rule.id,
    violations: evaluateRule(rule, mode)
  }));
  const violations = ruleResults.flatMap((result) => result.violations);
  return {
    state: buildState(mode, violations),
    ruleResults,
    violations,
    errors: violations.filter((item) => item.level === 'error'),
    warnings: violations.filter((item) => item.level === 'warn')
  };
}

export function detectSuggestedLayer(filePath: string): string {
  const absoluteFile = toAbsolute(filePath);
  const normalized = absoluteFile.replace(/\\/g, '/');
  const imports = fs.existsSync(absoluteFile) ? getImports(absoluteFile) : [];

  for (const layer of systemWriteArchitectureRules.layers) {
    if (layer.detectPathPatterns.some((pattern) => normalized.includes(pattern.replace(/\\/g, '/')))) {
      return layer.id;
    }
  }
  for (const layer of systemWriteArchitectureRules.layers) {
    if (layer.detectImportPatterns && imports.some((specifier) => layer.detectImportPatterns!.some((pattern) => matchesPattern(specifier, pattern)))) {
      return layer.id;
    }
  }
  return systemWriteArchitectureRules.layers.find((layer) => layer.id === 'port')?.id || systemWriteArchitectureRules.layers[0].id;
}
