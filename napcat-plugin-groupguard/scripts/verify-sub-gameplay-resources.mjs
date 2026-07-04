import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.join(repoRoot, 'resources', 'sub-gameplay');
const distResourceRoot = path.join(repoRoot, 'dist', 'resources', 'sub-gameplay');
const sourceRoot = path.resolve(process.env.SUB_GAMEPLAY_SOURCE_ROOT || 'D:/project2/unpackage/recovered');

const modules = ['core', 'master_servant', 'light_entertainment', 'racing'];

function exists(filePath) {
  return fs.existsSync(filePath);
}

function walk(dir) {
  if (!exists(dir)) return [];
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

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function addRequired(rows, sourceFile, resourcePath) {
  rows.push({
    sourceFile,
    resourcePath: normalize(resourcePath)
  });
}

function collectRequiredResources() {
  const rows = [];
  for (const module of modules) {
    const rawSourceDir = path.join(sourceRoot, 'playbook_recovery', module, 'resources_raw');
    for (const filePath of walk(rawSourceDir)) {
      addRequired(
        rows,
        filePath,
        path.join('raw', module, path.relative(rawSourceDir, filePath))
      );
    }
  }

  const deepDiveRoot = path.join(sourceRoot, 'deep_dive', 'resources');
  const directDeepDiveFiles = [
    ['resource_classification.json', 'resource_classification.json'],
    ['RESOURCE_CLASSIFICATION.md', 'RESOURCE_CLASSIFICATION.md'],
    ['RESOURCE_RECOVERY_NOTES.md', 'RESOURCE_RECOVERY_NOTES.md']
  ];
  for (const [sourceName, targetName] of directDeepDiveFiles) {
    addRequired(rows, path.join(deepDiveRoot, sourceName), targetName);
  }

  addRequired(rows, path.join(deepDiveRoot, 'viewable', 'manifest.json'), 'viewable_manifest.json');
  addRequired(rows, path.join(deepDiveRoot, 'viewable', 'README.md'), path.join('viewable', 'README.md'));

  const viewableRoot = path.join(deepDiveRoot, 'viewable');
  for (const module of modules) {
    const moduleDir = path.join(viewableRoot, module);
    for (const filePath of walk(moduleDir)) {
      addRequired(
        rows,
        filePath,
        path.join('viewable', module, path.relative(moduleDir, filePath))
      );
    }
  }

  const selectedRoot = path.join(deepDiveRoot, 'light_selected');
  for (const filePath of walk(selectedRoot)) {
    addRequired(
      rows,
      filePath,
      path.join('selected', 'light_entertainment', path.relative(selectedRoot, filePath))
    );
  }

  addRequired(
    rows,
    path.join(sourceRoot, 'snowluma_ready', 'resource_text_pack.no_auth.md'),
    'resource_text_pack.no_auth.md'
  );

  return rows;
}

function verifySourceCoverage(requiredRows) {
  const errors = [];
  for (const row of requiredRows) {
    if (!exists(row.sourceFile)) {
      errors.push(`missing source: ${row.sourceFile}`);
      continue;
    }
    const destination = path.join(resourceRoot, row.resourcePath);
    if (!exists(destination)) {
      errors.push(`missing resource: ${row.resourcePath}`);
      continue;
    }
    const sourceHash = sha1(row.sourceFile);
    const destinationHash = sha1(destination);
    if (sourceHash !== destinationHash) {
      errors.push(`hash mismatch: ${row.resourcePath}`);
    }
  }
  return errors;
}

function verifyManifest() {
  const errors = [];
  const manifestPath = path.join(resourceRoot, 'manifest.json');
  if (!exists(manifestPath)) return { errors: [`missing manifest: ${manifestPath}`], manifest: null };

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const ids = new Set();
  const duplicateIds = new Set();
  const entryPaths = new Set();

  for (const entry of entries) {
    if (!entry.resourceId) errors.push(`manifest entry missing resourceId: ${entry.path}`);
    if (ids.has(entry.resourceId)) duplicateIds.add(entry.resourceId);
    ids.add(entry.resourceId);
    entryPaths.add(entry.path);
    if (!entry.sourcePath) {
      errors.push(`manifest entry missing sourcePath: ${entry.path}`);
    } else {
      const sourceFile = path.resolve(entry.sourcePath);
      const resourceFile = path.join(resourceRoot, entry.path);
      if (!exists(sourceFile)) {
        errors.push(`manifest sourcePath missing file: ${entry.path} -> ${entry.sourcePath}`);
      } else if (entry.sourceRelation !== 'converted' && exists(resourceFile) && sha1(sourceFile) !== sha1(resourceFile)) {
        errors.push(`manifest sourcePath hash mismatch: ${entry.path} -> ${entry.sourcePath}`);
      }
    }
  }
  for (const id of duplicateIds) errors.push(`duplicate resourceId: ${id}`);

  const resourceFiles = walk(resourceRoot)
    .map(filePath => normalize(path.relative(resourceRoot, filePath)))
    .filter(relativePath => relativePath !== 'manifest.json')
    .sort();

  for (const relativePath of resourceFiles) {
    if (!entryPaths.has(relativePath)) errors.push(`manifest missing file: ${relativePath}`);
  }
  for (const entry of entries) {
    if (!exists(path.join(resourceRoot, entry.path))) errors.push(`manifest points to missing file: ${entry.path}`);
  }
  if (entries.length !== resourceFiles.length) {
    errors.push(`manifest count mismatch: entries=${entries.length} files=${resourceFiles.length}`);
  }

  return { errors, manifest, resourceFiles };
}

function verifyDistCopy(resourceFiles) {
  const errors = [];
  if (!exists(distResourceRoot)) return { errors: ['dist resource root missing; run npm run build:snowluma first'] };
  for (const relativePath of ['manifest.json', ...resourceFiles]) {
    const sourceFile = path.join(resourceRoot, relativePath);
    const distFile = path.join(distResourceRoot, relativePath);
    if (!exists(distFile)) {
      errors.push(`dist missing file: ${relativePath}`);
      continue;
    }
    if (sha1(sourceFile) !== sha1(distFile)) errors.push(`dist hash mismatch: ${relativePath}`);
  }
  return { errors };
}

const requiredRows = collectRequiredResources();
const sourceErrors = verifySourceCoverage(requiredRows);
const manifestResult = verifyManifest();
const distResult = verifyDistCopy(manifestResult.resourceFiles || []);
const allErrors = [...sourceErrors, ...manifestResult.errors, ...distResult.errors];

const summary = {
  sourceRoot,
  resourceRoot,
  distResourceRoot,
  requiredSourceResources: requiredRows.length,
  manifestEntries: manifestResult.manifest?.entries?.length || 0,
  manifestSummary: manifestResult.manifest?.summary || null,
  errors: allErrors
};

console.log(JSON.stringify(summary, null, 2));

if (allErrors.length > 0) {
  process.exit(1);
}
