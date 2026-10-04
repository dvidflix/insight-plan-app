/** One stage of an appearance profile: `color` null means "use the object's
    original color", `opacity` null means "use the object's original opacity". */
export interface AppearanceStage {
  color: string | null;
  opacity: number | null;
}

export type AppearanceAction = 'install' | 'remove' | 'maintain';

/** Growth simulation, as insight-plan's Blender bake does it:
    - 'drop': appears `distance` above and eases down into place (precast, steel)
    - 'slideIn': appears `distance` further from the site origin and slides in
    - 'bottomToTop': rises from its base across the task's duration (backfill)
    - 'liftUp' / 'slideAway': a removed object lifts / slides away as it goes. */
export type GrowthIn = 'none' | 'drop' | 'slideIn' | 'bottomToTop';
export type GrowthOut = 'none' | 'liftUp' | 'slideAway';

export const GROWTH_IN: { value: GrowthIn; label: string }[] = [
  { value: 'none', label: 'None — just appears' },
  { value: 'drop', label: 'Reveal and drop (e.g. precast lifted in)' },
  { value: 'slideIn', label: 'Reveal and slide in towards origin' },
  { value: 'bottomToTop', label: 'Bottom to top, over the task (e.g. backfill)' },
];

export const GROWTH_OUT: { value: GrowthOut; label: string }[] = [
  { value: 'none', label: 'None — just disappears' },
  { value: 'liftUp', label: 'Lift up and hide' },
  { value: 'slideAway', label: 'Slide away from origin and hide' },
];

export const DEFAULT_GROWTH_DISTANCE = 5;

export interface AppearanceProfile {
  id: string;
  name: string;
  /** 'install': hidden before start, visible after finish (endColor).
      'remove': visible before start (startColor), hidden after finish.
      'maintain': always visible, startColor before, endColor after. */
  action: AppearanceAction;
  startColor: AppearanceStage;
  activeStart: AppearanceStage;
  activeFinish: AppearanceStage;
  endColor: AppearanceStage;
  /** How it arrives (install / maintain) — optional, older profiles have none. */
  growthIn?: GrowthIn;
  /** How it leaves (remove). */
  growthOut?: GrowthOut;
  /** Metres for drop / slide / lift. */
  growthDistance?: number;
  /** Hours before the task's finish over which the drop / slide / lift
      plays (the object waits at its start position until then); blank =
      the whole task. Bottom to top always spans the whole task. */
  growthHours?: number | null;
}

export function newAppearanceId(): string {
  return crypto.randomUUID();
}

export function emptyAppearanceStage(): AppearanceStage {
  return { color: null, opacity: null };
}

export function emptyAppearanceProfile(name = 'New Profile'): AppearanceProfile {
  return {
    id: newAppearanceId(),
    name,
    action: 'install',
    startColor: emptyAppearanceStage(),
    activeStart: emptyAppearanceStage(),
    activeFinish: emptyAppearanceStage(),
    endColor: emptyAppearanceStage(),
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear-interpolates two stages by `t` (0..1). A stage with a null color/
    opacity on either side just snaps to the non-null side (no fade to/from
    "original" — that would require knowing the object's own color). */
export function lerpStage(a: AppearanceStage, b: AppearanceStage, t: number): AppearanceStage {
  let color = a.color ?? b.color;
  if (a.color && b.color) {
    const ca = hexToRgb(a.color);
    const cb = hexToRgb(b.color);
    if (ca && cb) color = rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
  } else if (t >= 1) {
    color = b.color ?? a.color;
  }
  let opacity = a.opacity ?? b.opacity;
  if (a.opacity !== null && b.opacity !== null) opacity = a.opacity + (b.opacity - a.opacity) * t;
  else if (t >= 1) opacity = b.opacity ?? a.opacity;
  return { color, opacity };
}
