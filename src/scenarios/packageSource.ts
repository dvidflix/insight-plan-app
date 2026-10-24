import type { ViewerEngine } from '../viewer/ViewerEngine';
import { runSearchSet, type SearchSet } from '../viewer/searchSets';
import type { Recipe } from '../prs/recipes';
import type { ScenarioRules } from '../prs/rules';
import type { ScenarioCrew } from './api';
import { NOT_WORK } from '../prs/standardMethods';
import { planWorkItem } from '../prs/activityPlan';
import { contentsOf, isFineTuned, materialOf, objectMethodsOf, packagesRequest, quantityOf, resolveMethod, serialDays, type PackageContents, type PackageObject, type ResolvedMethod, type WorkPackage } from '../prs/workPackages';
import { orderRuns, withSequenceOrder } from '../prs/objectOrder';

/** The loaded models as Generate 3's packages read them: every object that is work (not a space, an opening or the spatial structure), with its
    storey (from the model's spatial tree, ranked from the bottom by elevation, else by the tree's order), its IFC class, material and quantities. */
export function packageObjects(engine: ViewerEngine): PackageObject[] {
  const out: PackageObject[] = [];
  for (const [modelId, index] of engine.getIndexes()) {
    const storeys = engine.getStoreys(modelId);
    const heights = engine.getStoreyElevations(modelId);
    const ranked = storeys.map((s, i) => ({ s, i, h: heights.get(s.name) ?? null })).sort((a, b) => (a.h !== null && b.h !== null ? a.h - b.h : a.i - b.i));
    const rankOf = new Map(ranked.map((x, r) => [x.s.name, r]));
    const storeyOf = new Map<number, string>();
    for (const s of storeys) for (const id of s.ids) if (!storeyOf.has(id)) storeyOf.set(id, s.name);
    const buildingOf = new Map<number, string>();
    for (const b of engine.getBuildings(modelId)) for (const id of b.ids) if (!buildingOf.has(id) && b.name.trim()) buildingOf.set(id, b.name.trim());
    for (const [id, e] of index.elements) {
      const cls = (e.category || '').toUpperCase();
      if (!cls || NOT_WORK.test(cls)) continue;
      const storey = storeyOf.get(id) ?? '';
      out.push({ key: `${modelId}:${id}`, guid: e.guid, name: e.name, cls, storey, building: buildingOf.get(id) ?? '', storeyRank: storey ? rankOf.get(storey) ?? 0 : Number.MAX_SAFE_INTEGER, material: materialOf(e.props), props: e.props, volume: quantityOf(e.props, /Volume$/i), area: quantityOf(e.props, /(Net|Gross)?(Side|Footprint)?Area$/i) });
    }
  }
  return out;
}

/** Whether a search set finds an object, with each set run once. */
export function setFinder(engine: ViewerEngine, sets: readonly SearchSet[]): (set: string, key: string) => boolean {
  const cache = new Map<string, Set<string>>();
  return (name, key) => {
    const k = name.trim().toUpperCase();
    let found = cache.get(k);
    if (!found) {
      found = new Set<string>();
      for (const s of sets) if (s.name.trim().toUpperCase() === k) for (const [m, ids] of Object.entries(runSearchSet(engine.getIndexes(), s))) for (const id of ids) found.add(`${m}:${id}`);
      cache.set(k, found);
    }
    return found.has(key);
  };
}

/** The activities a project recipe would give a package, with their days and crews, as the generator would work them out for a work item with the
    package's volume (prs/activityPlan.ts). */
export function recipeDays(rules: ScenarioRules, crewSheet: ScenarioCrew[]) {
  return (recipe: Recipe, q: { volume: number }) => {
    const plan = planWorkItem({
      group: 'package', recipes: [{ ...recipe, group: 'package', priority: 0 }], rules, crewSheet, membership: new Map(),
      facts: [{ key: 'package', building: '', level: '', levelNumber: null, type: '', stage: '', zone: '', family: '', volume: q.volume, values: {} }],
    });
    return plan.activities.map((a) => ({ phase: a.phase, name: a.name, days: a.days ? a.days.max : 1, how: a.days ? a.days.how : a.daysNote ?? 'the generator’s 1 day', crew: a.crew?.label ?? '', ...(a.days ? {} : { unknown: true }) }));
  };
}

/** Everything Generate 3 shows of the packages: what each holds and the method each is built with. */
export function packagesView(engine: ViewerEngine, saved: readonly WorkPackage[], sets: readonly SearchSet[], recipes: readonly Recipe[], rules: ScenarioRules, crewSheet: ScenarioCrew[], objects = packageObjects(engine), ranks?: ReadonlyMap<string, number>): { objects: PackageObject[]; contents: PackageContents; methods: Map<string, ResolvedMethod>; objectMethods: (pkg: WorkPackage, objs: PackageObject[]) => Map<string, ResolvedMethod>; daysOf: Map<string, number>; packages: WorkPackage[] } {
  const contents = contentsOf(saved, objects, setFinder(engine, sets));
  // The object sequence (step 4), when used, gives each package without its own object order one.
  const packages = ranks && ranks.size ? withSequenceOrder(saved, contents, ranks) : [...saved];
  const days = recipeDays(rules, crewSheet);
  const methods = new Map(packages.map((p) => [p.id, resolveMethod(p, contents.objects.get(p.id) ?? [], recipes, days)]));
  const objectMethods = (pkg: WorkPackage, objs: PackageObject[]) => objectMethodsOf(pkg, objs, (p, o) => resolveMethod(p, o, recipes, days));
  // A package's days on the timeline: its method's, or for one fine-tuned, its objects' one after another.
  const daysOf = new Map(packages.map((p) => {
    const objs = contents.objects.get(p.id) ?? [];
    return [p.id, isFineTuned(p) && objs.length ? serialDays(orderRuns(objs, p.objectOrder), objectMethods(p, objs)) : methods.get(p.id)?.days ?? 0];
  }));
  return { objects, contents, methods, objectMethods, daysOf, packages };
}

/** The request Update 4D sends for the packages (see prs/workPackages.ts packagesRequest). */
export function buildPackagesRequest(engine: ViewerEngine, rules: ScenarioRules, sets: readonly SearchSet[], recipes: Recipe[], crewSheet: ScenarioCrew[], building: string, ranks?: ReadonlyMap<string, number>) {
  const view = packagesView(engine, rules.packages ?? [], sets, recipes, rules, crewSheet, undefined, rules.objectSequence ? ranks : undefined);
  // "Follow it exactly" (step 4): the table's order is the build order, across the packages.
  return packagesRequest(view.packages, view.contents, view.methods, building, view.objectMethods, rules.objectSequence === 'exact' && ranks?.size ? ranks : undefined);
}
