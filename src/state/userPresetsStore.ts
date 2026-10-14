import { create } from 'zustand';

/** Presets you save yourself from the Presets menu of the Programmes (and Sequence) setup panels: columns, filters, group, sort and
    colour. `kind` says which panel keeps it ('filters', 'group', 'sort', 'color', 'columns:<view>'); `data` is what the panel applies. */
export interface UserPreset {
  id: string;
  kind: string;
  name: string;
  data: unknown;
}

const STORE_KEY = 'schedule.userPresets';

function load(): UserPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((p): p is UserPreset => !!p && typeof p.id === 'string' && typeof p.kind === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export const useUserPresetsStore = create<{ presets: UserPreset[] }>(() => ({ presets: load() }));

useUserPresetsStore.subscribe((s, prev) => {
  if (s.presets === prev.presets) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s.presets));
  } catch {
    // not remembered
  }
});

const set = useUserPresetsStore.setState;

/** Keeps `data` under `name` for the panel `kind`; a preset of that name (any case) is replaced. */
export function saveUserPreset(kind: string, name: string, data: unknown) {
  set((s) => {
    const same = s.presets.find((p) => p.kind === kind && p.name.toLowerCase() === name.toLowerCase());
    return { presets: same ? s.presets.map((p) => (p === same ? { ...p, data } : p)) : [...s.presets, { id: crypto.randomUUID(), kind, name, data }] };
  });
}

export const removeUserPreset = (id: string) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
