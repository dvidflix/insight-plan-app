import type { ScheduleModel } from '../schedule/types';
import { elementIdField } from '../schedule/activityObjects';
import { taskFieldValue } from '../schedule/linkGroups';
import type { PourRow } from './pourOrder';

/** Suggested groups of walls that start together (one step in the order table), sized by the rebar rate:
    walls are added, in the order they are in, until their rebar adds up to the target tonnes per day of their level.
    A wall's own rate is its Rebar activity's tonnes divided by its days, from the programme generated for the scenario. */

/** Target rebar tonnes per day: the walls' rate, and the rate of each level where there is one. */
export interface RebarTargets {
  wall: number;
  byLevel: Record<string, number>;
}

/** The achieved ("actual") rebar t/day of the project's dashboard: walls overall, and by level. */
export const DEFAULT_TARGETS: RebarTargets = {
  wall: 0.4825,
  byLevel: { L1: 0.1174, 'L1 & 2': 2.79, L2: 0.3388, L3: 0.7058, L4: 0.788, L5: 0.8159, L6: 0.5583, L7: 0.521, L8: 0.5091 },
};

/** A level as the targets name it: "L02", "Level 2" and "L2" are L2; two numbers ("L1 + L02", "L1 & 2") are "L1 & 2". */
export function levelKey(text: string): string {
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return '';
  return nums.length >= 2 ? `L${nums[0]} & ${nums[1]}` : `L${nums[0]}`;
}

export const targetFor = (targets: RebarTargets, level: string): number => targets.byLevel[levelKey(level)] ?? targets.wall;

const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, '');

/** The Rebar activity of a pour (the generator names it "… - Rebar", its ID ends in -R). */
const isRebarActivity = (a: { name: string; code: string }) => /(^|[-\s])rebar\s*$/i.test(a.name.trim()) || /-R$/i.test(a.code.trim());

/** Rebar tonnes and days of every pour of a generated programme, by its normalised pour (element) ID. */
export function rebarByPour(schedule: ScheduleModel): Map<string, { tonnes: number; days: number }> {
  const out = new Map<string, { tonnes: number; days: number }>();
  const field = elementIdField(schedule);
  if (!field) return out;
  for (const a of schedule.activities) {
    if (!isRebarActivity(a)) continue;
    const id = norm(taskFieldValue(a, field));
    if (!id) continue;
    const tonnes = a.resources.filter((r) => /rebar/i.test(r.resourceName)).reduce((n, r) => n + (r.targetQty || 0), 0);
    const days = a.durationHours / 8;
    const cur = out.get(id) ?? { tonnes: 0, days: 0 };
    out.set(id, { tonnes: cur.tonnes + tonnes, days: cur.days + days });
  }
  return out;
}

export interface WallInfo {
  key: string;
  /** The pour ID, to name it. */
  label: string;
  level: string;
  tonnes: number;
  days: number;
  /** Rebar tonnes per day of this wall on its own. */
  rate: number;
}

/** The walls the table can group, in the order they are in: sequenced, alone in their step (not grouped yet), with a rebar
    rate in the programme. `skipped` counts the walls left out for lacking a rate. */
export function wallsToGroup(rows: PourRow[], headers: string[], rebar: Map<string, { tonnes: number; days: number }>): { walls: WallInfo[]; skipped: number } {
  const col = (name: string) => headers.indexOf(name);
  const typeCol = col('Pour Type');
  const levelCol = col('Level');
  const idCols = ['PlanningProposedPourID', 'Pour ID'].map(col).filter((i) => i >= 0);
  const perStep = new Map<number, number>();
  for (const r of rows) if (r.step !== null) perStep.set(r.step, (perStep.get(r.step) ?? 0) + 1);
  const walls: WallInfo[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.step === null || perStep.get(r.step) !== 1) continue;
    if (typeCol < 0 || !/wall/i.test(r.cells[typeCol] ?? '')) continue;
    let hit: { tonnes: number; days: number } | undefined;
    let label = '';
    for (const c of idCols) {
      label = (r.cells[c] ?? '').trim();
      hit = rebar.get(norm(label));
      if (hit) break;
    }
    if (!hit || hit.tonnes <= 0 || hit.days <= 0) {
      skipped++;
      continue;
    }
    walls.push({ key: r.key, label, level: levelCol >= 0 ? r.cells[levelCol] ?? '' : '', tonnes: hit.tonnes, days: hit.days, rate: hit.tonnes / hit.days });
  }
  return { walls, skipped };
}

export interface GroupSuggestion {
  id: string;
  members: WallInfo[];
  /** The target t/day (that of the group's first wall's level) and what the group's rebar adds up to. */
  target: number;
  rate: number;
}

/** Groups of two or more walls whose rebar rates add up to about their level's target: walls are added in order until the
    sum reaches the target, then the last one is left out when that gets closer. A lone wall is not a group. */
export function suggestGroups(walls: WallInfo[], targets: RebarTargets): GroupSuggestion[] {
  const out: GroupSuggestion[] = [];
  let group: WallInfo[] = [];
  let sum = 0;
  let target = 0;
  const flush = () => {
    if (group.length >= 2) out.push({ id: `g${out.length + 1}-${group[0].key}`, members: group, target, rate: sum });
    group = [];
    sum = 0;
  };
  for (const w of walls) {
    if (group.length === 0) target = targetFor(targets, w.level);
    group.push(w);
    sum += w.rate;
    if (sum < target) continue;
    // Closer to the target without the last wall? Then it starts the next group.
    // (A tie, within rounding, keeps the wall in: bigger groups.)
    if (group.length > 1 && sum - target > target - (sum - w.rate) + 1e-9) {
      group.pop();
      sum -= w.rate;
      flush();
      group = [w];
      sum = w.rate;
      target = targetFor(targets, w.level);
      if (sum >= target) flush();
    } else flush();
  }
  flush();
  return out;
}
