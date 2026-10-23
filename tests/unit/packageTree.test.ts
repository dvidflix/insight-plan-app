import { describe, expect, it } from 'vitest';
import { NO_RULES } from '../../src/prs/rules';
import type { Recipe } from '../../src/prs/recipes';
import { codesOf, inTreeOrder, indentPackage, movePackage, outdentPackage, removePackage, subtreeIds, treeRows } from '../../src/prs/packageTree';
import {
  STOREY_FIELD, appendPackages, buildingCode, labelOf, contentsOf, groupByFolders, linkTargets, normalizePackages, orderBottomUp, packagesRequest, resolveMethod, spoolPackages,
  spoolTree, splitPackage, timelineOf, whereParts, type PackageObject, type WorkPackage,
} from '../../src/prs/workPackages';

const obj = (key: string, storey: string, rank: number, cls: string, extra: Partial<PackageObject> = {}): PackageObject =>
  ({ key, guid: `G-${key}`, name: key, cls, storey, storeyRank: rank, material: '', props: {}, volume: 0, area: 0, ...extra });

const objects: PackageObject[] = [
  obj('m:1', 'L01', 1, 'IFCSLAB', { volume: 30, props: { 'P.Block': 'B' } }),
  obj('m:2', 'L00', 0, 'IFCWALL', { volume: 10, props: { 'P.Block': 'A' } }),
  obj('m:3', 'L01', 1, 'IFCWALL', { volume: 20, props: { 'P.Block': 'A' } }),
  obj('m:4', 'L00', 0, 'IFCCOLUMN', { volume: 4, props: { 'P.Block': 'A' } }),
  obj('m:5', 'L00', 0, 'IFCCOLUMN', { volume: 1 }),
];
const colors = (n: number) => Array.from({ length: n }, (_, i) => `#c${i}`);
const noSets = () => false;
const pk = (id: string, parent?: string, extra: Partial<WorkPackage> = {}): WorkPackage => ({ id, name: id, color: '', parts: [], ...(parent ? { parent } : {}), ...extra });

describe('the package tree', () => {
  const tree = [pk('A'), pk('B'), pk('A1', 'A'), pk('A2', 'A'), pk('A1x', 'A1')];

  it('keeps tree order and codes', () => {
    expect(inTreeOrder(tree).map((p) => p.id)).toEqual(['A', 'A1', 'A1x', 'A2', 'B']);
    expect([...codesOf(tree)]).toEqual([['A', 'WP-01'], ['A1', 'WP-01.01'], ['A1x', 'WP-01.01.01'], ['A2', 'WP-01.02'], ['B', 'WP-02']]);
    expect(treeRows(tree).map((r) => [r.pkg.id, r.depth, r.children])).toEqual([['A', 0, 2], ['A1', 1, 1], ['A1x', 2, 0], ['A2', 1, 0], ['B', 0, 0]]);
    expect(subtreeIds(tree, 'A')).toEqual(['A', 'A1', 'A2', 'A1x']);
  });

  it('cuts loops and missing parents', () => {
    expect(inTreeOrder([pk('X', 'Y'), pk('Y', 'X'), pk('Z', 'nobody')]).map((p) => [p.id, p.parent])).toEqual([['X', undefined], ['Y', undefined], ['Z', undefined]]);
  });

  it('moves a package with what it holds, before, after or inside another', () => {
    expect(movePackage(tree, 'A1', 'after', 'B').map((p) => [p.id, p.parent ?? ''])).toEqual([['A', ''], ['A2', 'A'], ['B', ''], ['A1', ''], ['A1x', 'A1']]);
    expect(movePackage(tree, 'B', 'inside', 'A1').map((p) => p.id)).toEqual(['A', 'A1', 'A1x', 'B', 'A2']);
    expect(movePackage(tree, 'B', 'before', 'A').map((p) => p.id)).toEqual(['B', 'A', 'A1', 'A1x', 'A2']);
    // Never into itself.
    expect(movePackage(tree, 'A', 'inside', 'A1x').map((p) => p.id)).toEqual(['A', 'A1', 'A1x', 'A2', 'B']);
  });

  it('indents, outdents and removes', () => {
    expect(indentPackage(tree, 'B').find((p) => p.id === 'B')!.parent).toBe('A');
    expect(outdentPackage(tree, 'A1').map((p) => [p.id, p.parent ?? ''])).toEqual([['A', ''], ['A2', 'A'], ['A1', ''], ['A1x', 'A1'], ['B', '']]);
    expect(removePackage(tree, 'A1').map((p) => [p.id, p.parent ?? ''])).toEqual([['A', ''], ['A1x', 'A'], ['A2', 'A'], ['B', '']]);
  });
});

describe('objects in a tree of packages', () => {
  it('lets the packages inside take their objects first, and adds them up', () => {
    const pkgs = [pk('All', undefined, { parts: [{ storey: 'L00' }] }), pk('Cols', 'All', { parts: [{ cls: 'IFCCOLUMN' }] })];
    const c = contentsOf(pkgs, objects, noSets);
    expect(c.objects.get('Cols')!.map((o) => o.key)).toEqual(['m:4', 'm:5']);
    expect(c.objects.get('All')!.map((o) => o.key)).toEqual(['m:2']);
    expect(c.all.get('All')!.map((o) => o.key).sort()).toEqual(['m:2', 'm:4', 'm:5']);
  });

  it('orders bottom up inside each package', () => {
    const pkgs = [pk('A'), pk('A-up', 'A', { parts: [{ storey: 'L01', where: { 'P.Block': 'A' } }] }), pk('A-down', 'A', { parts: [{ storey: 'L00', where: { 'P.Block': 'A' } }] }), pk('B', undefined, { parts: [{ where: { 'P.Block': 'B' } }] })];
    expect(orderBottomUp(pkgs, contentsOf(pkgs, objects, noSets)).map((p) => p.id)).toEqual(['A', 'A-down', 'A-up', 'B']);
  });

  it('splits a package inside itself', () => {
    const pkgs = [pk('W', undefined, { parts: [{ cls: 'IFCWALL' }], method: 'std:steel' })];
    const split = splitPackage(pkgs, 'W', 'storey', contentsOf(pkgs, objects, noSets).objects.get('W')!, colors, true);
    expect(split.map((p) => [p.name, p.parent ?? '', p.parts.length])).toEqual([['W', '', 0], ['L00', 'W', 1], ['L01', 'W', 1]]);
    expect(split[1].method).toBe('std:steel');
  });

  it('makes a tree from folders of search sets', () => {
    const made = groupByFolders([{ name: 'S1', folder: 'Top / Mid' }, { name: 'S2', folder: 'Top' }, { name: 'S3', folder: '' }], ' / ', () => 1, colors);
    expect(treeRows(made).map((r) => [r.code, r.pkg.name, r.pkg.parts])).toEqual([
      ['WP-01', 'Top', []], ['WP-01.01', 'Mid', []], ['WP-01.01.01', 'S1', [{ set: 'S1' }]], ['WP-01.02', 'S2', [{ set: 'S2' }]], ['WP-02', 'S3', [{ set: 'S3' }]],
    ]);
    const added = appendPackages([pk('P1'), pk('P2')], made, 'P2');
    expect(new Set(added.map((p) => p.id)).size).toBe(7);
    expect(added.find((p) => p.name === 'Top')!.parent).toBe('P2');
  });
});

describe('spool from properties', () => {
  it('makes a package per value of the first property holding one per value of the second', () => {
    const { tree, missing } = spoolTree(objects, 'P.Block', STOREY_FIELD);
    expect(missing).toBe(1);
    expect(tree.map((t) => [t.label, t.count, t.children.map((s) => [s.label, s.objects.length, s.volume])])).toEqual([
      ['A', 3, [['L00', 2, 14], ['L01', 1, 20]]],
      ['B', 1, [['L01', 1, 30]]],
    ]);
    const pkgs = spoolPackages(tree, [pk('P1')], colors, (t, s) => whereParts('P.Block', t.value, STOREY_FIELD, s.value));
    expect(pkgs.map((p) => [p.name, p.parent ?? ''])).toEqual([['A', ''], ['L00', 'P2'], ['L01', 'P2'], ['B', ''], ['L01', 'P5']]);
    const c = contentsOf(pkgs, objects, noSets);
    expect(c.objects.get('P3')!.map((o) => o.key)).toEqual(['m:2', 'm:4']);
    expect(c.all.get('P2')!.length).toBe(3);
  });
});

describe('links, bars, limits and overrides', () => {
  // A (holding A1, A2) then B; B starts after A1 (not after A2, the one above), with 2 days' gap.
  const pkgs: WorkPackage[] = [
    pk('A', undefined, { maxAtOnce: 1 }),
    pk('A1', 'A', { parts: [{ storey: 'L00', cls: 'IFCCOLUMN' }] }),
    pk('A2', 'A', { parts: [{ storey: 'L00', cls: 'IFCWALL' }] }),
    pk('B', undefined, { parts: [{ storey: 'L01' }], after: 'A1', lagDays: 2 }),
  ];
  const contents = contentsOf(pkgs, objects, noSets);
  const methods = new Map(pkgs.map((p) => [p.id, resolveMethod(p, contents.objects.get(p.id)!, [], () => [])]));

  it('only offers packages that are not itself, inside it or around it', () => {
    expect(linkTargets(pkgs, 'A1').map((p) => p.id)).toEqual(['A2', 'B']);
  });

  it('places a package after the one it names, and spans packages that hold others', () => {
    const days: Record<string, number> = { A1: 3, A2: 4, B: 5 };
    const t = new Map(timelineOf(pkgs, (p) => days[p.id] ?? 0, (p) => !!contents.objects.get(p.id)?.length).map((x) => [x.id, x]));
    expect(t.get('A1')).toMatchObject({ start: 0, finish: 3 });
    expect(t.get('A2')).toMatchObject({ start: 3, finish: 7 });
    expect(t.get('B')).toMatchObject({ start: 5, finish: 10 });
    expect(t.get('A')).toMatchObject({ start: 0, finish: 7 });
  });

  it('sends the order, a sequence per other link, a summary bar and a limit for the package that holds others', () => {
    const req = packagesRequest(pkgs, contents, methods, 'B1');
    expect(req.workItems.map((w) => w.group)).toEqual(['WP-01.01 A1', 'WP-01.02 A2', 'WP-02 B']);
    const rules = req.rules({ ...NO_RULES });
    expect(rules.sequences.map((s) => [s.id, s.steps])).toEqual([
      ['STEPS', [{ group: 'WP-01.01 A1' }, { group: 'WP-01.02 A2' }]],
      ['STEPS-2', [{ group: 'WP-01.01 A1' }, { group: 'WP-02 B', lagHours: 16 }]],
    ]);
    expect(rules.groups).toEqual([{ id: 'WP-01 A', name: 'WP-01 A', forEach: [], filters: [], include: ['WP-01.01 A1', 'WP-01.02 A2'] }]);
    expect(rules.levelTasks).toEqual([{ id: 'WPBAR-WP-01', name: 'A', group: 'WP-01 A' }]);
    expect(rules.limits.map((l) => [l.phase, l.group, l.max])).toEqual([['Rebar', 'WP-01 A', 1], ['Formwork', 'WP-01 A', 1], ['Concrete', 'WP-01 A', 1]]);
  });

  it('leaves the summary bar out when switched off, and starts after a package that holds others when it is named', () => {
    const off = pkgs.map((p) => (p.id === 'A' ? { ...p, bar: false, maxAtOnce: undefined } : p.id === 'B' ? { ...p, after: 'A' } : p));
    const rules = packagesRequest(off, contents, methods, 'B1').rules({ ...NO_RULES });
    expect(rules.levelTasks).toEqual([]);
    expect(rules.sequences[1].steps[0]).toEqual({ group: 'WP-01 A' });
  });

  it('shares a package’s own days among its activities, scales days with the crew, and adds an activity', () => {
    const walls = objects.filter((o) => o.cls === 'IFCWALL');
    const base = resolveMethod(pk('W', undefined, { method: 'std:insitu' }), walls, [], () => []);
    expect(base.days).toBe(6); // 30 m³ at the standard rates: rebar 2 (15 a day), formwork 3 (12 a day), concrete 1 (40 a day)
    const total = resolveMethod(pk('W', undefined, { method: 'std:insitu', totalDays: 10 }), walls, [], () => []);
    expect(total.days).toBe(10);
    expect(total.estimate).toBe(base.days);
    expect(total.activities.every((a) => a.fixed)).toBe(true);
    const crew = resolveMethod(pk('W', undefined, { method: 'std:insitu', people: 12 }), walls, [], () => []);
    expect(crew.crew).toBe('Concrete gang (12)');
    expect(crew.days).toBeLessThan(base.days);
    const extra = resolveMethod(pk('W', undefined, { method: 'std:insitu', extra: { name: 'Check', days: 2, before: true } }), walls, [], () => []);
    expect(extra.activities[0]).toMatchObject({ phase: 'Extra', name: 'Check', days: 2 });
  });

  it('sends a crew of its own size and an added activity with a project recipe', () => {
    const one = [pk('W', undefined, { parts: [{ cls: 'IFCWALL' }], method: 'std:insitu', people: 12 })];
    const c = contentsOf(one, objects, noSets);
    const m = new Map([['W', resolveMethod(one[0], c.objects.get('W')!, [], () => [])]]);
    const rules = packagesRequest(one, c, m, 'B1').rules({ ...NO_RULES });
    expect(rules.crewTemplates).toEqual([{ id: 'STD-CONCRETE-12', trades: [{ trade: 'STD-CONCRETE', size: 12 }] }]);
    expect(rules.recipes[0].tasks[0].crew).toBe('STD-CONCRETE-12');

    const recipes: Recipe[] = [{ id: 'R1', group: 'Other', tasks: [{ phase: 'X', days: 2 }] }];
    const two = [pk('W', undefined, { parts: [{ cls: 'IFCWALL' }], method: 'recipe:R1', extra: { name: 'Check', days: 3 } })];
    const m2 = new Map([['W', resolveMethod(two[0], c.objects.get('W')!, recipes, (r) => r.tasks.map((t) => ({ phase: t.phase, name: t.phase, days: 2, how: '', crew: '' })))]]);
    const sent = packagesRequest(two, contentsOf(two, objects, noSets), m2, 'B1').rules({ ...NO_RULES, recipes });
    const copy = sent.recipes.find((r) => r.id === 'R1 for WP-01 W')!;
    expect(copy.tasks.map((t) => [t.phase, t.formula ?? t.days])).toEqual([['X', 2], ['Extra', '3']]);
    expect(sent.recipes.some((r) => r.id === 'Overrides for WP-01 W' && r.tasks.some((t) => t.phase === 'Extra'))).toBe(false);
  });

  it('keeps the new settings when saved', () => {
    const saved = normalizePackages([{ id: 'A', name: 'A', color: '#1', parts: [] }, { id: 'B', name: 'B', color: '#2', parts: [], parent: 'A', after: 'X', totalDays: '4', people: 3.4, extra: { name: ' Check ', days: 2 }, bar: true, maxAtOnce: 0 }]);
    expect(saved![1]).toEqual({ id: 'B', name: 'B', color: '#2', parts: [], parent: 'A', after: 'X', totalDays: 4, people: 3, extra: { name: 'Check', days: 2 }, bar: true });
  });
});

describe('short names in the programme', () => {
  it('calls a package by its name without the storey it is on, and the model by its building', () => {
    expect(labelOf({ name: 'L00 Raft' }, [obj('a', 'L00', 0, 'IFCSLAB')])).toBe('Raft');
    expect(labelOf({ name: 'L00 - Main Slab' }, [obj('a', 'L00', 0, 'IFCSLAB')])).toBe('Main Slab');
    expect(labelOf({ name: 'L00 Raft' }, [obj('a', 'L00', 0, 'IFCSLAB'), obj('b', 'L01', 1, 'IFCSLAB')])).toBe('L00 Raft');
    expect(labelOf({ name: 'L00' }, [obj('a', 'L00', 0, 'IFCSLAB')])).toBe('L00');
    expect(buildingCode([{ building: '1HDAB' }, { building: '1HDAB' }, { building: 'X' }], 'long_model_file_name')).toBe('1HDAB');
    expect(buildingCode([{}, { building: ' ' }], 'stem')).toBe('stem');
  });

  it('sends the short building, the label and short sequence names', () => {
    const pkgs: WorkPackage[] = [pk('A', undefined, { name: 'L00 Walls', parts: [{ storey: 'L00', cls: 'IFCWALL' }] }), pk('B', undefined, { name: 'Slab', parts: [{ cls: 'IFCSLAB' }], after: 'A' })];
    const objs2 = objects.map((o) => ({ ...o, building: '1HDAB' }));
    const c = contentsOf(pkgs, objs2, noSets);
    const m = new Map(pkgs.map((p) => [p.id, resolveMethod(p, c.objects.get(p.id)!, [], () => [])]));
    const req = packagesRequest(pkgs, c, m, 'some_long_model_file_20261012');
    expect(req.workItems.map((w) => [w.building, w.group, w.label])).toEqual([['1HDAB', 'WP-01 L00 Walls', 'Walls'], ['1HDAB', 'WP-02 Slab', 'Slab']]);
    expect(req.rules({ ...NO_RULES }).sequences.map((s) => s.name)).toEqual(['Order', 'Starts after']);
  });
});
