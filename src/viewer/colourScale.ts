/** Grading: colour the models by a number along a colour scale (like Excel's colour scales). Pure, so it can be tested. */

export interface ScaleStop {
  /** Where on the scale, 0 (lowest) to 1 (highest). */
  at: number;
  color: string;
}

export interface ColourScale {
  stops: ScaleStop[];
  /** Fixed ends of the scale; null takes the lowest / highest number found. */
  min: number | null;
  max: number | null;
}

export const SCALE_PRESETS: { id: string; label: string; stops: ScaleStop[] }[] = [
  { id: 'gyr', label: 'Green – Yellow – Red', stops: [{ at: 0, color: '#63be7b' }, { at: 0.5, color: '#ffeb84' }, { at: 1, color: '#f8696b' }] },
  { id: 'ryg', label: 'Red – Yellow – Green', stops: [{ at: 0, color: '#f8696b' }, { at: 0.5, color: '#ffeb84' }, { at: 1, color: '#63be7b' }] },
  { id: 'gwr', label: 'Green – White – Red', stops: [{ at: 0, color: '#63be7b' }, { at: 0.5, color: '#ffffff' }, { at: 1, color: '#f8696b' }] },
  { id: 'bwr', label: 'Blue – White – Red', stops: [{ at: 0, color: '#5a8ac6' }, { at: 0.5, color: '#ffffff' }, { at: 1, color: '#f8696b' }] },
  { id: 'wg', label: 'White – Green', stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#63be7b' }] },
  { id: 'wr', label: 'White – Red', stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#f8696b' }] },
  { id: 'wb', label: 'White – Blue', stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#5a8ac6' }] },
  { id: 'ybr', label: 'Yellow – Orange – Red', stops: [{ at: 0, color: '#ffeb84' }, { at: 0.5, color: '#fd9a4a' }, { at: 1, color: '#d7301f' }] },
];

export const DEFAULT_SCALE: ColourScale = { stops: SCALE_PRESETS[0].stops, min: null, max: null };

/** The number a property value stands for ("1,250.5", "12 m", "-3"); null when it is not a number. */
export function parseNumber(value: string): number | null {
  const m = /^\s*([-+]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i.exec(value);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const hex = (c: string): [number, number, number] => {
  const h = /^#?([0-9a-f]{6})$/i.exec(c)?.[1] ?? '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** The colour at `t` (0..1) along the stops, blended between the two around it. */
export function colourAt(stops: ScaleStop[], t: number): string {
  const s = [...stops].sort((a, b) => a.at - b.at);
  if (s.length === 0) return '#808080';
  if (t <= s[0].at) return s[0].color;
  const last = s[s.length - 1];
  if (t >= last.at) return last.color;
  for (let i = 1; i < s.length; i++) {
    if (t > s[i].at) continue;
    const a = s[i - 1];
    const b = s[i];
    const f = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
    const ca = hex(a.color);
    const cb = hex(b.color);
    return toHex(ca.map((v, k) => v + (cb[k] - v) * f));
  }
  return last.color;
}

/** The lowest and highest number among the values (null when none is a number). */
export function numericRange(values: Iterable<string>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const n = parseNumber(v);
    if (n === null) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return min <= max ? { min, max } : null;
}

/** The ends the scale runs between: its fixed ends, else the numbers found. */
export function scaleRange(scale: ColourScale, values: Iterable<string>): { min: number; max: number } | null {
  const found = scale.min !== null && scale.max !== null ? null : numericRange(values);
  const min = scale.min ?? found?.min;
  const max = scale.max ?? found?.max;
  return min === undefined || max === undefined ? null : { min, max };
}

/** A function giving each value its colour on the scale; null for values that are not numbers. */
export function gradeColorOf(scale: ColourScale, values: Iterable<string>): (value: string) => string | null {
  const range = scaleRange(scale, values);
  const cache = new Map<string, string | null>();
  return (value) => {
    const hit = cache.get(value);
    if (hit !== undefined) return hit;
    const n = range ? parseNumber(value) : null;
    const out = n === null || !range ? null : colourAt(scale.stops, range.max === range.min ? 0 : Math.min(1, Math.max(0, (n - range.min) / (range.max - range.min))));
    cache.set(value, out);
    return out;
  };
}

/** CSS for a preview bar of the scale. */
export function scaleCss(stops: ScaleStop[]): string {
  const s = [...stops].sort((a, b) => a.at - b.at);
  return `linear-gradient(to right, ${s.map((x) => `${x.color} ${Math.round(x.at * 100)}%`).join(', ')})`;
}
