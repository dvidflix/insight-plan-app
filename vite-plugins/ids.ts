import { editedDir } from './projectLayout';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';

/** Dev-server API for Model checks: the IDS library in the repo
    (docs/ids/*.ids, docs/ids/patches/<id>.json, read by the app with
    import.meta.glob — this only writes) and fixed models written into the
    project folder.
    POST /api/ids/ids?name=            body: the .ids XML → {name}
    POST /api/ids/patch                {patch} → {file}
    POST /api/ids/model?root=&name=    body: the IFC → {path}
    POST /api/ids/log?root=&name=      {…} → {path}: what a patch changed */

export const IDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/ids');

const safeBase = (raw: string) =>
  path
    .basename(raw)
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 150);

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, `Files up to ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function projectFolder(raw: string | null): string {
  const root = path.resolve(String(raw ?? '').trim());
  if (!String(raw ?? '').trim()) throw new HttpError(400, 'No project folder given.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new HttpError(400, `There is no folder "${root}".`);
  const dir = editedDir(root);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function idsPlugin(): Plugin {
  return {
    name: 'insight-plan-ids',
    configureServer(server) {
      server.middlewares.use('/api/ids', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const route = url.pathname.replace(/^\/+/, '');
          if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
          if (route === 'ids') {
            const name = safeBase(url.searchParams.get('name') ?? '').replace(/\.(ids|xml)$/i, '');
            if (!name) throw new HttpError(400, 'No file name given.');
            const xml = (await readRaw(req, 20 * 1024 * 1024)).toString('utf8');
            if (!/<ids[\s>]/.test(xml) || !/<specification[\s>]/.test(xml)) throw new HttpError(400, 'Not an IDS file (no <ids> with specifications).');
            fs.mkdirSync(IDS_DIR, { recursive: true });
            fs.writeFileSync(path.join(IDS_DIR, `${name}.ids`), xml.replace(/\r\n/g, '\n'), 'utf8');
            return send(res, 200, { name: `${name}.ids` });
          }
          if (route === 'patch') {
            const { patch } = await readBody(req);
            const id = String(patch?.id ?? '');
            if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new HttpError(400, `Invalid patch id "${id}": lower-case letters, digits and dashes.`);
            if (!patch.operation?.type || !Array.isArray(patch.fixes)) throw new HttpError(400, 'A patch needs an operation and the checks it fixes.');
            const dir = path.join(IDS_DIR, 'patches');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
            return send(res, 200, { file: `patches/${id}.json` });
          }
          if (route === 'model') {
            const name = safeBase(url.searchParams.get('name') ?? '');
            if (!/\.ifc$/i.test(name)) throw new HttpError(400, 'An .ifc file name is needed.');
            const file = path.join(projectFolder(url.searchParams.get('root')), name);
            const bytes = await readRaw(req, 2 * 1024 * 1024 * 1024);
            // Writing over an earlier fixed copy: keep it, timestamped, when asked.
            let backup: string | undefined;
            if (url.searchParams.get('backup') === '1' && fs.existsSync(file)) {
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              backup = file.replace(/\.ifc$/i, `.${stamp}.bak.ifc`);
              fs.renameSync(file, backup);
            }
            fs.writeFileSync(file, bytes);
            return send(res, 200, { path: file, backup });
          }
          if (route === 'log') {
            const name = safeBase(url.searchParams.get('name') ?? '');
            if (!/\.json$/i.test(name)) throw new HttpError(400, 'A .json file name is needed.');
            const file = path.join(projectFolder(url.searchParams.get('root')), name);
            fs.writeFileSync(file, `${JSON.stringify(await readBody(req), null, 2)}\n`, 'utf8');
            return send(res, 200, { path: file });
          }
          throw new HttpError(404, `Unknown IDS endpoint: ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
