import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath_missing');

run([npmCli, 'run', 'build:onebot']);
const onebot = path.join(root, '.dist-onebot-temp');
fs.rmSync(onebot, { recursive: true, force: true });
fs.renameSync(path.join(root, 'dist'), onebot);
run([npmCli, 'run', 'build:snowluma']);
fs.cpSync(onebot, path.join(root, 'dist'), { recursive: true, force: false, errorOnExist: false });
fs.rmSync(onebot, { recursive: true, force: true });
