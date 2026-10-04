import { create } from 'zustand';

/** How the 4D timeline bar looks and plays (Settings › 4D timeline). Kept as
    one JSON value under "sequence.timeline", so the app configuration file
    carries it. */
const KEY = 'sequence.timeline';

export interface TimelineSettings {
  /** 1 = the whole programme fits the bar; higher = zoomed in, the bar scrolls sideways. */
  zoom: number;
  /** While stepping / playing, scroll the zoomed bar so the date stays in view. */
  followPlayhead: boolean;
  /** Real time between Play steps, in ms. */
  stepIntervalMs: number;
  showMonths: boolean;
  monthLabels: 'names' | 'initials';
  showYears: boolean;
  /** Weekly stepping only: a tick per week. */
  showWeekTicks: boolean;
  /** The shaded band from the start to the current date. */
  showProgress: boolean;
  /** A line at the current date. */
  showPlayhead: boolean;
  /** Ctrl + mouse wheel over the bar zooms it. */
  wheelZoom: boolean;
}

export const DEFAULT_TIMELINE: TimelineSettings = {
  zoom: 1,
  followPlayhead: true,
  stepIntervalMs: 550,
  showMonths: true,
  monthLabels: 'names',
  showYears: true,
  showWeekTicks: true,
  showProgress: true,
  showPlayhead: true,
  wheelZoom: true,
};

export const MAX_TIMELINE_ZOOM = 30;

function load(): TimelineSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_TIMELINE, ...(JSON.parse(raw) as Partial<TimelineSettings>) } : DEFAULT_TIMELINE;
  } catch {
    return DEFAULT_TIMELINE;
  }
}

interface State extends TimelineSettings {
  patch: (p: Partial<TimelineSettings>) => void;
  reset: () => void;
}

const save = (s: TimelineSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not remembered
  }
};
const pick = (s: State): TimelineSettings => ({
  zoom: s.zoom, followPlayhead: s.followPlayhead, stepIntervalMs: s.stepIntervalMs, showMonths: s.showMonths, monthLabels: s.monthLabels,
  showYears: s.showYears, showWeekTicks: s.showWeekTicks, showProgress: s.showProgress, showPlayhead: s.showPlayhead, wheelZoom: s.wheelZoom,
});

export const useTimelineSettingsStore = create<State>((set, get) => ({
  ...load(),
  patch: (p) => {
    set(p);
    save(pick(get()));
  },
  reset: () => {
    set(DEFAULT_TIMELINE);
    save(DEFAULT_TIMELINE);
  },
}));
