import { describe, expect, it } from 'vitest';
import { NO_RULES } from '../../src/prs/rules';
import { compactOrder, listRows, orderFromRanks, orderRuns, ranksFromList, ranksFromSets } from '../../src/prs/objectOrder';
import { contentsOf, normalizePackages, objectMethodsOf, packagesRequest, resolveMethod, type PackageObject, type WorkPackage } from '../../src/prs/workPackages';
import { recipeFromStandard } from '../../src/prs/standardRecipe';
import { STANDARD_METHODS } from '../../src/prs/standardMethods';

const obj = (n: number, volume = 10): PackageObject => ({ key: `m:${n}`, guid: `G${n}`, name: `Obj ${n}`, cls: 'IFCWALL', storey: 'L00', storeyRank: 0, material: '', props: {}, volume, area: 0 });
const objs = [obj(1), obj(2), obj(3), obj(4)];

describe('object order', () => {
  it('builds runs: lower ranks first, equal ranks together, the unranked after one by one', () => {
    expect(orderRuns(objs, { G3: 1, G1: 2, G4: 2 }).map((r) => r.map((o) => o.guid))).toEqual([['G3'], ['G1', 'G4'], ['G2']]);
    expect(compactOrder(objs, { G3: 10, G1: 25, G4: 25 })).toEqual({ G3: 1, G1: 2, G4: 2, G2: 3 });
    expect(orderFromRanks(objs, new Map([['G2', 5], ['X', 1]]))).toEqual({ order: { G2: 5 }, found: 1 });
  });

  it('reads a list by GlobalId, key or name, with or without ranks, and says what it does not know', () => {
    const r = ranksFromList(listRows('Id\nG4\nobj 2\nm:1\nnobody'), objs);
    expect([...r.ranks]).toEqual([['G4', 1], ['G2', 2], ['G1', 3]]);
    expect(r.unmatched).toEqual(['nobody']);
    expect([...ranksFromList(listRows('5\tG1\n2;G3'), objs).ranks]).toEqual([['G1', 5], ['G3', 2]]);
  });

  it('ranks by the first set, or folder, that holds an object', () => {
    const sets = [{ name: 'B', group: 'F2' }, { name: 'A', group: 'F1' }, { name: 'C', group: 'F2' }];
    const finds = (s: string, key: string) => (s === 'A' && key === 'm:1') || (s === 'B' && key === 'm:2') || (s === 'C' && key === 'm:3');
    expect([...ranksFromSets(objs, sets, finds)]).toEqual([['G1', 2], ['G2', 1], ['G3', 3]]);
    expect([...ranksFromSets(objs, sets, finds, true)]).toEqual([['G1', 2], ['G2', 1], ['G3', 1]]);
  });
});

describe('a fine-tuned package for the generator', () => {
  const pkgs: WorkPackage[] = normalizePackages([
    { id: 'A', name: 'Walls', color: '', parts: [{ cls: 'IFCWALL' }], method: 'std:install', objectOrder: { G2: 1, G1: 2, G3: 2 }, totalDays: 9 },
    { id: 'B', name: 'Next', color: '', parts: [{ cls: 'IFCSLAB' }] },
  ])!;
  const all = [...objs, { ...obj(5), cls: 'IFCSLAB' }];
  const contents = contentsOf(pkgs, all, () => false);
  const resolve = (p: WorkPackage, o: PackageObject[]) => resolveMethod(p, o, [], () => []);
  const methods = new Map(pkgs.map((p) => [p.id, resolve(p, contents.objects.get(p.id)!)]));

  it('shares the package’s days among its objects in their order', () => {
    const per = objectMethodsOf(pkgs[0], contents.objects.get('A')!, resolve);
    // Runs: [G2], [G1, G3], [G4]: one day each at the standard rate, 3 in a row, made 9.
    expect([...per.values()].map((m) => m.days)).toEqual([3, 3, 3, 3]);
  });

  it('sends a work item per object, an order sequence, and the package as the group of its objects', () => {
    const req = packagesRequest(pkgs, contents, methods, 'B1', (p, o) => objectMethodsOf(p, o, resolve));
    expect(req.workItems.map((w) => [w.id, w.group])).toEqual([
      ['WP|A|G2', 'WP-01 Walls #1'], ['WP|A|G1', 'WP-01 Walls #2'], ['WP|A|G3', 'WP-01 Walls #3'], ['WP|A|G4', 'WP-01 Walls #4'], ['WP|B', 'WP-02 Next'],
    ]);
    expect(req.members[0]).toEqual({ guids: ['G2'], item: { id: 'WP|A|G2' } });
    const rules = req.rules({ ...NO_RULES });
    expect(rules.sequences.map((s) => [s.id, s.steps.map((x) => x.group)])).toEqual([
      ['STEPS', ['WP-01 Walls', 'WP-02 Next']],
      ['WPO-WP-01', ['WP-01 Walls #1', 'WP-01 Walls step 2', 'WP-01 Walls #4']],
    ]);
    expect(rules.groups.find((g) => g.id === 'WP-01 Walls')!.include).toEqual(['WP-01 Walls #1', 'WP-01 Walls #2', 'WP-01 Walls #3', 'WP-01 Walls #4']);
    expect(rules.groups.find((g) => g.id === 'WP-01 Walls step 2')!.include).toEqual(['WP-01 Walls #2', 'WP-01 Walls #3']);
    expect(rules.recipes.filter((r) => r.group.startsWith('WP-01 Walls #')).length).toBe(4);
  });
});

describe('recipes like a standard method', () => {
  it('copies the activities, with a volume formula for rates per m³, and its crew is sent', () => {
    const r = recipeFromStandard(STANDARD_METHODS[0], [STANDARD_METHODS[0].name]);
    expect(r.id).toBe(`${STANDARD_METHODS[0].name} 2`);
    expect(r.tasks[0]).toMatchObject({ phase: 'Rebar', formula: 'max(1, ceil(Concrete_m3 / 15))', crew: 'STD-CONCRETE' });
    const one: WorkPackage[] = [{ id: 'A', name: 'A', color: '', parts: [{ cls: 'IFCWALL' }], method: `recipe:${r.id}` }];
    const c = contentsOf(one, objs, () => false);
    const m = new Map([['A', resolveMethod(one[0], c.objects.get('A')!, [r], (x) => x.tasks.map((t) => ({ phase: t.phase, name: t.phase, days: 1, how: '', crew: '' })))]]);
    const rules = packagesRequest(one, c, m, 'B1').rules({ ...NO_RULES, recipes: [r] });
    expect(rules.crewTemplates).toEqual([{ id: 'STD-CONCRETE', trades: [{ trade: 'STD-CONCRETE', size: 6 }] }]);
  });
});
