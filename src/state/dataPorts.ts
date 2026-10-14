import { useSearchSetsStore } from './searchSetsStore';
import { useViewpointStore, type ViewpointRecord } from './viewpointStore';
import { useDataTableStore, type DataTablePreset } from './dataTableStore';
import { useScheduleLayoutsStore, type ScheduleLayout } from './scheduleLayoutsStore';
import { useMarkersStore, type Marker } from './markersStore';
import { useLinkGroupsStore } from './linkGroupsStore';
import { useTagsStore, type Tag } from './tagsStore';
import { useAppearanceStore } from './appearanceStore';
import type { LinkGroup } from '../schedule/linkGroups';
import type { AppearanceProfile } from '../schedule/appearance';
import { useConstructionPlanesStore, type ConstructionPlane } from './constructionPlanesStore';
import { writeExportFiles } from '../db/api';
import { PERSISTED_CONFIG_PREFIXES, snapshotPersistedConfig } from '../utils/persistedState';
import type { SearchSet } from '../viewer/searchSets';
import { fetchSequence, saveScenario, type SequenceSheet } from '../scenarios/api';
import { isDirty, refreshProject, setCrews, setExtras, setRelations, setRules, useScenarioStore } from './scenarioStore';
import { parseOverlay } from '../prs/overlay';
import { withJoins } from '../prs/joins';
import { useRecipeStore } from './recipeStore';
import { isEmptyRules, mergeRules, normalizeRules, totalRules } from '../prs/rules';

/** One kind of thing that can be exported to a file and imported back, on its own: the Import / Export list in
    Settings has a row for each. A file says what it is (`kind`), so any of them can also be dropped on the list
    without choosing the row first. Importing adds what is new and replaces what has the same id (name for the
    data table presets), and never removes anything. */
export interface DataPort {
  id: 'options' | 'sets' | 'viewpoints' | 'datatable' | 'layouts' | 'decorators' | 'linkgroups' | 'appearance' | 'tags' | 'scenarios' | 'recipes' | 'rules';
  label: string;
  hint: string;
  /** How many items there are now. */
  count: () => number;
  /** What goes in the file (the scenarios are read from the project database, so this may take a moment). */
  collect: () => unknown | Promise<unknown>;
  /** Takes the file's content in; returns what it did, for the message. */
  apply: (data: unknown) => PortResult | Promise<PortResult>;
}

type PortResult = { added: number; updated: number; note?: string };

const KIND_PREFIX = 'insight-plan-';
const FILE_VERSION = 1;

/** Keys under the settings prefixes that are content with its own row, not options. */
const CONTENT_KEYS = new Set(['viewer.searchSets', 'viewer.viewpoints', 'viewer.markers', 'viewer.constructionPlanes', 'viewer.clashTests', 'viewer.activityNotes', 'schedule.layouts']);

function optionKeys(): Record<string, string> {
  return Object.fromEntries(Object.entries(snapshotPersistedConfig()).filter(([k]) => !CONTENT_KEYS.has(k)));
}

/** Items merged into the store's list by `idOf`: the same id replaced, new ones added. */
function mergeById<T>(current: T[], incoming: T[], idOf: (t: T) => string): { next: T[]; added: number; updated: number } {
  const next = [...current];
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const at = next.findIndex((x) => idOf(x) === idOf(item));
    if (at >= 0) {
      next[at] = item;
      updated++;
    } else {
      next.push(item);
      added++;
    }
  }
  return { next, added, updated };
}

const list = <T,>(v: unknown, what: string): T[] => {
  if (!Array.isArray(v)) throw new Error(`The file has no ${what}.`);
  return v as T[];
};

export const DATA_PORTS: DataPort[] = [
  {
    id: 'options',
    label: 'Global options',
    hint: 'Display and view settings: columns, colours, grouping, sorting, palettes, zoom, tabs shown. Reload to apply.',
    count: () => Object.keys(optionKeys()).length,
    collect: () => optionKeys(),
    apply: (data) => {
      const keys = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      let n = 0;
      for (const [k, v] of Object.entries(keys)) {
        if (typeof v !== 'string' || CONTENT_KEYS.has(k) || !PERSISTED_CONFIG_PREFIXES.some((p) => k.startsWith(p))) continue;
        localStorage.setItem(k, v);
        n++;
      }
      if (n === 0) throw new Error('The file has no options.');
      return { added: 0, updated: n, note: 'Reload to apply them.' };
    },
  },
  {
    id: 'sets',
    label: 'Sets',
    hint: 'Search sets and selection sets (Models > Search sets).',
    count: () => useSearchSetsStore.getState().sets.length,
    collect: () => useSearchSetsStore.getState().sets,
    apply: (data) => {
      const { next, added, updated } = mergeById(useSearchSetsStore.getState().sets, list<SearchSet>(data, 'sets'), (s) => s.id);
      useSearchSetsStore.setState({ sets: next });
      return { added, updated };
    },
  },
  {
    id: 'viewpoints',
    label: 'Viewpoints',
    hint: 'Saved viewpoints with their pictures. They show again when the models they were taken on are loaded.',
    count: () => useViewpointStore.getState().records.length,
    collect: () => useViewpointStore.getState().records,
    apply: (data) => {
      const { next, added, updated } = mergeById(useViewpointStore.getState().records, list<ViewpointRecord>(data, 'viewpoints'), (r) => r.guid);
      useViewpointStore.setState({ records: next });
      return { added, updated };
    },
  },
  {
    id: 'datatable',
    label: 'Data table presets',
    hint: 'The saved lists of the data table: columns, filters, grouping, sorting, row colours. A preset of the same name is replaced.',
    count: () => useDataTableStore.getState().presets.length,
    collect: () => useDataTableStore.getState().presets,
    apply: (data) => {
      const incoming = list<DataTablePreset>(data, 'presets');
      const current = useDataTableStore.getState().presets;
      const names = new Set(current.map((p) => p.name));
      const updated = incoming.filter((p) => names.has(p.name)).length;
      const kept = current.filter((p) => !incoming.some((i) => i.name === p.name));
      useDataTableStore.setState({ presets: [...kept, ...incoming.map((p) => ({ ...p, id: crypto.randomUUID() }))] });
      return { added: incoming.length - updated, updated };
    },
  },
  {
    id: 'layouts',
    label: 'Gantt layouts',
    hint: 'The Programmes layouts: columns, grouping, colours and filters of the Table and Gantt, with their folders.',
    count: () => useScheduleLayoutsStore.getState().layouts.length,
    collect: () => ({ layouts: useScheduleLayoutsStore.getState().layouts, folders: useScheduleLayoutsStore.getState().folders }),
    apply: (data) => {
      const d = (data && typeof data === 'object' ? data : {}) as { layouts?: unknown; folders?: unknown };
      const { next, added, updated } = mergeById(useScheduleLayoutsStore.getState().layouts, list<ScheduleLayout>(d.layouts, 'layouts'), (l) => l.id);
      const folders = [
        ...new Set([
          ...useScheduleLayoutsStore.getState().folders,
          ...(Array.isArray(d.folders) ? (d.folders as string[]) : []),
          ...next.map((l) => l.folder).filter((f): f is string => !!f),
        ]),
      ];
      useScheduleLayoutsStore.setState({ layouts: next, folders });
      return { added, updated };
    },
  },
  {
    id: 'linkgroups',
    label: 'Link Groups',
    hint: 'The 4D Link Groups: which objects each activity drives. A group with the same id is replaced.',
    count: () => useLinkGroupsStore.getState().groups.length,
    collect: () => useLinkGroupsStore.getState().groups,
    apply: (data) => {
      const { next, added, updated } = mergeById(useLinkGroupsStore.getState().groups, list<LinkGroup>(data, 'link groups'), (g) => g.id);
      useLinkGroupsStore.getState().replaceAll(next);
      return { added, updated };
    },
  },
  {
    id: 'appearance',
    label: 'Appearance Profiles',
    hint: 'The 4D Appearance Profiles: how objects look before, during and after their activity. A profile with the same id is replaced.',
    count: () => useAppearanceStore.getState().profiles.length,
    collect: () => useAppearanceStore.getState().profiles,
    apply: (data) => {
      const { next, added, updated } = mergeById(useAppearanceStore.getState().profiles, list<AppearanceProfile>(data, 'appearance profiles'), (p) => p.id);
      useAppearanceStore.getState().replaceAll(next);
      return { added, updated };
    },
  },
  {
    id: 'tags',
    label: 'Tags',
    hint: 'The 4D tags (on-viewer labels): name, text with its task and object tokens, placement and look. A tag with the same id is replaced.',
    count: () => useTagsStore.getState().tags.length,
    collect: () => useTagsStore.getState().tags,
    apply: (data) => {
      const { next, added, updated } = mergeById(useTagsStore.getState().tags, list<Tag>(data, 'tags'), (t) => t.id);
      useTagsStore.setState({ tags: next });
      return { added, updated };
    },
  },
  {
    id: 'decorators',
    label: 'Decorators',
    hint: 'Markers and construction planes (Views > Decorators).',
    count: () => useMarkersStore.getState().markers.length + useConstructionPlanesStore.getState().planes.length,
    collect: () => ({ markers: useMarkersStore.getState().markers, planes: useConstructionPlanesStore.getState().planes }),
    apply: (data) => {
      const d = (data && typeof data === 'object' ? data : {}) as { markers?: unknown; planes?: unknown };
      if (!Array.isArray(d.markers) && !Array.isArray(d.planes)) throw new Error('The file has no decorators.');
      const m = mergeById(useMarkersStore.getState().markers, (d.markers as Marker[]) ?? [], (x) => x.id);
      const p = mergeById(useConstructionPlanesStore.getState().planes, (d.planes as ConstructionPlane[]) ?? [], (x) => x.id);
      useMarkersStore.setState({ markers: m.next });
      useConstructionPlanesStore.setState({ planes: p.next });
      return { added: m.added + p.added, updated: m.updated + p.updated };
    },
  },
  {
    id: 'scenarios',
    label: 'Sequence',
    hint: "The project's saved scenarios, each with its order, joined objects, manual links, crews, extra activities, review flags and rules. A scenario of the same name (for the same model) is replaced; a scenario open with unsaved changes is skipped.",
    count: () => savedScenarios().length,
    collect: async () => (await readScenarios()).map((s) => ({ scenario: s.scenario, stem: s.stem, sequence: s.sequence, relations: s.relations, crews: s.crews, extras: s.extras, flags: s.flags, rules: s.rules })),
    apply: async (data) => writeScenarios(list<ScenarioFile>(data, 'scenarios'), false),
  },
  {
    id: 'recipes',
    label: 'Recipes',
    hint: 'The recipes (how each kind of object is built) and the equipment, crane and material pools they name. A recipe with the same ID is replaced; nothing is removed.',
    count: () => useRecipeStore.getState().recipes.length,
    collect: () => ({ recipes: useRecipeStore.getState().recipes, pools: useRecipeStore.getState().pools }),
    apply: (data) => {
      const d = (data && typeof data === 'object' ? data : {}) as { recipes?: unknown; pools?: unknown };
      if (!Array.isArray(d.recipes) && !Array.isArray(d.pools)) throw new Error('The file has no recipes.');
      const incoming = normalizeRules({ recipes: d.recipes, resourcePools: d.pools });
      const store = useRecipeStore.getState();
      // A file marked "replace" is the whole library: what it does not have is removed (a renamed recipe does not stay under its old name).
      if ((data as { replace?: unknown }).replace === true) {
        const before = store.recipes.length;
        store.setRecipes(incoming.recipes);
        if (Array.isArray(d.pools)) store.setPools(incoming.resourcePools);
        return { added: incoming.recipes.length, updated: 0, note: `The library now has ${incoming.recipes.length} recipes (it had ${before}).` };
      }
      const r = mergeById(store.recipes, incoming.recipes, (x) => x.id.toUpperCase());
      const p = mergeById(store.pools, incoming.resourcePools, (x) => `${x.kind}|${x.id.toUpperCase()}`);
      store.setRecipes(r.next);
      store.setPools(p.next);
      return { added: r.added + p.added, updated: r.updated + p.updated };
    },
  },
  {
    id: 'rules',
    label: 'Generator rules',
    hint: "The rules of every saved scenario (durations, chains, curing, groups, settings...), without its joined objects. Importing sets the rules of the scenario of the same name and model and keeps its order, joins and everything else; a scenario that is not in the project is skipped. A Programme Rules file (.prs.xml) is added to the scenario that is open instead.",
    count: () => savedScenarios().filter((s) => s.rules > 0).length,
    collect: async () => (await readScenarios()).filter((s) => Object.keys(s.rules as object).length).map((s) => ({ scenario: s.scenario, stem: s.stem, rules: withJoins(normalizeRules(s.rules), []) })),
    apply: async (data) => writeScenarios(list<ScenarioFile>(data, 'rules'), true),
  },
];

// ---------------------------------------------------------------- scenarios (kept in the project database, read and written through the scenarios service)

interface ScenarioFile {
  scenario: string;
  stem: string;
  sequence?: { GUID: string; Index: number; Phase?: string }[];
  relations?: SequenceSheet['relations'];
  crews?: SequenceSheet['crews'];
  extras?: SequenceSheet['extras'];
  flags?: SequenceSheet['flags'];
  rules?: unknown;
}

/** The saved scenarios of the project, one per scenario and model (rules: how many rules each holds). */
const savedScenarios = () =>
  (useScenarioStore.getState().project?.scenarios ?? []).flatMap((sc) => sc.models.filter((m) => m.saved).map((m) => ({ scenario: sc.name, stem: m.stem, rules: m.rules ?? 0 })));

/** A scenario as the service gives it, in the form of the file. */
const toFile = (scenario: string, stem: string, s: SequenceSheet): Required<ScenarioFile> => {
  const idx = s.headers.indexOf('Index');
  const guid = s.headers.indexOf('GUID');
  return {
    scenario,
    stem,
    sequence: s.rows
      .filter((r) => /^\d+(\.\d+)?$/.test((r[idx] ?? '').trim()) && (r[guid] ?? '').trim())
      .map((r) => ({ GUID: r[guid].trim(), Index: Math.trunc(Number(r[idx])), Phase: '' })),
    relations: s.relations ?? [],
    crews: s.crews ?? [],
    extras: s.extras ?? [],
    flags: s.flags ?? [],
    rules: s.rules ?? {},
  };
};

async function readScenarios() {
  const { project } = useScenarioStore.getState();
  if (!project) throw new Error('Open the project first (Settings > Project database): the scenarios are read from it.');
  const out: Required<ScenarioFile>[] = [];
  for (const s of savedScenarios()) {
    const sheet = await fetchSequence(project.root, s.stem, s.scenario);
    if (sheet.source === 'scenario') out.push(toFile(s.scenario, s.stem, sheet));
  }
  return out;
}

/** Saves the file's scenarios into the project. Whole scenarios (rulesOnly false): the file's order, links, crews, extras, flags and rules, with the
    saved scenario's joins when the file has none. Rules only: the file's rules into the saved scenario of that name and model, which keeps the rest
    (and its joins); one that is not saved in the project is skipped. A scenario open with unsaved changes is never overwritten. */
async function writeScenarios(incoming: ScenarioFile[], rulesOnly: boolean): Promise<PortResult> {
  const st = useScenarioStore.getState();
  const { project } = st;
  if (!project) throw new Error('Open the project first (Settings > Project database): the scenarios are saved into it.');
  const known = new Set(savedScenarios().map((s) => `${s.scenario}|${s.stem}`));
  let added = 0;
  let updated = 0;
  const skipped: string[] = [];
  const written = new Set<string>();
  for (const file of incoming) {
    if (!file || !file.scenario || !file.stem || /^[_.]/.test(file.scenario)) {
      skipped.push(String(file?.scenario ?? '?'));
      continue;
    }
    const exists = known.has(`${file.scenario}|${file.stem}`);
    if (rulesOnly && !exists) {
      skipped.push(`${file.scenario} (not in the project)`);
      continue;
    }
    if (exists && st.scenario === file.scenario && st.loaded?.stem === file.stem && isDirty(st)) {
      skipped.push(`${file.scenario} (open with unsaved changes)`);
      continue;
    }
    const saved = exists ? toFile(file.scenario, file.stem, await fetchSequence(project.root, file.stem, file.scenario)) : null;
    const joinsOf = (rules: unknown) => normalizeRules(rules).joins ?? [];
    let base: Required<ScenarioFile>;
    if (rulesOnly && saved) {
      const incoming = normalizeRules(file.rules);
      const own = normalizeRules(saved.rules);
      // (the scenario's recipes and pools stay when the file has none)
      base = { ...saved, rules: withJoins({ ...incoming, recipes: incoming.recipes.length ? incoming.recipes : own.recipes, resourcePools: incoming.resourcePools.length ? incoming.resourcePools : own.resourcePools }, joinsOf(saved.rules)) };
    } else {
      const rules = normalizeRules(file.rules);
      base = {
        scenario: file.scenario, stem: file.stem, sequence: file.sequence ?? [], relations: file.relations ?? [], crews: file.crews ?? [],
        extras: file.extras ?? [], flags: file.flags ?? [], rules: saved && !(rules.joins ?? []).length ? withJoins(rules, joinsOf(saved.rules)) : rules,
      };
    }
    await saveScenario({
      root: project.root, scenario: base.scenario, stem: base.stem,
      headers: ['Index', 'GUID', 'Phase'], rows: base.sequence.map((s) => [String(s.Index), s.GUID, s.Phase ?? '']),
      relations: base.relations, crews: base.crews, extras: base.extras, flags: base.flags, rules: base.rules as never,
    });
    written.add(`${base.scenario}|${base.stem}`);
    if (exists) updated++;
    else added++;
  }
  await refreshProject(project.root);
  // The open scenario was replaced: it is read again from the project.
  const open = useScenarioStore.getState();
  if (open.scenario && open.loaded && written.has(`${open.scenario}|${open.loaded.stem}`)) useScenarioStore.setState({ loaded: null });
  return { added, updated, ...(skipped.length ? { note: `Skipped: ${skipped.join(', ')}.` } : {}) };
}

/** A Programme Rules file (docs/programme-rules, .prs.xml) into the scenario that is open: its extra activities, links, crew rows and rules are added
    (rows with the same id, or the same ends and type for links, are replaced). Not saved by itself: the scenario saves as it does for any change. */
function importProgrammeRules(text: string): PortResult {
  const st = useScenarioStore.getState();
  if (!st.loaded || !st.scenario) throw new Error('Open a scenario first (4D Sequencing > Scenarios): a Programme Rules file is added to the scenario that is open.');
  const o = parseOverlay(text);
  const linkKey = (l: { ActivityID1: string; ActivityID2: string; Relation: string }) => `${l.ActivityID1}>${l.ActivityID2}:${l.Relation}`;
  const crewKey = (c: { Phase: string; PourType: string; Trade: string }) => `${c.Phase}|${c.PourType}|${c.Trade}`;
  const extraIds = new Set(o.extras.map((e) => e.TaskID.toUpperCase()));
  const linkKeys = new Set(o.links.map(linkKey));
  const crewKeys = new Set(o.crews.map(crewKey));
  setExtras([...st.extras.filter((e) => !extraIds.has(e.TaskID.toUpperCase())), ...o.extras]);
  setRelations([...st.relations.filter((l) => !linkKeys.has(linkKey(l))), ...o.links]);
  setCrews([...st.crews.filter((c) => !crewKeys.has(crewKey(c))), ...o.crews]);
  if (o.rules && !isEmptyRules(o.rules)) setRules(mergeRules(useScenarioStore.getState().rules, o.rules));
  const n = o.extras.length + o.links.length + o.crews.length + (o.rules ? totalRules(o.rules) : 0);
  return { added: n, updated: 0, note: `Added to "${st.scenario}": ${o.extras.length} extra activities, ${o.links.length} links, ${o.crews.length} crew rows and ${o.rules ? totalRules(o.rules) : 0} rules.` };
}

const isProgrammeRulesFile = (file: File, text: string) => /\.(prs|xml)$/i.test(file.name) || text.trimStart().startsWith('<');

const portFile = async (port: DataPort) => ({
  name: `${KIND_PREFIX}${port.id}.json`,
  content: JSON.stringify({ kind: `${KIND_PREFIX}${port.id}`, version: FILE_VERSION, exportedAt: new Date().toISOString(), data: await port.collect() }, null, 2),
});

/** Every list as its export file, written into the settings subfolder of the project folder (the files "Export" would download). Resolves to the folder and the file names. */
export async function exportAllToProject(root: string): Promise<{ folder: string; written: string[] }> {
  return writeExportFiles(root, await Promise.all(DATA_PORTS.map(portFile)));
}

/** One list as its export file, written into the project folder's settings subfolder. */
export async function exportPortToProject(root: string, port: DataPort): Promise<{ folder: string; written: string[] }> {
  return writeExportFiles(root, [await portFile(port)]);
}

export async function exportPort(port: DataPort) {
  const payload = { kind: `${KIND_PREFIX}${port.id}`, version: FILE_VERSION, exportedAt: new Date().toISOString(), data: await port.collect() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${KIND_PREFIX}${port.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads a file and imports it into the list it says it is for (or into `only`, when given: a file of another kind is refused). */
export async function importPortFile(file: File, only?: DataPort['id']): Promise<{ port: DataPort; added: number; updated: number; note?: string }> {
  let parsed: { kind?: unknown; data?: unknown };
  const text = await file.text();
  // A Programme Rules file (XML) is a Rules import into the scenario that is open.
  if (isProgrammeRulesFile(file, text)) {
    const rules = DATA_PORTS.find((p) => p.id === 'rules')!;
    if (only && only !== 'rules') throw new Error(`This is a Programme Rules file, not ${DATA_PORTS.find((p) => p.id === only)?.label.toLowerCase()}.`);
    return { port: rules, ...importProgrammeRules(text) };
  }
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not an Insight Plan export file.');
  }
  const kind = typeof parsed.kind === 'string' ? parsed.kind : '';
  const port = DATA_PORTS.find((p) => `${KIND_PREFIX}${p.id}` === kind);
  if (!port) throw new Error(kind ? `"${kind}" is not one of the lists here.` : 'This is not an Insight Plan export file.');
  if (only && port.id !== only) throw new Error(`This file holds ${port.label.toLowerCase()}, not ${DATA_PORTS.find((p) => p.id === only)?.label.toLowerCase()}.`);
  return { port, ...(await port.apply(parsed.data)) };
}
