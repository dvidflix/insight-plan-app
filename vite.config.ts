import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { scenariosPlugin } from './vite-plugins/scenarios';
import { projectDbPlugin } from './vite-plugins/projectDbPlugin';
import { modelsPlugin } from './vite-plugins/modelsPlugin';
import { appUpdatePlugin } from './vite-plugins/appUpdate';
import { wikiPlugin } from './vite-plugins/wiki';
import { idsPlugin } from './vite-plugins/ids';
import { seatablePlugin } from './vite-plugins/seatablePlugin';
import { externalPlugin } from './vite-plugins/externalPlugin';

export default defineConfig({
  plugins: [
    react(),
    appUpdatePlugin(),
    wikiPlugin(),
    idsPlugin(),
    seatablePlugin(),
    externalPlugin(),
    projectDbPlugin(),
    modelsPlugin(),
    scenariosPlugin(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/web-ifc/web-ifc.wasm', dest: 'wasm' },
        { src: 'node_modules/web-ifc/web-ifc-mt.wasm', dest: 'wasm' },
        { src: 'node_modules/@thatopen/fragments/dist/Worker/worker.mjs', dest: 'wasm' },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ['web-ifc'],
  },
});
