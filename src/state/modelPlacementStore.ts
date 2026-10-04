import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Offset in project axes: X east, Y north, Z up (metres). */
export interface Offset {
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical axis through a pivot point (project axes, metres),
      applied before the move. Anticlockwise seen from above. */
  rot?: Rotation;
}

export interface Rotation {
  deg: number;
  px: number;
  py: number;
  pz: number;
}

/** A saved placement: the rotation about a pivot (if any) and the move. */
export interface OffsetPreset extends Offset {
  id: string;
}

export const ZERO_OFFSET: Offset = { x: 0, y: 0, z: 0 };

interface PlacementState {
  /** Per model, by name (ids don't survive a reload). */
  offsets: Record<string, Offset>;
  presets: OffsetPreset[];
  setOffset: (modelName: string, offset: Offset) => void;
  addPreset: (offset: Offset) => void;
  removePreset: (id: string) => void;
}

export const useModelPlacementStore = create<PlacementState>()(
  persist(
    (set) => ({
      offsets: {},
      presets: [],
      setOffset: (modelName, offset) => set((s) => ({ offsets: { ...s.offsets, [modelName]: offset } })),
      addPreset: (offset) => set((s) => ({ presets: [...s.presets, { id: crypto.randomUUID(), ...offset }] })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: 'sequence.modelPlacement' },
  ),
);
