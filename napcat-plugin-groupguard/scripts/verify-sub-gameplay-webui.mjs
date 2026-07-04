import { renderHomePage } from '../src/standalone/admin/static_page.ts';
import {
  getSubGameplayResourceManifest,
  getSubGameplayResourceOverview,
  verifySubGameplayResourceIntegrity
} from '../src/services/sub_gameplay_resources.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, fragment, label) {
  assert(text.includes(fragment), `missing WebUI fragment: ${label}`);
}

const html = renderHomePage();

const requiredFragments = [
  ['SUB资源', 'resource tab label'],
  ['resourceModule', 'module filter'],
  ['resourceCollection', 'collection filter'],
  ['resourceMediaType', 'media type filter'],
  ['resourceSourceRelation', 'source relation filter'],
  ['loadResourcesBtn', 'load resources button'],
  ['/api/sub-gameplay/resources', 'resource list api'],
  ['/api/sub-gameplay/resource-file', 'resource file api'],
  ['sourceRelation=', 'source relation query'],
  ['row.sourceRelation', 'source relation table column'],
  ['integrity.sourceRelations', 'source relation summary'],
  ['integrity.sourcePathCoverage', 'source path coverage summary']
];

for (const [fragment, label] of requiredFragments) {
  assertIncludes(html, fragment, label);
}

const manifest = getSubGameplayResourceManifest();
assert(manifest, 'missing sub gameplay manifest');

const entries = manifest.entries || [];
const sourcePathCount = entries.filter(entry => entry.sourcePath).length;
const relationCounts = entries.reduce((counts, entry) => {
  const relation = entry.sourceRelation || 'unknown';
  counts[relation] = (counts[relation] || 0) + 1;
  return counts;
}, {});

assert(entries.length === 352, `unexpected manifest entry count: ${entries.length}`);
assert(sourcePathCount === entries.length, `sourcePath coverage mismatch: ${sourcePathCount}/${entries.length}`);
assert(relationCounts.direct === 273, `unexpected direct relation count: ${relationCounts.direct || 0}`);
assert(relationCounts.converted === 79, `unexpected converted relation count: ${relationCounts.converted || 0}`);

const integrity = verifySubGameplayResourceIntegrity();
assert(integrity.ok, `resource integrity failed: ${integrity.errors.join(', ')}`);
assert(integrity.sourcePathCoverage === 352, `unexpected integrity sourcePath coverage: ${integrity.sourcePathCoverage}`);
assert(integrity.sourceRelations.direct === 273, `unexpected integrity direct count: ${integrity.sourceRelations.direct || 0}`);
assert(integrity.sourceRelations.converted === 79, `unexpected integrity converted count: ${integrity.sourceRelations.converted || 0}`);

const convertedOverview = getSubGameplayResourceOverview('', 500, '', '', '', 'converted');
const directOverview = getSubGameplayResourceOverview('', 500, '', '', '', 'direct');
const selectedLightImages = getSubGameplayResourceOverview('light_entertainment', 500, '', 'selected', 'image', 'direct');
const rpsSearch = getSubGameplayResourceOverview('light_entertainment', 500, 'rps', 'selected', 'image', 'direct');

assert(convertedOverview.entries.length === 79, `converted filter mismatch: ${convertedOverview.entries.length}`);
assert(directOverview.entries.length === 273, `direct filter mismatch: ${directOverview.entries.length}`);
assert(selectedLightImages.entries.length === 12, `selected light image filter mismatch: ${selectedLightImages.entries.length}`);
assert(rpsSearch.entries.length >= 6, `rps search returned too few entries: ${rpsSearch.entries.length}`);

console.log(JSON.stringify({
  ok: true,
  webuiFragments: requiredFragments.length,
  manifestEntries: entries.length,
  sourcePathCoverage: sourcePathCount,
  sourceRelations: relationCounts,
  filtered: {
    converted: convertedOverview.entries.length,
    direct: directOverview.entries.length,
    selectedLightImages: selectedLightImages.entries.length,
    rpsSearch: rpsSearch.entries.length
  }
}, null, 2));
