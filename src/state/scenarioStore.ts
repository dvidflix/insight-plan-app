import { setObjectJoins } from '../schedule/linkGroups';
import type { PresetContent } from '../prs/presets';
import { withOwn } from '../prs/recipeRules';
import { create } from 'zustand';
import { useModelsStore } from './modelsStore';
import { makeEditableCopy, reloadFromDb, useProjectDbStore } from './projectDbStore';
import {
  downloadText,
  fetchProject,
  fetchSequence,
  fetchBaseSequence,
  forgetBaseSequence,
  fetchXml,
  loadIntoInputs,
  deleteScenarioOnServer,
  saveScenario,
  scenarioFileName,
  updateScenario,
  warmScenario,
  type CrewOptions,
  type ProjectInfo,
  type ScenarioCrew,
  type ScenarioFlag,
  type ScenarioRelation,
  type ScenarioExtra,
} from '../scenarios/api';
import { baseStem, indexFromProgramme } from '../scenarios/fromProgramme';
import { fromSheet, indexColumn, stepNumbers, toSheet, type PourRow } from '../scenarios/pourOrder';
import { useScheduleStore } from './scheduleStore';
import { elementIdField } from '../schedule/activityObjects';
import { taskFieldValue } from '../schedule/linkGroups';
import { startOf } from '../schedule/columns';
import { parseXml } from '../schedule/parsers/xml';
import { xmlToXer } from '../schedule/xmlToXer';
import { filterXmlText } from '../schedule/exportFilter';
import { DEFAULT_SCN_TABLE, type ScnTableConfig } from '../scenarios/tableView';
import type { ScnConfigTab } from '../components/scenarios/ScenarioTableConfig';
import { getWbsOrder } from './wbsOrder';
import { NO_RULES, isEmptyRules, normalizeRules, type EngineDefaults, type ScenarioRules } from '../prs/rules';
import { convertLegacyRules, legacyCount } from '../prs/convert';
import { useRecipeStore } from './recipeStore';
import { stepSetNames, withFolderSteps } from '../prs/folderSteps';
import { forGenerator } from '../prs/recipeRules';
import { useSearchSetsStore } from './searchSetsStore';
import { duplicateSets, groupsWithSets, setsForGroups, shadowCopies, staleSets, uniqueGroups } from '../prs/groupSets';
import { calendarsFromProgrammes, syncCalendars } from '../prs/calendarsFromProgramme';

/** The Scenarios work in progress — project, scenario, pour order, unsaved
    edits, undo/redo, selection, table view — in one store, so the Scenarios
    tab and the Scenarios panel of 4D Sequencing show (and edit) the same
    thing, and switching between them loses nothing. The loading side lives
    in ScenarioSync (mounted by whichever of the two is showing). */

export const NO_ROWS: PourRow[] = [];
const NO_RELATIONS: ScenarioRelation[] = [];
const NO_CREWS: ScenarioCrew[] = [];
const NO_EXTRAS: ScenarioExtra[] = [];
const NO_FLAGS: Record<string, FlagState> = {};

/** Review flag on a pour (its GUID) or a group (its key): to fix, or fixed. */
export type FlagState = 'flag' | 'done';
const flagsOf = (list: ScenarioFlag[] | undefined): Record<string, FlagState> => (list?.length ? Object.fromEntries(list.map((f) => [f.Key, f.State])) : NO_FLAGS);
const flagList = (flags: Record<string, FlagState>): ScenarioFlag[] => Object.entries(flags).map(([Key, State]) => ({ Key, State }));
const NAME_RE = /^[^<>:"/\\|?*\x00-\x1f]+$/;

export interface LoadedOrder {
  root: string;
  scenario: string;
  stem: string;
  headers: string[];
  /** Base (project) step of each row (0 = not in its sequence), for the
      "Base" / shift columns and the moved count. */
  baseStep: Map<string, number>;
}

type Message = { kind: 'ok' | 'error' | 'warn'; text: string } | null;
export type ScenarioCfgTab = 'scenario' | 'rules' | ScnConfigTab;
/** Tabs showing the table configuration (the others are cards). */
export const isTableCfgTab = (tab: ScenarioCfgTab): tab is ScnConfigTab => tab !== 'scenario' && tab !== 'rules';

// Same localStorage keys (and JSON format) the Scenarios tab used before.
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered
  }
}

interface ScenarioState {
  startDate: string;
  scenario: string | null;
  pickedStem: string | null;
  tableCfg: ScnTableConfig;
  cfgTab: ScenarioCfgTab;

  project: ProjectInfo | null;
  projectError: string | null;
  drafts: string[];
  loaded: LoadedOrder | null;
  rows: PourRow[];
  savedRows: PourRow[];
  undo: PourRow[][];
  redo: PourRow[][];
  selected: Set<string>;
  filter: string;
  collapsedGroups: Set<string>;
  /** Recording the order objects are picked in 3D (row keys, in pick order). */
  recordPicks: boolean;
  pickOrder: string[];
  busy: string | null;
  message: Message;
  log: string;
  showLog: boolean;
  /** "Copy the order on screen" hands its rows to the next load. */
  copy: {
    scenario: string;
    stem: string;
    loaded: LoadedOrder;
    rows: PourRow[];
    /** Links, crews, flags and crew options carried over from the scenario copied. */
    relations?: ScenarioRelation[];
    crews?: ScenarioCrew[];
    extras?: ScenarioExtra[];
    rules?: ScenarioRules;
    flags?: Record<string, FlagState>;
    crewOptions?: CrewOptions | null;
  } | null;
  /** Bumped after each successful Generate (4D refreshes from it). */
  generation: number;
  /** Regenerate 4D automatically a moment after each change to the order. */
  autoUpdate: boolean;
  /** A saved scenario saves itself a moment after each change (order, joins, links, crews, extras, flags, rules). */
  autoSave: boolean;
  /** The order, links and crews the programme in 4D was last updated from. */
  updatedFrom: { rows: PourRow[]; relations: ScenarioRelation[]; crews: ScenarioCrew[]; extras: ScenarioExtra[]; rules: ScenarioRules } | null;
  /** The scenario's manual links and crews (saved with it), and as last
      saved (for the unsaved flag). */
  relations: ScenarioRelation[];
  crews: ScenarioCrew[];
  savedRelations: ScenarioRelation[];
  savedCrews: ScenarioCrew[];
  /** The scenario's extra activities (from a high-level programme), and as last saved. */
  extras: ScenarioExtra[];
  savedExtras: ScenarioExtra[];
  /** The scenario's programme rules (durations, rebar, crews, rule groups, level tasks, sequences, contact links, settings), and as last saved. */
  rules: ScenarioRules;
  savedRules: ScenarioRules;
  /** What the generator does without rules (shown beside the scenario's own rows). */
  engineDefaults: EngineDefaults | null;
  /** Review flags (pour GUID / group key -> state), saved with the scenario; and the table showing only the flagged. */
  flags: Record<string, FlagState>;
  savedFlags: Record<string, FlagState>;
  flaggedOnly: boolean;
  /** The generator's trades, crew phases and default crews (crew editor). */
  crewOptions: CrewOptions | null;
}

export const useScenarioStore = create<ScenarioState>(() => ({
  startDate: load('scenarios.startDate', ''),
  scenario: load<string | null>('scenarios.current', null),
  pickedStem: load<string | null>('scenarios.model', null),
  tableCfg: load('scenarios.table', DEFAULT_SCN_TABLE),
  // 'sort' was a tab of its own before sorting moved into Columns.
  cfgTab: ((t) => (t === ('sort' as string) ? 'columns' : t))(load<ScenarioCfgTab>('scenarios.cfgTab', 'scenario')),
  project: null,
  projectError: null,
  drafts: [],
  loaded: null,
  rows: NO_ROWS,
  savedRows: NO_ROWS,
  undo: [],
  redo: [],
  selected: new Set(),
  filter: '',
  collapsedGroups: new Set(),
  recordPicks: false,
  pickOrder: [],
  busy: null,
  message: null,
  log: '',
  showLog: false,
  copy: null,
  generation: 0,
  autoUpdate: load('scenarios.autoUpdate', false),
  autoSave: load('scenarios.autoSave', true),
  updatedFrom: null,
  relations: NO_RELATIONS,
  crews: NO_CREWS,
  savedRelations: NO_RELATIONS,
  savedCrews: NO_CREWS,
  extras: NO_EXTRAS,
  savedExtras: NO_EXTRAS,
  rules: NO_RULES,
  savedRules: NO_RULES,
  engineDefaults: null,
  flags: NO_FLAGS,
  savedFlags: NO_FLAGS,
  flaggedOnly: false,
  crewOptions: null,
}));

const PERSISTED: [keyof ScenarioState, string][] = [
  ['startDate', 'scenarios.startDate'],
  ['scenario', 'scenarios.current'],
  ['pickedStem', 'scenarios.model'],
  ['tableCfg', 'scenarios.table'],
  ['cfgTab', 'scenarios.cfgTab'],
  ['autoUpdate', 'scenarios.autoUpdate'],
  ['autoSave', 'scenarios.autoSave'],
];
useScenarioStore.subscribe((s, prev) => {
  for (const [field, key] of PERSISTED) if (s[field] !== prev[field]) save(key, s[field]);
});

const get = () => useScenarioStore.getState();
const set = useScenarioStore.setState;

// ---- the building (stem): the IFC loaded in Inputs ----

export const stemsInInputs = (models: { name: string }[]) => models.map((m) => m.name.replace(/\.(ifc|frag)$/i, ''));

const sameBuilding = (a: string, b: string) => baseStem(a).toLowerCase() === baseStem(b).toLowerCase();

/** Scenarios are worked one building at a time. With several loaded in Inputs, the building is the one the current
    scenario belongs to (if the picked one has no such scenario, another loaded building that has it), else the picked
    one, else the first loaded — preferring buildings that are in the project folder. */
function resolveStem(stems: string[], picked: string | null, project: ProjectInfo | null, scenario: string | null): string | null {
  const chosen = chooseStem(stems, picked, project, scenario);
  // The IFC loaded may be the _FIXED copy: work on the project folder's own stem for that building.
  return chosen !== null ? project?.models.find((m) => sameBuilding(m.stem, chosen))?.stem ?? chosen : null;
}
function chooseStem(stems: string[], picked: string | null, project: ProjectInfo | null, scenario: string | null): string | null {
  const saved = scenario ? project?.scenarios.find((s) => s.name === scenario) : undefined;
  if (saved) {
    const owners = stems.filter((stem) => saved.models.some((m) => sameBuilding(m.stem, stem)));
    if (picked && owners.some((o) => sameBuilding(o, picked))) return picked;
    if (owners.length) return owners[0];
  }
  if (picked && stems.some((st) => sameBuilding(st, picked))) return picked;
  const inProject = stems.find((stem) => project?.models.some((m) => sameBuilding(m.stem, stem)));
  return inProject ?? stems[0] ?? null;
}
export function useScenarioStem(): string | null {
  const models = useModelsStore((s) => s.models);
  const picked = useScenarioStore((s) => s.pickedStem);
  const project = useScenarioStore((s) => s.project);
  const scenario = useScenarioStore((s) => s.scenario);
  return resolveStem(stemsInInputs(models), picked, project, scenario);
}
function currentStem(): string | null {
  const { pickedStem, project, scenario } = get();
  return resolveStem(stemsInInputs(useModelsStore.getState().models), pickedStem, project, scenario);
}

/** The scenarios of every loaded building (plus unsaved ones): picking one moves to the building it belongs to. */
export function scenarioNamesForStems(project: ProjectInfo | null, drafts: string[], stems: string[]): string[] {
  const own = project?.scenarios.filter((s) => s.models.some((m) => stems.some((stem) => sameBuilding(m.stem, stem)))).map((s) => s.name) ?? [];
  return [...new Set([...own, ...drafts])].sort((a, b) => a.localeCompare(b));
}

export function scenarioNamesFor(project: ProjectInfo | null, drafts: string[], stem: string | null): string[] {
  const own = project?.scenarios.filter((s) => s.models.some((m) => stem !== null && baseStem(m.stem).toLowerCase() === baseStem(stem).toLowerCase())).map((s) => s.name) ?? [];
  return [...new Set([...own, ...drafts])].sort((a, b) => a.localeCompare(b));
}

// ---- loading ----

export async function refreshProject(root = useProjectDbStore.getState().root) {
  if (!root) return;
  try {
    set({ projectError: null, project: await fetchProject(root) });
  } catch (e) {
    set({ project: null, projectError: e instanceof Error ? e.message : String(e) });
  }
}

/** Loads the scenario's pour order (and the project's base order) — unless
    that same order is already loaded, so edits survive switching between
    the Scenarios tab and 4D. */
let loadingOrder: { key: string; run: Promise<void> } | null = null;

export async function loadOrder(stem: string | null) {
  const { project, scenario } = get();
  // Already loading this one (e.g. the tab was left and opened again while
  // the building is being prepared): wait for it instead of asking again.
  const key = `${project?.root}|${scenario}|${stem}`;
  if (loadingOrder?.key === key) return loadingOrder.run;
  const run = loadOrderNow(stem);
  loadingOrder = { key, run };
  try {
    await run;
  } finally {
    if (loadingOrder?.run === run) loadingOrder = null;
  }
}

/** The rules, extra activities, links and crews a new scenario was asked to start with (instead of its source's): applied when it opens, and
    left unsaved, so Save stores them with the scenario. */
let pendingContent: { scenario: string; content: PresetContent } | null = null;
function applyPendingContent(scenario: string) {
  if (!pendingContent || pendingContent.scenario !== scenario) return;
  const { content } = pendingContent;
  pendingContent = null;
  set({ rules: withOwn(content.rules, get().rules), extras: content.extras, relations: content.relations, crews: content.crews, savedRules: NO_RULES, savedExtras: NO_EXTRAS, savedRelations: NO_RELATIONS, savedCrews: NO_CREWS });
}

async function loadOrderNow(stem: string | null) {
  const { project, scenario, loaded, copy } = get();
  if (!project || !scenario || !stem || !project.models.some((m) => m.stem === stem)) {
    if (loaded) set({ loaded: null });
    return;
  }
  if (loaded && loaded.root === project.root && loaded.scenario === scenario && loaded.stem === stem) return;
  if (copy && copy.scenario === scenario && copy.stem === stem) {
    set({
      copy: null, loaded: { ...copy.loaded, scenario, root: project.root }, rows: copy.rows, savedRows: [], undo: [], redo: [],
      relations: copy.relations ?? NO_RELATIONS, crews: copy.crews ?? NO_CREWS, savedRelations: NO_RELATIONS, savedCrews: NO_CREWS,
      extras: copy.extras ?? NO_EXTRAS, savedExtras: NO_EXTRAS,
      rules: copy.rules ?? NO_RULES, savedRules: NO_RULES,
      flags: copy.flags ?? NO_FLAGS, savedFlags: NO_FLAGS, ...(copy.crewOptions ? { crewOptions: copy.crewOptions } : {}),
    });
    applyPendingContent(scenario);
    return;
  }
  set({ busy: 'Loading order…', copy: null });
  try {
    const [own, base] = await Promise.all([fetchSequence(project.root, stem, scenario), fetchBaseSequence(project.root, stem)]);
    // Still the one asked for?
    if (get().scenario !== scenario || get().project?.root !== project.root || currentStem() !== stem) return;
    const baseOrder = fromSheet(base.headers, base.rows);
    const baseSteps = stepNumbers(baseOrder.rows);
    // A scenario with no saved order but a programme (loaded from a file):
    // take the order from the programme's own dates, as an unsaved scenario.
    let ownRows = own.rows;
    let fromProgramme = false;
    if (own.source !== 'scenario') {
      const programme = useScheduleStore.getState().schedules.find((s) => s.sourceFileName.includes(`[${scenario}]`));
      const derived = programme ? indexFromProgramme(programme, own.headers, own.rows) : null;
      if (derived) {
        ownRows = derived;
        fromProgramme = true;
      }
    }
    const order = fromSheet(own.headers, ownRows);
    set({
      loaded: { root: project.root, scenario, stem, headers: own.headers, baseStep: new Map(baseOrder.rows.map((r, i) => [r.key, baseSteps[i]])) },
      relations: own.relations ?? NO_RELATIONS,
      crews: own.crews ?? NO_CREWS,
      savedRelations: own.relations ?? NO_RELATIONS,
      savedCrews: own.crews ?? NO_CREWS,
      extras: own.extras ?? NO_EXTRAS,
      savedExtras: own.extras ?? NO_EXTRAS,
      rules: withLibrary(groupsIntoSets(migrateOldRules(normalizeRules(own.rules)))),
      savedRules: normalizeRules(own.rules),
      engineDefaults: own.defaults ?? get().engineDefaults,
      flags: flagsOf(own.flags),
      savedFlags: flagsOf(own.flags),
      crewOptions: { trades: own.trades ?? [], phases: own.phases ?? [], defaultCrews: own.defaultCrews ?? [] },
      rows: order.rows,
      savedRows: fromProgramme ? NO_ROWS : order.rows,
      undo: [],
      redo: [],
      selected: new Set(),
      message: fromProgramme ? { kind: 'ok', text: `"${scenario}" opened from its programme — the pour order comes from the programme's start dates. Edit it, Update 4D, then Save.` } : null,
    });
    applyPendingContent(scenario);
  } catch (e) {
    set({ message: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
  } finally {
    set({ busy: null });
  }
}

// ---- editing ----

export const isDirty = (s: Pick<ScenarioState, 'rows' | 'savedRows' | 'relations' | 'savedRelations' | 'crews' | 'savedCrews' | 'extras' | 'savedExtras' | 'rules' | 'savedRules' | 'flags' | 'savedFlags'>) =>
  s.rows !== s.savedRows || s.relations !== s.savedRelations || s.crews !== s.savedCrews || s.extras !== s.savedExtras || s.rules !== s.savedRules || s.flags !== s.savedFlags;
export const confirmDiscard = () => !isDirty(get()) || window.confirm('Discard the unsaved changes to this scenario (order, links, crews)?');

/** Manual links and crews are edited in place; Save stores them. */
export const setRelations = (relations: ScenarioRelation[]) => set({ relations });
export const setCrews = (crews: ScenarioCrew[]) => set({ crews });
export const setExtras = (extras: ScenarioExtra[]) => set({ extras });
/** The programme rules are edited in place (a new object per change); Save stores them, Update 4D generates with them. */
export const setRules = (rules: ScenarioRules) => set({ rules: rules.sequences.some((q) => q.stepsFolder) ? withLibrary(rules) : rules });

/** Sets (or, with null, clears) the review flag of these pours / groups. */
export const setFlags = (keys: string[], state: FlagState | null) => {
  const next = { ...get().flags };
  for (const k of keys) {
    if (state) next[k] = state;
    else delete next[k];
  }
  set({ flags: Object.keys(next).length ? next : NO_FLAGS });
};

/** Drops the loaded order so it is read again (after changes made to the
    database elsewhere). Asks first when there are unsaved edits. */
export function reloadOrder(): boolean {
  if (!confirmDiscard()) return false;
  forgetBaseSequence();
  set({ loaded: null });
  return true;
}

export function applyRows(next: PourRow[]) {
  const { rows, undo } = get();
  if (next === rows) return;
  set({ undo: [...undo.slice(-99), rows], redo: [], rows: next });
}
export function undoRows() {
  const { rows, undo, redo } = get();
  if (!undo.length) return;
  set({ redo: [rows, ...redo], rows: undo[undo.length - 1], undo: undo.slice(0, -1) });
}
export function redoRows() {
  const { rows, undo, redo } = get();
  if (!redo.length) return;
  set({ undo: [...undo, rows], rows: redo[0], redo: redo.slice(1) });
}
export const setSelected = (selected: Set<string>) => set({ selected });

// ---- actions ----

const xmlCache = new Map<string, string>();

async function run(label: string, fn: () => Promise<void>) {
  set({ busy: label, message: null });
  try {
    await fn();
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const [first, ...more] = text.split('\n');
    set({ message: { kind: 'error', text: first } });
    if (more.join('').trim()) set({ log: text });
  } finally {
    set({ busy: null });
  }
}

function request() {
  const { project, scenario, loaded, rows, relations, crews, extras, rules, flags } = get();
  return { root: project!.root, scenario: scenario!, stem: loaded!.stem, headers: loaded!.headers, rows: toSheet({ headers: loaded!.headers, rows }), relations, crews, extras, rules, flags: flagList(flags), wbsOrder: getWbsOrder() };
}

export const saveOrder = () =>
  run('Saving…', async () => {
    const { rows, scenario, relations, crews, extras, rules, flags } = get();
    await saveScenario(request());
    set({ savedRows: rows, savedRelations: relations, savedCrews: crews, savedExtras: extras, savedRules: rules, savedFlags: flags });
    // Drop the draft only once the refreshed project lists the scenario:
    // in between it would be in neither list and be taken as deleted.
    await refreshProject(get().project!.root);
    set((s) => ({ drafts: s.drafts.filter((n) => n !== scenario) }));
    set({ message: { kind: 'ok', text: `Saved "${scenario}" to the project database.` } });
  });

// ---- autosave: a scenario that is saved in the project keeps itself saved
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

const savedInProject = (s: ScenarioState) =>
  !!s.scenario && !!s.loaded && !!s.project?.scenarios.some((sc) => sc.name === s.scenario && sc.models.some((m) => m.stem === s.loaded!.stem && m.saved > 0));

/** Saves the scenario on screen a moment after the last change. A draft that was never saved is left for the first Save (so creating a scenario
    does not fill the project), and nothing is saved while something else is running. What is saved is what was on screen when it started: a
    change made meanwhile stays unsaved and goes with the next one. */
export function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null;
    const s = get();
    if (!s.autoSave || !s.loaded || !isDirty(s) || !savedInProject(s)) return;
    if (s.busy) return scheduleAutoSave();
    const { rows, relations, crews, extras, rules, flags, scenario, loaded } = s;
    try {
      await saveScenario(request());
    } catch (e) {
      set({ message: { kind: 'error', text: `Autosave failed: ${e instanceof Error ? e.message : String(e)}` } });
      return;
    }
    const now = get();
    if (now.scenario !== scenario || now.loaded !== loaded) return; // another scenario was opened meanwhile: it was saved, nothing to mark
    set({ savedRows: rows, savedRelations: relations, savedCrews: crews, savedExtras: extras, savedRules: rules, savedFlags: flags });
    await refreshProject(now.project!.root).catch(() => undefined);
    set({ message: { kind: 'ok', text: `Autosaved "${scenario}" at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` } });
    if (isDirty(get())) scheduleAutoSave();
  }, 1500);
}

useScenarioStore.subscribe((s, prev) => {
  if (!s.autoSave || !s.loaded) return;
  const changed = s.rows !== prev.rows || s.relations !== prev.relations || s.crews !== prev.crews || s.extras !== prev.extras || s.rules !== prev.rules || s.flags !== prev.flags;
  if ((changed || (s.autoSave && !prev.autoSave)) && isDirty(s)) scheduleAutoSave();
});

/** "Update 4D": the programme for the order on screen from the long-running
    generator (about a second once warm), straight into 4D. The order is not
    saved (Save does that) unless the scenario needed a full run first. */
export const updateFourD = () =>
  run('Updating 4D…', async () => {
    const { rows, scenario, startDate, loaded, relations, crews, extras, rules, flags } = get();
    const stem = loaded!.stem;
    const res = await updateScenario({ ...request(), rules: forGenerator(rules), startDate: startDate || null });
    xmlCache.set(`${scenario}|${stem}`, res.xml);
    await loadIntoInputs(res.xml, stem, scenario!);
    set((s) => ({
      updatedFrom: { rows, relations, crews, extras, rules },
      generation: s.generation + 1,
      log: res.log || s.log,
      message: {
        kind: 'ok',
        text: res.fast
          ? `4D updated in ${res.seconds ?? '?'} s — "${scenarioFileName(stem, scenario!)}".`
          : `First run for this scenario done (it builds the cache for fast updates) — 4D updated.`,
      },
    }));
    if (!res.fast) {
      set((s) => ({ savedRows: rows, savedRelations: relations, savedCrews: crews, savedExtras: extras, savedRules: rules, savedFlags: flags, drafts: s.drafts.filter((n) => n !== scenario) }));
      await refreshProject(get().project!.root);
    }
  });

/** The order, links or crews changed since 4D was last updated. */
export const needsUpdate = (s: Pick<ScenarioState, 'rows' | 'relations' | 'crews' | 'extras' | 'rules' | 'updatedFrom'>) =>
  !s.updatedFrom || s.updatedFrom.rows !== s.rows || s.updatedFrom.relations !== s.relations || s.updatedFrom.crews !== s.crews || s.updatedFrom.extras !== s.extras || s.updatedFrom.rules !== s.rules;

// Auto-update: one run a moment after the last change, never two at once.
let autoTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleAutoUpdate() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    const s = get();
    if (!s.autoUpdate || !s.loaded || !needsUpdate(s)) return;
    if (s.busy) return scheduleAutoUpdate();
    await updateFourD();
    // Changed again while updating: go once more.
    const after = get();
    if (after.autoUpdate && needsUpdate(after)) scheduleAutoUpdate();
  }, 700);
}

/** Loads the model and workbook into the long-running generator early. */
export function warmUp() {
  const { project, scenario, loaded } = get();
  if (project && scenario && loaded) void warmScenario({ root: project.root, scenario, stem: loaded.stem });
}

async function currentXml() {
  const { project, scenario, loaded } = get();
  const key = `${scenario}|${loaded!.stem}`;
  const hit = xmlCache.get(key);
  if (hit) return hit;
  const xml = await fetchXml(project!.root, scenario!, loaded!.stem);
  xmlCache.set(key, xml);
  return xml;
}

export const loadGenerated = () =>
  run('Loading into Inputs…', async () => {
    const { scenario, loaded } = get();
    await loadIntoInputs(await currentXml(), loaded!.stem, scenario!);
    set({ message: { kind: 'ok', text: `Loaded "${scenarioFileName(loaded!.stem, scenario!)}" into Inputs.` } });
  });

/** "Take over": switches from the scenario to editing by hand. The programme as generated now (generated first when there is none in
    the project database yet) is copied to an editable programme that no scenario owns, so later generating does not replace it. */
export const takeOver = () =>
  run('Taking over the programme…', async () => {
    const { scenario, loaded } = get();
    const stem = loaded!.stem;
    const find = () => useProjectDbStore.getState().programmes.find((p) => p.kind === 'scenario' && p.scenario === scenario && p.stem === stem);
    if (!find()) await loadIntoInputs(await currentXml(), stem, scenario!);
    const source = find();
    if (!source) throw new Error('The project database has no programme for this scenario: open a project folder first.');
    await makeEditableCopy(source, `${scenarioFileName(stem, scenario!)} (manual)`);
    const err = useProjectDbStore.getState().error;
    set({ message: err ? { kind: 'error', text: err } : { kind: 'ok', text: `"${scenarioFileName(stem, scenario!)} (manual)" is now yours to edit in Inputs / Schedule. It is no longer changed by this scenario.` } });
  });

export const download = (format: 'xml' | 'xer') =>
  run(`Preparing ${format.toUpperCase()}…`, async () => {
    const { scenario, loaded } = get();
    const xml = await currentXml();
    const name = scenarioFileName(loaded!.stem, scenario!);
    const out = filterXmlText(xml);
    if (format === 'xml') downloadText(`${name}.xml`, out, 'application/xml');
    else downloadText(`${name}.xer`, xmlToXer(parseXml(out)), 'text/plain;charset=utf-8');
  });

/** Creates a scenario (a draft until saved); returns an error message or null. */
/** Where a new scenario's pour order starts: the baseline, the order on screen,
    a saved scenario of this building, or the dates of a loaded programme. */
export type StartFrom = 'base' | 'current' | `saved:${string}` | `programme:${string}`;

/** The pour dates of a loaded programme, by Pour ID (= the schedule's Element ID): the earliest start of the pour's activities. */
function programmeStarts(scheduleId: string): { starts: Map<string, number>; error: string | null } {
  const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, '');
  const starts = new Map<string, number>();
  const schedule = useScheduleStore.getState().schedules.find((s) => s.id === scheduleId);
  if (!schedule) return { starts, error: 'That programme is no longer loaded.' };
  const field = elementIdField(schedule);
  if (!field) return { starts, error: 'That programme has no Element ID (an activity code or user field) to tell which pour each activity belongs to.' };
  for (const a of schedule.activities) {
    const id = norm(taskFieldValue(a, field));
    const start = startOf(a);
    if (!id || !start) continue;
    const t = start.getTime();
    const cur = starts.get(id);
    if (cur === undefined || t < cur) starts.set(id, t);
  }
  return { starts, error: starts.size === 0 ? 'No activity of that programme has an Element ID and a start date.' : null };
}

/** The pour order of another scenario of the same model (key -> step number, 0 = unsequenced), to put this scenario's order in the same
    order: the order it saved, or for one with none the order of its programme's start dates. An error text when it has no order. */
export async function orderOfScenario(name: string): Promise<{ steps: Map<string, number>; count: number } | string> {
  const { project } = get();
  const stem = currentStem();
  if (!project || !stem) return "Load the building's model in Inputs first.";
  try {
    const other = await fetchSequence(project.root, stem, name);
    let rows = other.rows;
    if (other.source !== 'scenario') {
      const programme = useScheduleStore.getState().schedules.find((x) => x.sourceFileName.includes(`[${name}]`));
      const derived = programme ? indexFromProgramme(programme, other.headers, other.rows) : null;
      if (derived) rows = derived;
    }
    const order = fromSheet(other.headers, rows);
    const numbers = stepNumbers(order.rows);
    const steps = new Map(order.rows.map((r, i) => [r.key, numbers[i]]));
    const count = [...steps.values()].filter((n) => n > 0).length;
    return count === 0 ? `“${name}” has no pour order saved, and no programme to read one from.` : { steps, count };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Starts a scenario as a copy of a saved one, or from a programme's dates: the
    pour order (and for a copy, its links, crews and flags) is built from the
    building's baseline sheet. */
async function createFromSource(name: string, from: StartFrom): Promise<string | null> {
  const { project, drafts } = get();
  const stem = currentStem();
  if (!project || !stem) return 'Load the building\'s model in Inputs first.';
  if (!confirmDiscard()) return null;
  set({ busy: 'Preparing the new scenario…' });
  try {
    const source = from.startsWith('saved:') ? from.slice('saved:'.length) : null;
    const [own, base] = await Promise.all([fetchSequence(project.root, stem, source), fetchBaseSequence(project.root, stem)]);
    let headers = own.headers;
    let sheetRows = own.rows;
    let note: Message = null;
    if (from.startsWith('programme:')) {
      const { starts, error } = programmeStarts(from.slice('programme:'.length));
      if (error) return error;
      const idx = indexColumn(base.headers);
      const idCols = ['PlanningProposedPourID', 'Pour ID'].map((h) => base.headers.indexOf(h)).filter((i) => i >= 0);
      if (idx < 0 || idCols.length === 0) return 'The building\'s pour table has no Index or Pour ID column to match against.';
      const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, '');
      const day = (t: number) => Math.floor(t / 86_400_000);
      const dated = base.rows.map((cells) => {
        for (const c of idCols) {
          const t = starts.get(norm(cells[c] ?? ''));
          if (t !== undefined) return { cells, day: day(t) };
        }
        return { cells, day: null as number | null };
      });
      // Pours starting the same day share an Index; the rest keep their baseline order, unsequenced.
      const days = [...new Set(dated.flatMap((d) => (d.day === null ? [] : [d.day])))].sort((a, b) => a - b);
      const rankOf = new Map(days.map((d, i) => [d, i + 1]));
      headers = base.headers;
      sheetRows = dated
        .map((d, pos) => ({ ...d, pos }))
        .sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity) || a.pos - b.pos)
        .map((d) => {
          const cells = [...d.cells];
          cells[idx] = d.day === null ? '' : String(rankOf.get(d.day));
          return cells;
        });
      const matched = dated.filter((d) => d.day !== null).length;
      note = { kind: matched === 0 ? 'warn' : 'ok', text: `${matched} of ${dated.length} pours found in the programme, in ${days.length} steps by start date.${matched < dated.length ? ' The others are unsequenced, at the end.' : ''}` };
    }
    const order = fromSheet(headers, sheetRows);
    const baseOrder = fromSheet(base.headers, base.rows);
    const baseSteps = stepNumbers(baseOrder.rows);
    const loadedOrder: LoadedOrder = {
      root: project.root, scenario: name, stem, headers, baseStep: new Map(baseOrder.rows.map((r, i) => [r.key, baseSteps[i]])),
    };
    set({
      copy: {
        scenario: name, stem, loaded: loadedOrder, rows: order.rows,
        ...(source ? { relations: own.relations ?? NO_RELATIONS, crews: own.crews ?? NO_CREWS, extras: own.extras ?? NO_EXTRAS, rules: normalizeRules(own.rules), flags: flagsOf(own.flags) } : {}),
        crewOptions: { trades: own.trades ?? [], phases: own.phases ?? [], defaultCrews: own.defaultCrews ?? [] },
      },
      drafts: [...drafts, name], scenario: name, loaded: null, message: note, ...(own.defaults ? { engineDefaults: own.defaults } : {}),
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    set({ busy: null });
  }
}

/** What rules a new scenario starts with: those of the order it is made from (the default), none, or a preset's. */
export type RulesFrom = 'source' | 'none' | { preset: PresetContent };

export async function createScenario(rawName: string, from: StartFrom, rulesFrom: RulesFrom = 'source'): Promise<string | null> {
  const name = rawName.trim();
  const { project, drafts, loaded, rows, rules, extras, relations, crews, flags } = get();
  if (!NAME_RE.test(name) || name === '.' || name === '..') return 'Scenario names cannot contain < > : " / \\ | ? *';
  if (scenarioNamesFor(project, drafts, currentStem()).includes(name)) return `There is already a scenario called "${name}".`;
  pendingContent = rulesFrom === 'source' ? null : { scenario: name, content: rulesFrom === 'none' ? { rules: NO_RULES, extras: NO_EXTRAS, relations: NO_RELATIONS, crews: NO_CREWS } : rulesFrom.preset };
  if (from === 'current' && loaded) {
    // The order on screen with what goes with it: its rules (the joins too), extra activities, manual links, crews and flags.
    set({ copy: { scenario: name, stem: loaded.stem, loaded, rows, rules, extras, relations, crews, flags }, drafts: [...drafts, name], scenario: name });
    return null;
  }
  if (from.startsWith('saved:') || from.startsWith('programme:')) {
    const err = await createFromSource(name, from);
    if (err) pendingContent = null;
    return err;
  }
  if (!confirmDiscard()) {
    pendingContent = null;
    return null;
  }
  set({ drafts: [...drafts, name], scenario: name, loaded: null });
  return null;
}

/** Deletes a scenario after asking: a draft only disappears from the list; a
    saved one is removed from the project database with its generated programme. */
export async function deleteScenario(name: string): Promise<void> {
  const { project, drafts, scenario } = get();
  const saved = !!project?.scenarios.some((s) => s.name === name);
  const what = saved ? 'its saved order, links, crews and generated programme' : 'this unsaved scenario';
  if (!window.confirm(`Delete the scenario "${name}"? This removes ${what}. It cannot be undone.`)) return;
  const wasCurrent = scenario === name;
  try {
    if (saved && project) await deleteScenarioOnServer({ root: project.root, scenario: name });
  } catch (e) {
    set({ message: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
    return;
  }
  set({ drafts: drafts.filter((d) => d !== name), ...(wasCurrent ? { scenario: null, loaded: null } : {}) });
  if (saved) {
    await refreshProject();
    // Its programme is gone from the database: the lists read it again.
    void reloadFromDb();
  }
}

export function pickScenario(name: string) {
  if (name === get().scenario || !confirmDiscard()) return;
  set({ scenario: name, loaded: null });
}

export function pickStem(stem: string) {
  if (stem === currentStem() || !confirmDiscard()) return;
  set({ pickedStem: stem, loaded: null });
}

/** Rules in the old form (Duration, Productivity, Rebar rate, Crew rule, Calendar rule rows) are turned into groups, rates, crews and assignments
    when a scenario opens: the panel no longer edits them, and the generator makes the same programme. */
function migrateOldRules(rules: ScenarioRules): ScenarioRules {
  return legacyCount(rules) > 0 ? convertLegacyRules(rules).rules : rules;
}

/** The scenario's rules with the recipe library's recipes and pools. A library with nothing in it takes the scenario's own first (a scenario
    saved before the library existed keeps its recipes). */
/** The groups of a scenario that a search set can say exactly become sets of the "Recipes sets" folder, when it opens: the sets are the groups. */
function groupsIntoSets(rules: ScenarioRules): ScenarioRules {
  const store = useSearchSetsStore.getState();
  for (const set of [...staleSets(rules.groups, store.sets), ...shadowCopies(rules.groups, store.sets), ...duplicateSets(store.sets)]) store.remove(set.id);
  for (const set of setsForGroups(rules.groups, useSearchSetsStore.getState().sets)) store.save(set);
  return rules;
}

function withLibrary(rules: ScenarioRules): ScenarioRules {
  const allSets = useSearchSetsStore.getState().sets;
  rules = withFolderSteps(rules, allSets);
  // A search set is the group of its name wherever it is used: by a recipe, a step, a level task or a limit.
  const named = [
    ...useRecipeStore.getState().recipes.map((r) => r.group),
    ...stepSetNames(rules, allSets),
    ...rules.levelTasks.map((t) => t.group),
    ...rules.sequences.flatMap((q) => q.steps.map((s) => s.group)),
    ...(rules.limits ?? []).map((l) => l.group ?? ''),
  ];
  const groups = groupsWithSets(uniqueGroups(rules.groups), allSets, named);
  const calendars = syncCalendars(rules.calendars, calendarsFromProgrammes(useScheduleStore.getState().schedules.flatMap((m) => m.calendars)));
  const synced = groups === rules.groups && calendars === rules.calendars ? rules : { ...rules, groups, calendars };
  return withRecipeLibrary(synced);
}

function withRecipeLibrary(rules: ScenarioRules): ScenarioRules {
  const lib = useRecipeStore.getState();
  if (!lib.recipes.length && !lib.pools.length) {
    if (rules.recipes.length) lib.setRecipes(rules.recipes);
    if (rules.resourcePools.length) lib.setPools(rules.resourcePools);
    return rules;
  }
  if (rules.recipes === lib.recipes && rules.resourcePools === lib.pools) return rules;
  const next = { ...rules, recipes: lib.recipes, resourcePools: lib.pools };
  return isEmptyRules(next) ? NO_RULES : next;
}

// A change in the recipe library goes into the open scenario's rules (so it is saved with it, and Update 4D sees it).
useRecipeStore.subscribe((lib, prev) => {
  if (lib.recipes === prev.recipes && lib.pools === prev.pools) return;
  const s = useScenarioStore.getState();
  if (!s.loaded) return;
  const next = withLibrary(s.rules);
  if (next !== s.rules) set({ rules: next });
});

// So are the calendars of the loaded programmes (the only place for calendars is Programmes > Calendars).
useScheduleStore.subscribe((st, prev) => {
  if (st.schedules === prev.schedules) return;
  const s = useScenarioStore.getState();
  if (!s.loaded) return;
  const next = withLibrary(s.rules);
  if (next !== s.rules) set({ rules: next });
});

// So are the sets of the "Recipes sets" folder: they are the groups the recipes name.
useSearchSetsStore.subscribe((st, prev) => {
  if (st.sets === prev.sets) return;
  const s = useScenarioStore.getState();
  if (!s.loaded) return;
  const next = withLibrary(s.rules);
  if (next !== s.rules) set({ rules: next });
});

// Joined objects are shown with their main object's activities in 4D.
useScenarioStore.subscribe((s, prev) => {
  if (s.rules.joins !== prev.rules.joins) setObjectJoins(s.rules.joins ?? []);
});
