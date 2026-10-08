import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MARKER_ICON } from '../viewer/markerIcons';

/** Markers: points in the model's own coordinates (project axes: X east, Y
    north, Z up, metres — as the IFC and the Point coordinates tool give them)
    with a name and an icon. Kept with the app configuration ("viewer." key). */
export interface Marker {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  icon: string;
  /** Bubble colour; none: the icon's own. */
  color?: string;
  /** The activity it belongs to: in 4D Sequencing the marker shows only from its start to its finish. */
  activityId?: string;
  activityCode?: string;
  activityName?: string;
  /** A formatted note (sanitised HTML), shown with the marker on hover. */
  note?: string;
  /** Switched off with its eye (Views > Decorators): not drawn. */
  hidden?: boolean;
  /** Set on the markers made from BCF topics (not saved with the Markers). */
  topicId?: string;
}

interface MarkersState {
  markers: Marker[];
  visible: boolean;
  setVisible: (v: boolean) => void;
  add: (m?: Partial<Marker>) => string;
  update: (id: string, patch: Partial<Marker>) => void;
  remove: (id: string) => void;
  /** A copy right after the original, to change from there; returns its id. */
  duplicate: (id: string) => string | null;
  /** Every marker's own eye on (false) or off (true). */
  setAllHidden: (hidden: boolean) => void;
  setAll: (markers: Marker[]) => void;
  clear: () => void;
}

export const newMarker = (m: Partial<Marker> = {}): Marker => ({ id: crypto.randomUUID(), name: '', x: 0, y: 0, z: 0, icon: DEFAULT_MARKER_ICON, ...m });

export const useMarkersStore = create<MarkersState>()(
  persist(
    (set) => ({
      markers: [],
      visible: true,
      setVisible: (visible) => set({ visible }),
      add: (m) => {
        const marker = newMarker(m);
        set((s) => ({ markers: [...s.markers, marker] }));
        return marker.id;
      },
      update: (id, patch) => set((s) => ({ markers: s.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      remove: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),
      duplicate: (id) => {
        let copyId: string | null = null;
        set((s) => {
          const i = s.markers.findIndex((m) => m.id === id);
          if (i < 0) return s;
          // A BCF topic's marker belongs to its topic: the copy is an ordinary marker.
          const { id: _id, topicId: _topic, ...rest } = s.markers[i];
          const copy = newMarker({ ...rest, name: `${rest.name || 'Marker'} (copy)` });
          copyId = copy.id;
          return { markers: [...s.markers.slice(0, i + 1), copy, ...s.markers.slice(i + 1)] };
        });
        return copyId;
      },
      setAllHidden: (hidden) => set((s) => ({ markers: s.markers.map((m) => (!!m.hidden === hidden ? m : { ...m, hidden })) })),
      setAll: (markers) => set({ markers }),
      clear: () => set({ markers: [] }),
    }),
    { name: 'viewer.markers' },
  ),
);
