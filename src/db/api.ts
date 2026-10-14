import { FEATURES } from '../features';
/** Client for the project database (vite-plugins/projectDbPlugin.ts). */

export interface DbProgramme {
  id: number;
  name: string;
  sourceFile: string | null;
  /** p6db: projects of a P6 Professional database, read live (read-only). */
  sourceFormat: 'xer' | 'xml' | 'p6db';
  sourcePath: string | null;
  projectIds: string[];
  /** scenario: a Scenarios programme (one per scenario and building). */
  kind: 'import' | 'scenario';
  scenario: string | null;
  stem: string | null;
  hidden: boolean;
  activityCount: number | null;
  /** Edited in place: its rows change (applyProgrammeOps), as against an import, edited on top. */
  editable: boolean;
  /** A saved baseline of the programme with this id (a frozen copy of it). */
  baselineOf: number | null;
  importedAt: string;
}

export interface DbProjectInfo {
  id: string;
  shortName: string;
  name: string;
  activityCount: number;
}

export interface DbTable {
  columns: string[];
  rows: string[][];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/db/${path}`, init);
  } catch {
    throw new Error('Could not reach the project database — run the app with Autorun.bat / npm run dev.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    if (res.status === 404 && !body) throw new Error('The project database is not available — run the app with Autorun.bat / npm run dev (not a static build).');
    throw new Error(body?.error ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

const qs = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== null && e[1] !== undefined).map(([k, v]) => [k, String(v)])).toString();

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Writes the export files of Settings > Import / Export into a subfolder of the project folder (settings). */
export const writeExportFiles = (root: string, files: { name: string; content: string }[], dir = 'settings') => post<{ folder: string; written: string[] }>('export-files', { root, files, dir });
export const openDb = (root: string) => post<{ root: string; file: string; changes: number }>('open', { root });
/** Folders of an earlier layout (1-input-ifc, fixed-models, 7-scenarios) still in the project. */
export const fetchLegacyFolders = (root: string) => call<{ legacy: string[] }>(`layout?${qs({ root })}`).then((r) => r.legacy);
export const migrateFolderLayout = (root: string) => post<{ renamed: string[]; skipped: string[] }>('layout/migrate', { root });
export const fetchChanges = (root: string) => call<{ changes: number }>(`changes?${qs({ root })}`).then((r) => r.changes);

export const fetchProgrammes = (root: string) => call<{ programmes: DbProgramme[] }>(`programmes?${qs({ root })}`).then((r) => r.programmes);
export const programmeExportUrl = (root: string, id: number) => `/api/db/programmes/export?${qs({ root, id })}`;
export const programmeTablesUrl = (root: string, id: number) => `/api/db/programmes/tables?${qs({ root, id })}`;
export const setProgrammesHidden = (root: string, hidden: Record<number, boolean>) => post('programmes/hidden', { root, hidden });
export const copyProgramme = (root: string, id: number, name: string) => post<{ programme: DbProgramme }>('programmes/copy', { root, id, name }).then((r) => r.programme);
export const saveBaseline = (root: string, id: number, name: string) => post<{ programme: DbProgramme }>('programmes/baseline', { root, id, name }).then((r) => r.programme);
export const blankProgramme = (root: string, name: string, start: string) => post<{ programme: DbProgramme }>('programmes/blank', { root, name, start }).then((r) => r.programme);
export interface DbRowOp {
  table: string;
  op: 'upsert' | 'delete';
  key: { column: string; value: string | number | null };
  match?: Record<string, string | number>;
  set?: Record<string, string | number | null>;
}
/** Changes rows of an editable programme in one transaction; the ids given to new rows (null key) come back by op number. */
export const applyProgrammeOps = (root: string, id: number, ops: DbRowOp[]) => post<{ applied: number; assigned: Record<number, number> }>('programmes/ops', { root, id, ops });
export const renameProgramme = (root: string, id: number, name: string) => post('programmes/rename', { root, id, name });
export const deleteProgramme = (root: string, id: number) => post('programmes/delete', { root, id });

export interface ImportOptions {
  root: string;
  name: string;
  file: string;
  format: 'xer' | 'xml';
  kind?: 'import' | 'scenario';
  scenario?: string;
  stem?: string;
  projectIds?: string[] | null;
}

/** Uploads an XER (a File, or XER text from an XML programme) into the
    project database's P6 tables. XMLHttpRequest for the upload progress. */
export function importProgramme(body: Blob, o: ImportOptions, onProgress?: (fraction: number) => void): Promise<DbProgramme> {
  const url = `/api/db/programmes/import?${qs({ root: o.root, name: o.name, file: o.file, format: o.format, kind: o.kind ?? 'import', scenario: o.scenario, stem: o.stem, projects: o.projectIds?.join(',') })}`;
  if (FEATURES.browserData) {
    return fetch(url, { method: 'POST', body }).then(async (res) => {
      const data = (await res.json().catch(() => null)) as { programme?: DbProgramme; error?: string } | null;
      if (!res.ok || !data?.programme) throw new Error(data?.error ?? `Import failed (${res.status}).`);
      onProgress?.(1);
      return data.programme;
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Could not reach the project database — run the app with Autorun.bat / npm run dev.'));
    xhr.onload = () => {
      let res: { programme?: DbProgramme; error?: string } | null = null;
      try {
        res = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && res?.programme) resolve(res.programme);
      else reject(new Error(res?.error ?? `Import failed (${xhr.status}).`));
    };
    xhr.send(body);
  });
}

export const fetchP6Projects = (path: string) => call<{ file: string; projects: DbProjectInfo[] }>(`p6/projects?${qs({ path })}`);
export const linkP6Projects = (root: string, path: string, projectIds: string[], name: string) =>
  post<{ programme: DbProgramme }>('p6/link', { root, path, projectIds, name }).then((r) => r.programme);

export const fetchLinkGroups = (root: string) => call<{ groups: unknown[] }>(`link-groups?${qs({ root })}`).then((r) => r.groups);
export const saveLinkGroups = (root: string, groups: unknown[]) => post('link-groups', { root, groups });
export const fetchCapacities = (root: string) => call<{ capacities: Record<string, number> }>(`capacities?${qs({ root })}`).then((r) => r.capacities);
export const saveCapacities = (root: string, capacities: Record<string, number>) => post('capacities', { root, capacities });
export const fetchSettings = (root: string) => call<{ settings: Record<string, unknown> }>(`settings?${qs({ root })}`).then((r) => r.settings);
export const saveSetting = (root: string, key: string, value: unknown) => post('settings', { root, key, value });

/** A stored contact: A's and B's GlobalIds, gap (m), overlapping, where B sits. */
export type DbClashPair = [string, string, number, boolean, string];
export const fetchClashRuns = (root: string, keys: string[]) => post<{ runs: { key: string; pairs: DbClashPair[] }[] }>('clashes/get', { root, keys }).then((r) => r.runs);
export const writeClashRun = (root: string, key: string, scope: string, pairs: DbClashPair[]) => post('clashes/write', { root, key, scope, pairs });
