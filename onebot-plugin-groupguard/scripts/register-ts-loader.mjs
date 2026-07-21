import { register } from 'node:module';

register('./internal/ts-extension-loader.mjs', import.meta.url);
