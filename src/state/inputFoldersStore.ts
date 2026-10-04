import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Folders on the Inputs page: a tidy-up of the lists only (nothing moves on disk).
    A model, programme or site mesh goes in a folder by its name, so a stored
    model and the same model loaded share one folder. Saved with the project
    (the "models." settings go into the project database). */
interface InputFoldersState {
  folders: string[];
  /** item name -> folder name (absent = no folder). */
  assign: Record<string, string>;
  collapsed: string[];
  /** Returns false when the name is empty or taken. */
  addFolder: (name: string) => boolean;
  renameFolder: (from: string, to: string) => boolean;
  /** The items in it go back to "No folder". */
  removeFolder: (name: string) => void;
  moveItem: (item: string, folder: string | null) => void;
  toggleCollapsed: (name: string) => void;
}

export const NO_FOLDER = '';

export const useInputFoldersStore = create<InputFoldersState>()(
  persist(
    (set, get) => ({
      folders: [],
      assign: {},
      collapsed: [],
      addFolder: (name) => {
        const n = name.trim();
        if (!n || get().folders.some((f) => f.toLowerCase() === n.toLowerCase())) return false;
        set((s) => ({ folders: [...s.folders, n] }));
        return true;
      },
      renameFolder: (from, to) => {
        const n = to.trim();
        if (!n) return false;
        if (n !== from && get().folders.some((f) => f.toLowerCase() === n.toLowerCase())) return false;
        set((s) => ({
          folders: s.folders.map((f) => (f === from ? n : f)),
          assign: Object.fromEntries(Object.entries(s.assign).map(([k, v]) => [k, v === from ? n : v])),
          collapsed: s.collapsed.map((f) => (f === from ? n : f)),
        }));
        return true;
      },
      removeFolder: (name) =>
        set((s) => ({
          folders: s.folders.filter((f) => f !== name),
          assign: Object.fromEntries(Object.entries(s.assign).filter(([, v]) => v !== name)),
          collapsed: s.collapsed.filter((f) => f !== name),
        })),
      moveItem: (item, folder) =>
        set((s) => {
          const assign = { ...s.assign };
          if (folder) assign[item] = folder;
          else delete assign[item];
          return { assign };
        }),
      toggleCollapsed: (name) => set((s) => ({ collapsed: s.collapsed.includes(name) ? s.collapsed.filter((f) => f !== name) : [...s.collapsed, name] })),
    }),
    { name: 'models.inputFolders' },
  ),
);

export interface FolderSection<T> {
  /** NO_FOLDER for the items in none. */
  folder: string;
  items: T[];
}

/** The items by folder (every folder, even empty ones, so they can be dropped
    into), then those in no folder. With no folders at all: one plain section. */
export function sectionsOf<T>(items: T[], nameOf: (item: T) => string, folders: string[], assign: Record<string, string>): FolderSection<T>[] {
  if (folders.length === 0) return [{ folder: NO_FOLDER, items }];
  const sections: FolderSection<T>[] = folders.map((folder) => ({ folder, items: [] }));
  const none: FolderSection<T> = { folder: NO_FOLDER, items: [] };
  for (const item of items) {
    const f = assign[nameOf(item)];
    (sections.find((s) => s.folder === f) ?? none).items.push(item);
  }
  return [...sections, none];
}
