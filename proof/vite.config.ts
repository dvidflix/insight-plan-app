import { defineConfig } from 'vite';
import path from 'node:path';

// A throw-away test page for the browser-database proof: not part of the app or its builds.
export default defineConfig({
  root: path.resolve(__dirname),
  server: { port: 5190, fs: { allow: [path.resolve(__dirname, '..')] } },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
});
