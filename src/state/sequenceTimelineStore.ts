import { create } from 'zustand';

export type HourUnit = '1h' | '2h' | '3h' | '4h' | '6h' | '8h' | '12h';
export type StepUnit = HourUnit | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Hours in an hour-based step unit, or null for day and coarser. */
export function stepHours(unit: StepUnit): number | null {
  return unit.endsWith('h') ? Number(unit.slice(0, -1)) : null;
}

export const STEP_UNIT_LABELS: { value: StepUnit; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '2h', label: '2 hours' },
  { value: '3h', label: '3 hours' },
  { value: '4h', label: '4 hours' },
  { value: '6h', label: '6 hours' },
  { value: '8h', label: '8 hours' },
  { value: '12h', label: '12 hours' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
];

/** Days the playback steps over. 'custom': the weekdays picked (JS getDay: 0 = Sunday); 'nonworking': the programme's
    own calendar. Sunday by default. */
export type SkipMode = 'none' | 'nonworking' | 'custom';
export interface SkipSettings {
  mode: SkipMode;
  days: number[];
}
const SKIP_KEY = 'sequence.skipDays';
const DEFAULT_SKIP: SkipSettings = { mode: 'custom', days: [0] };
function loadSkip(): SkipSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) ?? 'null') as Partial<SkipSettings> | null;
    if (v && (v.mode === 'none' || v.mode === 'nonworking' || v.mode === 'custom') && Array.isArray(v.days)) return { mode: v.mode, days: v.days.filter((d) => d >= 0 && d <= 6) };
  } catch {
    // unreadable: the default
  }
  return DEFAULT_SKIP;
}

interface SequenceTimelineState {
  date: number | null;
  playing: boolean;
  /** Playback granularity — matches the reference Blender pipeline's
      Speed Settings unit (bake_speed_unit: Day/Week/Month/Year, here also
      Quarter): each Play tick jumps the cursor to the NEXT calendar
      boundary of this unit (next Monday / 1st of next month / etc.)
      instead of advancing continuously, so every activity whose window
      falls inside that period updates together on the same tick — the
      "group the activities" behavior at coarser granularities. */
  stepUnit: StepUnit;
  basis: 'planned' | 'actual';
  /** Days stepped over by the playback and the step buttons. */
  skip: SkipSettings;
  /** The date the 4D driver last finished applying to the views. */
  appliedDate: number | null;
  setDate: (d: number | ((prev: number | null) => number)) => void;
  setPlaying: (p: boolean | ((prev: boolean) => boolean)) => void;
  setStepUnit: (u: StepUnit) => void;
  setBasis: (b: 'planned' | 'actual') => void;
  setSkip: (s: SkipSettings) => void;
}

/** 4D playback cursor — shared between the Sequencing side panel (which
    drives the viewer off it) and the floating timeline overlay docked to
    the 3D viewport (which the side panel can be collapsed without losing). */
export const useSequenceTimelineStore = create<SequenceTimelineState>((set) => ({
  date: null,
  playing: false,
  stepUnit: 'day',
  basis: 'planned',
  skip: loadSkip(),
  appliedDate: null,
  setDate: (d) => set((s) => ({ date: typeof d === 'function' ? d(s.date) : d })),
  setPlaying: (p) => set((s) => ({ playing: typeof p === 'function' ? p(s.playing) : p })),
  setStepUnit: (stepUnit) => set({ stepUnit }),
  setBasis: (basis) => set({ basis }),
  setSkip: (skip) => {
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify(skip));
    } catch {
      // not saved: lasts until reload
    }
    set({ skip });
  },
}));
