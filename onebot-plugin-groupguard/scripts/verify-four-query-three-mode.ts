import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { resolveUnifiedQueryPreferredOutput } from '../src/dynamic-commands/intranet_query_runtime_plugin.ts';
import { normalizeIntranetPreferredOutput } from '../src/services/intranet_query_service.ts';

assert.equal(normalizeIntranetPreferredOutput('text'), 'text');
assert.equal(normalizeIntranetPreferredOutput('forward'), 'forward');
assert.equal(normalizeIntranetPreferredOutput('image'), 'image');
assert.equal(normalizeIntranetPreferredOutput('card'), 'image');

const original = structuredClone(configStateService.getConfig() as any);
try {
  for (const mode of ['text', 'forward', 'image'] as const) {
    const config = structuredClone(original) as any;
    config.global = { ...(config.global || {}), lolQueryOutputFormat: mode };
    config.groups = {};
    config.queryCommandProfiles = {};
    configStateService.setConfig(config);
    for (const keys of [['lol_ban'], ['scammer'], ['peer'], ['dynamic']]) {
      assert.equal(resolveUnifiedQueryPreferredOutput('10001', keys), mode);
    }
  }

  const config = structuredClone(original) as any;
  config.global = { ...(config.global || {}), lolQueryOutputFormat: 'text' };
  config.queryCommandProfiles = { scammer: { outputFormat: 'forward' } };
  configStateService.setConfig(config);
  assert.equal(resolveUnifiedQueryPreferredOutput('10001', ['scammer']), 'forward');
} finally {
  configStateService.setConfig(original as any);
}

for (const path of [
  'src/dynamic-commands/intranet_query_runtime_plugin.ts',
  'src/dynamic-commands/intranet_risk_runtime_plugin.ts',
  'src/dynamic-commands/intranet_dynamic_command_plugin.ts'
]) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.equal(source.includes("preferred: 'text'"), path.includes('intranet_risk_runtime_plugin') ? true : false);
}

console.log('four query three-mode preference verification passed');
