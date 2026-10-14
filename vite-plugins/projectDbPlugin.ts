import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';
import { legacyFolders, migrateLayout } from './projectLayout';
import { closeAllDatabases, listP6Projects, p6Database, projectDb, openProjectFiles } from './db/projectDb';

/** Dev-server API for the project database (vite-plugins/db/projectDb.ts):
    <project folder>/insight-plan.db. Every call names the project folder
    (`root`); the file is created on first use. Only runs under `npm run dev`. */

function numberParam(raw: unknown, what: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${what}.`);
  return n;
}

const optional = (v: string | null) => (v && v.trim() ? v.trim() : null);

export function projectDbPlugin(): Plugin {
  return {
    name: 'insight-plan-project-db',
    configureServer(server) {
      server.httpServer?.on('close', closeAllDatabases);
      server.middlewares.use('/api/db', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const q = url.searchParams;
          const route = url.pathname.replace(/^\/+/, '');
          const get = req.method === 'GET';

          if (req.method === 'POST' && route === 'open') {
            const db = projectDb((await readBody(req)).root);
            return send(res, 200, { root: db.root, file: db.file, changes: db.changes() });
          }
          // ---- folder layout ----
          if (get && route === 'layout') return send(res, 200, { legacy: legacyFolders(projectDb(q.get('root')).root) });
          if (req.method === 'POST' && route === 'layout/migrate') return send(res, 200, migrateLayout(projectDb((await readBody(req)).root).root));

          if (get && route === 'opened') return send(res, 200, { files: openProjectFiles() });
          if (get && route === 'changes') return send(res, 200, { changes: projectDb(q.get('root')).changes() });

          // ---- programmes ----
          if (get && route === 'programmes') return send(res, 200, { programmes: projectDb(q.get('root')).programmes() });
          if (get && route === 'programmes/tables') return send(res, 200, projectDb(q.get('root')).programmeTables(numberParam(q.get('id'), 'programme id')));
          if (req.method === 'POST' && route === 'programmes/import') {
            // Body: the XER file itself (an XML programme is converted to XER
            // by the app first). Spooled to a temp file, then imported in one
            // transaction.
            const db = projectDb(q.get('root'));
            const kind = q.get('kind') === 'scenario' ? 'scenario' : 'import';
            const name = optional(q.get('name'));
            if (!name) throw new HttpError(400, 'No programme name given.');
            const tmp = path.join(os.tmpdir(), `insight-plan-import-${process.pid}-${Date.now()}.xer`);
            try {
              await pipeline(req, fs.createWriteStream(tmp));
              const projects = optional(q.get('projects'));
              const programme = db.importXer(tmp, {
                name,
                sourceFile: optional(q.get('file')) ?? name,
                sourceFormat: q.get('format') === 'xml' ? 'xml' : 'xer',
                kind,
                scenario: kind === 'scenario' ? optional(q.get('scenario')) : null,
                stem: kind === 'scenario' ? optional(q.get('stem')) : null,
                projectIds: projects ? projects.split(',') : null,
              });
              return send(res, 200, { programme });
            } finally {
              fs.rmSync(tmp, { force: true });
            }
          }
          if (req.method === 'POST' && route === 'programmes/hidden') {
            const body = await readBody(req);
            projectDb(body.root).setHidden(body.hidden ?? {});
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && route === 'programmes/rename') {
            const body = await readBody(req);
            const name = String(body.name ?? '').trim();
            if (!name) throw new HttpError(400, 'No name given.');
            projectDb(body.root).renameProgramme(numberParam(body.id, 'programme id'), name);
            return send(res, 200, { ok: true });
          }
          if (get && route === 'programmes/export') return send(res, 200, projectDb(q.get('root')).exportProgramme(numberParam(q.get('id'), 'programme id')));
          if (req.method === 'POST' && route === 'programmes/copy') {
            const body = await readBody(req);
            const name = String(body.name ?? '').trim();
            if (!name) throw new HttpError(400, 'No name given.');
            return send(res, 200, { programme: projectDb(body.root).copyProgramme(numberParam(body.id, 'programme id'), name) });
          }
          if (req.method === 'POST' && route === 'programmes/baseline') {
            const body = await readBody(req);
            const name = String(body.name ?? '').trim();
            if (!name) throw new HttpError(400, 'No name given.');
            return send(res, 200, { programme: projectDb(body.root).saveBaseline(numberParam(body.id, 'programme id'), name) });
          }
          if (req.method === 'POST' && route === 'programmes/blank') {
            const body = await readBody(req);
            const name = String(body.name ?? '').trim();
            if (!name) throw new HttpError(400, 'No name given.');
            return send(res, 200, { programme: projectDb(body.root).blankProgramme(name, String(body.start ?? '')) });
          }
          if (req.method === 'POST' && route === 'programmes/ops') {
            const body = await readBody(req);
            if (!Array.isArray(body.ops)) throw new HttpError(400, 'No changes given.');
            return send(res, 200, projectDb(body.root).applyOps(numberParam(body.id, 'programme id'), body.ops));
          }
          if (req.method === 'POST' && route === 'programmes/delete') {
            const body = await readBody(req);
            projectDb(body.root).deleteProgramme(numberParam(body.id, 'programme id'));
            return send(res, 200, { ok: true });
          }

          // ---- P6 Professional databases (read-only) ----
          if (get && route === 'p6/projects') {
            const { file, db } = p6Database(q.get('path'));
            return send(res, 200, { file, projects: listP6Projects(db) });
          }
          if (req.method === 'POST' && route === 'p6/link') {
            const body = await readBody(req);
            const { file, db } = p6Database(body.path);
            const ids = Array.isArray(body.projectIds) ? body.projectIds.map(String) : [];
            const name = String(body.name ?? '').trim() || path.basename(file);
            return send(res, 200, { programme: projectDb(body.root).linkP6(file, db, ids, name) });
          }

          // ---- link groups, trade capacities, settings ----
          if (get && route === 'link-groups') return send(res, 200, { groups: projectDb(q.get('root')).linkGroups() });
          if (req.method === 'POST' && route === 'link-groups') {
            const body = await readBody(req);
            if (!Array.isArray(body.groups)) throw new HttpError(400, 'No link groups given.');
            projectDb(body.root).writeLinkGroups(body.groups);
            return send(res, 200, { ok: true });
          }
          if (get && route === 'capacities') return send(res, 200, { capacities: projectDb(q.get('root')).capacities() });
          if (req.method === 'POST' && route === 'capacities') {
            const body = await readBody(req);
            projectDb(body.root).writeCapacities(body.capacities ?? {});
            return send(res, 200, { ok: true });
          }
          if (get && route === 'settings') return send(res, 200, { settings: projectDb(q.get('root')).settings() });
          if (req.method === 'POST' && route === 'settings') {
            const body = await readBody(req);
            const key = String(body.key ?? '').trim();
            if (!key) throw new HttpError(400, 'No setting key given.');
            projectDb(body.root).writeSetting(key, body.value);
            return send(res, 200, { ok: true });
          }
          // ---- Settings > Import / Export: "Export all" writes the export files into the project folder ----
          if (req.method === 'POST' && route === 'export-files') {
            const body = await readBody(req);
            const dir = String(body.dir ?? '');
            if (!/^[a-z]*$/.test(dir)) throw new HttpError(400, `Not a folder name: ${dir}`);
            const folder = path.join(projectDb(body.root).root, dir);
            fs.mkdirSync(folder, { recursive: true });
            const files = Array.isArray(body.files) ? body.files : [];
            const written: string[] = [];
            for (const f of files) {
              const name = String(f?.name ?? '');
              if (!/^insight-plan-[a-z]+\.json$/.test(name) || typeof f.content !== 'string') throw new HttpError(400, `Not an export file: ${name}`);
              fs.writeFileSync(path.join(folder, name), f.content, 'utf8');
              written.push(name);
            }
            return send(res, 200, { folder, written });
          }
          // ---- clashes & contacts ----
          if (req.method === 'POST' && route === 'clashes/get') {
            const body = await readBody(req);
            const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
            return send(res, 200, { runs: projectDb(body.root).clashRuns(keys) });
          }
          if (req.method === 'POST' && route === 'clashes/write') {
            const body = await readBody(req);
            const key = String(body.key ?? '');
            const scope = String(body.scope ?? '');
            if (!key || !scope || !Array.isArray(body.pairs)) throw new HttpError(400, 'A clash run needs a key, a scope and its pairs.');
            projectDb(body.root).writeClashRun(key, scope, body.pairs);
            return send(res, 200, { ok: true });
          }
          throw new HttpError(404, `Unknown database endpoint: ${req.method} ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
