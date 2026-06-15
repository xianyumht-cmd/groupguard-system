import fs from 'fs';
import {
  detectSuggestedLayer,
  toAbsolute
} from './internal/system-write-governance-core.ts';
import { systemWriteArchitectureRules } from '../config/architecture/system-write.rules.ts';
import { getLayerPresentation } from './internal/system-write-governance-presentation.ts';

const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const inputFile = fileArg?.slice('--file='.length);
if (!inputFile) {
  console.log('usage: npm run arch:hints:system-write -- --file=<path>');
  process.exit(0);
}

const absoluteFile = toAbsolute(inputFile);
if (!fs.existsSync(absoluteFile)) {
  console.error(`file not found: ${absoluteFile}`);
  process.exit(1);
}

const suggestedLayerId = detectSuggestedLayer(absoluteFile);
const suggestedLayer = systemWriteArchitectureRules.layers.find((layer) => layer.id === suggestedLayerId);
if (!suggestedLayer) {
  console.error(`unknown suggested layer: ${suggestedLayerId}`);
  process.exit(1);
}
const presentation = getLayerPresentation(suggestedLayer.id);

console.log('system_write architecture hint');
console.log(`version: ${systemWriteArchitectureRules.version}`);
console.log(`file: ${absoluteFile}`);
console.log(`suggested layer: ${presentation.title}`);
console.log('\nrecommended guidance:');
for (const line of presentation.responsibilities) {
  console.log(`- ${line}`);
}

if (presentation.quickChecks) {
  console.log('\nquick checks:');
  console.log(`- allowed: ${presentation.quickChecks.allowed.join(', ')}`);
  console.log(`- forbidden: ${presentation.quickChecks.forbidden.join(', ')}`);
}
