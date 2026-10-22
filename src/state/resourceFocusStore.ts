import { create } from 'zustand';

/** The resource (or recipe) another screen asked to see: a resource chip in a recipe or an Order step opens the Resources tab on it, and the
    row is highlighted there. Not persisted. */
export const useResourceFocus = create<{ id: string | null; focus: (id: string | null) => void }>()((set) => ({ id: null, focus: (id) => set({ id }) }));
