import fs from 'node:fs';
import path from 'node:path';

const launcherPath = process.argv[2];
if (!launcherPath) {
  throw new Error('usage: node fix-immutable-d0b79b6e-v2.mjs <launcher.ps1>');
}

let bytes = fs.readFileSync(launcherPath);

const replacements = [
  {
    from: Buffer.from("$BuildInfoPath = Join-Path $ExtractPath 'dist\b" + "uild-info.json'", 'utf8'),
    to: Buffer.from("$BuildInfoPath = Join-Path (Join-Path $ExtractPath 'dist') 'build-info.json'", 'utf8'),
    label: 'build-info path',
  },
  {
    from: Buffer.from("$EntryPath = Join-Path $ExtractPath 'distsnowluma-service.mjs'", 'utf8'),
    to: Buffer.from("$EntryPath = Join-Path (Join-Path $ExtractPath 'dist') 'snowluma-service.mjs'", 'utf8'),
    label: 'SnowLuma entry path',
  },
];

for (const { from, to, label } of replacements) {
  const first = bytes.indexOf(from);
  if (first < 0) throw new Error(`generated launcher ${label} defect was not found`);
  if (bytes.indexOf(from, first + from.length) >= 0) throw new Error(`generated launcher ${label} defect occurred more than once`);
  bytes = Buffer.concat([bytes.subarray(0, first), to, bytes.subarray(first + from.length)]);
}

for (let index = 0; index < bytes.length; index += 1) {
  const value = bytes[index];
  if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) {
    throw new Error(`generated launcher contains illegal control byte 0x${value.toString(16).padStart(2, '0')} at offset ${index}`);
  }
}

const text = bytes.toString('utf8');
for (const required of [
  "$BuildInfoPath = Join-Path (Join-Path $ExtractPath 'dist') 'build-info.json'",
  "$EntryPath = Join-Path (Join-Path $ExtractPath 'dist') 'snowluma-service.mjs'",
]) {
  if (!text.includes(required)) throw new Error(`corrected launcher line is missing: ${required}`);
}

fs.writeFileSync(launcherPath, bytes);

const outputDir = path.dirname(launcherPath);
const manifestPath = path.join(outputDir, 'PACKAGE-MANIFEST.txt');
const readmePath = path.join(outputDir, 'README.txt');

let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest.replace(
  'package_name=groupguard-production-safe-deployment-d0b79b6e',
  'package_name=groupguard-production-safe-deployment-d0b79b6e-v2',
);
if (!manifest.includes('package_revision=2')) {
  manifest += 'package_revision=2\nlocal_path_fix=dist-child-join\n';
}
fs.writeFileSync(manifestPath, manifest, 'utf8');

let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme.replace(
  'GroupGuard production safe deployment package\n',
  'GroupGuard production safe deployment package v2\n',
);
if (!readme.includes('Package fix   : v2')) {
  readme = readme.replace(
    'Target commit :',
    'Package fix   : v2 - corrected Windows local candidate paths\nTarget commit :',
  );
}
fs.writeFileSync(readmePath, readme, 'utf8');

console.log(`corrected generated launcher and package metadata: ${outputDir}`);
console.log('v2 validation trigger: 2026-08-01');
