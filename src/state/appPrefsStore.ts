import { create } from 'zustand';

/** App-wide display preferences that several components react to at once
    (Settings changes them, the app shell reads them). Stored under
    "viewer." keys, so the app configuration file carries them. */
const SCENARIOS_TAB_KEY = 'viewer.showScenariosTab';
const TIMELINES_TAB_KEY = 'viewer.showTimelinesTab';
const WIKI_TAB_KEY = 'viewer.showWikiTab';
const HELP_TAB_KEY = 'viewer.showHelpTab';
const EXTERNAL_TAB_KEY = 'viewer.showExternalTab';
const DASHBOARDS_TAB_KEY = 'viewer.showDashboardsTab';

/** Features still being tried out: hidden until switched on in
    Settings › Experimental features. */
import { FEATURES } from '../features';

export const EXPERIMENTAL_FEATURES = [
  { id: 'scenarios', label: 'Scenarios (pour-by-pour programme generator)', tip: 'The Scenarios generator: the Scenarios tab, the Scenarios panel in 4D Sequencing and the Generated schedules tab in Programmes. For planners who generate programmes from the model; needs the Python generator.' },
  { id: 'classicGenerate', label: 'Classic Generate (eight tabs)', tip: 'The old Generate page with its eight tabs (recipes, crews, parameters, rules…), beside Generate. Rarely needed: Generate does everything a planner needs. Needs Scenarios on.' },
  { id: 'whyShown', label: 'Why is it shown?', tip: '4D tab: lists the tasks that link to the selected object and which one controls it.' },
  { id: 'taskFields', label: 'Task fields from search sets', tip: '4D tab: writes a task field from the search sets the tasks\' objects belong to.' },
  { id: 'navisworks', label: 'Navisworks TimeLiner export', tip: 'Views tab: exports search sets + a TimeLiner CSV for Navisworks.' },
  { id: 'sectionCuts', label: 'Section cuts', tip: 'Views tab: styled section cuts.' },
  { id: 'scheduleExplorer', label: 'Programmes: Schedule Explorer', tip: 'Programmes › Views: the Schedule Explorer (table, Gantt and panels together).' },
  { id: 'networkView', label: 'Programmes: Network View', tip: 'Programmes › Views: the activity network diagram.' },
  { id: 'ppcView', label: 'Programmes: PPC (Plan Complete)', tip: 'Programmes › Views: percent plan complete by week.' },
  { id: 'monteCarlo', label: 'Programmes: Risk (Monte Carlo)', tip: 'Programmes › Views: the chance of finishing by a date, from a Monte Carlo run.' },
  { id: 'anonymise', label: 'Programmes: Anonymise', tip: 'Programmes › Views: replace names and codes so a programme can be shared.' },
  { id: 'whatIf', label: 'Programmes: What-If Scenarios', tip: 'Programmes › Views: try changes to the programme and see their effect.' },
  { id: 'seatableFiles', label: 'SeaTable: file details', tip: 'Inputs page: the file details (discipline, building, status ...) are read from and written to the Insight Plan Files table of SeaTable, and files are pushed to it. Needs the SeaTable Docker stack. Off: the details you type stay in the app.' },
  { id: 'seatableModel', label: 'SeaTable: model data', tip: 'Settings > Inputs: push the elements of the model to SeaTable and pull custom fields back onto the elements, also automatically when a model loads. Needs the SeaTable Docker stack.' },
  { id: 'bcf', label: 'BCF topics', tip: 'Models page: the Topics tab, to create BCF topics and comments and to import / export BCF files.' },
] as const;
export type ExperimentalId = (typeof EXPERIMENTAL_FEATURES)[number]['id'];

const experimentalKey = (id: ExperimentalId) => `viewer.experimental.${id}`;
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
};
/** A flag that is on unless it was switched off. */
const readFlagOn = (key: string) => {
  try {
    return localStorage.getItem(key) !== 'false';
  } catch {
    return true;
  }
};
const writeFlag =(key: string, v: boolean) => {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // not remembered
  }
};

interface AppPrefs {
  /** The top bar's Scenarios page tab — off by default: Scenarios also
      lives in 4D Sequencing (its Scenarios panel). */
  showScenariosTab: boolean;
  setShowScenariosTab: (v: boolean) => void;
  /** The top bar's Timelines and Wiki tabs — on by default. */
  showTimelinesTab: boolean;
  setShowTimelinesTab: (v: boolean) => void;
  showWikiTab: boolean;
  showHelpTab: boolean;
  setShowHelpTab: (v: boolean) => void;
  showExternalTab: boolean;
  setShowExternalTab: (v: boolean) => void;
  showDashboardsTab: boolean;
  setShowDashboardsTab: (v: boolean) => void;
  setShowWikiTab: (v: boolean) => void;
  /** Experimental features that are switched on (all off by default). */
  experimental: Record<ExperimentalId, boolean>;
  setExperimental: (id: ExperimentalId, v: boolean) => void;
}

export const useAppPrefsStore = create<AppPrefs>((set) => ({
  showScenariosTab: readFlag(SCENARIOS_TAB_KEY),
  setShowScenariosTab: (v) => {
    writeFlag(SCENARIOS_TAB_KEY, v);
    set({ showScenariosTab: v });
  },
  showTimelinesTab: readFlagOn(TIMELINES_TAB_KEY),
  setShowTimelinesTab: (v) => {
    writeFlag(TIMELINES_TAB_KEY, v);
    set({ showTimelinesTab: v });
  },
  showWikiTab: readFlagOn(WIKI_TAB_KEY),
  showHelpTab: readFlagOn(HELP_TAB_KEY),
  setShowHelpTab: (v) => {
    writeFlag(HELP_TAB_KEY, v);
    set({ showHelpTab: v });
  },
  showExternalTab: readFlagOn(EXTERNAL_TAB_KEY),
  setShowExternalTab: (v) => {
    writeFlag(EXTERNAL_TAB_KEY, v);
    set({ showExternalTab: v });
  },
  showDashboardsTab: readFlagOn(DASHBOARDS_TAB_KEY),
  setShowDashboardsTab: (v) => {
    writeFlag(DASHBOARDS_TAB_KEY, v);
    set({ showDashboardsTab: v });
  },
  setShowWikiTab: (v) => {
    writeFlag(WIKI_TAB_KEY, v);
    set({ showWikiTab: v });
  },
  experimental: Object.fromEntries(EXPERIMENTAL_FEATURES.map((f) => [f.id, readFlag(experimentalKey(f.id)) && (f.id !== 'scenarios' || FEATURES.scenarios)])) as Record<ExperimentalId, boolean>,
  setExperimental: (id, v) => {
    writeFlag(experimentalKey(id), v);
    set((s) => ({ experimental: { ...s.experimental, [id]: v } }));
  },
}));

/** Whether an experimental feature is switched on (for code outside components). */
export const experimentalOn = (id: ExperimentalId): boolean => useAppPrefsStore.getState().experimental[id];

/** Whether an experimental feature is switched on. */
export const useExperimental = (id: ExperimentalId) => useAppPrefsStore((s) => s.experimental[id]);
