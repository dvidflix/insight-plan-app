import { create } from 'zustand';
import type { PropertyValueType } from '../ids/patches';

/** Property edits staged on the Properties tab (Edit properties) until they
    are written to the IFC: one entry per property/value and the elements it
    goes on, by model. Kept for the session, not saved. */
export interface QueuedEdit {
  id: number;
  pset: string;
  name: string;
  value: string;
  valueType: PropertyValueType;
  /** Model id → GlobalIds of the elements. */
  targets: Record<string, string[]>;
}

interface PropertyQueueState {
  queue: QueuedEdit[];
  add: (edit: Omit<QueuedEdit, 'id'>) => void;
  remove: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const usePropertyQueueStore = create<PropertyQueueState>((set) => ({
  queue: [],
  add: (edit) => set((s) => ({ queue: [...s.queue, { ...edit, id: nextId++ }] })),
  remove: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
  clear: () => set({ queue: [] }),
}));
