import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type SubGameplayResourceModule = 'core' | 'master_servant' | 'light_entertainment' | 'racing';

interface SubGameplayResourceManifestEntry {
  resourceId?: string;
  path: string;
  displayName?: string;
  module: SubGameplayResourceModule | string;
  collection?: string;
  mediaType?: string;
  semanticKey?: string;
  sourcePath?: string;
  sourceRelation?: string;
  size: number;
  extension: string;
  sha1: string;
}

interface SubGameplayResourceManifest {
  generatedAt: string;
  sourceRoot: string;
  modules: SubGameplayResourceModule[];
  summary?: {
    total: number;
    byModule: Record<string, number>;
    byCollection: Record<string, number>;
    byMediaType: Record<string, number>;
  };
  entries: SubGameplayResourceManifestEntry[];
}

let cachedRoot: string | null = null;
let cachedManifest: SubGameplayResourceManifest | null | undefined;

const LIGHT_SELECTED_IMAGES: Record<string, string> = {
  dice_1: 'selected/light_entertainment/dice1_101d18bd.png',
  dice_2: 'selected/light_entertainment/dice2_101d49b6.png',
  dice_3: 'selected/light_entertainment/dice3_101d7c3e.png',
  dice_4: 'selected/light_entertainment/dice4_101dad07.png',
  dice_5: 'selected/light_entertainment/dice5_101dd7dc.png',
  dice_6: 'selected/light_entertainment/dice6_101e053a.png',
  rps_paper: 'selected/light_entertainment/rps_choice1_101c400b.png',
  rps_rock: 'selected/light_entertainment/rps_choice2_101c888b.png',
  rps_scissors: 'selected/light_entertainment/rps_choice3_101cd1d3.png',
  rps_win: 'selected/light_entertainment/rps_win_icon_101bd5a1.png',
  rps_draw: 'selected/light_entertainment/rps_draw_or_equal_101bbf9c.png',
  rps_lose: 'selected/light_entertainment/rps_lose_icon_101bedd1.png'
};

const MODULE_REPRESENTATIVE_IMAGES: Record<string, string> = {
  core: 'viewable/core/RT_ICON_1_2052.bmp',
  master_servant: 'viewable/master_servant/RT_ICON_1_2052.bmp',
  light_entertainment: 'selected/light_entertainment/rps_win_icon_101bd5a1.png',
  racing: 'viewable/racing/RT_ICON_1_2052.bmp'
};

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function resolveResourceRoot(): string {
  if (cachedRoot) return cachedRoot;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, '../resources/sub-gameplay'),
    path.resolve(currentDir, 'resources/sub-gameplay'),
    path.resolve(process.cwd(), 'dist/resources/sub-gameplay'),
    path.resolve(process.cwd(), 'resources/sub-gameplay')
  ];
  cachedRoot = candidates.find(isDirectory) || candidates[0];
  return cachedRoot;
}

export function getSubGameplayResourceManifest(): SubGameplayResourceManifest | null {
  if (cachedManifest !== undefined) return cachedManifest;
  const manifestPath = path.join(resolveResourceRoot(), 'manifest.json');
  try {
    cachedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SubGameplayResourceManifest;
  } catch {
    cachedManifest = null;
  }
  return cachedManifest;
}

export function getSubGameplayResourcePath(relativePath: string): string | null {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  const fullPath = path.join(resolveResourceRoot(), normalized);
  return fs.existsSync(fullPath) ? fullPath : null;
}

export function findSubGameplayResource(identifier: string): SubGameplayResourceManifestEntry | null {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const manifest = getSubGameplayResourceManifest();
  return (manifest?.entries || []).find(entry =>
    entry.path === value ||
    entry.resourceId === value ||
    (!!entry.semanticKey && entry.semanticKey === value)
  ) || null;
}

export function getSubGameplayResourceFile(identifier: string): string | null {
  const entry = findSubGameplayResource(identifier);
  return entry ? getSubGameplayResourcePath(entry.path) : getSubGameplayResourcePath(identifier);
}

export function getLightEntertainmentImage(key: keyof typeof LIGHT_SELECTED_IMAGES): string | null {
  return getSubGameplayResourcePath(LIGHT_SELECTED_IMAGES[key]);
}

export function getModuleRepresentativeImage(module: string): string | null {
  const relativePath = MODULE_REPRESENTATIVE_IMAGES[String(module || '')];
  return relativePath ? getSubGameplayResourcePath(relativePath) : null;
}

export function getSubGameplayResourceOverview(module = '', limit = 50, query = '', collection = '', mediaType = '', sourceRelation = ''): {
  root: string;
  manifest: SubGameplayResourceManifest | null;
  entries: SubGameplayResourceManifestEntry[];
} {
  const manifest = getSubGameplayResourceManifest();
  const normalizedModule = String(module || '').trim();
  const normalizedCollection = String(collection || '').trim();
  const normalizedMediaType = String(mediaType || '').trim();
  const normalizedSourceRelation = String(sourceRelation || '').trim();
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const entries = (manifest?.entries || [])
    .filter(entry => !normalizedModule || entry.module === normalizedModule)
    .filter(entry => !normalizedCollection || entry.collection === normalizedCollection)
    .filter(entry => !normalizedMediaType || entry.mediaType === normalizedMediaType)
    .filter(entry => !normalizedSourceRelation || entry.sourceRelation === normalizedSourceRelation)
    .filter(entry => !normalizedQuery || [
      entry.resourceId,
      entry.path,
      entry.displayName,
      entry.semanticKey,
      entry.sourcePath,
      entry.sourceRelation,
      entry.mediaType,
      entry.collection
    ].some(value => String(value || '').toLowerCase().includes(normalizedQuery)))
    .slice(0, safeLimit);
  return {
    root: resolveResourceRoot(),
    manifest,
    entries
  };
}

function walkFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkFiles(fullPath);
      if (entry.isFile()) return [fullPath];
      return [];
    });
  } catch {
    return [];
  }
}

export function verifySubGameplayResourceIntegrity(): {
  ok: boolean;
  root: string;
  manifestEntries: number;
  resourceFiles: number;
  sourcePathCoverage: number;
  sourceRelations: Record<string, number>;
  errors: string[];
} {
  const root = resolveResourceRoot();
  const manifest = getSubGameplayResourceManifest();
  const errors: string[] = [];
  if (!manifest) {
    errors.push('manifest_missing_or_invalid');
    return { ok: false, root, manifestEntries: 0, resourceFiles: 0, sourcePathCoverage: 0, sourceRelations: {}, errors };
  }

  const entries = manifest.entries || [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const sourceRelations: Record<string, number> = {};
  let sourcePathCoverage = 0;
  for (const entry of entries) {
    if (!entry.resourceId) errors.push(`missing_resource_id:${entry.path}`);
    if (entry.resourceId && ids.has(entry.resourceId)) errors.push(`duplicate_resource_id:${entry.resourceId}`);
    if (entry.resourceId) ids.add(entry.resourceId);
    if (paths.has(entry.path)) errors.push(`duplicate_path:${entry.path}`);
    paths.add(entry.path);
    if (entry.sourcePath) sourcePathCoverage += 1;
    const relation = entry.sourceRelation || 'unknown';
    sourceRelations[relation] = (sourceRelations[relation] || 0) + 1;
    if (!getSubGameplayResourcePath(entry.path)) errors.push(`missing_file:${entry.path}`);
  }

  const resourceFiles = walkFiles(root)
    .map(filePath => path.relative(root, filePath).replace(/\\/g, '/'))
    .filter(relativePath => relativePath !== 'manifest.json');
  for (const relativePath of resourceFiles) {
    if (!paths.has(relativePath)) errors.push(`unindexed_file:${relativePath}`);
  }
  if (resourceFiles.length !== entries.length) {
    errors.push(`count_mismatch:manifest=${entries.length},files=${resourceFiles.length}`);
  }

  return {
    ok: errors.length === 0,
    root,
    manifestEntries: entries.length,
    resourceFiles: resourceFiles.length,
    sourcePathCoverage,
    sourceRelations,
    errors
  };
}

export function toLocalFileUrl(filePath: string): string {
  return `file:///${path.resolve(filePath).replace(/\\/g, '/')}`;
}

export function toOneBotImageSource(filePath: string): string | null {
  try {
    return `base64://${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}
