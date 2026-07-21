import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.join(repoRoot, 'resources', 'sub-gameplay');
const sourceRoot = 'D:/project2/unpackage/recovered';

const modules = ['core', 'master_servant', 'light_entertainment', 'racing'];
const moduleSet = new Set(modules);
const selectedKeys = new Map([
  ['selected/master_servant/representative_icon.png', 'representative_icon'],
  ['selected/racing/representative_icon.png', 'representative_icon'],
  ['selected/light_entertainment/dice1_101d18bd.png', 'dice_1'],
  ['selected/light_entertainment/dice2_101d49b6.png', 'dice_2'],
  ['selected/light_entertainment/dice3_101d7c3e.png', 'dice_3'],
  ['selected/light_entertainment/dice4_101dad07.png', 'dice_4'],
  ['selected/light_entertainment/dice5_101dd7dc.png', 'dice_5'],
  ['selected/light_entertainment/dice6_101e053a.png', 'dice_6'],
  ['selected/light_entertainment/rps_choice1_101c400b.png', 'rps_paper'],
  ['selected/light_entertainment/rps_choice2_101c888b.png', 'rps_rock'],
  ['selected/light_entertainment/rps_choice3_101cd1d3.png', 'rps_scissors'],
  ['selected/light_entertainment/rps_draw_or_equal_101bbf9c.png', 'rps_draw'],
  ['selected/light_entertainment/rps_lose_icon_101bedd1.png', 'rps_lose'],
  ['selected/light_entertainment/rps_win_icon_101bd5a1.png', 'rps_win']
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (entry.isFile()) return [fullPath];
    return [];
  });
}

function sha1(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function slug(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function slugWithExtension(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function resourceIdFor(relativePath, classified) {
  const base = classified.collection === 'root' ? slugWithExtension(path.basename(relativePath)) : slug(path.basename(relativePath));
  if (classified.semanticKey) return `sub.${classified.module}.${classified.semanticKey}`;
  return `sub.${classified.module}.${classified.collection}.${base}`;
}

function loadViewableSourceMap() {
  const map = new Map();
  const candidates = [
    path.join(resourceRoot, 'viewable_manifest.json'),
    path.resolve(repoRoot, '..', '..', '..', 'unpackage', 'recovered', 'deep_dive', 'resources', 'viewable', 'manifest.json'),
    'D:/project2/unpackage/recovered/deep_dive/resources/viewable/manifest.json'
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const output = String(row.output || '').replace(/\\/g, '/');
        const match = output.match(/resources\/viewable\/(.+)$/);
        const source = String(row.source || '').replace(/\\/g, '/').replace(/^recovered\//, '');
        if (match) map.set(`viewable/${match[1]}`, `${sourceRoot}/${source}`);
      }
      break;
    } catch {
      // Ignore stale or partial manifests; the generated index remains usable without sourcePath.
    }
  }
  return map;
}

function sourceInfoFor(relativePath, classified, viewableSourceMap) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (viewableSourceMap.has(normalized)) {
    return {
      sourcePath: viewableSourceMap.get(normalized),
      sourceRelation: 'converted'
    };
  }

  if (classified.collection === 'raw' && moduleSet.has(classified.module)) {
    return {
      sourcePath: `${sourceRoot}/playbook_recovery/${classified.module}/resources_raw/${normalized.split('/').slice(2).join('/')}`,
      sourceRelation: 'direct'
    };
  }

  if (classified.collection === 'selected' && classified.module === 'light_entertainment') {
    return {
      sourcePath: `${sourceRoot}/deep_dive/resources/light_selected/${normalized.split('/').slice(2).join('/')}`,
      sourceRelation: 'direct'
    };
  }

  const selectedConvertedSources = new Map([
    ['selected/master_servant/representative_icon.png', `${sourceRoot}/deep_dive/resources/viewable/master_servant/RT_ICON_1_2052.bmp`],
    ['selected/racing/representative_icon.png', `${sourceRoot}/deep_dive/resources/viewable/racing/RT_ICON_1_2052.bmp`]
  ]);
  if (selectedConvertedSources.has(normalized)) {
    return {
      sourcePath: selectedConvertedSources.get(normalized),
      sourceRelation: 'converted'
    };
  }

  const rootSources = new Map([
    ['resource_classification.json', `${sourceRoot}/deep_dive/resources/resource_classification.json`],
    ['RESOURCE_CLASSIFICATION.md', `${sourceRoot}/deep_dive/resources/RESOURCE_CLASSIFICATION.md`],
    ['RESOURCE_RECOVERY_NOTES.md', `${sourceRoot}/deep_dive/resources/RESOURCE_RECOVERY_NOTES.md`],
    ['resource_text_pack.no_auth.md', `${sourceRoot}/snowluma_ready/resource_text_pack.no_auth.md`],
    ['viewable_manifest.json', `${sourceRoot}/deep_dive/resources/viewable/manifest.json`],
    ['viewable/README.md', `${sourceRoot}/deep_dive/resources/viewable/README.md`]
  ]);
  return {
    sourcePath: rootSources.get(normalized) || '',
    sourceRelation: rootSources.has(normalized) ? 'direct' : ''
  };
}

function classify(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const collection = parts.length > 1 ? parts[0] : 'root';
  let module = 'shared';
  if ((collection === 'raw' || collection === 'viewable' || collection === 'selected') && moduleSet.has(parts[1])) {
    module = parts[1];
  }
  const extension = path.extname(normalized).toLowerCase();
  const mediaType = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)
    ? 'image'
    : ['.wav', '.mp3', '.ogg'].includes(extension)
      ? 'audio'
      : ['.md', '.json', '.txt'].includes(extension)
        ? 'document'
        : 'binary';
  return {
    collection,
    module,
    mediaType,
    semanticKey: selectedKeys.get(normalized) || ''
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

if (!fs.existsSync(resourceRoot)) {
  throw new Error(`missing resource root: ${resourceRoot}`);
}

const viewableSourceMap = loadViewableSourceMap();

const entries = walk(resourceRoot)
  .map((filePath) => {
    const relativePath = path.relative(resourceRoot, filePath).replace(/\\/g, '/');
    const stats = fs.statSync(filePath);
    const classified = classify(relativePath);
    const id = resourceIdFor(relativePath, classified);
    const sourceInfo = sourceInfoFor(relativePath, classified, viewableSourceMap);
    return {
      resourceId: id,
      path: relativePath,
      displayName: path.basename(relativePath),
      module: classified.module,
      collection: classified.collection,
      mediaType: classified.mediaType,
      semanticKey: classified.semanticKey,
      sourcePath: sourceInfo.sourcePath,
      sourceRelation: sourceInfo.sourceRelation,
      size: stats.size,
      extension: path.extname(filePath).toLowerCase(),
      sha1: sha1(filePath)
    };
  })
  .filter((entry) => entry.path !== 'manifest.json')
  .sort((a, b) => a.path.localeCompare(b.path));

const summary = {
  total: entries.length,
  byModule: {},
  byCollection: {},
  byMediaType: {}
};

for (const entry of entries) {
  increment(summary.byModule, entry.module);
  increment(summary.byCollection, entry.collection);
  increment(summary.byMediaType, entry.mediaType);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceRoot,
  modules,
  summary,
  entries
};

fs.writeFileSync(path.join(resourceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`wrote ${path.join(resourceRoot, 'manifest.json')} (${entries.length} entries)`);
