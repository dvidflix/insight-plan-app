import { create } from 'zustand';
import type { ContextMeshInfo, ContextOffset } from '../viewer/contextMeshes';

/** glTF / GLB site-context meshes loaded this session (not kept across a reload:
    the file is asked for again). */
export interface ContextMeshRow extends ContextMeshInfo {
  hidden: boolean;
  offset: ContextOffset;
}

interface State {
  meshes: ContextMeshRow[];
  add: (info: ContextMeshInfo) => void;
  remove: (id: string) => void;
  toggleHidden: (id: string) => void;
  setOffset: (id: string, offset: ContextOffset) => void;
}

export const useContextMeshStore = create<State>((set) => ({
  meshes: [],
  add: (info) => set((s) => ({ meshes: [...s.meshes, { ...info, hidden: false, offset: { x: 0, y: 0, z: 0 } }] })),
  remove: (id) => set((s) => ({ meshes: s.meshes.filter((m) => m.id !== id) })),
  toggleHidden: (id) => set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, hidden: !m.hidden } : m)) })),
  setOffset: (id, offset) => set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, offset } : m)) })),
}));
