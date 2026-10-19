import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { setVirtualResolver } from '../viewer/bimTables';
import { runSearchSet, type SearchSet } from '../viewer/searchSets';
import { SET_FOLDER, setFolderOf } from '../viewer/setFolderValues';
import { computeGroupLinks, type LinkGroup } from '../schedule/linkGroups';
import type { ScheduleModel } from '../schedule/types';
import type { ElementSummary } from '../viewer/types';
import type { ModelIndex } from '../viewer/ViewerEngine';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useSequenceSchedule } from '../state/scheduleStore';
import { useIndexTick } from './modelFields';

/** The field of the Link Group that links an object (every group that does, in the order of the Link Groups list). */
export const LINK_GROUP_FIELD = 'LinkGroups:Group';

/** What the virtual fields read from: the loaded models, the search / selection sets and the Link Groups (set while the Data table
    shows). Their values are worked out once per field and kept until one of those changes. */
let ctx: { indexes: ReadonlyMap<string, ModelIndex>; sets: SearchSet[]; groups: LinkGroup[]; schedule: ScheduleModel | null } = { indexes: new Map(), sets: [], groups: [], schedule: null };
const folderCache = new Map<string, Map<ElementSummary, string[]>>();
let groupCache: Map<ElementSummary, string[]> | null = null;

function buildFolder(folder: string): Map<ElementSummary, string[]> {
  const out = new Map<ElementSummary, string[]>();
  for (const set of ctx.sets) {
    if ((set.group ?? '') !== folder) continue;
    for (const [modelId, ids] of Object.entries(runSearchSet(ctx.indexes, set))) {
      const index = ctx.indexes.get(modelId);
      for (const id of ids) {
        const e = index?.elements.get(id);
        if (e) (out.get(e) ?? out.set(e, []).get(e)!).push(set.name);
      }
    }
  }
  return out;
}

function buildGroups(): Map<ElementSummary, string[]> {
  const out = new Map<ElementSummary, string[]>();
  if (!ctx.schedule) return out;
  for (const index of ctx.indexes.values()) {
    const elements = [...index.elements.values()];
    for (const g of ctx.groups) {
      for (const id of computeGroupLinks(ctx.schedule, elements, g).elementIds) {
        const e = index.elements.get(id);
        if (e) (out.get(e) ?? out.set(e, []).get(e)!).push(g.name);
      }
    }
  }
  return out;
}

setVirtualResolver((e, key) => {
  if (key === LINK_GROUP_FIELD) return (groupCache ??= buildGroups()).get(e) ?? [];
  if (key.startsWith(SET_FOLDER)) {
    const folder = setFolderOf(key);
    let m = folderCache.get(folder);
    if (!m) folderCache.set(folder, (m = buildFolder(folder)));
    return m.get(e) ?? [];
  }
  return [];
});

/** Mount where the Data table is: gives the virtual fields (set folders, Link Groups) what they read from. Returns a number that
    changes when their values may have, for the memos that use them. */
export function useVirtualFields(): number {
  const engine = useViewerEngine();
  const sets = useSearchSetsStore((s) => s.sets);
  const groups = useLinkGroupsStore((s) => s.groups);
  const schedule = useSequenceSchedule();
  const tick = useIndexTick();
  ctx = { indexes: engine.getIndexes(), sets, groups, schedule };
  const version = useMemo(() => {
    folderCache.clear();
    groupCache = null;
    return Date.now() + Math.random();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sets, groups, schedule, tick]);
  return version;
}

/** The set folders and the Link Group field as fields to pick (columns, filters, grouping, sorting, colours). */
export function useVirtualFieldList(): { id: string; label: string; group: string }[] {
  const sets = useSearchSetsStore((s) => s.sets);
  const groups = useLinkGroupsStore((s) => s.groups);
  return useMemo(() => {
    const out: { id: string; label: string; group: string }[] = [];
    for (const f of [...new Set(sets.map((x) => x.group ?? ''))].sort((a, b) => a.localeCompare(b))) out.push({ id: SET_FOLDER + f, label: f || '(no folder)', group: 'Search / Selection Sets' });
    if (groups.length) out.push({ id: LINK_GROUP_FIELD, label: 'Link group', group: 'Link Groups' });
    return out;
  }, [sets, groups.length]);
}
