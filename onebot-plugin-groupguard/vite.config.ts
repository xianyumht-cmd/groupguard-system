import fs from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { execFileSync } from 'node:child_process';

const nodeModules = [...builtinModules, builtinModules.map((m) => `node:${m}`)].flat();
const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

function gitOutput(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, '/');
}

function manualChunks(id: string): string | undefined {
  const normalized = normalizeId(id);

  if (normalized.includes('/node_modules/')) {
    if (normalized.includes('/jimp/') || normalized.includes('/@jimp/')) return 'vendor-image';
    if (normalized.includes('/jsqr/')) return 'vendor-qr';
    if (normalized.includes('/undici/')) return 'vendor-http';
    return 'vendor';
  }

  // Internal feature layers have intentional two-way orchestration edges. Forcing
  // each folder into a separate chunk turns those edges into circular chunks.
  // Let Rollup keep/co-locate application modules and only split third-party code.
  return undefined;
}

export default defineConfig(({ mode }) => {
  const isDebug = mode === 'debug';
  const isSnowLuma = mode === 'snowluma';
  const isOneBot = mode === 'onebot';
  const entryName = isSnowLuma ? 'snowluma-service.mjs' : isOneBot ? 'onebot-service.mjs' : 'onebot-runtime.mjs';
  const subGameplayResourcesDir = resolve(__dirname, 'resources/sub-gameplay');
  const commitSha = process.env.GROUPGUARD_COMMIT_SHA || gitOutput(['rev-parse', 'HEAD']) || 'unknown';
  const dirty = gitOutput(['status', '--porcelain', '--', '.']).length > 0;
  const buildInfo = {
    service: 'groupguard',
    version: String(packageJson.version || 'unknown'),
    commit_sha: commitSha,
    build_time_utc: process.env.GROUPGUARD_BUILD_TIME_UTC || new Date().toISOString(),
    contract_version: 'groupguard-lol-api.v2',
    config_schema_version: 8,
    dirty,
    artifact: entryName
  };

  return {
    resolve: { conditions: ['node', 'default'] },
    define: {
      __GROUPGUARD_BUILD_INFO__: JSON.stringify(buildInfo)
    },
    build: {
      sourcemap: isDebug,
      target: 'esnext',
      minify: false,
      lib: {
        entry: resolve(__dirname, isSnowLuma || isOneBot ? 'src/standalone/snowluma_service.ts' : 'src/index.ts'),
        formats: ['es'],
        fileName: () => entryName,
      },
      rollupOptions: {
        external: [...nodeModules],
        output: {
          manualChunks,
          entryFileNames: entryName,
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      outDir: 'dist',
      emptyDirBeforeWrite: true,
    },
    plugins: [
      nodeResolve(),
      {
        name: 'copy-sub-gameplay-resources',
        closeBundle() {
          if (!fs.existsSync(subGameplayResourcesDir)) return;
          const target = resolve(__dirname, 'dist/resources/sub-gameplay');
          fs.rmSync(target, { recursive: true, force: true });
          fs.cpSync(subGameplayResourcesDir, target, { recursive: true });
        },
      },
      {
        name: 'write-build-info',
        closeBundle() {
          fs.writeFileSync(
            resolve(__dirname, 'dist/build-info.json'),
            `${JSON.stringify(buildInfo, null, 2)}\n`,
            'utf-8'
          );
        }
      }
    ],
  };
});
