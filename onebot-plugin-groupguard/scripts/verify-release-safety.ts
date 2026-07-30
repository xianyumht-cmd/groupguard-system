import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const server = read('src/standalone/admin/server.ts');
assert.doesNotMatch(server, /logger\.(?:info|warn|error)\([^)]*\?token=/);
assert.doesNotMatch(server, /logger\.(?:info|warn|error)\([^)]*\$\{token\}/);
assert.match(server, /ephemeral token that is intentionally not logged/);

const deploy = read('scripts/ops/Deploy-SnowLuma.ps1');
for (const marker of [
  'archive_sha256=',
  'sha256sum -c',
  "jq -er '.commit_sha'",
  'docker inspect --type container',
  '/api/build-info',
  '/api/health',
  'health.ready !== true',
  'dist.previous',
  'restoring dist.previous',
  'GROUPGUARD_WEBUI_TOKEN',
  'PrepareOnly',
  'Remove-Item -LiteralPath $DistPath -Recurse -Force'
]) {
  assert.ok(deploy.includes(marker), `deploy safety marker missing: ${marker}`);
}
assert.doesNotMatch(deploy, /docker ps --filter/);
assert.doesNotMatch(deploy, /scp\s+-r/);
assert.match(deploy, /-SkipBuild is disabled for production deployment/);

const backup = read('scripts/ops/Backup-SnowLuma.ps1');
for (const marker of [
  'test -f config/config.json',
  'test -d config',
  'test -d data',
  'test -d dist',
  'set -- config data dist',
  'if [ -f package.json ]',
  'umask 077',
  'tar -tzf',
  'chmod 600',
  'sha256sum'
]) {
  assert.ok(backup.includes(marker), `backup safety marker missing: ${marker}`);
}
assert.doesNotMatch(backup, /\|\|\s*tar/);

const rollback = read('scripts/ops/Rollback-SnowLuma.ps1');
for (const marker of [
  "jq -er '.commit_sha'",
  'artifact_sha256',
  'docker inspect --type container',
  '/api/build-info',
  '/api/health',
  'rollback verification failed',
  'ExpectedCommit'
]) {
  assert.ok(rollback.includes(marker), `rollback safety marker missing: ${marker}`);
}
assert.doesNotMatch(rollback, /rm -rf dist\.failed-rollback/);

console.log('release safety verification passed');
