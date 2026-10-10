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

// The product edition (--mode product) never contacts GitHub, SeaTable or Superset: their server parts are not loaded.
export default defineConfig(({ mode }) => {
  const internal = mode !== 'product' && mode !== 'web';
  return {
  plugins: [
    react(),
    ...(internal ? [appUpdatePlugin()] : []),
    wikiPlugin(),
    idsPlugin(),
    ...(internal ? [seatablePlugin(), externalPlugin()] : []),
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
    exclude: ['web-ifc', '@sqlite.org/sqlite-wasm'],
  },
  worker: { format: 'es' as const },
  // The viewer's worker threads need a cross-origin isolated page; a host serving the web edition must send the same two headers.
  server: mode === 'web' ? { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } } : undefined,
  };
});
