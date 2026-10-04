import { create } from 'zustand';

export interface SmartView {
  id: string;
  name: string;
  cameraJson: string;
}

interface SmartViewsState {
  views: SmartView[];
  add: (v: SmartView) => void;
  remove: (id: string) => void;
  importAll: (views: SmartView[]) => void;
}

export const useSmartViewsStore = create<SmartViewsState>((set) => ({
  views: [],
  add: (v) => set((s) => ({ views: [...s.views, v] })),
  remove: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
  importAll: (views) => set((s) => ({ views: [...s.views, ...views.map((v) => ({ ...v, id: crypto.randomUUID() }))] })),
}));
