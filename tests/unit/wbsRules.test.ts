import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { context, fill, holds, normalizeWbs, packageTreeRules, previewTree, rowsToRules, rulesToRows, type WbsCondition, type WbsRuleSet } from '../../src/prs/wbsRules';

/** The app's WBS rule evaluator: the same answers as the generator's (the shared cases), the Excel sheet round trip, Generate's default (the
    package tree) and the preview. */

const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', 'scenario-engine', 'tests', 'fixtures', 'wbs_rule_cases.json'), 'utf8')) as {
  fill: { ctx: Record<string, unknown>; template: string; out: string | null }[];
  holds: { ctx: Record<string, unknown>; cond: WbsCondition; out: boolean }[];
};

describe('the same answers as the generator', () => {
  it.each(cases.fill)('fills $template', (c) => expect(fill(c.template, context(c.ctx))).toBe(c.out));
  it.each(cases.holds)('$cond.op $cond.value', (c) => expect(holds(c.cond, context(c.ctx))).toBe(c.out));
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
