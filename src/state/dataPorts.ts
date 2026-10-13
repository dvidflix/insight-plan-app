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

/** One kind of thing that can be exported to a file and imported back, on its own: the Import / Export list in
    Settings has a row for each. A file says what it is (`kind`), so any of them can also be dropped on the list
    without choosing the row first. Importing adds what is new and replaces what has the same id (name for the
    data table presets), and never removes anything. */
export interface DataPort {
  id: 'options' | 'sets' | 'viewpoints' | 'datatable' | 'layouts' | 'decorators' | 'linkgroups' | 'appearance' | 'tags';
  label: string;
  hint: string;
  /** How many items there are now. */
  count: () => number;
  /** What goes in the file. */
  collect: () => unknown;
  /** Takes the file's content in; returns what it did, for the message. */
  apply: (data: unknown) => { added: number; updated: number; note?: string };
}

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
];

const portFile = (port: DataPort) => ({
  name: `${KIND_PREFIX}${port.id}.json`,
  content: JSON.stringify({ kind: `${KIND_PREFIX}${port.id}`, version: FILE_VERSION, exportedAt: new Date().toISOString(), data: port.collect() }, null, 2),
});

/** Every list as its export file, written into the project folder (the files "Export" would download). Resolves to the folder and the file names. */
export async function exportAllToProject(root: string): Promise<{ folder: string; written: string[] }> {
  return writeExportFiles(root, DATA_PORTS.map(portFile));
}

export function exportPort(port: DataPort) {
  const payload = { kind: `${KIND_PREFIX}${port.id}`, version: FILE_VERSION, exportedAt: new Date().toISOString(), data: port.collect() };
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
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not an Insight Plan export file.');
  }
  const kind = typeof parsed.kind === 'string' ? parsed.kind : '';
  const port = DATA_PORTS.find((p) => `${KIND_PREFIX}${p.id}` === kind);
  if (!port) throw new Error(kind ? `"${kind}" is not one of the lists here.` : 'This is not an Insight Plan export file.');
  if (only && port.id !== only) throw new Error(`This file holds ${port.label.toLowerCase()}, not ${DATA_PORTS.find((p) => p.id === only)?.label.toLowerCase()}.`);
  return { port, ...port.apply(parsed.data) };
}
