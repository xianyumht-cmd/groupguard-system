import {
  evaluateArchitecture,
  parseMode,
  validateMode
} from './internal/system-write-governance-core.ts';
import { systemWriteArchitectureRules } from '../config/architecture/system-write.rules.ts';
import { getRulePresentation } from './internal/system-write-governance-presentation.ts';

function printSection(title: string, violations: ReturnType<typeof evaluateArchitecture>['violations']): void {
  console.log(`\n[${title}]`);
  if (!violations.length) {
    console.log('PASS');
    return;
  }
  for (const violation of violations) {
    const rule = systemWriteArchitectureRules.rules.find((item) => item.id === violation.ruleId);
    console.log(`- ${violation.level.toUpperCase()} ${violation.file}: ${violation.ruleId} -> ${violation.message}`);
    if (rule) {
      const presentation = getRulePresentation(rule.id, rule.fix.strategyId);
      console.log(`  why: ${presentation.why}`);
      console.log(`  move to: ${presentation.moveTo}`);
      console.log(`  example: ${presentation.exampleFix}`);
    }
  }
}

const mode = parseMode(process.argv);
validateMode(mode);
const evaluation = evaluateArchitecture(mode);

console.log(`system_write architecture health check`);
console.log(`module: ${systemWriteArchitectureRules.module}`);
console.log(`version: ${systemWriteArchitectureRules.version}`);
console.log(`mode: ${evaluation.state.mode}`);
console.log(`status: ${systemWriteArchitectureRules.status}`);
console.log(`guidance: ${evaluation.state.guidanceLevel}`);
console.log(`severity: ${evaluation.state.severityLevel}`);

for (const result of evaluation.ruleResults) {
  const rule = systemWriteArchitectureRules.rules.find((item) => item.id === result.ruleId);
  const title = rule ? getRulePresentation(rule.id, rule.fix.strategyId).title : result.ruleId;
  printSection(title, result.violations);
}

console.log(`\nsummary: ${evaluation.errors.length} error(s), ${evaluation.warnings.length} warning(s)`);

if (evaluation.errors.length) {
  console.error(`\nsystem_write architecture check failed with ${evaluation.errors.length} error(s)`);
  process.exit(1);
}

if (evaluation.warnings.length) {
  console.warn(`\nsystem_write architecture warnings present`);
}

console.log('\nsystem_write architecture evolvable lock active');
