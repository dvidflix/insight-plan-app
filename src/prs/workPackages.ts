import type { Recipe, RecipeTask } from './recipes';
import type { CrewTemplate, RuleGroup, ScenarioRules, SequenceStep, TradeRow } from './rules';
import { STEPS_ID } from './recipesWorkbook';
import { CLASS_ORDER, STANDARD_METHODS, chooseMethod, taskDays, type StandardMethod } from './standardMethods';
import { OVERRIDE_PRIORITY, withItemOverrides } from './activityPlan';

/** Generate 3's work packages: groups of model objects, in the order they are built, each built by a method. This is the only structure a planner
    manages there. A package is made of parts (a search set, a storey, an IFC class, a property value, or picked objects: within a part all must hold,
    and a package holds the objects of any of its parts); an object in two packages belongs to the first. The packages are saved with the scenario
    (`rules.packages`) and reach the generator as work items (scenario-engine/core/work_items.py): one per package, with its objects' quantities.
    Their order and "starts after" links become the scenario's steps (one step per package, or per run of packages that start together); a package's
    method becomes a recipe for its group. So the generator does not change. */

export interface PackagePart {
  set?: string;
  storey?: string;
  cls?: string;
  /** Property ("Pset.Prop") -> value. */
  where?: Record<string, string>;
  /** GlobalIds of objects picked by hand. */
  guids?: string[];
}

/** How a package follows the one above: once it has finished (with a lag in working days), or together with it. */
export type PackageLink = 'after' | 'with';

export interface WorkPackage {
  id: string;
  name: string;
  color: string;
  parts: PackagePart[];
  link?: PackageLink;
  lagDays?: number;
  /** The method chosen by hand: "std:<id>" (a standard method) or "recipe:<id>" (one of the project's recipes). Empty: chosen from the objects. */
  method?: string;
  /** Days fixed by hand, by activity (its phase). */
  days?: Record<string, number>;
}

/** One object of the models, as the packages read it. */
export interface PackageObject {
  /** "<model id>:<local id>". */
  key: string;
  guid: string;
  name: string;
  /** Upper case, as the model has it. */
  cls: string;
  storey: string;
  /** The storey's place from the bottom (by elevation, else the model's order). */
  storeyRank: number;
  material: string;
  props: Record<string, unknown>;
  volume: number;
  area: number;
}

const norm = (s: string) => s.trim().toUpperCase();
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** "IFCWALLSTANDARDCASE" -> "Wall"; "IFCBUILDINGELEMENTPROXY" -> "Building element proxy". */
export function className(cls: string): string {
  const bare = cls.replace(/^IFC/i, '').replace(/(STANDARDCASE|ELEMENTEDCASE)$/i, '');
  const words: Record<string, string> = { BUILDINGELEMENTPROXY: 'Building element proxy', CURTAINWALL: 'Curtain wall', STAIRFLIGHT: 'Stair flight', RAMPFLIGHT: 'Ramp flight', FLOWSEGMENT: 'Flow segment', FLOWFITTING: 'Flow fitting', FLOWTERMINAL: 'Flow terminal', DISCRETEACCESSORY: 'Discrete accessory', MECHANICALFASTENER: 'Mechanical fastener', FURNISHINGELEMENT: 'Furnishing element' };
  const up = bare.toUpperCase();
  if (words[up]) return words[up];
  return up ? up[0] + up.slice(1).toLowerCase() : 'Object';
}

/** A name for many of a kind: "Wall" -> "Walls". */
export const plural = (s: string) => (/[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : /(s|x|ch|sh)$/i.test(s) ? `${s}es` : `${s}s`);

/** The first number a quantity property of these props holds (a net one first): /Volume$/ finds NetVolume, GrossVolume... */
export function quantityOf(props: Record<string, unknown>, suffix: RegExp): number {
  let net: number | undefined;
  let any: number | undefined;
  for (const [k, v] of Object.entries(props)) {
    if (!suffix.test(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (any === undefined) any = n;
    if (/net/i.test(k) && net === undefined) net = n;
  }
  return net ?? any ?? 0;
}

/** The material text of an object: every property whose name says material. */
export const materialOf = (props: Record<string, unknown>): string => Object.entries(props).filter(([k]) => /material/i.test(k)).map(([, v]) => text(v)).filter(Boolean).join(' ');

function partHolds(p: PackagePart, o: PackageObject, inSet: (set: string, key: string) => boolean): boolean {
  if (p.guids) return p.guids.includes(o.guid);
  if (p.set && !inSet(p.set, o.key)) return false;
  if (p.storey !== undefined && norm(p.storey) !== norm(o.storey)) return false;
  if (p.cls && norm(p.cls) !== norm(o.cls)) return false;
  for (const [field, value] of Object.entries(p.where ?? {})) if (norm(text(o.props[field])) !== norm(value)) return false;
  return !!(p.set || p.storey !== undefined || p.cls || Object.keys(p.where ?? {}).length);
}

export interface PackageContents {
  /** The objects of each package, by package id (an object in two packages is in the first only). */
  objects: Map<string, PackageObject[]>;
  /** How many of each package's objects are in an earlier one. */
  taken: Map<string, number>;
}

/** The objects each package holds. `inSet` says whether a search set finds an object. */
export function contentsOf(packages: readonly WorkPackage[], all: readonly PackageObject[], inSet: (set: string, key: string) => boolean): PackageContents {
  const owner = new Set<string>();
  const objects = new Map<string, PackageObject[]>();
  const taken = new Map<string, number>();
  for (const pkg of packages) {
    const mine: PackageObject[] = [];
    let twice = 0;
    for (const o of all) {
      if (!pkg.parts.some((p) => partHolds(p, o, inSet))) continue;
      if (owner.has(o.key)) { twice++; continue; }
      owner.add(o.key);
      mine.push(o);
    }
    objects.set(pkg.id, mine);
    taken.set(pkg.id, twice);
  }
  return { objects, taken };
}

/** A package id no package has. */
export function freshId(packages: readonly Pick<WorkPackage, 'id'>[]): string {
  const ids = new Set(packages.map((p) => p.id));
  let n = packages.length + 1;
  while (ids.has(`P${n}`)) n++;
  return `P${n}`;
}

/** The code a package goes by: its place in the build order. */
export const codeOf = (index: number) => `WP-${String(index + 1).padStart(2, '0')}`;
/** What the generator knows a package by (its group): code and name. */
export const groupOf = (pkg: WorkPackage, index: number) => `${codeOf(index)} ${pkg.name.trim() || 'Package'}`;

const classRank = (cls: string) => { const i = CLASS_ORDER.indexOf(norm(cls)); return i < 0 ? CLASS_ORDER.length : i; };
const commonest = (list: string[]) => { const n = new Map<string, number>(); for (const v of list) n.set(v, (n.get(v) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };

/** Packages of the objects by storey and IFC class, bottom storey first, and on a storey in the usual order of the kinds of work. */
export function groupByStoreyAndClass(all: readonly PackageObject[], colors: (n: number) => string[]): WorkPackage[] {
  const by = new Map<string, { storey: string; rank: number; cls: string; n: number }>();
  for (const o of all) {
    const k = `${o.storey}\u0001${o.cls}`;
    const g = by.get(k) ?? by.set(k, { storey: o.storey, rank: o.storeyRank, cls: o.cls, n: 0 }).get(k)!;
    g.n++;
  }
  const groups = [...by.values()].sort((a, b) => a.rank - b.rank || classRank(a.cls) - classRank(b.cls) || a.cls.localeCompare(b.cls));
  const c = colors(groups.length);
  return groups.map((g, i) => ({ id: `P${i + 1}`, name: `${g.storey || 'No storey'} ${plural(className(g.cls))}`, color: c[i], parts: [{ storey: g.storey, cls: g.cls }] }));
}

/** Packages of the objects by storey and the value of a property. */
export function groupByStoreyAndProperty(all: readonly PackageObject[], field: string, colors: (n: number) => string[]): WorkPackage[] {
  const by = new Map<string, { storey: string; rank: number; value: string }>();
  for (const o of all) {
    const value = text(o.props[field]);
    if (!value) continue;
    const k = `${o.storey}\u0001${norm(value)}`;
    if (!by.has(k)) by.set(k, { storey: o.storey, rank: o.storeyRank, value });
  }
  const groups = [...by.values()].sort((a, b) => a.rank - b.rank || a.value.localeCompare(b.value, undefined, { numeric: true }));
  const c = colors(groups.length);
  return groups.map((g, i) => ({ id: `P${i + 1}`, name: `${g.storey || 'No storey'} ${g.value}`, color: c[i], parts: [{ storey: g.storey, where: { [field]: g.value } }] }));
}

/** One package per search set, in the sets' order (sets that find nothing are left out). */
export function groupBySets(sets: readonly string[], finds: (set: string) => number, colors: (n: number) => string[]): WorkPackage[] {
  const used = sets.filter((s) => finds(s) > 0);
  const c = colors(used.length);
  return used.map((s, i) => ({ id: `P${i + 1}`, name: s, color: c[i], parts: [{ set: s }] }));
}

/** A package split by storey, by IFC class or by a property: one package for each value its objects have, in its place. */
export function splitPackage(packages: WorkPackage[], id: string, by: 'storey' | 'cls' | string, objects: readonly PackageObject[], colors: (n: number) => string[]): WorkPackage[] {
  const at = packages.findIndex((p) => p.id === id);
  if (at < 0) return packages;
  const pkg = packages[at];
  const valueOf = (o: PackageObject) => (by === 'storey' ? o.storey : by === 'cls' ? o.cls : text(o.props[by]));
  const values = [...new Map(objects.map((o) => [norm(valueOf(o)), { v: valueOf(o), rank: by === 'storey' ? o.storeyRank : by === 'cls' ? classRank(o.cls) : 0 }])).values()].sort((a, b) => a.rank - b.rank || a.v.localeCompare(b.v, undefined, { numeric: true }));
  if (values.length < 2) return packages;
  const c = colors(packages.length + values.length);
  let next = packages;
  const made = values.map(({ v }, i): WorkPackage => {
    const id2 = freshId(next);
    const label = by === 'storey' ? v || 'No storey' : by === 'cls' ? plural(className(v)) : v || 'No value';
    const parts = pkg.parts.map((p): PackagePart => (by === 'storey' ? { ...p, storey: v } : by === 'cls' ? { ...p, cls: v } : { ...p, where: { ...p.where, [by]: v } }));
    const out: WorkPackage = { ...pkg, id: id2, name: `${pkg.name} · ${label}`, color: i === 0 ? pkg.color : c[packages.length + i], parts, link: i === 0 ? pkg.link : 'after', lagDays: i === 0 ? pkg.lagDays : undefined };
    next = [...next, out];
    return out;
  });
  return [...packages.slice(0, at), ...made, ...packages.slice(at + 1)];
}

/** Two packages as one (in the place of the first): their parts together. */
export function mergePackages(packages: WorkPackage[], id: string, withId: string): WorkPackage[] {
  const a = packages.find((p) => p.id === id);
  const b = packages.find((p) => p.id === withId);
  if (!a || !b || a === b) return packages;
  const merged: WorkPackage = { ...a, name: `${a.name} + ${b.name}`, parts: [...a.parts, ...b.parts], days: undefined };
  return packages.flatMap((p) => (p === a ? [merged] : p === b ? [] : [p]));
}

/** The packages bottom up: by the lowest storey of their objects, then on a storey in the usual order of the kinds of work (the commonest class of
    each), else as they were. */
export function orderBottomUp(packages: WorkPackage[], contents: PackageContents): WorkPackage[] {
  const key = (p: WorkPackage) => {
    const objs = contents.objects.get(p.id) ?? [];
    return { storey: objs.length ? Math.min(...objs.map((o) => o.storeyRank)) : Number.POSITIVE_INFINITY, cls: classRank(commonest(objs.map((o) => o.cls))) };
  };
  return packages.map((p, i) => ({ p, i, k: key(p) })).sort((a, b) => a.k.storey - b.k.storey || a.k.cls - b.k.cls || a.i - b.i).map((x) => x.p);
}

/** The quantities of a package's objects. */
export function quantities(objs: readonly PackageObject[]): { count: number; volume: number; area: number } {
  return { count: objs.length, volume: objs.reduce((n, o) => n + o.volume, 0), area: objs.reduce((n, o) => n + o.area, 0) };
}

/** A package's method: chosen by hand, else a project recipe for one of its search sets or for every object, else the standard method its objects
    suggest. Each activity has its days (fixed by hand, else worked out) and how they were found. */
export interface ResolvedMethod {
  key: string;
  name: string;
  kind: 'std' | 'recipe';
  chosen: boolean;
  why: string;
  crew: string;
  activities: { phase: string; name: string; days: number; fixed: boolean; how: string }[];
  days: number;
}

export function resolveMethod(pkg: WorkPackage, objs: readonly PackageObject[], recipes: readonly Recipe[], recipeDays: (recipe: Recipe, q: ReturnType<typeof quantities>) => { phase: string; name: string; days: number; how: string; crew: string }[]): ResolvedMethod {
  const q = quantities(objs);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  const fixed = (phase: string) => Object.entries(pkg.days ?? {}).find(([k]) => norm(k) === norm(phase))?.[1];
  const fromRecipe = (r: Recipe, chosen: boolean, why: string): ResolvedMethod => {
    const acts = recipeDays(r, q).map((a) => { const f = fixed(a.phase); return { phase: a.phase, name: a.name, days: f ?? a.days, fixed: f !== undefined, how: f !== undefined ? 'set here' : a.how }; });
    return { key: `recipe:${r.id}`, name: r.name?.trim() || r.id, kind: 'recipe', chosen, why, crew: recipeDays(r, q).map((a) => a.crew).find(Boolean) ?? '', activities: acts, days: acts.reduce((n, a) => n + a.days, 0) };
  };
  const fromStd = (m: StandardMethod, chosen: boolean, why: string): ResolvedMethod => {
    const acts = m.tasks.map((t) => { const f = fixed(t.phase); const d = taskDays(t, q); return { phase: t.phase, name: t.name, days: f ?? d.days, fixed: f !== undefined, how: f !== undefined ? 'set here' : d.how }; });
    return { key: `std:${m.id}`, name: m.name, kind: 'std', chosen, why, crew: `${m.crew.name} (${m.crew.people})`, activities: acts, days: acts.reduce((n, a) => n + a.days, 0) };
  };
  if (pkg.method?.startsWith('recipe:')) { const r = chains.find((x) => norm(x.id) === norm(pkg.method!.slice(7))); if (r) return fromRecipe(r, true, 'chosen'); }
  if (pkg.method?.startsWith('std:')) { const m = STANDARD_METHODS.find((x) => x.id === pkg.method!.slice(4)); if (m) return fromStd(m, true, 'chosen'); }
  const sets = pkg.parts.map((p) => p.set).filter((s): s is string => !!s);
  const own = chains.find((r) => sets.some((s) => norm(s) === norm(r.group)));
  if (own) return fromRecipe(own, false, `the project's recipe for ${own.group}`);
  const all = chains.find((r) => r.group.trim() === '');
  if (all) return fromRecipe(all, false, 'the project’s recipe for every object');
  const pick = chooseMethod(objs);
  return fromStd(pick.method, false, pick.why);
}

/** When each package starts and finishes in working days from the start, before Generate: after the one above (its finish plus the lag), or together
    with it (its start plus the lag); a package takes its activities' days one after another. The generator works out the real dates. */
export function timelineOf(packages: readonly WorkPackage[], days: (pkg: WorkPackage) => number): { id: string; start: number; finish: number }[] {
  const out: { id: string; start: number; finish: number }[] = [];
  packages.forEach((p, i) => {
    const prev = out[i - 1];
    const lag = Math.max(0, p.lagDays ?? 0);
    const start = !prev ? 0 : (p.link === 'with' ? prev.start : prev.finish) + lag;
    out.push({ id: p.id, start, finish: start + Math.max(0, days(p)) });
  });
  return out;
}

export const HOURS_PER_DAY = 8;

/** What Generate sends for the packages: the work items, the GlobalIds of each item's objects (for the 4D links), and the rules as the generator
    should read them (the steps made from the packages, the methods as recipes for their groups, and the standard methods' crews). */
export function packagesRequest(packages: readonly WorkPackage[], contents: PackageContents, methods: Map<string, ResolvedMethod>, building: string): {
  workItems: { id: string; group: string; building: string; level: string; name: string; quantity: number; quantities: Record<string, number> }[];
  members: { guids: string[]; item: { id: string } }[];
  rules: (rules: ScenarioRules) => ScenarioRules;
} {
  const live = packages.map((p, i) => ({ p, i, objs: contents.objects.get(p.id) ?? [] })).filter((x) => x.objs.length > 0);
  const workItems = live.map(({ p, i, objs }) => {
    const q = quantities(objs);
    const storeys = [...new Set(objs.map((o) => o.storey))];
    return { id: `WP|${p.id}`, group: groupOf(p, i), building, level: storeys.length === 1 ? storeys[0] : '', name: groupOf(p, i), quantity: q.volume, quantities: { count: q.count, area: q.area } };
  });
  const members = live.map(({ p, objs }) => ({ guids: objs.map((o) => o.guid).filter(Boolean), item: { id: `WP|${p.id}` } }));
  // Steps: one per package, or one per run of packages that start together (a group that includes theirs).
  const steps: SequenceStep[] = [];
  const groups: RuleGroup[] = [];
  live.forEach(({ p, i }, k) => {
    const g = groupOf(p, i);
    if (k > 0 && p.link === 'with') {
      const last = steps[steps.length - 1];
      const run = groups.find((x) => x.id === last.group);
      if (run) run.include = [...(run.include ?? []), g];
      else { const id = `${last.group} + together`; groups.push({ id, name: id, forEach: [], filters: [], include: [last.group, g] }); last.group = id; }
      return;
    }
    steps.push({ group: g, ...(k > 0 && (p.lagDays ?? 0) > 0 ? { lagHours: (p.lagDays ?? 0) * HOURS_PER_DAY } : {}) });
  });
  return {
    workItems, members,
    rules: (rules) => {
      const overrides: Record<string, { recipe?: string; tasks?: Record<string, { days?: number }> }> = {};
      const stdRecipes: Recipe[] = [];
      const usedStd = new Map<string, StandardMethod>();
      for (const { p, i } of live) {
        const m = methods.get(p.id);
        if (!m) continue;
        const g = groupOf(p, i);
        if (m.kind === 'recipe') {
          const tasks = Object.fromEntries(m.activities.filter((a) => a.fixed).map((a) => [a.phase, { days: a.days }]));
          overrides[g] = { recipe: m.key.slice(7), ...(Object.keys(tasks).length ? { tasks } : {}) };
          continue;
        }
        const std = STANDARD_METHODS.find((x) => `std:${x.id}` === m.key)!;
        usedStd.set(std.id, std);
        const tasks: RecipeTask[] = m.activities.map((a) => ({ phase: a.phase, name: a.name, formula: String(a.days), crew: std.crew.id, priority: OVERRIDE_PRIORITY - 1 }));
        stdRecipes.push({ id: `${std.name} for ${g}`, group: g, priority: OVERRIDE_PRIORITY, tasks });
      }
      const trades: TradeRow[] = [...usedStd.values()].filter((s) => !rules.trades.some((t) => norm(t.id) === norm(s.crew.id))).map((s) => ({ id: s.crew.id, name: s.crew.name, capacity: 0 }));
      const crews: CrewTemplate[] = [...usedStd.values()].filter((s) => !rules.crewTemplates.some((c) => norm(c.id) === norm(s.crew.id))).map((s) => ({ id: s.crew.id, trades: [{ trade: s.crew.id, size: s.crew.people }] }));
      const others = rules.sequences.filter((q) => q.id.toUpperCase() !== STEPS_ID);
      const { breakdown: _b, ...rest } = rules;
      return {
        ...rest,
        sequences: steps.length ? [{ id: STEPS_ID, name: 'Work packages', steps }, ...others] : others,
        groups: [...rest.groups.filter((g) => !groups.some((x) => x.id === g.id)), ...groups],
        recipes: [...stdRecipes, ...withItemOverrides(rest.recipes ?? [], overrides)],
        trades: [...rest.trades, ...trades],
        crewTemplates: [...rest.crewTemplates, ...crews],
      };
    },
  };
}

/** Cleans saved packages. */
export function normalizePackages(raw: unknown): WorkPackage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set<string>();
  const out: WorkPackage[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const p = x as Partial<WorkPackage>;
    const id = text(p.id);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const parts = (Array.isArray(p.parts) ? p.parts : []).filter((q) => q && typeof q === 'object').map((q): PackagePart => ({
      ...(text(q.set) ? { set: text(q.set) } : {}),
      ...(typeof q.storey === 'string' ? { storey: q.storey } : {}),
      ...(text(q.cls) ? { cls: text(q.cls) } : {}),
      ...(q.where && typeof q.where === 'object' ? { where: Object.fromEntries(Object.entries(q.where).map(([k, v]) => [k, text(v)])) } : {}),
      ...(Array.isArray(q.guids) ? { guids: q.guids.map(text).filter(Boolean) } : {}),
    }));
    const days = p.days && typeof p.days === 'object' ? Object.fromEntries(Object.entries(p.days).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [k, Number(v)])) : undefined;
    out.push({
      id, name: text(p.name), color: text(p.color) || '#888888', parts,
      ...(p.link === 'with' ? { link: 'with' as const } : {}),
      ...(Number.isFinite(Number(p.lagDays)) && Number(p.lagDays) > 0 ? { lagDays: Number(p.lagDays) } : {}),
      ...(text(p.method) ? { method: text(p.method) } : {}),
      ...(days && Object.keys(days).length ? { days } : {}),
    });
  }
  return out.length ? out : undefined;
}
