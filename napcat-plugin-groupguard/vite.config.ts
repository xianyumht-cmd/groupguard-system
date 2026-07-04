import fs from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';

const nodeModules = [...builtinModules, builtinModules.map((m) => `node:${m}`)].flat();

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

  if (!normalized.includes('/src/')) return undefined;

  if (normalized.includes('/src/commands/')) return 'commands';
  if (normalized.includes('/src/runtime/')) return 'runtime';
  if (normalized.includes('/src/standalone/')) return 'standalone';
  if (normalized.includes('/src/repositories/')) return 'repositories';
  if (normalized.includes('/src/risk/')) return 'risk';
  if (normalized.includes('/src/services/')) return 'services';
  if (normalized.includes('/src/core/')) return 'core';
  if (normalized.includes('/src/verify')) return 'verify';
  if (normalized.includes('/src/config') || normalized.includes('/src/state') || normalized.includes('/src/types')) return 'state';

  return 'features';
}

export default defineConfig(({ mode }) => {
  const isDebug = mode === 'debug';
  const isSnowLuma = mode === 'snowluma';
  const entryName = isSnowLuma ? 'snowluma-service.mjs' : 'index.mjs';
  const subGameplayResourcesDir = resolve(__dirname, 'resources/sub-gameplay');

  return {
    resolve: { conditions: ['node', 'default'] },
    build: {
      sourcemap: isDebug,
      target: 'esnext',
      minify: false,
      lib: {
        entry: resolve(__dirname, isSnowLuma ? 'src/standalone/snowluma_service.ts' : 'src/index.ts'),
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
      emptyDirBeforeWrite: !isSnowLuma,
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
    ],
  };
});
