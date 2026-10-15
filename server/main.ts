import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wikiPlugin } from '../vite-plugins/wiki';
import { idsPlugin } from '../vite-plugins/ids';
import { ifcToolsPlugin } from '../vite-plugins/ifcTools';
import { projectDbPlugin } from '../vite-plugins/projectDbPlugin';
import { modelsPlugin } from '../vite-plugins/modelsPlugin';
import { scenariosPlugin } from '../vite-plugins/scenarios';
import { registerPackageUpdater } from './packageUpdater';

/** The production server of the product edition: serves the built app (dist/) and the same /api endpoints the Vite dev
    server provides (project database, models, Scenarios, IDS, Wiki) — no Vite, no internet. It is bundled to
    server-dist/server.mjs (npm run build:server) and started by "Start Insight Plan.cmd".

    It listens on this computer only (127.0.0.1): the endpoints read and write files, so they must never be reachable from
    the network, and requests that come from another web page (a different Origin) are refused. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>;
const stack: { prefix: string; handler: Handler }[] = [];
// The small part of Vite's (connect's) middleware interface the endpoints use.
const middlewares = {
  use(prefix: string | Handler, handler?: Handler) {
    stack.push(typeof prefix === 'string' ? { prefix, handler: handler! } : { prefix: '', handler: prefix });
  },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  let file = path.join(DIST, rel);
  // Never leave dist/ (a "../" in the path).
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // A file that does not exist is a 404; anything else is the app (its own routes).
    if (path.extname(rel)) { res.statusCode = 404; return res.end('Not found'); }
    rel = '/index.html';
    file = path.join(DIST, rel);
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  // Built assets carry a hash in their name; everything else is checked again each time.
  res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs and non-browser clients carry none
  try {
    const o = new URL(origin);
    return (o.hostname === '127.0.0.1' || o.hostname === 'localhost') && o.port === String(PORT);
  } catch {
    return false;
  }
}

const closers: (() => void)[] = [];
const httpServer = { on: (event: string, fn: () => void) => { if (event === 'close') closers.push(fn); } };

for (const plugin of [wikiPlugin(), idsPlugin(), ifcToolsPlugin(), projectDbPlugin(), modelsPlugin(), scenariosPlugin()]) {
  (plugin.configureServer as unknown as (s: unknown) => void)({ middlewares, httpServer });
}

// Updates of the packaged app: download in the background, install on the next start (or now, via the launcher: exit code 75).
registerPackageUpdater(middlewares, (code) => shutdown(code));

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if ((host !== '127.0.0.1' && host !== 'localhost') || !sameOrigin(req)) { res.statusCode = 403; return res.end('Forbidden'); }
  const url = req.url ?? '/';
  let i = 0;
  const next = (): void => {
    while (i < stack.length) {
      const { prefix, handler } = stack[i++];
      if (prefix && url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) continue;
      const original = req.url;
      if (prefix) req.url = url.slice(prefix.length) || '/';
      Promise.resolve(handler(req, res, () => { req.url = original; next(); })).catch((e) => {
        if (!res.headersSent) res.statusCode = 500;
        res.end(String(e instanceof Error ? e.message : e));
      });
      return;
    }
    if (url.startsWith('/api/')) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"Not available in this edition."}'); return; }
    serveStatic(req, res);
  };
  next();
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use: is Insight Plan already running?` : String(e));
  process.exit(1);
});
server.listen(PORT, HOST, () => console.log(`Insight Plan is running at http://localhost:${PORT}  (this computer only; close this window to stop it)`));

const shutdown = (code = 0) => { for (const close of closers) try { close(); } catch { /* closing anyway */ } server.close(); process.exit(code); };
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
