import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Row height as a percentage of the normal one (100): the Gantt, the Planner, the data table and the activity table follow it. */
export const ROW_SCALE_MIN = 60;
export const ROW_SCALE_MAX = 200;
export const ROW_SCALE_NORMAL = 100;
export const clampRowScale = (v: number) => Math.min(ROW_SCALE_MAX, Math.max(ROW_SCALE_MIN, Math.round(Number.isFinite(v) ? v : ROW_SCALE_NORMAL)));

interface TableStyleState {
  /** Let long column headers wrap onto several lines instead of being cut off. */
  wrapHeaders: boolean;
  setWrapHeaders: (v: boolean) => void;
  /** The mouse wheel scrolls tables with a glide: it speeds up as the wheel turns and slows to a stop, like a hand on a tablet. */
  smoothScroll: boolean;
  setSmoothScroll: (v: boolean) => void;
  /** How many times further the wheel scrolls while Ctrl is held: 2, 3 or 4. */
  ctrlScrollFactor: number;
  setCtrlScrollFactor: (v: number) => void;
  /** Row height, % of normal. */
  rowScale: number;
  setRowScale: (v: number) => void;
}

export const useTableStyleStore = create<TableStyleState>()(
  persist(
    (set) => ({
      wrapHeaders: false,
      setWrapHeaders: (wrapHeaders) => set({ wrapHeaders }),
      smoothScroll: false,
      setSmoothScroll: (smoothScroll) => set({ smoothScroll }),
      ctrlScrollFactor: 2,
      setCtrlScrollFactor: (v) => set({ ctrlScrollFactor: Math.min(4, Math.max(2, Math.round(v) || 2)) }),
      rowScale: ROW_SCALE_NORMAL,
      setRowScale: (v) => set({ rowScale: clampRowScale(v) }),
    }),
    { name: 'tables.style' },
  ),
);

/** The row height of a table whose rows are a fixed number of pixels (`base` at 100 %). */
export const useRowPx = (base: number) => Math.round((base * useTableStyleStore((s) => s.rowScale)) / 100);

// The tables made of HTML rows take their height from the padding of their cells.
const applyRowPad = (scale: number) => {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--row-pad', `${Math.round(((5 * scale) / 100) * 10) / 10}px`);
};
applyRowPad(useTableStyleStore.getState().rowScale);
useTableStyleStore.subscribe((s) => applyRowPad(s.rowScale));
