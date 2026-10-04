import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';
import { closeModelDatabases, modelsDb } from './db/modelsDb';

/** Dev-server API for the project's model store (vite-plugins/db/modelsDb.ts).
    Every call names the project folder (`root`). Only runs under `npm run dev`.

    GET  /api/models/list?root=&fragVersion=            the models
    POST /api/models/ifc?root=&name=&note=              body: the IFC -> {hash, changed}
    GET  /api/models/ifc?root=&name=[&version=]         the IFC
    POST /api/models/frag?root=&name=&hash=&fragVersion= body: the .frag (header x-layers: JSON)
    GET  /api/models/frag?root=&name=&fragVersion=      the .frag (404 when none fits); x-layers header
    GET  /api/models/versions?root=&name=               earlier IFCs
    POST /api/models/restore                            {root, name, id}
    POST /api/models/delete                             {root, name} */

const LIMIT = 2 * 1024 * 1024 * 1024;

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > LIMIT) throw new HttpError(413, 'Models up to 2 GB.');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

const nameParam = (raw: string | null) => {
  const name = String(raw ?? '').trim();
  if (!name || /[\\/]/.test(name)) throw new HttpError(400, 'No (or an invalid) model name given.');
  return name;
};

export function modelsPlugin(): Plugin {
  return {
    name: 'insight-plan-models',
    configureServer(server) {
      server.httpServer?.on('close', closeModelDatabases);
      server.middlewares.use('/api/models', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const q = url.searchParams;
          const route = url.pathname.replace(/^\/+/, '');
          const get = req.method === 'GET';
          const fragVersion = q.get('fragVersion') ?? '';

          if (get && route === 'list') return send(res, 200, { models: modelsDb(q.get('root')).list(fragVersion) });
          if (get && route === 'versions') return send(res, 200, { versions: modelsDb(q.get('root')).versions(nameParam(q.get('name'))) });
          if (get && route === 'ifc') {
            const bytes = modelsDb(q.get('root')).getIfc(nameParam(q.get('name')), q.get('version') ? Number(q.get('version')) : undefined);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            return void res.end(bytes);
          }
          if (get && route === 'frag') {
            const found = modelsDb(q.get('root')).getFrag(nameParam(q.get('name')), fragVersion);
            if (!found) return send(res, 404, { error: 'No converted copy of this model.' });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            if (found.layers) res.setHeader('x-layers', encodeURIComponent(found.layers));
            res.setHeader('Access-Control-Expose-Headers', 'x-layers');
            return void res.end(found.frag);
          }
          if (req.method === 'POST' && route === 'ifc') {
            const out = modelsDb(q.get('root')).saveIfc(nameParam(q.get('name')), await readRaw(req), q.get('note'));
            return send(res, 200, out);
          }
          if (req.method === 'POST' && route === 'frag') {
            const layers = req.headers['x-layers'] ? decodeURIComponent(String(req.headers['x-layers'])) : null;
            const stored = modelsDb(q.get('root')).saveFrag(nameParam(q.get('name')), String(q.get('hash') ?? ''), fragVersion, await readRaw(req), layers);
            return send(res, 200, { stored });
          }
          if (req.method === 'POST' && route === 'restore') {
            const body = await readBody(req);
            modelsDb(body.root).restore(nameParam(body.name), Number(body.id));
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && route === 'delete') {
            const body = await readBody(req);
            modelsDb(body.root).remove(nameParam(body.name));
            return send(res, 200, { ok: true });
          }
          throw new HttpError(404, `Unknown model-store endpoint: ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
