import { systemWriteArchitectureRules } from '../config/architecture/system-write.rules.ts';
import {
  architectureHelpPresentation,
  getLayerPresentation
} from './internal/system-write-governance-presentation.ts';

console.log('system_write architecture help');
console.log(`version: ${systemWriteArchitectureRules.version}`);
console.log(`status: ${systemWriteArchitectureRules.status}`);
console.log('');
console.log('simple model:');
for (const layer of systemWriteArchitectureRules.layers) {
  const presentation = getLayerPresentation(layer.id);
  if (layer.id === 'infra') {
    console.log(`- ${presentation.title} contains the concrete external services.`);
    continue;
  }
  console.log(`- ${presentation.title}: ${presentation.responsibilities[0]}`);
}
console.log('');
console.log('allowed patterns:');
for (const item of architectureHelpPresentation.allowedPatterns) {
  console.log(`- ${item}`);
}
console.log('');
console.log('forbidden patterns:');
for (const item of architectureHelpPresentation.forbiddenPatterns) {
  console.log(`- ${item}`);
}
console.log('');
console.log('common examples:');
for (const example of architectureHelpPresentation.examples) {
  console.log(`- ${example}`);
}
console.log('');
console.log('useful commands:');
for (const command of architectureHelpPresentation.commands) {
  console.log(`- ${command}`);
}
