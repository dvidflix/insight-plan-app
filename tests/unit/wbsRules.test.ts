import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { context, fill, holds, levelText, normalizeWbs, packageTreeRules, parseLevel, pathOf, previewTree, readsSets, rowsToRules, rulesToRows, type WbsCondition, type WbsLevel, type WbsRuleSet } from '../../src/prs/wbsRules';

/** The app's WBS rule evaluator: the same answers as the generator's (the shared cases), the Excel sheet round trip, Generate's default (the
    package tree) and the preview. */

const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', 'scenario-engine', 'tests', 'fixtures', 'wbs_rule_cases.json'), 'utf8')) as {
  fill: { ctx: Record<string, unknown>; template: string; out: string | null }[];
  holds: { ctx: Record<string, unknown>; cond: WbsCondition; out: boolean }[];
  path: { about: string; ctx: Record<string, unknown>; phase: string; phases: string[]; path: WbsLevel[]; out: string[] }[];
};

describe('the same answers as the generator', () => {
  it.each(cases.fill)('fills $template', (c) => expect(fill(c.template, context(c.ctx))).toBe(c.out));
  it.each(cases.holds)('$cond.op $cond.value', (c) => expect(holds(c.cond, context(c.ctx))).toBe(c.out));
  it.each(cases.path)('places: $about', (c) => expect(pathOf({ id: 'x', when: [], path: c.path.map((l) => ({ ...l, name: l.name ?? '' })) }, context(c.ctx), 'START', c.phase, undefined, c.phases)).toEqual(c.out));
});

describe('steps of their own', () => {
  it('are written as words in a level cell, and read back', () => {
    expect(levelText({ name: '', kind: 'phases' })).toBe('phases from recipe');
    expect(levelText({ name: 'Item {item_id}', kind: 'each' })).toBe('per item ID: Item {item_id}');
    expect(parseLevel('Phases from recipe')).toEqual({ name: '', kind: 'phases' });
    expect(parseLevel('per item ID: Item {item_id}')).toEqual({ name: 'Item {item_id}', kind: 'each' });
    expect(parseLevel('{Pour Type}')).toEqual({ name: '{Pour Type}' });
  });

  // The request's example, all as rules: walls by level, internal or external, then the recipe's phases; two kinds by level, kind and item, then
  // phases; anything else by level and kind.
  const example: WbsRuleSet = {
    rules: [
      { id: 'w', under: 'root', when: [{ field: 'Kind', op: 'equals', value: 'A' }], path: [{ name: '{level}' }, { name: '{outside|External|Internal}' }, { name: '', kind: 'phases' }] },
      { id: 'f', under: 'root', when: [{ field: 'Kind', op: 'in', value: 'B, C' }], path: [{ name: '{level}' }, { name: '{Kind}' }, { name: '', kind: 'each' }, { name: '', kind: 'phases' }] },
      { id: 'z', name: 'Otherwise', under: 'root', when: [], path: [{ name: '{level}' }, { name: '{Kind}' }] },
    ],
  };

  it('go through the Excel sheet', () => {
    const rows = rulesToRows(example);
    expect(rows[1]).toMatchObject({ 'Level 3': 'per item ID', 'Level 4': 'phases from recipe', 'Last level for phases': '' });
    const back = rowsToRules(rows);
    expect(back.warnings).toEqual([]);
    expect(back.set.rules.map((r) => ({ ...r, id: '' }))).toEqual(example.rules.map((r) => ({ ...r, id: '' })));
  });

  it('show in the preview with the recipe’s phases and the item IDs', () => {
    const items = [
      { fields: { Kind: 'A', Storey: 'L1', outside: 'yes' }, phases: ['P1', 'P2'], objects: 1, id: '0001' },
      { fields: { Kind: 'B', Storey: 'L1' }, phases: ['P3'], objects: 1, id: '0002' },
      { fields: { Kind: 'D', Storey: 'L1' }, phases: ['P3'], objects: 1, id: '0003' },
    ];
    const { tree } = previewTree(example, items);
    const show = (n: typeof tree, depth = 0): string[] => [`${'  '.repeat(depth)}${n.name}`, ...n.children.flatMap((c) => show(c, depth + 1))];
    expect(show(tree)).toEqual(['Construction', '  L1', '    External', '      P1', '      P2', '    B', '      0002', '        P3', '    D']);
  });
});

describe('the set fields', () => {
  it('are read only when a rule uses them', () => {
    expect(readsSets(example2([{ field: 'Set folder 1', op: 'equals', value: 'X' }], '{Package}'))).toBe(true);
    expect(readsSets(example2([], '{Set}'))).toBe(true);
    expect(readsSets(example2([{ field: 'Storey', op: 'equals', value: 'X' }], '{Package}'))).toBe(false);
  });
  const example2 = (when: WbsCondition[], name: string): WbsRuleSet => ({ rules: [{ id: 'a', when, path: [{ name }] }] });
});

const set: WbsRuleSet = {
  rules: [
    { id: 'a', name: 'Of a kind', when: [{ field: 'IFC class', op: 'equals', value: 'IFCWALL' }, { field: 'Storey', op: 'is not empty' }], path: [{ name: '{level_node} - Walls' }, { name: '{parent} - {phase}', phases: ['Build', 'Finish'], always: true }] },
    { id: 'b', enabled: false, when: [], under: 'root', path: [{ name: '{Package level 1}' }, { name: '{Package level 2}' }] },
    { id: 'c', name: 'Otherwise', when: [], under: 'root', path: [{ name: '{Package level 1}' }, { name: '{Package level 2}' }] },
  ],
};

describe('as an Excel sheet', () => {
  it('reads back what it wrote', () => {
    const rows = rulesToRows(set);
    expect(rows[0]).toMatchObject({ Order: 1, On: 'Yes', 'Field 1': 'IFC class', 'Operator 1': 'equals', 'Value 1': 'IFCWALL', 'Level 2': '{parent} - {phase}', 'Last level for phases': 'Build, Finish', 'Make every phase': 'Yes' });
    const back = rowsToRules(rows);
    expect(back.warnings).toEqual([]);
    expect(back.set.rules.map((r) => ({ ...r, id: '' }))).toEqual(set.rules.map((r) => ({ ...r, id: '' })));
  });

  it('orders by Order, leaves out rows with no level, and says what it could not read', () => {
    const r = rowsToRules([
      { Order: 2, Name: 'Second', 'Level 1': 'B' },
      { Order: 1, Name: 'First', 'Field 1': 'x', 'Operator 1': 'is like', 'Level 1': 'A' },
      { Order: 3, Name: 'Nothing' },
    ]);
    expect(r.set.rules.map((x) => [x.name, x.when.length])).toEqual([['First', 0], ['Second', 0]]);
    expect(r.warnings).toEqual([expect.stringContaining('Row 3: operator “is like”'), expect.stringContaining('Row 4: no level')]);
  });
});

describe('Generate’s rules', () => {
  it('follow the package tree by default, as deep as the packages go', () => {
    expect(packageTreeRules(3).rules[0]).toMatchObject({ under: 'root', when: [], path: [{ name: '{Package level 1}' }, { name: '{Package level 2}' }, { name: '{Package level 3}' }] });
  });

  it('are kept as stored, unreadable parts left out', () => {
    expect(normalizeWbs({ rules: [{ id: 'x', when: [{ field: 'A', op: 'nonsense', value: 'v' }, { field: '' }], path: ['One', { name: ' ' }, { name: 'Two', phases: ['P'], always: true }] }, { path: [] }] })).toEqual({
      rules: [{ id: 'x', when: [{ field: 'A', op: 'equals', value: 'v' }], path: [{ name: 'One' }, { name: 'Two', phases: ['P'], always: true }] }, { id: 'rule-2', when: [], path: [] }],
    });
    expect(normalizeWbs(null)).toBeUndefined();
  });

  it('preview the tree the generator will make, with objects and activities per node', () => {
    const items = [
      { fields: { 'IFC class': 'IFCWALL', Storey: 'L1', 'Package level 1': 'L1', 'Package level 2': 'Walls' }, phases: ['Build', 'Check'], objects: 4 },
      { fields: { 'IFC class': 'IFCSLAB', Storey: 'L1', 'Package level 1': 'L1', 'Package level 2': 'Slabs' }, phases: ['Build'], objects: 2 },
    ];
    const { tree, byRule, unplaced } = previewTree(set, items);
    const show = (n: typeof tree, depth = 0): string[] => [`${'  '.repeat(depth)}${n.name} (${n.objects}/${n.activities})`, ...n.children.flatMap((c) => show(c, depth + 1))];
    expect(show(tree)).toEqual([
      'Construction (6/0)',
      '  L1 (6/0)',
      '    L1 - Walls (4/1)',
      '      L1 - Walls - Build (4/1)',
      '      L1 - Walls - Finish (0/0)',
      '    Slabs (2/1)',
    ]);
    expect([...byRule]).toEqual([['a', 2], ['c', 1]]);
    expect(unplaced).toBe(0);
  });
});
