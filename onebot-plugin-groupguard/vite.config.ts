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

  // Internal feature layers have intentional two-way orchestration edges. Forcing
  // each folder into a separate chunk turns those edges into circular chunks.
  // Let Rollup keep/co-locate application modules and only split third-party code.
  return undefined;
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
