import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CameraKey } from '../viewer/flythrough';

interface FlythroughState {
  /** Camera keyframes, in order (world coordinates). */
  keys: CameraKey[];
  setKeys: (keys: CameraKey[]) => void;
  /** Seconds to travel the whole path. */
  duration: number;
  setDuration: (s: number) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  /** Draw the path in the 3D view. */
  showPath: boolean;
  setShowPath: (show: boolean) => void;
  /** 4D image / video export: move the camera along the path over the recording. */
  followInExport: boolean;
  setFollowInExport: (on: boolean) => void;
}

/** The camera fly-through (Fly-through tab), shared by the Models and 4D
    pages and kept across reloads. */
export const useFlythroughStore = create<FlythroughState>()(
  persist(
    (set) => ({
      keys: [],
      setKeys: (keys) => set({ keys }),
      duration: 20,
      setDuration: (duration) => set({ duration }),
      loop: true,
      setLoop: (loop) => set({ loop }),
      showPath: true,
      setShowPath: (showPath) => set({ showPath }),
      followInExport: false,
      setFollowInExport: (followInExport) => set({ followInExport }),
    }),
    { name: 'viewer.flythrough' },
  ),
);
