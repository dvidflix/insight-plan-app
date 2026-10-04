import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_REALISM, type RealismSettings } from '../viewer/realism';

export type ViewStyle = 'COLOR_PEN' | 'COLOR_PEN_SHADOWS';
export type Projection = 'Perspective' | 'Orthographic';

/** How one 3D view looks — every 3D view (the main one, and the second one
    of a split) has its own copy. */
export interface ViewSettings {
  projection: Projection;
  style: ViewStyle;
  antiAliasing: boolean;
  edgeLines: boolean;
  ambientOcclusion: boolean;
  edgeWidth: number;
  background: string;
  /** Reference grid and floor plane. */
  grid: boolean;
  /** Storey slide per model name: metres each storey is lifted above the one below. */
  storeySlides: Record<string, number>;
  /** Realistic look: fixed sun and shadows (main view). */
  realistic?: boolean;
  /** Concrete colour and texture (main view). Unset follows `realistic`,
      which used to switch both. */
  concrete?: boolean;
  /** A real-time sky behind the models, from the sun's bearing and height (needs Sun & shadows). */
  sky?: boolean;
  /** Material classes (brick, glass, timber...) matched from the models' names. */
  materials?: boolean;
  /** Model names this view leaves out, e.g. one project per side of the
      compare slider. Unset shows every model. */
  hiddenModels?: string[];
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  projection: 'Perspective',
  style: 'COLOR_PEN_SHADOWS',
  antiAliasing: true,
  edgeLines: true,
  ambientOcclusion: true,
  edgeWidth: 1.2,
  background: '#ffffff',
  grid: true,
  storeySlides: {},
};

export type ViewKey = 'main' | 'second';

/** The pages that show the 3D viewer. Each keeps its own view setup, so the
    Models page and 4D Sequencing never change each other's views. */
export type ViewPage = 'model' | 'sequence';

/** How a split page shows its two views: next to each other, or stacked
    with a draggable divider revealing the left view on one side and the
    right view on the other (a before/after slider). */
export type CompareMode = 'side' | 'slider';

export interface PageViews {
  /** Two views side by side. */
  split: boolean;
  /** Side by side (default) or the compare slider. */
  compare?: CompareMode;
  /** Compare slider divider position, as a fraction of the view width. */
  sliderPos?: number;
  /** Orbit/zoom both views together. */
  linked: boolean;
  /** The navigation cube in the corner of each view. */
  showCube: boolean;
  /** The north arrow under the cube in each view (unset = shown). */
  showNorth?: boolean;
  /** North arrow override: degrees clockwise from project north (e.g. the
      site's true north). Unset = 0. */
  northRotation?: number;
  main: ViewSettings;
  second: ViewSettings;
}

/** Seeds both pages from what was saved before settings were per page (the
    shared view settings and the 4D page's split/link/cube switches). */
function legacyPage(): PageViews {
  const read = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null')?.state ?? null;
    } catch {
      return null;
    }
  };
  const views = read('viewer.viewSettings');
  const modes = read('sequence.colorModes');
  // Storey slides used to be one setting for every view (4D Models tab).
  const storeySlides = read('sequence.modelPlacement')?.slides ?? {};
  return {
    split: modes?.split ?? false,
    linked: modes?.linked ?? true,
    showCube: modes?.showCube ?? true,
    main: { ...DEFAULT_VIEW_SETTINGS, ...(views?.main ?? {}), storeySlides },
    second: { ...DEFAULT_VIEW_SETTINGS, ...(views?.second ?? {}), storeySlides },
  };
}

export const pageOfLayout = (layout: string): ViewPage => (layout.startsWith('model') ? 'model' : 'sequence');

/** Layouts that show the second view (side by side, or the compare slider). */
export const isTwoViewLayout = (layout: string) => layout.endsWith('Split') || layout.endsWith('Slider');

interface ViewSettingsState {
  pages: Record<ViewPage, PageViews>;
  /** The page the viewer is on now (set by ViewerCanvas). */
  activePage: ViewPage;
  /** Site location, sun hour and concrete strength for the realistic look. */
  realism: RealismSettings;
  setRealism: (p: Partial<RealismSettings>) => void;
  patch: (page: ViewPage, view: ViewKey, p: Partial<ViewSettings>) => void;
  patchPage: (page: ViewPage, p: Partial<Omit<PageViews, 'main' | 'second'>>) => void;
}

export const useViewSettingsStore = create<ViewSettingsState>()(
  persist(
    (set) => ({
      pages: { model: legacyPage(), sequence: legacyPage() },
      activePage: 'model',
      realism: { ...DEFAULT_REALISM },
      setRealism: (p) => set((s) => ({ realism: { ...s.realism, ...p } })),
      patch: (page, view, p) =>
        set((s) => ({ pages: { ...s.pages, [page]: { ...s.pages[page], [view]: { ...s.pages[page][view], ...p } } } })),
      patchPage: (page, p) => set((s) => ({ pages: { ...s.pages, [page]: { ...s.pages[page], ...p } } })),
    }),
    {
      name: 'viewer.pageViews',
      // Settings saved before storey slides were per view lack the field.
      merge: (persisted, current) => {
        const p = persisted as Partial<ViewSettingsState> | undefined;
        if (!p?.pages) return current;
        const fix = (v: ViewSettings): ViewSettings => ({ ...DEFAULT_VIEW_SETTINGS, ...v, storeySlides: v.storeySlides ?? current.pages.model.main.storeySlides });
        const pages = Object.fromEntries(
          (Object.keys(current.pages) as ViewPage[]).map((k) => {
            const pv = p.pages?.[k] ?? current.pages[k];
            return [k, { ...pv, main: fix(pv.main), second: fix(pv.second) }];
          }),
        ) as Record<ViewPage, PageViews>;
        return { ...current, pages, realism: { ...DEFAULT_REALISM, ...(p.realism ?? {}) } };
      },
    },
  ),
);
