import { create } from 'zustand';
import type { RememberedFolder } from './client';

/** The browser edition's project folder, as the screens need to show it: the one remembered from last time (it may need a
    click to allow it again). */
interface WebFolderState {
  remembered: RememberedFolder | null;
}

export const useWebFolderStore = create<WebFolderState>(() => ({ remembered: null }));
