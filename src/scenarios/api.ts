import { buildScheduleModel, parseScheduleFile } from '../schedule/loadSchedule';
import { parseXml } from '../schedule/parsers/xml';
import { xmlToXer } from '../schedule/xmlToXer';
import { useScheduleStore } from '../state/scheduleStore';
import { dbRoot, dbScheduleId, importIntoDb, setHidden, useProjectDbStore } from '../state/projectDbStore';
import { useAutoLinksStore } from '../state/autoLinksStore';

/** Client for the dev-server bridge in vite-plugins/scenarios.ts. */

export interface ScenarioModelInfo {
  stem: string;
  hasSource: boolean;
  /** Enriched IFC + geometry cache exist, so generating is quick. */
  cached: boolean;
}

export interface ScenarioInfo {
  name: string;
  models: { stem: string; saved: number; generated: number | null }[];
}

export interface ProjectInfo {
  root: string;
  models: ScenarioModelInfo[];
  scenarios: ScenarioInfo[];
}

/** A manual link (the legacy Relations sheet): Lag in working hours. */
export interface ScenarioRelation { ActivityID1: string; ActivityID2: string; Relation: string; Lag: number }
/** A crew row (the legacy Crews sheet): replaces the default crew for that phase / pour type. */
export interface ScenarioCrew { Phase: string; PourType: string; Trade: string; Crew: string }

export interface CrewTrade { code: string; name: string; capacity: number | null }
/** The generator's labour trades, crew phases and default crews
    (scenario-engine/config.py LABOUR_TRADES, CREW_TABLE): key is
    "<phase>" or "<phase>|<POUR_TYPE>", crews [trade code, people]. */
export interface CrewOptions {
  trades: CrewTrade[];
  phases: string[];
  defaultCrews: { key: string; crews: [string, number][] }[];
}

/** The pour table for a scenario (or the base order): the building's pours
    from the model with their columns, Index = the scenario's step. */
/** A review flag: 'flag' = to fix, 'done' = fixed. Key = a pour's GUID or a group's key in the Scenarios table. */
export interface ScenarioFlag { Key: string; State: 'flag' | 'done' }

export interface SequenceSheet {
  headers: string[];
  rows: string[][];
  /** Where the order came from: the scenario, a legacy workbook, or the generator's automatic order. */
  source: 'scenario' | 'legacy' | 'auto';
  relations: ScenarioRelation[];
  crews: ScenarioCrew[];
  /** Review flags saved with the scenario (pour GUID / group key). */
  flags?: ScenarioFlag[];
  trades: CrewTrade[];
  phases: string[];
  defaultCrews: CrewOptions['defaultCrews'];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/scenarios/${path}`, init);
  } catch {
    throw new Error('Could not reach the scenarios service — run the app with Autorun.bat / npm run dev.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    if (res.status === 404 && !body) throw new Error('The scenarios service is not available — run the app with Autorun.bat / npm run dev (not a static build).');
    throw new Error(body?.error ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

const qs = (params: Record<string, string | null>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== null)).toString();

/** Documents\Insight Plan\Default project, for working without a project folder. */
export const fetchDefaultRoot = () => call<{ root: string }>('default-root').then((r) => r.root);

/** Puts an IFC loaded in the app into the project (models/<stem>.ifc). */
export function addModelToProject(root: string, stem: string, file: File, onProgress?: (fraction: number) => void): Promise<{ replaced: boolean; note: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/scenarios/model?${qs({ root, stem })}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Could not reach the scenarios service — run the app with Autorun.bat / npm run dev.'));
    xhr.onload = () => {
      let res: { replaced?: boolean; note?: string | null; error?: string } | null = null;
      try {
        res = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && res) resolve({ replaced: !!res.replaced, note: res.note ?? null });
      else reject(new Error(res?.error ?? `Adding the model failed (${xhr.status}).`));
    };
    xhr.send(file);
  });
}

export const fetchProject = (root: string) => call<ProjectInfo>(`project?${qs({ root })}`);

export const fetchSequence = (root: string, stem: string, scenario: string | null) =>
  call<SequenceSheet>(`sequence?${qs({ root, stem, scenario })}`);

export const fetchXml = (root: string, scenario: string, stem: string) => call<{ xml: string }>(`xml?${qs({ root, scenario, stem })}`).then((r) => r.xml);

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface SaveRequest {
  root: string;
  scenario: string;
  stem: string;
  headers: string[];
  rows: string[][];
  relations?: ScenarioRelation[];
  crews?: ScenarioCrew[];
  flags?: ScenarioFlag[];
  /** The WBS order set in Programmes > WBS (parent path -> children paths): the generated schedule's WBS follows it. */
  wbsOrder?: Record<string, string[]>;
}

export const saveScenario = (req: SaveRequest) => post<{ ok: true }>('save', req);

/** Deletes a saved scenario: its order, links and crews, its generated programme and its files. */
export const deleteScenarioOnServer = (req: { root: string; scenario: string }) => post<{ ok: true }>('delete', req);

/** "Update 4D": the XML for the order on screen from the long-running
    generator (about a second; the order is not saved). `fast` is false when
    the scenario needed one full run first. */
export const updateScenario = (req: SaveRequest & { startDate: string | null }) =>
  post<{ xml: string; log: string; warning: string | null; fast: boolean; seconds: number | null }>('update', req);

/** Loads the building's model and the scenario's workbook into the
    long-running generator ahead of the first update. */
export const warmScenario = (req: { root: string; scenario: string; stem: string }) => post<{ ok: boolean }>('warm', req).catch(() => ({ ok: false }));

export const scenarioFileName = (stem: string, scenario: string) => `${stem} [${scenario}]`;

/** Loads a scenario's XML into the Programmes list (Inputs), replacing any
    earlier copy of the same scenario and hiding the model's other
    programmes (base or other scenarios), so 4D plays just this one. With a
    project database open it goes into the P6 tables first (as the
    scenario's programme) and is loaded from there. */
export async function loadIntoInputs(xml: string, stem: string, scenario: string) {
  if (dbRoot()) return loadIntoDb(xml, stem, scenario);
  const fileName = `${scenarioFileName(stem, scenario)}.xml`;
  const parsed = await parseScheduleFile(new File([xml], fileName, { type: 'application/xml' }));
  const model = buildScheduleModel(parsed);
  const store = useScheduleStore.getState();
  for (const s of store.schedules) if (s.sourceFileName === fileName) store.removeSchedule(s.id);
  store.addSchedule(model);
  const { schedules, hiddenScheduleIds } = useScheduleStore.getState();
  const hidden = new Set(hiddenScheduleIds);
  for (const s of schedules) {
    if (s.id !== model.id && s.sourceFileName.startsWith(stem)) hidden.add(s.id);
  }
  useScheduleStore.setState({ hiddenScheduleIds: hidden });
  // The slabs' missing links are added to the new programme once the models and contacts are ready.
  useAutoLinksStore.getState().request(model.id);
}

async function loadIntoDb(xml: string, stem: string, scenario: string) {
  const name = scenarioFileName(stem, scenario);
  const xer = xmlToXer(parseXml(xml));
  const programme = await importIntoDb(new Blob([xer], { type: 'text/plain' }), { name, file: `${name}.xml`, format: 'xml', kind: 'scenario', scenario, stem });
  // The building's other programmes (base, other scenarios) are hidden, in
  // the database too; copies loaded from files are replaced / hidden.
  const others: Record<number, boolean> = {};
  for (const p of useProjectDbStore.getState().programmes) {
    if (p.id !== programme.id && !p.hidden && (p.stem === stem || p.name.startsWith(stem))) others[p.id] = true;
  }
  if (Object.keys(others).length) await setHidden(others);
  const store = useScheduleStore.getState();
  for (const s of store.schedules) if (s.dbProgrammeId === undefined && s.sourceFileName === `${name}.xml`) store.removeSchedule(s.id);
  const { schedules, hiddenScheduleIds } = useScheduleStore.getState();
  const hidden = new Set(hiddenScheduleIds);
  for (const s of schedules) if (s.dbProgrammeId === undefined && s.sourceFileName.startsWith(stem)) hidden.add(s.id);
  useScheduleStore.setState({ hiddenScheduleIds: hidden, selectedId: dbScheduleId(programme.id) });
  useAutoLinksStore.getState().request(dbScheduleId(programme.id));
}

export function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
