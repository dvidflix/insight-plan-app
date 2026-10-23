import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The 3D preview beside the Order list: whether it is shown (remembered) and which step is the current one (its group name, upper case; not remembered).
    Picking a step in the list or a pour in 3D sets `current`; the preview then colours only that step's pours.
    `many` colours several steps at once (a node of Generate 2's tree: the sets inside it); setting `current` clears it. */
export const useOrderPreview = create<{ show: boolean; setShow: (on: boolean) => void; current: string | null; setCurrent: (group: string | null) => void; many: string[] | null; setMany: (groups: string[] | null) => void }>()(
  persist((set) => ({ show: true, setShow: (show) => set({ show }), current: null, setCurrent: (current) => set({ current, many: null }), many: null, setMany: (many) => set({ many, current: null }) }), { name: 'generate.orderPreview', partialize: (s) => ({ show: s.show }) }),
);
