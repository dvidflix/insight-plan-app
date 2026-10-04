import fs from 'node:fs';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';

/** Dev-server bridge to SeaTable (the local Docker instance in C:\insight-stack): the model
    elements go into its "Elements" table, and the columns its users add come back as custom
    fields. The browser never talks to SeaTable (no CORS, no token in the page).

    Settings: SEATABLE_ENV_FILE (default C:\insight-stack\seatable\.env) supplies
    SEATABLE_SERVER_PROTOCOL / SEATABLE_SERVER_HOSTNAME and SEATABLE_RATES_API_TOKEN, the API token
    of the "Insight Plan Rates" base. Only runs under `npm run dev`.

    Columns of the Elements table:
      GUID, Model, IFC class, Name, Last pushed, Removed   managed by the push
      "Pset.Property" (a name with a dot)                  managed: one per pushed model property
      anything else                                        the user's: pulled as custom fields */

const ENV_FILE = process.env.SEATABLE_ENV_FILE ?? 'C:\\insight-stack\\seatable\\.env';
const TABLE = 'Elements';
const FIXED = ['GUID', 'Model', 'IFC class', 'Name', 'Last pushed', 'Removed'];
/** Column types whose value is not a plain value to bring back. */
const SKIP_TYPES = new Set(['image', 'file', 'button', 'digital-sign', 'geolocation', 'ctime', 'mtime', 'creator', 'last-modifier']);

interface GatewayAccess {
  gw: string;
  headers: Record<string, string>;
  base: string;
  at: number;
}

function readEnv(): Record<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new HttpError(503, `SeaTable settings not found: ${ENV_FILE}. Set SEATABLE_ENV_FILE to the seatable .env file.`);
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

let cached: GatewayAccess | null = null;

async function access(force = false): Promise<GatewayAccess> {
  if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return cached;
  const env = readEnv();
  const token = env.SEATABLE_RATES_API_TOKEN;
  if (!token) throw new HttpError(503, `SEATABLE_RATES_API_TOKEN is missing from ${ENV_FILE}.`);
  const root = `${env.SEATABLE_SERVER_PROTOCOL || 'http'}://${env.SEATABLE_SERVER_HOSTNAME || 'localhost'}`;
  let r: Response;
  try {
    r = await fetch(`${root}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${token}` } });
  } catch (e) {
    throw new HttpError(503, `SeaTable is not reachable at ${root}: is its Docker stack running? (${e instanceof Error ? e.message : e})`);
  }
  if (!r.ok) throw new HttpError(503, `SeaTable refused the API token (${r.status}).`);
  const a = (await r.json()) as { access_token: string; dtable_uuid: string; dtable_server: string };
  cached = { gw: `${a.dtable_server}api/v2/dtables/${a.dtable_uuid}`, headers: { Authorization: `Bearer ${a.access_token}`, 'Content-Type': 'application/json' }, base: root, at: Date.now() };
  return cached;
}

async function call(method: string, path: string, opts: { query?: Record<string, string | number>; json?: unknown } = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await access(attempt > 0);
    const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]): [string, string] => [k, String(v)]))}` : '';
    const r = await fetch(`${a.gw}${path}${qs}`, { method, headers: a.headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) });
    if (r.status === 401 && attempt === 0) continue; // the access token expired: ask for a new one
    const text = await r.text();
    if (!r.ok) throw new HttpError(502, `SeaTable ${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
  throw new HttpError(502, `SeaTable ${method} ${path}: no access.`);
}

interface Col {
  name: string;
  type: string;
}

async function tableInfo(): Promise<{ exists: boolean; columns: Col[] }> {
  const meta = await call('GET', '/metadata/');
  const t = (meta.metadata?.tables ?? []).find((x: any) => x.name === TABLE);
  return { exists: !!t, columns: t ? t.columns.map((c: any) => ({ name: c.name, type: c.type })) : [] };
}

async function allRows(): Promise<any[]> {
  const out: any[] = [];
  for (let start = 0; ; start += 1000) {
    const { rows } = await call('GET', '/rows/', { query: { table_name: TABLE, convert_keys: 'true', limit: 1000, start } });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function ensureTable(): Promise<Col[]> {
  const info = await tableInfo();
  if (info.exists) return info.columns;
  await call('POST', '/tables/', {
    json: {
      table_name: TABLE,
      columns: [
        { column_name: 'GUID', column_type: 'text' },
        { column_name: 'Model', column_type: 'text' },
        { column_name: 'IFC class', column_type: 'text' },
        { column_name: 'Name', column_type: 'text' },
        { column_name: 'Last pushed', column_type: 'text' },
        { column_name: 'Removed', column_type: 'checkbox' },
      ],
    },
  });
  return (await tableInfo()).columns;
}

// ---- push sessions: the rows of the table are read once, then chunks are upserted ----

interface PushSession {
  existing: Map<string, { id: string; model: string }>;
  numeric: Set<string>;
  properties: string[];
  seen: Set<string>;
  models: Set<string>;
  pushedAt: string;
}
const sessions = new Map<string, PushSession>();

const clean = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' || typeof v === 'string' ? v : String(v));

function normalize(v: unknown): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x && typeof x === 'object' ? (x as any).display_value ?? (x as any).name ?? (x as any).value ?? '' : x)).filter((x) => x !== '' && x !== null && x !== undefined);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') {
    const o = v as any;
    const s = o.display_value ?? o.name ?? o.value;
    return s === undefined || s === null || s === '' ? null : String(s);
  }
  return String(v);
}

export function seatablePlugin(): Plugin {
  return {
    name: 'insight-plan-seatable',
    configureServer(server) {
      server.middlewares.use('/api/seatable', async (req, res) => {
        try {
          const route = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '');

          if (req.method === 'GET' && route === 'status') {
            let env: Record<string, string> = {};
            try {
              env = readEnv();
            } catch (e) {
              return send(res, 200, { configured: false, reachable: false, envFile: ENV_FILE, error: e instanceof Error ? e.message : String(e) });
            }
            try {
              const info = await tableInfo();
              const rows = info.exists ? (await call('GET', '/rows/', { query: { table_name: TABLE, limit: 1 } })).rows.length : 0;
              return send(res, 200, { configured: true, reachable: true, envFile: ENV_FILE, address: `${env.SEATABLE_SERVER_PROTOCOL || 'http'}://${env.SEATABLE_SERVER_HOSTNAME || 'localhost'}`, table: info.exists, columns: info.columns.length, hasRows: rows > 0 });
            } catch (e) {
              return send(res, 200, { configured: true, reachable: false, envFile: ENV_FILE, error: e instanceof Error ? e.message : String(e) });
            }
          }

          // ---- push: start -> rows (many) -> finish ----
          if (req.method === 'POST' && route === 'push/start') {
            const { properties } = (await readBody(req)) as { properties: { key: string; numeric: boolean }[] };
            if (!Array.isArray(properties)) throw new HttpError(400, 'No properties given.');
            const columns = await ensureTable();
            const have = new Set(columns.map((c) => c.name));
            const missing = properties.filter((p) => !have.has(p.key));
            // Columns are added a few at a time (one API call each).
            for (let i = 0; i < missing.length; i += 4) {
              await Promise.all(missing.slice(i, i + 4).map((p) => call('POST', '/columns/', { json: { table_name: TABLE, column_name: p.key, column_type: p.numeric ? 'number' : 'text' } })));
            }
            const current = new Map((await tableInfo()).columns.map((c) => [c.name, c.type]));
            const existing = new Map<string, { id: string; model: string }>();
            for (const r of await allRows()) if (r.GUID) existing.set(String(r.GUID), { id: r._id, model: String(r.Model ?? '') });
            const id = Math.random().toString(36).slice(2);
            sessions.set(id, {
              existing,
              numeric: new Set(properties.filter((p) => current.get(p.key) === 'number').map((p) => p.key)),
              properties: properties.map((p) => p.key),
              seen: new Set(),
              models: new Set(),
              pushedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            });
            if (sessions.size > 5) sessions.delete(sessions.keys().next().value as string);
            return send(res, 200, { session: id, existingRows: existing.size, addedColumns: missing.length });
          }

          if (req.method === 'POST' && route === 'push/rows') {
            const { session, model, rows } = (await readBody(req)) as { session: string; model: string; rows: { guid: string; class: string; name: string; props: Record<string, unknown> }[] };
            const s = sessions.get(session);
            if (!s) throw new HttpError(410, 'The push session expired: start the push again.');
            const appends: Record<string, unknown>[] = [];
            const updates: { row_id: string; row: Record<string, unknown> }[] = [];
            for (const r of rows) {
              const row: Record<string, unknown> = { GUID: r.guid, Model: model, 'IFC class': r.class, Name: r.name ?? '', 'Last pushed': s.pushedAt, Removed: false };
              const known = s.existing.get(r.guid);
              for (const key of s.properties) {
                const v = r.props[key];
                if (s.numeric.has(key)) {
                  const n = v === undefined || v === '' || v === null ? null : Number(v);
                  if (n !== null && Number.isFinite(n)) row[key] = n;
                  else if (known) row[key] = null;
                } else if (v !== undefined && v !== null && v !== '') row[key] = clean(v);
                else if (known) row[key] = '';
              }
              s.seen.add(r.guid);
              s.models.add(model);
              if (known) updates.push({ row_id: known.id, row });
              else appends.push(row);
            }
            for (let i = 0; i < appends.length; i += 200) await call('POST', '/rows/', { json: { table_name: TABLE, rows: appends.slice(i, i + 200) } });
            for (let i = 0; i < updates.length; i += 200) await call('PUT', '/rows/', { json: { table_name: TABLE, updates: updates.slice(i, i + 200) } });
            return send(res, 200, { added: appends.length, updated: updates.length });
          }

          if (req.method === 'POST' && route === 'push/finish') {
            const { session } = (await readBody(req)) as { session: string };
            const s = sessions.get(session);
            if (!s) throw new HttpError(410, 'The push session expired.');
            // Rows of the pushed models that are no longer in them: marked, not deleted (the user's columns stay).
            const gone = [...s.existing].filter(([guid, v]) => !s.seen.has(guid) && s.models.has(v.model));
            for (let i = 0; i < gone.length; i += 200) {
              await call('PUT', '/rows/', { json: { table_name: TABLE, updates: gone.slice(i, i + 200).map(([, v]) => ({ row_id: v.id, row: { Removed: true } })) } });
            }
            sessions.delete(session);
            return send(res, 200, { removed: gone.length });
          }

          // ---- pull: the user's columns ----
          if (req.method === 'GET' && route === 'pull') {
            const info = await tableInfo();
            if (!info.exists) return send(res, 200, { columns: [], rows: [], note: 'The Elements table does not exist yet: push the model elements first.' });
            const custom = info.columns.filter((c) => !FIXED.includes(c.name) && !c.name.includes('.') && !c.name.startsWith('_') && !SKIP_TYPES.has(c.type));
            const names = custom.map((c) => c.name);
            const rows: { guid: string; values: Record<string, string | number> }[] = [];
            for (const r of await allRows()) {
              if (!r.GUID) continue;
              const values: Record<string, string | number> = {};
              for (const n of names) {
                const v = normalize(r[n]);
                if (v !== null) values[n] = v;
              }
              if (Object.keys(values).length) rows.push({ guid: String(r.GUID), values });
            }
            return send(res, 200, { columns: custom, rows });
          }

          throw new HttpError(404, `No such route: ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
