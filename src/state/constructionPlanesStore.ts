import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Construction planes: boxes in the model's own coordinates (project axes: X east, Y north,
    Z up, metres) from a minimum to a maximum corner. Where min and max meet on an axis the
    box is flat: a plane. Drawn translucent in the 3D view. */
export interface ConstructionPlane {
  id: string;
  name: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  color: string;
  /** 0 – 1. */
  opacity: number;
  visible: boolean;
}

interface PlanesState {
  planes: ConstructionPlane[];
  visible: boolean;
  setVisible: (v: boolean) => void;
  add: (p?: Partial<ConstructionPlane>) => string;
  update: (id: string, patch: Partial<ConstructionPlane>) => void;
  remove: (id: string) => void;
  /** A copy right after the original, to change from there; returns its id. */
  duplicate: (id: string) => string | null;
  /** Every plane's own eye on or off. */
  setAllVisible: (visible: boolean) => void;
  clear: () => void;
}

export const newPlane = (p: Partial<ConstructionPlane> = {}): ConstructionPlane => ({
  id: crypto.randomUUID(), name: '', minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 0, color: '#2f80ed', opacity: 0.25, visible: true, ...p,
});

export const useConstructionPlanesStore = create<PlanesState>()(
  persist(
    (set) => ({
      planes: [],
      visible: true,
      setVisible: (visible) => set({ visible }),
      add: (p) => {
        const plane = newPlane(p);
        set((s) => ({ planes: [...s.planes, plane] }));
        return plane.id;
      },
      update: (id, patch) => set((s) => ({ planes: s.planes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ planes: s.planes.filter((p) => p.id !== id) })),
      duplicate: (id) => {
        let copyId: string | null = null;
        set((s) => {
          const i = s.planes.findIndex((p) => p.id === id);
          if (i < 0) return s;
          const { id: _id, ...rest } = s.planes[i];
          const copy = newPlane({ ...rest, name: `${rest.name || 'Plane'} (copy)` });
          copyId = copy.id;
          return { planes: [...s.planes.slice(0, i + 1), copy, ...s.planes.slice(i + 1)] };
        });
        return copyId;
      },
      setAllVisible: (visible) => set((s) => ({ planes: s.planes.map((p) => (p.visible === visible ? p : { ...p, visible })) })),
      clear: () => set({ planes: [] }),
    }),
    { name: 'viewer.constructionPlanes' },
  ),
);
