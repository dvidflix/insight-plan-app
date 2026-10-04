import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SearchCondition, SearchSet } from '../viewer/searchSets';

interface SearchSetsState {
  sets: SearchSet[];
  save: (set: SearchSet) => void;
  remove: (id: string) => void;
  /** Replaces every set of a folder with `next` (kept at the end of the list). */
  replaceGroup: (group: string, next: SearchSet[]) => void;
  /** Moves `id` to where `beforeId` is (or to the end). */
  move: (id: string, beforeId: string | null) => void;
}

const newId = () => crypto.randomUUID();

/** A regex as the old search sets stored it ("/…/i" or plain). */
const regexSource = (v: unknown) => {
  const s = String(v ?? '');
  const m = /^\/(.*)\/[a-z]*$/.exec(s);
  return m ? m[1] : s;
};

/** Search sets saved by the old form (the viewer's ItemsFinder: a category
    regex and one attribute name / value regex), as conditions. Read once,
    the first time this store has nothing saved. */
function fromOldForm(): SearchSet[] {
  try {
    const raw = JSON.parse(localStorage.getItem('ip.viewer.finderQueries') ?? 'null') as { data?: { name: string; customData?: { user?: boolean }; queries?: { categories?: unknown[]; attributes?: { queries?: { name?: unknown; value?: unknown }[] } }[] }[] } | null;
    return (raw?.data ?? []).filter((d) => d.customData?.user).map((d) => {
      const conditions: SearchCondition[] = [];
      for (const q of d.queries ?? []) {
        for (const c of q.categories ?? []) conditions.push({ id: newId(), field: 'Attributes.Class', op: 'regex', value: regexSource(c) });
        for (const a of q.attributes?.queries ?? []) {
          const name = regexSource(a.name);
          const field = /globalid/i.test(name) ? 'Attributes.GlobalId' : 'Attributes.Name';
          const value = regexSource(a.value);
          if (value && value !== '.*') conditions.push({ id: newId(), field, op: 'regex', value });
        }
      }
      return { id: newId(), name: d.name, group: '', match: 'all' as const, conditions };
    });
  } catch {
    return [];
  }
}

/** Selection sets saved by the old Sets tab (local ids per model), as
    selection sets; the ids become GlobalIds once each model is loaded. */
function fromOldSelectionSets(): SearchSet[] {
  try {
    const raw = JSON.parse(localStorage.getItem('ip.viewer.selectionSets') ?? 'null') as Record<string, Record<string, number[]>> | null;
    return Object.entries(raw ?? {}).map(([name, legacy]) => ({ id: newId(), name, group: '', kind: 'selection' as const, match: 'all' as const, conditions: [], items: [], legacy }));
  } catch {
    return [];
  }
}

/** Models > Search sets: saved searches over every object's properties,
    run again whenever they're used (so they follow the loaded models), and
    selection sets (fixed objects, by model and GlobalId).
    Under "viewer.", so the app configuration file carries them. */
export const useSearchSetsStore = create<SearchSetsState>()(
  persist(
    (set) => ({
      sets: [...fromOldForm(), ...fromOldSelectionSets()],
      save: (next) => set((s) => ({ sets: s.sets.some((x) => x.id === next.id) ? s.sets.map((x) => (x.id === next.id ? next : x)) : [...s.sets, next] })),
      remove: (id) => set((s) => ({ sets: s.sets.filter((x) => x.id !== id) })),
      replaceGroup: (group, next) => set((s) => ({ sets: [...s.sets.filter((x) => x.group !== group), ...next] })),
      move: (id, beforeId) =>
        set((s) => {
          const item = s.sets.find((x) => x.id === id);
          if (!item || id === beforeId) return s;
          const rest = s.sets.filter((x) => x.id !== id);
          const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
          rest.splice(at < 0 ? rest.length : at, 0, item);
          return { sets: rest };
        }),
    }),
    {
      name: 'viewer.searchSets',
      version: 1,
      // Version 0 was saved before selection sets joined: bring the old ones in.
      migrate: (old, version) => {
        const s = old as { sets?: SearchSet[] };
        return (version === 0 ? { ...s, sets: [...(s.sets ?? []), ...fromOldSelectionSets()] } : s) as SearchSetsState;
      },
    },
  ),
);
