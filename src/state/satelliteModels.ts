import { create } from 'zustand';

/** A second window loads the 3D models only when it shows Models or 4D (loading them is the slow part). A panel that needs them
    (the Link Groups' task and object counts, the Views) can ask for them here: "Load the models here". */
export const useSatelliteModelsStore = create<{ wanted: boolean; want: () => void }>((set) => ({
  wanted: false,
  want: () => set({ wanted: true }),
}));
