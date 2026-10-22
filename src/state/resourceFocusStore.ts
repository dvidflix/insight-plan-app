import { create } from 'zustand';

/** The resource (or recipe) another screen asked to see: a resource chip in a recipe or an Order step opens the Resources tab on it, and the
    row is highlighted there. Not persisted. */
export const useResourceFocus = create<{ id: string | null; focus: (id: string | null) => void }>()((set) => ({ id: null, focus: (id) => set({ id }) }));

/** The Sequence step another screen asked to see (by its group): the recipe's "Built in steps" links open the Sequence tab with that step open. */
export const useStepFocus = create<{ group: string | null; focus: (group: string | null) => void }>()((set) => ({ group: null, focus: (group) => set({ group }) }));
