import { HttpError, type ImportMeta } from '../db/core';
import type { BrowserProjectDb } from './browserDb';

/** The browser edition's answer to the app's /api/db calls: the same routes as vite-plugins/projectDbPlugin.ts, on the
    project database in this browser (see worker.ts). Same request shapes, same JSON replies, so the screens do not change.
    Not available here: P6 Professional database links and the old folder layouts (they need files by path). */

export interface DbHost {
  /** The project folder's database (opened on first use). */
  database(root: unknown): Promise<BrowserProjectDb>;
  /** Writes plain files into the project folder (the export files of Settings > Import / Export). */
  writeFiles(root: unknown, files: { name: string; content: string }[], dir?: string): Promise<string[]>;
  /** How the file is doing: saved, waiting to be saved, or failing. */
  saveStatus(root: unknown): { dirty: boolean; savedAt: number | null; error: string | null };
}

export interface ApiReply {
  status: number;
  /** The JSON text of the reply. */
  body: string;
}

const ok = (value: unknown): ApiReply => ({ status: 200, body: JSON.stringify(value) });

function numberParam(raw: unknown, what: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${what}.`);
  return n;
}
const optional = (v: string | null) => (v && v.trim() ? v.trim() : null);

function json(body: ArrayBuffer | string | null): any {
  if (body === null || body === '') return {};
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return text ? JSON.parse(text) : {};
}

/** `route` is the path after /api/db/ (e.g. "programmes/tables"); `query` its search parameters. */
export async function handleDbRequest(host: DbHost, method: string, route: string, query: URLSearchParams, body: ArrayBuffer | string | null): Promise<ApiReply> {
  try {
    const get = method === 'GET';
    const post = method === 'POST';
    const root = query.get('root');

    if (post && route === 'open') {
      const db = await host.database(json(body).root);
      return ok({ root: db.root, file: db.file, changes: db.changes() });
    }
    // ---- folder layout: nothing to migrate in a browser project ----
    if (get && route === 'layout') return ok({ legacy: [] });
    if (post && route === 'layout/migrate') throw new HttpError(400, 'Old folder layouts are not handled in the browser edition.');
    if (get && route === 'opened') return ok({ files: [] });
    if (get && route === 'changes') return ok({ changes: (await host.database(root)).changes() });
    if (get && route === 'save-status') return ok(host.saveStatus(root));
    if (post && route === 'export-files') {
      const b = json(body);
      const files = (Array.isArray(b.files) ? b.files : []) as { name: string; content: string }[];
      for (const f of files) if (!/^insight-plan-[a-z]+\.json$/.test(String(f?.name)) || typeof f.content !== 'string') throw new HttpError(400, `Not an export file: ${f?.name}`);
      const dir = String(b.dir ?? '');
      if (!/^[a-z]*$/.test(dir)) throw new HttpError(400, `Not a folder name: ${dir}`);
      const written = await host.writeFiles(b.root, files, dir);
      return ok({ folder: dir ? `${String(b.root ?? '')}/${dir}` : String(b.root ?? ''), written });
    }

    // ---- programmes ----
    if (get && route === 'programmes') return ok({ programmes: (await host.database(root)).programmes() });
    if (get && route === 'programmes/tables') return ok((await host.database(root)).programmeTables(numberParam(query.get('id'), 'programme id')));
    if (post && route === 'programmes/import') {
      if (!(body instanceof ArrayBuffer)) throw new HttpError(400, 'No programme file sent.');
      const db = await host.database(root);
      const kind = query.get('kind') === 'scenario' ? 'scenario' : 'import';
      const name = optional(query.get('name'));
      if (!name) throw new HttpError(400, 'No programme name given.');
      const projects = optional(query.get('projects'));
      const meta: ImportMeta = {
        name,
        sourceFile: optional(query.get('file')) ?? name,
        sourceFormat: query.get('format') === 'xml' ? 'xml' : 'xer',
        kind,
        scenario: kind === 'scenario' ? optional(query.get('scenario')) : null,
        stem: kind === 'scenario' ? optional(query.get('stem')) : null,
        projectIds: projects ? projects.split(',') : null,
      };
      return ok({ programme: db.importXerBytes(body, meta) });
    }
    if (post && route === 'programmes/hidden') {
      const b = json(body);
      (await host.database(b.root)).setHidden(b.hidden ?? {});
      return ok({ ok: true });
    }
    if (post && route === 'programmes/rename') {
      const b = json(body);
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, 'No name given.');
      (await host.database(b.root)).renameProgramme(numberParam(b.id, 'programme id'), name);
      return ok({ ok: true });
    }
    if (get && route === 'programmes/export') return ok((await host.database(root)).exportProgramme(numberParam(query.get('id'), 'programme id')));
    if (post && route === 'programmes/copy') {
      const b = json(body);
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, 'No name given.');
      return ok({ programme: (await host.database(b.root)).copyProgramme(numberParam(b.id, 'programme id'), name) });
    }
    if (post && route === 'programmes/baseline') {
      const b = json(body);
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, 'No name given.');
      return ok({ programme: (await host.database(b.root)).saveBaseline(numberParam(b.id, 'programme id'), name) });
    }
    if (post && route === 'programmes/blank') {
      const b = json(body);
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, 'No name given.');
      return ok({ programme: (await host.database(b.root)).blankProgramme(name, String(b.start ?? '')) });
    }
    if (post && route === 'programmes/ops') {
      const b = json(body);
      if (!Array.isArray(b.ops)) throw new HttpError(400, 'No changes given.');
      return ok((await host.database(b.root)).applyOps(numberParam(b.id, 'programme id'), b.ops));
    }
    if (post && route === 'programmes/delete') {
      const b = json(body);
      (await host.database(b.root)).deleteProgramme(numberParam(b.id, 'programme id'));
      return ok({ ok: true });
    }

    // ---- P6 Professional databases need a file path: not available here ----
    if (route.startsWith('p6/')) throw new HttpError(400, 'P6 Professional databases cannot be read in the browser edition. Export the programme as an XER file and load that.');

    // ---- link groups, trade capacities, settings ----
    if (get && route === 'link-groups') return ok({ groups: (await host.database(root)).linkGroups() });
    if (post && route === 'link-groups') {
      const b = json(body);
      if (!Array.isArray(b.groups)) throw new HttpError(400, 'No link groups given.');
      (await host.database(b.root)).writeLinkGroups(b.groups);
      return ok({ ok: true });
    }
    if (get && route === 'capacities') return ok({ capacities: (await host.database(root)).capacities() });
    if (post && route === 'capacities') {
      const b = json(body);
      (await host.database(b.root)).writeCapacities(b.capacities ?? {});
      return ok({ ok: true });
    }
    if (get && route === 'settings') return ok({ settings: (await host.database(root)).settings() });
    if (post && route === 'settings') {
      const b = json(body);
      const key = String(b.key ?? '').trim();
      if (!key) throw new HttpError(400, 'No setting key given.');
      (await host.database(b.root)).writeSetting(key, b.value);
      return ok({ ok: true });
    }

    // ---- clashes & contacts ----
    if (post && route === 'clashes/get') {
      const b = json(body);
      const keys = Array.isArray(b.keys) ? b.keys.map(String) : [];
      return ok({ runs: (await host.database(b.root)).clashRuns(keys) });
    }
    if (post && route === 'clashes/write') {
      const b = json(body);
      const key = String(b.key ?? '');
      const scope = String(b.scope ?? '');
      if (!key || !scope || !Array.isArray(b.pairs)) throw new HttpError(400, 'A clash run needs a key, a scope and its pairs.');
      (await host.database(b.root)).writeClashRun(key, scope, b.pairs);
      return ok({ ok: true });
    }
    throw new HttpError(404, `Unknown database endpoint: ${method} ${route}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) };
  }
}
