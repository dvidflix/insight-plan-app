import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The columns users add to the SeaTable "Elements" table, as "custom fields" of the model
    elements: a local copy (so the app works with SeaTable off) keyed by the element's GlobalId.
    Shown as the "Custom" property group (key "Custom.<column>") in Properties, the Data table,
    colour, filters, search sets and link groups. Saved with the project (the "models." settings
    go into the project database); a copy too big for the browser's storage is kept in memory only. */
export type FieldValue = string | number;

interface CustomFieldsState {
  /** Custom columns, in SeaTable's order. */
  fields: string[];
  /** GlobalId -> column -> value (empty cells left out). */
  values: Record<string, Record<string, FieldValue>>;
  pulledAt: string | null;
  /** Pull when a model loads. */
  autoPull: boolean;
  /** IFC classes (as the models name them) whose elements are pushed. */
  pushClasses: string[];
  lastPush: { at: string; elements: number; properties: number; added: number; updated: number; removed: number } | null;
  setPulled: (fields: string[], values: Record<string, Record<string, FieldValue>>) => void;
  setAutoPull: (on: boolean) => void;
  setPushClasses: (classes: string[]) => void;
  setLastPush: (p: NonNullable<CustomFieldsState['lastPush']>) => void;
}

const MAX_SAVED = 3_000_000;

export const useCustomFieldsStore = create<CustomFieldsState>()(
  persist(
    (set) => ({
      fields: [],
      values: {},
      pulledAt: null,
      autoPull: true,
      pushClasses: [],
      lastPush: null,
      setPulled: (fields, values) => set({ fields, values, pulledAt: new Date().toISOString() }),
      setAutoPull: (autoPull) => set({ autoPull }),
      setPushClasses: (pushClasses) => set({ pushClasses }),
      setLastPush: (lastPush) => set({ lastPush }),
    }),
    {
      name: 'models.customFields',
      partialize: (s) => {
        let values = s.values;
        try {
          if (JSON.stringify(values).length > MAX_SAVED) values = {};
        } catch {
          values = {};
        }
        return { fields: s.fields, values, pulledAt: s.pulledAt, autoPull: s.autoPull, pushClasses: s.pushClasses, lastPush: s.lastPush };
      },
    },
  ),
);

/** The property key a custom column gets on an element ("Custom.<column>"; a dot would split it into set and property). */
export const customKey = (field: string) => `Custom.${field.replace(/\./g, '·')}`;
export const customFieldKeys = () => useCustomFieldsStore.getState().fields.map(customKey);

/** What is happening (not saved). */
interface SeaTableUiState {
  busy: 'push' | 'pull' | null;
  progress: { done: number; total: number; label: string } | null;
  message: { kind: 'ok' | 'warn' | 'error'; text: string } | null;
}
export const useSeaTableUiStore = create<SeaTableUiState>(() => ({ busy: null, progress: null, message: null }));
