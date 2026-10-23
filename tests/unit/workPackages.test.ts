import { describe, expect, it } from 'vitest';
import { NO_RULES, normalizeRules } from '../../src/prs/rules';
import type { Recipe } from '../../src/prs/recipes';
import {
  className, contentsOf, groupBySets, groupByStoreyAndClass, groupOf, mergePackages, normalizePackages, orderBottomUp, packagesRequest, plural,
  quantityOf, resolveMethod, splitPackage, timelineOf, type PackageObject, type WorkPackage,
} from '../../src/prs/workPackages';
import { chooseMethod, taskDays, STANDARD_METHODS } from '../../src/prs/standardMethods';

const obj = (key: string, storey: string, rank: number, cls: string, extra: Partial<PackageObject> = {}): PackageObject =>
  ({ key, guid: `G-${key}`, name: key, cls, storey, storeyRank: rank, material: '', props: {}, volume: 0, area: 0, ...extra });

const objects: PackageObject[] = [
  obj('m:1', 'Level 2', 1, 'IFCSLAB', { volume: 30 }),
  obj('m:2', 'Level 1', 0, 'IFCWALL', { volume: 10, props: { 'P.Zone': 'A' } }),
  obj('m:3', 'Level 1', 0, 'IFCWALL', { volume: 20, props: { 'P.Zone': 'B' } }),
  obj('m:4', 'Level 1', 0, 'IFCCOLUMN', { volume: 4 }),
];
const colors = (n: number) => Array.from({ length: n }, (_, i) => `#00000${i}`);
const noSets = () => false;

describe('making packages', () => {
  it('groups by storey and class, bottom up, in the usual order of the work on a storey', () => {
    const p = groupByStoreyAndClass(objects, colors);
    expect(p.map((x) => x.name)).toEqual(['Level 1 Columns', 'Level 1 Walls', 'Level 2 Slabs']);
    const c = contentsOf(p, objects, noSets);
    expect(c.objects.get(p[1].id)!.map((o) => o.key)).toEqual(['m:2', 'm:3']);
  });

  it('names IFC classes for people', () => {
    expect(className('IFCWALLSTANDARDCASE')).toBe('Wall');
    expect(className('IFCBUILDINGELEMENTPROXY')).toBe('Building element proxy');
    expect(plural('Stair flight')).toBe('Stair flights');
    expect(plural('Building element proxy')).toBe('Building element proxies');
  });

  it('gives an object to the first package that holds it', () => {
    const a: WorkPackage = { id: 'A', name: 'All on level 1', color: '', parts: [{ storey: 'Level 1' }] };
    const b: WorkPackage = { id: 'B', name: 'Walls', color: '', parts: [{ cls: 'IFCWALL' }] };
    const c = contentsOf([a, b], objects, noSets);
    expect(c.objects.get('B')).toEqual([]);
    expect(c.taken.get('B')).toBe(2);
  });

  it('makes one package per search set that finds something', () => {
    const p = groupBySets(['S1', 'Empty', 'S2'], (s) => (s === 'Empty' ? 0 : 3), colors);
    expect(p.map((x) => x.parts)).toEqual([[{ set: 'S1' }], [{ set: 'S2' }]]);
    const c = contentsOf(p, objects, (set, key) => set === 'S1' && key === 'm:4');
    expect(c.objects.get(p[0].id)!.map((o) => o.key)).toEqual(['m:4']);
  });

  it('splits by a property and merges', () => {
    const p = groupByStoreyAndClass(objects, colors);
    const walls = p[1];
    const split = splitPackage(p, walls.id, 'P.Zone', contentsOf(p, objects, noSets).objects.get(walls.id)!, colors);
    expect(split.map((x) => x.name)).toEqual(['Level 1 Columns', 'Level 1 Walls · A', 'Level 1 Walls · B', 'Level 2 Slabs']);
    const c = contentsOf(split, objects, noSets);
    expect(c.objects.get(split[2].id)!.map((o) => o.key)).toEqual(['m:3']);
    const merged = mergePackages(split, split[1].id, split[2].id);
    expect(merged).toHaveLength(3);
    expect(contentsOf(merged, objects, noSets).objects.get(merged[1].id)!.map((o) => o.key)).toEqual(['m:2', 'm:3']);
  });

  it('orders bottom up', () => {
    const p = groupByStoreyAndClass(objects, colors);
    const shuffled = [p[2], p[1], p[0]];
    expect(orderBottomUp(shuffled, contentsOf(shuffled, objects, noSets)).map((x) => x.name)).toEqual(['Level 1 Columns', 'Level 1 Walls', 'Level 2 Slabs']);
  });

  it('reads a net quantity first', () => {
    expect(quantityOf({ 'Qto.GrossVolume': 5, 'Qto.NetVolume': 4, 'P.Name': 'x' }, /Volume$/i)).toBe(4);
    expect(quantityOf({ 'Qto.GrossVolume': 5 }, /Volume$/i)).toBe(5);
    expect(quantityOf({}, /Area$/i)).toBe(0);
  });

  it('keeps saved packages clean and in the rules', () => {
    const clean = normalizePackages([{ id: 'A', name: ' X ', color: '#111', parts: [{ storey: '', cls: 'IFCWALL', where: { 'P.Z': 1 } }], lagDays: -2, link: 'with' }, { id: 'A' }, 'junk']);
    expect(clean).toEqual([{ id: 'A', name: 'X', color: '#111', parts: [{ storey: '', cls: 'IFCWALL', where: { 'P.Z': '1' } }], link: 'with' }]);
    expect(normalizeRules({ packages: clean }).packages).toEqual(clean);
  });
});

describe('methods', () => {
  it('chooses a standard method from what the objects are, and says why', () => {
    expect(chooseMethod([{ cls: 'IFCWALL', material: 'Concrete C30/37', name: '' }]).method.id).toBe('insitu');
    expect(chooseMethod([{ cls: 'IFCMEMBER', material: 'Steel S355', name: '' }]).method.id).toBe('steel');
    expect(chooseMethod([{ cls: 'IFCSLAB', material: '', name: 'Precast plank' }]).method.id).toBe('precast');
    const none = chooseMethod([{ cls: 'IFCFLOWTERMINAL', material: '', name: '' }]);
    expect(none.method.id).toBe('install');
    expect(none.why).toMatch(/nothing/);
  });

  it('works out days from the quantity, or from the count when the objects carry none', () => {
    const rebar = STANDARD_METHODS[0].tasks[0];
    expect(taskDays(rebar, { volume: 40, area: 0, count: 3 }).days).toBe(3);
    expect(taskDays(rebar, { volume: 0, area: 0, count: 13 })).toMatchObject({ days: 3 });
    expect(taskDays(rebar, { volume: 1, area: 0, count: 1 }).days).toBe(1);
  });

  it('prefers the hand choice, then a project recipe for the package’s set, then a standard method', () => {
    const recipes: Recipe[] = [{ id: 'R1', name: 'Own way', group: 'S1', tasks: [{ phase: 'X', days: 2 }] }];
    const days = (r: Recipe) => r.tasks.map((t) => ({ phase: t.phase, name: t.phase, days: t.days ?? 1, how: 'fixed', crew: '' }));
    const pkg: WorkPackage = { id: 'A', name: 'A', color: '', parts: [{ set: 'S1' }] };
    const walls = objects.slice(1, 3);
    expect(resolveMethod(pkg, walls, recipes, days)).toMatchObject({ key: 'recipe:R1', chosen: false, days: 2 });
    expect(resolveMethod({ ...pkg, parts: [{ cls: 'IFCWALL' }] }, walls, recipes, days)).toMatchObject({ key: 'std:insitu', chosen: false });
    const fixed = resolveMethod({ ...pkg, method: 'std:steel', days: { Erect: 9 } }, walls, recipes, days);
    expect(fixed).toMatchObject({ key: 'std:steel', chosen: true });
    expect(fixed.activities[0]).toMatchObject({ phase: 'Erect', days: 9, fixed: true });
  });
});

describe('sequence and generate', () => {
  const pkgs: WorkPackage[] = [
    { id: 'A', name: 'First', color: '', parts: [{ cls: 'IFCCOLUMN' }] },
    { id: 'B', name: 'Second', color: '', parts: [{ cls: 'IFCWALL' }], lagDays: 2 },
    { id: 'C', name: 'Third', color: '', parts: [{ cls: 'IFCSLAB' }], link: 'with' },
  ];

  it('places packages after, or together with, the one above, with the lag', () => {
    const days: Record<string, number> = { A: 3, B: 5, C: 4 };
    expect(timelineOf(pkgs, (p) => days[p.id])).toEqual([{ id: 'A', start: 0, finish: 3 }, { id: 'B', start: 5, finish: 10 }, { id: 'C', start: 5, finish: 9 }]);
  });

  it('sends work items, steps (packages that start together share one), methods as recipes and the standard crews', () => {
    const contents = contentsOf(pkgs, objects, noSets);
    const methods = new Map(pkgs.map((p) => [p.id, resolveMethod(p, contents.objects.get(p.id)!, [], () => [])]));
    const req = packagesRequest(pkgs, contents, methods, 'B1');
    expect(req.workItems.map((w) => [w.id, w.group, w.level, w.quantity])).toEqual([['WP|A', 'WP-01 First', 'Level 1', 4], ['WP|B', 'WP-02 Second', 'Level 1', 30], ['WP|C', 'WP-03 Third', 'Level 2', 30]]);
    expect(req.members[1].guids).toEqual(['G-m:2', 'G-m:3']);
    const rules = req.rules({ ...NO_RULES, breakdown: { levels: [] } });
    expect(rules.breakdown).toBeUndefined();
    expect(rules.sequences[0].steps).toEqual([{ group: 'WP-01 First' }, { group: 'WP-02 Second + together', lagHours: 16 }]);
    expect(rules.groups).toEqual([{ id: 'WP-02 Second + together', name: 'WP-02 Second + together', forEach: [], filters: [], include: ['WP-02 Second', 'WP-03 Third'] }]);
    expect(rules.recipes[0]).toMatchObject({ id: 'In-situ concrete for WP-01 First', group: 'WP-01 First', priority: 1000 });
    expect(rules.recipes[0].tasks.map((t) => [t.phase, t.formula, t.crew])).toEqual([['Rebar', '1', 'STD-CONCRETE'], ['Formwork', '1', 'STD-CONCRETE'], ['Concrete', '1', 'STD-CONCRETE']]);
    expect(rules.trades).toEqual([{ id: 'STD-CONCRETE', name: 'Concrete gang', capacity: 0 }]);
    expect(rules.crewTemplates).toEqual([{ id: 'STD-CONCRETE', trades: [{ trade: 'STD-CONCRETE', size: 6 }] }]);
    expect(groupOf(pkgs[0], 0)).toBe('WP-01 First');
  });

  it('sends a chosen project recipe as a copy for the package', () => {
    const recipes: Recipe[] = [{ id: 'R1', group: 'Other', tasks: [{ phase: 'X', days: 2 }] }];
    const one = [pkgs[0]];
    const contents = contentsOf(one, objects, noSets);
    const m = resolveMethod({ ...pkgs[0], method: 'recipe:R1' }, contents.objects.get('A')!, recipes, (r) => r.tasks.map((t) => ({ phase: t.phase, name: t.phase, days: 2, how: '', crew: '' })));
    const rules = packagesRequest(one, contents, new Map([['A', m]]), 'B1').rules({ ...NO_RULES, recipes });
    expect(rules.recipes[0]).toMatchObject({ id: 'R1 for WP-01 First', group: 'WP-01 First', priority: 1000 });
  });
});
