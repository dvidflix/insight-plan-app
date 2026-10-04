import { buildNetwork, computeCPM, type NetworkNode } from './network';
import type { ScheduleModel } from './types';

/** Monte Carlo schedule risk: run the critical-path calculation many times with
    every remaining duration drawn from a triangular distribution around its
    planned value (shortest / most likely / longest as a percentage of it). The
    spread of the finish dates gives the confidence levels; how often an
    activity lands on the critical path is its criticality index. */

export interface MonteCarloOptions {
  iterations: number;
  /** The shortest duration, as a percentage of planned (e.g. 90). */
  minPct: number;
  /** The longest duration, as a percentage of planned (e.g. 140). */
  maxPct: number;
  /** Only activities not yet finished vary. */
  seed?: number;
}

export interface CriticalityRow {
  id: string;
  code: string;
  name: string;
  /** 0-100: the share of runs in which it sat on the critical path. */
  criticality: number;
  durationDays: number;
}

export interface MonteCarloResult {
  iterations: number;
  /** Finish dates of every run, sorted. */
  finishes: number[];
  /** The programme's own (deterministic) finish. */
  planned: number | null;
  percentile: (p: number) => number;
  /** Chance (0-100) of finishing on or before `date`. */
  chanceBy: (date: number) => number;
  criticality: CriticalityRow[];
  histogram: { from: number; to: number; count: number }[];
}

/** Small seeded generator, so a run can be repeated. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangular draw with the given minimum, mode and maximum. */
export function triangular(u: number, min: number, mode: number, max: number): number {
  if (max <= min) return mode;
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Runs the simulation in slices so the page stays responsive; `onProgress` gets 0..1, `cancelled` stops it early. */
export async function runMonteCarlo(
  model: ScheduleModel,
  options: MonteCarloOptions,
  onProgress?: (fraction: number) => void,
  cancelled?: () => boolean,
): Promise<MonteCarloResult | null> {
  const network = buildNetwork(model);
  const dataDate = model.project.dataDate;
  const rand = mulberry32(options.seed ?? 12345);
  const lo = Math.max(0.01, options.minPct / 100);
  const hi = Math.max(lo, options.maxPct / 100);

  // Only unfinished activities vary; remember each node's planned values.
  const varying: { node: NetworkNode; duration: number; remaining: number | null }[] = [];
  network.nodes.forEach((node) => {
    if (node.actualFinish || node.type === 'milestone-start' || node.type === 'milestone-finish' || node.durationDays <= 0) return;
    varying.push({ node, duration: node.durationDays, remaining: node.remainingDurationDays });
  });

  const base = computeCPM(network, dataDate);
  const planned = base.projectFinish ? base.projectFinish.getTime() : null;
  const finishes: number[] = [];
  const criticalCount = new Map<string, number>();
  const SLICE_MS = 40;

  try {
    let sliceStart = performance.now();
    for (let i = 0; i < options.iterations; i++) {
      for (const v of varying) {
        const k = triangular(rand(), lo, 1, hi);
        // Whole working days: the date arithmetic rounds fractions, which would leave phantom float.
        v.node.durationDays = Math.max(1, Math.round(v.duration * k));
        if (v.remaining !== null) v.node.remainingDurationDays = Math.max(1, Math.round(v.remaining * k));
      }
      const result = computeCPM(network, dataDate);
      if (result.projectFinish) finishes.push(result.projectFinish.getTime());
      for (const [id, r] of result.perNode) if (r.isCritical) criticalCount.set(id, (criticalCount.get(id) ?? 0) + 1);
      if (performance.now() - sliceStart > SLICE_MS) {
        onProgress?.((i + 1) / options.iterations);
        await tick();
        if (cancelled?.()) return null;
        sliceStart = performance.now();
      }
    }
  } finally {
    for (const v of varying) {
      v.node.durationDays = v.duration;
      v.node.remainingDurationDays = v.remaining;
    }
  }
  onProgress?.(1);
  if (finishes.length === 0) return null;

  finishes.sort((a, b) => a - b);
  const n = finishes.length;
  const percentile = (p: number) => finishes[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
  const chanceBy = (date: number) => {
    let lowIdx = 0;
    let hiIdx = n;
    while (lowIdx < hiIdx) {
      const mid = (lowIdx + hiIdx) >> 1;
      if (finishes[mid] <= date) lowIdx = mid + 1;
      else hiIdx = mid;
    }
    return (lowIdx / n) * 100;
  };

  const criticality: CriticalityRow[] = [];
  for (const [id, count] of criticalCount) {
    const node = network.nodes.get(id);
    if (node) criticality.push({ id, code: node.code, name: node.name, criticality: (count / options.iterations) * 100, durationDays: node.durationDays });
  }
  criticality.sort((a, b) => b.criticality - a.criticality || b.durationDays - a.durationDays);

  const BINS = 24;
  const min = finishes[0];
  const max = finishes[n - 1];
  const width = Math.max(1, (max - min) / BINS);
  const histogram = Array.from({ length: BINS }, (_, b) => ({ from: min + b * width, to: min + (b + 1) * width, count: 0 }));
  for (const f of finishes) histogram[Math.min(BINS - 1, Math.floor((f - min) / width))].count++;

  return { iterations: options.iterations, finishes, planned, percentile, chanceBy, criticality, histogram };
}
