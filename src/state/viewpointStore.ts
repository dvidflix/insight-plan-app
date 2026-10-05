import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type * as OBC from '@thatopen/components';

/** The saved viewpoints, kept with the app configuration ("viewer." key) so they survive a reload.
    Each is filed against the models that were loaded when it was taken: it shows again when
    those are loaded, and is left out while they are not. */
export interface ViewpointRecord {
  guid: string;
  /** The library's BCF form of the viewpoint (camera, hidden and selected objects). */
  bcf: OBC.BCFViewpoint;
  /** Our own data (attributes, style, display, folder, ...). */
  data: Record<string, unknown>;
  /** Names of the models loaded when it was taken. */
  models: string[];
  /** The thumbnail, base64. */
  snapshot?: string;
}

interface ViewpointsState {
  records: ViewpointRecord[];
  upsert: (r: ViewpointRecord) => void;
  remove: (guid: string) => void;
}

export const useViewpointStore = create<ViewpointsState>()(
  persist(
    (set) => ({
      records: [],
      upsert: (r) => set((s) => ({ records: s.records.some((x) => x.guid === r.guid) ? s.records.map((x) => (x.guid === r.guid ? r : x)) : [...s.records, r] })),
      remove: (guid) => set((s) => ({ records: s.records.filter((x) => x.guid !== guid) })),
    }),
    { name: 'viewer.viewpoints' },
  ),
);
