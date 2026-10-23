import type { Recipe, RecipeTask } from './recipes';
import type { CrewTemplate, LevelTask, LimitRow, RuleGroup, ScenarioRules, SequenceStep, TradeRow } from './rules';
import { STEPS_ID } from './recipesWorkbook';
import { CLASS_ORDER, STANDARD_METHODS, chooseMethod, taskDays, type StandardMethod } from './standardMethods';
import { OVERRIDE_PRIORITY, withItemOverrides } from './activityPlan';
import { inTreeOrder, subtreeIds, treeRows } from './packageTree';
import { orderRuns, type ObjectOrder } from './objectOrder';

/** Generate 3's work packages: groups of model objects, in the order they are built, each built by a method. This is the only structure a planner
    manages there. A package is made of parts (a search set, a storey, an IFC class, a property value, or picked objects: within a part all must hold,
    and a package holds the objects of any of its parts). A package can hold other packages (`parent`, prs/packageTree.ts): the list is a tree, kept
    in build order. An object belongs to one package only: the deepest, first one that holds it (the packages inside a package take their objects
    before it does, so a package for a whole building gets what its levels leave). The packages are saved with the scenario (`rules.packages`) and
    reach the generator as work items (scenario-engine/core/work_items.py): one per package that holds objects of its own, with their quantities.
    Their order and "starts after" links become the scenario's sequences (the build order, and one more short sequence for each package that starts
    after another than the one above it); a package's method becomes a recipe for its group; a package holding others can have a summary bar and a
    limit on how many of them run at once. So the generator does not change. */

export interface PackagePart {
  set?: string;
  storey?: string;
  cls?: string;
  /** Property ("Pset.Prop", "Attributes.Class", or STOREY_FIELD) -> value. */
  where?: Record<string, string>;
  /** GlobalIds of objects picked by hand. */
  guids?: string[];
}

/** How a package follows the one above: once it has finished (with a lag in working days), or together with it. */
export type PackageLink = 'after' | 'with';

/** One activity added to a package's method, before or after its activities. */
export interface PackageExtra {
  name: string;
  days: number;
  before?: boolean;
}

export interface WorkPackage {
  id: string;
  name: string;
  color: string;
  parts: PackagePart[];
  /** The package it is inside. */
  parent?: string;
  link?: PackageLink;
  lagDays?: number;
  /** Starts after this package (and everything in it) has finished, instead of after the one above. */
  after?: string;
  /** The method chosen by hand: "std:<id>" (a standard method) or "recipe:<id>" (one of the project's recipes). Empty: chosen from the objects. */
  method?: string;
  /** Days fixed by hand, by activity (its phase). */
  days?: Record<string, number>;
  /** The package's days in all, fixed by hand: its activities share them as their estimates do. */
  totalDays?: number;
  /** The people in the crew of a standard method, when not its usual number: the days change in proportion. */
  people?: number;
  extra?: PackageExtra;
  /** A summary bar over the package in the programme (default: on for a package that holds others, off for the rest). */
  bar?: boolean;
  /** A package that holds others: at most this many of them work at once. */
  maxAtOnce?: number;
  /** Fine-tuned object order (prs/objectOrder.ts): with one, each object is built on its own, in this order (GlobalId -> rank). */
  objectOrder?: ObjectOrder;
}

/** Whether a package's objects are built one by one in an order of their own. */
export const isFineTuned = (p: Pick<WorkPackage, 'objectOrder'>) => !!p.objectOrder && Object.keys(p.objectOrder).length > 0;

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

/** The storey of an object (from the model's spatial structure, not a property) as a field of `where` and of "Spool from properties". */
export const STOREY_FIELD = '@storey';
export const CLASS_FIELD = 'Attributes.Class';

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

/** An object's value of a field: its storey, its IFC class, its name, or a property. */
export function fieldValue(o: PackageObject, field: string): string {
  if (field === STOREY_FIELD) return o.storey;
  if (field === CLASS_FIELD) return o.cls;
  if (field === 'Attributes.Name') return o.name;
  return text(o.props[field]);
}

/** A value as a planner reads it (an IFC class by its name). */
export const valueLabel = (field: string, value: string) => (field === CLASS_FIELD ? plural(className(value)) : value);

function partHolds(p: PackagePart, o: PackageObject, inSet: (set: string, key: string) => boolean): boolean {
  if (p.guids) return p.guids.includes(o.guid);
  if (p.set && !inSet(p.set, o.key)) return false;
  if (p.storey !== undefined && norm(p.storey) !== norm(o.storey)) return false;
  if (p.cls && norm(p.cls) !== norm(o.cls)) return false;
  for (const [field, value] of Object.entries(p.where ?? {})) if (norm(fieldValue(o, field)) !== norm(value)) return false;
  return !!(p.set || p.storey !== undefined || p.cls || Object.keys(p.where ?? {}).length);
}

export interface PackageContents {
  /** The objects each package holds itself, by package id (an object in two packages is in one only). */
  objects: Map<string, PackageObject[]>;
  /** The objects of each package with those of the packages inside it. */
  all: Map<string, PackageObject[]>;
  /** How many of each package's objects are in another package. */
  taken: Map<string, number>;
}

/** The objects each package holds. `inSet` says whether a search set finds an object. The packages inside a package take their objects first. */
export function contentsOf(packages: readonly WorkPackage[], all: readonly PackageObject[], inSet: (set: string, key: string) => boolean): PackageContents {
  const ordered = inTreeOrder(packages);
  const kids = new Map<string | undefined, WorkPackage[]>();
  for (const p of ordered) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)!).push(p);
  const post: WorkPackage[] = [];
  const walk = (id: string | undefined) => { for (const p of kids.get(id) ?? []) { walk(p.id); post.push(p); } };
  walk(undefined);
  const owner = new Set<string>();
  const objects = new Map<string, PackageObject[]>();
  const taken = new Map<string, number>();
  for (const pkg of post) {
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
  const total = new Map<string, PackageObject[]>();
  for (const p of [...ordered].reverse()) total.set(p.id, [...(objects.get(p.id) ?? []), ...(kids.get(p.id) ?? []).flatMap((k) => total.get(k.id) ?? [])]);
  return { objects, all: total, taken };
}

/** A package id no package has. */
export function freshId(packages: readonly Pick<WorkPackage, 'id'>[]): string {
  const ids = new Set(packages.map((p) => p.id));
  let n = packages.length + 1;
  while (ids.has(`P${n}`)) n++;
  return `P${n}`;
}

/** What the generator knows a package by (its group): code and name. */
export const groupOf = (pkg: Pick<WorkPackage, 'name'>, code: string) => `${code} ${pkg.name.trim() || 'Package'}`;

const classRank = (cls: string) => { const i = CLASS_ORDER.indexOf(norm(cls)); return i < 0 ? CLASS_ORDER.length : i; };
const commonest = (list: string[]) => { const n = new Map<string, number>(); for (const v of list) n.set(v, (n.get(v) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };
const byValue = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

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
    const value = fieldValue(o, field);
    if (!value) continue;
    const k = `${o.storey}\u0001${norm(value)}`;
    if (!by.has(k)) by.set(k, { storey: o.storey, rank: o.storeyRank, value });
  }
  const groups = [...by.values()].sort((a, b) => a.rank - b.rank || byValue(a.value, b.value));
  const c = colors(groups.length);
  return groups.map((g, i) => ({ id: `P${i + 1}`, name: `${g.storey || 'No storey'} ${valueLabel(field, g.value)}`, color: c[i], parts: [{ storey: g.storey, where: { [field]: g.value } }] }));
}

/** One package per search set, in the sets' order (sets that find nothing are left out). */
export function groupBySets(sets: readonly string[], finds: (set: string) => number, colors: (n: number) => string[]): WorkPackage[] {
  const used = sets.filter((s) => finds(s) > 0);
  const c = colors(used.length);
  return used.map((s, i) => ({ id: `P${i + 1}`, name: s, color: c[i], parts: [{ set: s }] }));
}

/** Packages from folders of search sets: a package for each folder (holding a package for each folder and set inside it), in the folders' order.
    `sets` are [name, folder path] in the order of the tree; `sep` splits a path. Sets that find nothing are left out, and so are folders left empty. */
export function groupByFolders(sets: readonly { name: string; folder: string }[], sep: string, finds: (set: string) => number, colors: (n: number) => string[]): WorkPackage[] {
  const out: WorkPackage[] = [];
  const folderIds = new Map<string, string>();
  const used = sets.filter((s) => finds(s.name) > 0);
  const c = colors(used.length + new Set(used.map((s) => s.folder)).size * 2);
  let k = 0;
  const folder = (path: string): string | undefined => {
    if (!path) return undefined;
    const key = norm(path);
    if (folderIds.has(key)) return folderIds.get(key);
    const parts = path.split(sep);
    const parent = folder(parts.slice(0, -1).join(sep));
    const id = `P${out.length + 1}`;
    out.push({ id, name: parts[parts.length - 1].trim() || 'Folder', color: c[k++ % c.length], parts: [], ...(parent ? { parent } : {}) });
    folderIds.set(key, id);
    return id;
  };
  for (const s of used) {
    const parent = folder(s.folder);
    out.push({ id: `P${out.length + 1}`, name: s.name, color: c[k++ % c.length], parts: [{ set: s.name }], ...(parent ? { parent } : {}) });
  }
  return inTreeOrder(out);
}

/** Packages made elsewhere (numbered from P1) added after `existing` with ids of their own; their top packages go inside `parent` if given. */
export function appendPackages(existing: readonly WorkPackage[], made: readonly WorkPackage[], parent?: string): WorkPackage[] {
  const out = [...existing];
  const ids = new Map<string, string>();
  for (const p of made) { const id = freshId(out); ids.set(p.id, id); out.push({ ...p, id }); }
  return inTreeOrder(out.map((p, i) => {
    if (i < existing.length) return p;
    const up = p.parent ? ids.get(p.parent) : parent;
    const { parent: _old, ...rest } = p;
    return up ? { ...rest, parent: up } : rest;
  }));
}

/** "Spool from properties": the values of one field and, under each, the values of a second one, from the objects in scope. Objects without a
    value of either field are counted, not placed. */
export interface SpoolNode { value: string; label: string; count: number; volume: number; children: { value: string; label: string; objects: PackageObject[]; volume: number }[] }

export function spoolTree(objs: readonly PackageObject[], top: string, sub: string): { tree: SpoolNode[]; missing: number } {
  const tops = new Map<string, { value: string; rank: number; subs: Map<string, { value: string; rank: number; objects: PackageObject[] }> }>();
  let missing = 0;
  const rank = (field: string, o: PackageObject) => (field === STOREY_FIELD ? o.storeyRank : field === CLASS_FIELD ? classRank(o.cls) : 0);
  for (const o of objs) {
    const a = fieldValue(o, top);
    const b = fieldValue(o, sub);
    if (!a || !b) { missing++; continue; }
    const t = tops.get(norm(a)) ?? tops.set(norm(a), { value: a, rank: rank(top, o), subs: new Map() }).get(norm(a))!;
    const s = t.subs.get(norm(b)) ?? t.subs.set(norm(b), { value: b, rank: rank(sub, o), objects: [] }).get(norm(b))!;
    s.objects.push(o);
  }
  const sorted = <T extends { value: string; rank: number }>(xs: Iterable<T>) => [...xs].sort((x, y) => x.rank - y.rank || byValue(x.value, y.value));
  const tree = sorted(tops.values()).map((t) => {
    const children = sorted(t.subs.values()).map((s) => ({ value: s.value, label: valueLabel(sub, s.value), objects: s.objects, volume: s.objects.reduce((n, o) => n + o.volume, 0) }));
    return { value: t.value, label: valueLabel(top, t.value), count: children.reduce((n, s) => n + s.objects.length, 0), volume: children.reduce((n, s) => n + s.volume, 0), children };
  });
  return { tree, missing };
}

/** The packages a spool tree makes: a package for each value of the first field, holding a package for each value of the second. `part` says what a
    child package is made of (the property values, the search set made for it, or its objects). New ids follow `existing`. */
export function spoolPackages(tree: readonly SpoolNode[], existing: readonly Pick<WorkPackage, 'id'>[], colors: (n: number) => string[], part: (top: SpoolNode, child: SpoolNode['children'][number]) => PackagePart): WorkPackage[] {
  const out: WorkPackage[] = [];
  const n = tree.reduce((k, t) => k + 1 + t.children.length, 0);
  const c = colors(n);
  let k = 0;
  for (const t of tree) {
    const parent: WorkPackage = { id: freshId([...existing, ...out]), name: t.label, color: c[k++], parts: [] };
    out.push(parent);
    for (const s of t.children) out.push({ id: freshId([...existing, ...out]), name: s.label, color: c[k++], parts: [part(t, s)], parent: parent.id });
  }
  return out;
}

/** The parts of a package made from the values of two fields. */
export const whereParts = (top: string, topValue: string, sub: string, subValue: string): PackagePart => ({ where: { [top]: topValue, [sub]: subValue } });

const strip = (p: WorkPackage): WorkPackage => {
  const { after: _a, bar: _b, maxAtOnce: _m, extra: _e, totalDays: _t, days: _d, ...rest } = p;
  return rest;
};

/** A package split by storey, by IFC class or by a property: one package for each value its objects have, in its place; or, `inside`, inside it
    (the package keeps its name and holds the new ones). */
export function splitPackage(packages: WorkPackage[], id: string, by: 'storey' | 'cls' | string, objects: readonly PackageObject[], colors: (n: number) => string[], inside = false): WorkPackage[] {
  const ordered = inTreeOrder(packages);
  const at = ordered.findIndex((p) => p.id === id);
  if (at < 0) return packages;
  const pkg = ordered[at];
  const valueOf = (o: PackageObject) => (by === 'storey' ? o.storey : by === 'cls' ? o.cls : fieldValue(o, by));
  const values = [...new Map(objects.map((o) => [norm(valueOf(o)), { v: valueOf(o), rank: by === 'storey' ? o.storeyRank : by === 'cls' ? classRank(o.cls) : 0 }])).values()].sort((a, b) => a.rank - b.rank || byValue(a.v, b.v));
  if (values.length < 2) return packages;
  const c = colors(ordered.length + values.length);
  let next = ordered;
  const made = values.map(({ v }, i): WorkPackage => {
    const id2 = freshId(next);
    const label = by === 'storey' ? v || 'No storey' : by === 'cls' ? plural(className(v)) : v || 'No value';
    const parts = pkg.parts.map((p): PackagePart => (by === 'storey' ? { ...p, storey: v } : by === 'cls' ? { ...p, cls: v } : { ...p, where: { ...p.where, [by]: v } }));
    const out: WorkPackage = inside
      ? { ...strip(pkg), id: id2, name: label, color: c[ordered.length + i], parts, parent: pkg.id, link: undefined, lagDays: undefined }
      : { ...pkg, id: id2, name: `${pkg.name} · ${label}`, color: i === 0 ? pkg.color : c[ordered.length + i], parts, link: i === 0 ? pkg.link : 'after', lagDays: i === 0 ? pkg.lagDays : undefined, after: i === 0 ? pkg.after : undefined };
    for (const k of Object.keys(out) as (keyof WorkPackage)[]) if (out[k] === undefined) delete out[k];
    next = [...next, out];
    return out;
  });
  if (inside) {
    const end = at + subtreeIds(ordered, id).length;
    return inTreeOrder([...ordered.slice(0, at), { ...pkg, parts: [] }, ...ordered.slice(at + 1, end), ...made, ...ordered.slice(end)]);
  }
  return inTreeOrder([...ordered.slice(0, at), ...made, ...ordered.slice(at + 1)]);
}

/** Two packages as one (in the place of the first): their parts together, and what the second held goes into the first. */
export function mergePackages(packages: WorkPackage[], id: string, withId: string): WorkPackage[] {
  const a = packages.find((p) => p.id === id);
  const b = packages.find((p) => p.id === withId);
  if (!a || !b || a === b) return packages;
  const merged: WorkPackage = { ...a, name: `${a.name} + ${b.name}`, parts: [...a.parts, ...b.parts], days: undefined, totalDays: undefined };
  return inTreeOrder(packages.flatMap((p) => (p === a ? [merged] : p === b ? [] : p.parent === b.id ? [{ ...p, parent: a.id }] : [p])));
}

/** The packages bottom up, at every level of the tree: by the lowest storey of their objects, then on a storey in the usual order of the kinds of
    work (the commonest class of each), else as they were. */
export function orderBottomUp(packages: WorkPackage[], contents: PackageContents): WorkPackage[] {
  const ordered = inTreeOrder(packages);
  const key = (p: WorkPackage) => {
    const objs = contents.all.get(p.id) ?? contents.objects.get(p.id) ?? [];
    return { storey: objs.length ? Math.min(...objs.map((o) => o.storeyRank)) : Number.POSITIVE_INFINITY, cls: classRank(commonest(objs.map((o) => o.cls))) };
  };
  const kids = new Map<string | undefined, WorkPackage[]>();
  for (const p of ordered) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)!).push(p);
  const out: WorkPackage[] = [];
  const walk = (id: string | undefined) => {
    const list = (kids.get(id) ?? []).map((p, i) => ({ p, i, k: key(p) })).sort((a, b) => a.k.storey - b.k.storey || a.k.cls - b.k.cls || a.i - b.i);
    for (const x of list) { out.push(x.p); walk(x.p.id); }
  };
  walk(undefined);
  return out;
}

/** The quantities of a package's objects. */
export function quantities(objs: readonly PackageObject[]): { count: number; volume: number; area: number } {
  return { count: objs.length, volume: objs.reduce((n, o) => n + o.volume, 0), area: objs.reduce((n, o) => n + o.area, 0) };
}

/** The phase of an activity added to a package (PackageExtra). */
export const EXTRA_PHASE = 'Extra';

/** A package's method: chosen by hand, else a project recipe for one of its search sets or for every object, else the standard method its objects
    suggest. Each activity has its days (fixed by hand, else worked out) and how they were found. */
export interface ResolvedMethod {
  key: string;
  name: string;
  kind: 'std' | 'recipe';
  chosen: boolean;
  why: string;
  crew: string;
  /** A standard method's usual crew size (the people a package can change); null for a project recipe. */
  people: number | null;
  /** `unknown`: the days cannot be worked out before Generate (the 1 shown is a stand-in). */
  activities: { phase: string; name: string; days: number; fixed: boolean; how: string; unknown?: boolean }[];
  days: number;
  /** The days before the package's own total, if it has one. */
  estimate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveMethod(pkg: WorkPackage, objs: readonly PackageObject[], recipes: readonly Recipe[], recipeDays: (recipe: Recipe, q: ReturnType<typeof quantities>) => { phase: string; name: string; days: number; how: string; crew: string; unknown?: boolean }[]): ResolvedMethod {
  const q = quantities(objs);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  const fixed = (phase: string) => Object.entries(pkg.days ?? {}).find(([k]) => norm(k) === norm(phase))?.[1];
  type Act = ResolvedMethod['activities'][number];
  const finish = (base: Omit<ResolvedMethod, 'activities' | 'days' | 'estimate'>, acts: Act[]): ResolvedMethod => {
    const e = pkg.extra && pkg.extra.name.trim() ? pkg.extra : null;
    if (e) { const a: Act = { phase: EXTRA_PHASE, name: e.name.trim(), days: Math.max(0, e.days), fixed: true, how: 'added to this package' }; acts = e.before ? [a, ...acts] : [...acts, a]; }
    const estimate = acts.reduce((n, a) => n + a.days, 0);
    const total = pkg.totalDays && pkg.totalDays > 0 ? pkg.totalDays : 0;
    if (total && acts.length) {
      const shares = acts.map((a) => (estimate > 0 ? a.days / estimate : 1 / acts.length));
      acts = acts.map((a, i) => ({ ...a, days: round2(total * shares[i]), fixed: true, how: `its share of the ${total} days set for the package` }));
      const off = round2(total - acts.reduce((n, a) => n + a.days, 0));
      if (off) acts[acts.length - 1] = { ...acts[acts.length - 1], days: round2(acts[acts.length - 1].days + off) };
    }
    return { ...base, activities: acts, days: round2(acts.reduce((n, a) => n + a.days, 0)), estimate };
  };
  const fromRecipe = (r: Recipe, chosen: boolean, why: string): ResolvedMethod => {
    const planned = recipeDays(r, q);
    const acts = planned.map((a) => { const f = fixed(a.phase); return { phase: a.phase, name: a.name, days: f ?? a.days, fixed: f !== undefined, how: f !== undefined ? 'set here' : a.how, ...(a.unknown && f === undefined ? { unknown: true } : {}) }; });
    return finish({ key: `recipe:${r.id}`, name: r.name?.trim() || r.id, kind: 'recipe', chosen, why, crew: planned.map((a) => a.crew).find(Boolean) ?? '', people: null }, acts);
  };
  const fromStd = (m: StandardMethod, chosen: boolean, why: string): ResolvedMethod => {
    const people = pkg.people && pkg.people > 0 ? pkg.people : m.crew.people;
    const ratio = m.crew.people / people;
    const acts = m.tasks.map((t) => {
      const f = fixed(t.phase);
      const d = taskDays(t, q);
      const days = ratio === 1 ? d.days : Math.max(1, Math.ceil(d.days * ratio - 1e-9));
      return { phase: t.phase, name: t.name, days: f ?? days, fixed: f !== undefined, how: f !== undefined ? 'set here' : ratio === 1 ? d.how : `${d.how}, with ${people} people instead of ${m.crew.people}` };
    });
    return finish({ key: `std:${m.id}`, name: m.name, kind: 'std', chosen, why, crew: `${m.crew.name} (${people})`, people: m.crew.people }, acts);
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

/** The packages a package may start after: any other that is not itself, inside it, or one it is inside. */
export function linkTargets(packages: readonly WorkPackage[], id: string): WorkPackage[] {
  const mine = new Set(subtreeIds(packages, id));
  const up = new Set<string>();
  for (let p = packages.find((x) => x.id === id)?.parent; p && !up.has(p); p = packages.find((x) => x.id === p)?.parent) up.add(p);
  return inTreeOrder(packages).filter((p) => !mine.has(p.id) && !up.has(p.id));
}

/** When each package starts and finishes in working days from the start, before Generate. A package with work of its own (`works`) starts after the
    one above (its finish plus the lag), together with it (its start plus the lag), or after the package it names (`after`: when everything in that
    one is done, plus the lag); it takes its activities' days one after another. A package that holds others spans them. The generator works out the
    real dates. */
export function timelineOf(packages: readonly WorkPackage[], days: (pkg: WorkPackage) => number, works: (pkg: WorkPackage) => boolean = () => true): { id: string; start: number; finish: number }[] {
  const ordered = inTreeOrder(packages);
  const placed = new Map<string, { start: number; finish: number }>();
  const span = (id: string) => {
    let s = Infinity;
    let f = -Infinity;
    for (const k of subtreeIds(ordered, id)) { const t = placed.get(k); if (t) { s = Math.min(s, t.start); f = Math.max(f, t.finish); } }
    return Number.isFinite(s) ? { start: s, finish: f } : null;
  };
  let prev: { start: number; finish: number } | null = null;
  for (const p of ordered) {
    if (!works(p)) continue;
    const lag = Math.max(0, p.lagDays ?? 0);
    let start: number;
    if (p.after && linkTargets(ordered, p.id).some((t) => t.id === p.after)) start = (span(p.after)?.finish ?? 0) + lag;
    else if (!prev) start = 0;
    else start = (p.link === 'with' ? prev.start : prev.finish) + lag;
    const t = { start, finish: start + Math.max(0, days(p)) };
    placed.set(p.id, t);
    prev = t;
  }
  return ordered.flatMap((p) => { const s = span(p.id); return s ? [{ id: p.id, ...s }] : []; });
}

/** The days of runs of objects built one after another (a run's objects together): the longest of each run, added up. */
export const serialDays = (runs: readonly (readonly PackageObject[])[], methods: ReadonlyMap<string, ResolvedMethod>) =>
  round2(runs.reduce((n, run) => n + Math.max(0, ...run.map((o) => methods.get(o.key)?.days ?? 0)), 0));

/** The method of each object of a fine-tuned package (by object key), each worked out from the object's own quantities. The package's added
    activity goes with its first object (before) or its last (after); the package's own days are shared in proportion. */
export function objectMethodsOf(pkg: WorkPackage, objs: readonly PackageObject[], resolve: (pkg: WorkPackage, objs: PackageObject[]) => ResolvedMethod): Map<string, ResolvedMethod> {
  const runs = orderRuns(objs, pkg.objectOrder);
  const flat = runs.flat();
  const { totalDays, extra, ...base } = pkg;
  const out = new Map<string, ResolvedMethod>();
  flat.forEach((o, i) => {
    const own = extra && ((extra.before && i === 0) || (!extra.before && i === flat.length - 1)) ? { ...base, extra } : base;
    out.set(o.key, resolve(own, [o]));
  });
  const serial = serialDays(runs, out);
  if (totalDays && totalDays > 0 && serial > 0) {
    const f = totalDays / serial;
    for (const [k, m] of out) {
      const acts = m.activities.map((a) => ({ ...a, days: round2(a.days * f), fixed: true, how: `its share of the ${totalDays} days set for the package` }));
      out.set(k, { ...m, activities: acts, days: round2(acts.reduce((n, a) => n + a.days, 0)) });
    }
  }
  return out;
}

export const HOURS_PER_DAY = 8;

/** What Generate sends for the packages: the work items, the GlobalIds of each item's objects (for the 4D links), and the rules as the generator
    should read them: the sequences made from the packages' order and links, the methods as recipes for their groups (with the standard methods'
    crews), and the summary bars and limits of the packages that hold others. */
export function packagesRequest(packages: readonly WorkPackage[], contents: PackageContents, methods: Map<string, ResolvedMethod>, building: string, objectMethods?: (pkg: WorkPackage, objs: PackageObject[]) => Map<string, ResolvedMethod>): {
  workItems: { id: string; group: string; building: string; level: string; name: string; quantity: number; quantities: Record<string, number> }[];
  members: { guids: string[]; item: { id: string } }[];
  rules: (rules: ScenarioRules) => ScenarioRules;
} {
  const rows = treeRows(packages);
  const ordered = rows.map((r) => r.pkg);
  const code = new Map(rows.map((r) => [r.pkg.id, r.code]));
  const byId = new Map(ordered.map((p) => [p.id, p]));
  const groupFor = (id: string) => groupOf(byId.get(id)!, code.get(id)!);
  const live = rows.map((r) => ({ p: r.pkg, objs: contents.objects.get(r.pkg.id) ?? [] })).filter((x) => x.objs.length > 0);
  const liveIds = new Set(live.map((x) => x.p.id));
  const groups: RuleGroup[] = [];
  // A fine-tuned package: a work item per object, in its order (a sequence of its own); the package's group includes the objects' groups.
  const orderChains: { id: string; name: string; steps: SequenceStep[] }[] = [];
  const objectMethodsFor = new Map<string, { group: string; m: ResolvedMethod }[]>();
  const workItems: { id: string; group: string; building: string; level: string; name: string; quantity: number; quantities: Record<string, number> }[] = [];
  const members: { guids: string[]; item: { id: string } }[] = [];
  for (const { p, objs } of live) {
    const g = groupFor(p.id);
    if (!isFineTuned(p) || !objectMethods) {
      const q = quantities(objs);
      const storeys = [...new Set(objs.map((o) => o.storey))];
      workItems.push({ id: `WP|${p.id}`, group: g, building, level: storeys.length === 1 ? storeys[0] : '', name: g, quantity: q.volume, quantities: { count: q.count, area: q.area } });
      members.push({ guids: objs.map((o) => o.guid).filter(Boolean), item: { id: `WP|${p.id}` } });
      continue;
    }
    const runs = orderRuns(objs, p.objectOrder);
    const per = objectMethods(p, objs);
    const mine: { group: string; m: ResolvedMethod }[] = [];
    const steps: SequenceStep[] = [];
    let n = 0;
    runs.forEach((run, k) => {
      const runGroups = run.map((o) => {
        n++;
        const og = `${g} #${n}`;
        const id = `WP|${p.id}|${o.guid || o.key}`;
        workItems.push({ id, group: og, building, level: o.storey, name: `${g} - ${o.name || o.guid}`, quantity: o.volume, quantities: { count: 1, area: o.area } });
        members.push({ guids: o.guid ? [o.guid] : [], item: { id } });
        const m = per.get(o.key);
        if (m) mine.push({ group: og, m });
        return og;
      });
      if (runGroups.length === 1) steps.push({ group: runGroups[0] });
      else { const rid = `${g} step ${k + 1}`; groups.push({ id: rid, name: rid, forEach: [], filters: [], include: runGroups }); steps.push({ group: rid }); }
    });
    objectMethodsFor.set(p.id, mine);
    groups.push({ id: g, name: g, forEach: [], filters: [], include: Array.from({ length: n }, (_, i) => `${g} #${i + 1}`) });
    if (steps.length > 1) orderChains.push({ id: `WPO-${code.get(p.id)}`, name: `Object order: ${g}`, steps });
  }
  // A package that holds others is, for the generator, a group that includes the groups of every package in it with objects.
  const spanGroup = (id: string): string | null => {
    const ids = subtreeIds(ordered, id).filter((k) => liveIds.has(k));
    if (!ids.length) return null;
    if (ids.length === 1) return groupFor(ids[0]);
    const gid = `${groupFor(id)}${liveIds.has(id) ? ' (all)' : ''}`;
    if (!groups.some((g) => g.id === gid)) groups.push({ id: gid, name: gid, forEach: [], filters: [], include: ids.map(groupFor) });
    return gid;
  };
  // Sequences: the build order, one step per package (or per run of packages that start together); a package that starts after another than the
  // one above begins a new short sequence from that one, and the packages after it follow on in it.
  const chains: SequenceStep[][] = [[]];
  let chain = chains[0];
  const together = new Set<string>();
  live.forEach(({ p }, k) => {
    const g = groupFor(p.id);
    const lag = k > 0 && (p.lagDays ?? 0) > 0 ? { lagHours: (p.lagDays ?? 0) * HOURS_PER_DAY } : {};
    const target = k > 0 && p.after && linkTargets(ordered, p.id).some((t) => t.id === p.after) ? spanGroup(p.after) : null;
    if (target) { chain = [{ group: target }, { group: g, ...lag }]; chains.push(chain); return; }
    if (k > 0 && p.link === 'with' && chain.length) {
      const last = chain[chain.length - 1];
      const run = together.has(last.group) ? groups.find((x) => x.id === last.group) : undefined;
      if (run) run.include = [...(run.include ?? []), g];
      else { const id = `${last.group} + together`; groups.push({ id, name: id, forEach: [], filters: [], include: [last.group, g] }); together.add(id); last.group = id; }
      return;
    }
    chain.push({ group: g, ...lag });
  });
  // Summary bars and limits of the packages that hold others (and a bar for any package that asks for one).
  const bars: LevelTask[] = [];
  const limits: LimitRow[] = [];
  for (const r of rows) {
    const wantsBar = r.children > 0 ? r.pkg.bar !== false : r.pkg.bar === true;
    const g = wantsBar || (r.children > 0 && (r.pkg.maxAtOnce ?? 0) > 0) ? spanGroup(r.pkg.id) : null;
    if (!g) continue;
    if (wantsBar) bars.push({ id: `WPBAR-${r.code}`, name: groupFor(r.pkg.id), group: g });
    if (r.children > 0 && (r.pkg.maxAtOnce ?? 0) > 0) {
      const phases = [...new Set(subtreeIds(ordered, r.pkg.id).filter((k) => k !== r.pkg.id && liveIds.has(k)).flatMap((k) => methods.get(k)?.activities.map((a) => a.phase) ?? []))];
      for (const phase of phases) limits.push({ id: `WPLIM-${r.code}-${phase}`, phase, group: g, max: r.pkg.maxAtOnce! });
    }
  }
  return {
    workItems, members,
    rules: (rules) => {
      const overrides: Record<string, { recipe?: string; tasks?: Record<string, { days?: number }> }> = {};
      const extras: { recipeId: string; task: RecipeTask; before: boolean }[] = [];
      const stdRecipes: Recipe[] = [];
      const crewsUsed = new Map<string, { std: StandardMethod; people: number }>();
      const each = live.flatMap(({ p }) => objectMethodsFor.get(p.id)?.map((x) => ({ p, g: x.group, m: x.m as ResolvedMethod | undefined })) ?? [{ p, g: groupFor(p.id), m: methods.get(p.id) }]);
      for (const { p, g, m } of each) {
        if (!m) continue;
        if (m.kind === 'recipe') {
          const tasks = Object.fromEntries(m.activities.filter((a) => a.fixed && a.phase !== EXTRA_PHASE).map((a) => [a.phase, { days: a.days }]));
          overrides[g] = { recipe: m.key.slice(7), ...(Object.keys(tasks).length ? { tasks } : {}) };
          const extra = m.activities.find((a) => a.phase === EXTRA_PHASE);
          if (extra) extras.push({ recipeId: `${m.key.slice(7)} for ${g}`, task: { phase: EXTRA_PHASE, name: extra.name, formula: String(extra.days), priority: OVERRIDE_PRIORITY - 1 }, before: !!p.extra?.before });
          continue;
        }
        const std = STANDARD_METHODS.find((x) => `std:${x.id}` === m.key)!;
        const people = p.people && p.people > 0 ? p.people : std.crew.people;
        const crewId = people === std.crew.people ? std.crew.id : `${std.crew.id}-${people}`;
        crewsUsed.set(crewId, { std, people });
        const tasks: RecipeTask[] = m.activities.map((a) => ({ phase: a.phase, name: a.name, formula: String(a.days), crew: crewId, priority: OVERRIDE_PRIORITY - 1 }));
        stdRecipes.push({ id: `${std.name} for ${g}`, group: g, priority: OVERRIDE_PRIORITY, tasks });
      }
      // A recipe made from a standard method names its crew: that crew is sent too.
      for (const r of rules.recipes ?? []) for (const t of r.tasks) {
        const std = t.crew ? STANDARD_METHODS.find((x) => norm(x.crew.id) === norm(t.crew!)) : undefined;
        if (std && !crewsUsed.has(std.crew.id)) crewsUsed.set(std.crew.id, { std, people: std.crew.people });
      }
      const trades: TradeRow[] = [...new Map([...crewsUsed.values()].map((c) => [c.std.crew.id, c.std])).values()].filter((s) => !rules.trades.some((t) => norm(t.id) === norm(s.crew.id))).map((s) => ({ id: s.crew.id, name: s.crew.name, capacity: 0 }));
      const crews: CrewTemplate[] = [...crewsUsed].filter(([id]) => !rules.crewTemplates.some((c) => norm(c.id) === norm(id))).map(([id, c]) => ({ id, trades: [{ trade: c.std.crew.id, size: c.people }] }));
      const ownIds = new Set([STEPS_ID, ...chains.map((_, i) => `${STEPS_ID}-${i + 1}`), ...orderChains.map((c) => c.id)].map((s) => s.toUpperCase()));
      const others = rules.sequences.filter((q) => !ownIds.has(q.id.toUpperCase()));
      const sequences = chains.map((steps, i) => ({ id: i === 0 ? STEPS_ID : `${STEPS_ID}-${i + 1}`, name: i === 0 ? 'Work packages' : `Work packages: ${steps[1]?.group ?? ''} starts after ${steps[0]?.group ?? ''}`, steps })).filter((q, i) => i === 0 ? q.steps.length > 0 : q.steps.length > 1);
      const { breakdown: _b, ...rest } = rules;
      const recipes = withItemOverrides(rest.recipes ?? [], overrides).map((r) => {
        const add = extras.filter((x) => x.recipeId === r.id);
        if (!add.length) return r;
        return { ...r, tasks: [...add.filter((x) => x.before).map((x) => x.task), ...r.tasks, ...add.filter((x) => !x.before).map((x) => x.task)] };
      });
      return {
        ...rest,
        sequences: [...sequences, ...orderChains, ...others],
        groups: [...rest.groups.filter((g) => !groups.some((x) => x.id === g.id)), ...groups],
        recipes: [...stdRecipes, ...recipes],
        trades: [...rest.trades, ...trades],
        crewTemplates: [...rest.crewTemplates, ...crews],
        levelTasks: [...rest.levelTasks, ...bars],
        limits: [...rest.limits, ...limits],
      };
    },
  };
}

const positive = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

/** Cleans saved packages (in tree order). */
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
    const objectOrder = p.objectOrder && typeof p.objectOrder === 'object' ? Object.fromEntries(Object.entries(p.objectOrder).filter(([k, v]) => k && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) : undefined;
    const extra = p.extra && typeof p.extra === 'object' && text(p.extra.name) ? { name: text(p.extra.name), days: Number.isFinite(Number(p.extra.days)) && Number(p.extra.days) >= 0 ? Number(p.extra.days) : 1, ...(p.extra.before ? { before: true } : {}) } : undefined;
    out.push({
      id, name: text(p.name), color: text(p.color) || '#888888', parts,
      ...(text(p.parent) ? { parent: text(p.parent) } : {}),
      ...(p.link === 'with' ? { link: 'with' as const } : {}),
      ...(positive(p.lagDays) ? { lagDays: positive(p.lagDays) } : {}),
      ...(text(p.after) ? { after: text(p.after) } : {}),
      ...(text(p.method) ? { method: text(p.method) } : {}),
      ...(days && Object.keys(days).length ? { days } : {}),
      ...(positive(p.totalDays) ? { totalDays: positive(p.totalDays) } : {}),
      ...(positive(p.people) ? { people: Math.round(positive(p.people)!) } : {}),
      ...(extra ? { extra } : {}),
      ...(typeof p.bar === 'boolean' ? { bar: p.bar } : {}),
      ...(positive(p.maxAtOnce) ? { maxAtOnce: Math.round(positive(p.maxAtOnce)!) } : {}),
      ...(objectOrder && Object.keys(objectOrder).length ? { objectOrder } : {}),
    });
  }
  const ordered = inTreeOrder(out).map((p) => { if (p.parent === undefined && 'parent' in p) { const { parent: _x, ...rest } = p; return rest; } return p; });
  return ordered.length ? ordered : undefined;
}
