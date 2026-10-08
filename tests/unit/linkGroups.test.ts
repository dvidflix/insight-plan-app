import { describe, expect, it } from 'vitest';
import { computeGroupLinks, joinKeys, splitValues, buildMatchExportRows, emptyGroup, type LinkGroup, type MatchRule } from '../../src/schedule/linkGroups';
import type { ElementSummary } from '../../src/viewer/types';
import { activity, model } from './helpers';

const element = (localId: number, ecs: string): ElementSummary =>
  ({ localId, category: 'IFCWALL', name: `W${localId}`, guid: `g${localId}`, fileName: 'm.ifc', props: { 'Pset.ECS': ecs } }) as unknown as ElementSummary;

const rule = (over: Partial<MatchRule> = {}): MatchRule => ({
  id: 'r1', taskField: 'ECS', objectPropertySet: 'Pset', objectAttribute: 'ECS', conj: 'or', ...over,
});
const group = (matchRules: MatchRule[]): LinkGroup => ({ ...emptyGroup('G'), matchRules });
const task = (id: string, ecs: string) => activity(id, { activityCodes: { ECS: ecs } });

describe('splitValues', () => {
  it('is the whole trimmed value without separators', () => {
    expect(splitValues('  A || B ')).toEqual(['a || b']);
    expect(splitValues('   ')).toEqual([]);
  });

  it('splits on any separator, trims, drops empties and repeats', () => {
    expect(splitValues('1HDCD/0B41 || 1HDCD/0B02V ||', ['||'])).toEqual(['1hdcd/0b41', '1hdcd/0b02v']);
    expect(splitValues('a, b; c,,a', [',', ';'])).toEqual(['a', 'b', 'c']);
    expect(splitValues('a', [''])).toEqual(['a']); // an empty separator does nothing
  });
});

describe('joinKeys', () => {
  it('is every combination across the parts, none when one part is empty', () => {
    expect(joinKeys([['a', 'b'], ['x']])).toEqual(['a\u0001x', 'b\u0001x']);
    expect(joinKeys([['a'], []])).toEqual([]);
    expect(joinKeys([])).toEqual([]);
  });

  it('does not confuse "ab"+"c" with "a"+"bc"', () => {
    expect(joinKeys([['ab'], ['c']])).not.toEqual(joinKeys([['a'], ['bc']]));
  });

  it('is capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(joinKeys([many, many, many], 100).length).toBeLessThanOrEqual(100);
  });
});

describe('matching rules with separators', () => {
  const objects = [element(1, 'AAA/01'), element(2, 'BBB/02 || AAA/01'), element(3, 'CCC/03')];
  const m = model([task('T1', 'AAA/01 || ZZZ/99'), task('T2', 'CCC/03'), task('T3', 'AAA/01')]);

  it('links a whole value only when the whole value is equal, as before', () => {
    const out = computeGroupLinks(m, objects, group([rule()]));
    expect([...out.taskToElements.keys()].sort()).toEqual(['T2', 'T3']);
    expect(out.taskToElements.get('T3')).toEqual([1]);
  });

  it('links on any one value when both sides are split', () => {
    const out = computeGroupLinks(m, objects, group([rule({ taskSeparators: ['||'], objectSeparators: ['||'] })]));
    expect(out.taskToElements.get('T1')?.sort()).toEqual([1, 2]);
    expect(out.taskToElements.get('T3')?.sort()).toEqual([1, 2]);
    expect(out.taskToElements.get('T2')).toEqual([3]);
    expect([...out.elementIds].sort()).toEqual([1, 2, 3]);
  });

  it('splits just the object side', () => {
    const out = computeGroupLinks(m, objects, group([rule({ objectSeparators: ['||'] })]));
    expect(out.taskToElements.get('T3')?.sort()).toEqual([1, 2]);
    expect(out.taskToElements.has('T1')).toBe(false); // the task's own value is still one whole value
  });

  it('needs every rule of an AND cluster to hold, each with its own separators', () => {
    const two = (id: number, a: string, b: string) => ({ ...element(id, a), props: { 'Pset.ECS': a, 'Pset.Zone': b } }) as unknown as ElementSummary;
    const els = [two(1, 'A || B', 'L1'), two(2, 'A', 'L2')];
    const t = model([activity('T', { activityCodes: { ECS: 'B', Zone: 'L1 / L3' } })]);
    const rules = [
      rule({ id: 'a', objectSeparators: ['||'] }),
      rule({ id: 'b', taskField: 'Zone', objectAttribute: 'Zone', conj: 'and', taskSeparators: ['/'] }),
    ];
    expect(computeGroupLinks(t, els, group(rules)).taskToElements.get('T')).toEqual([1]);
  });

  it('exports the pairs it linked', () => {
    const rows = buildMatchExportRows(m, objects, [group([rule({ taskSeparators: ['||'], objectSeparators: ['||'] })])]);
    const pairs = rows.map((r) => `${r.activityId}-${r.elementName}`).sort();
    expect(pairs).toEqual(['T1-W1', 'T1-W2', 'T2-W3', 'T3-W1', 'T3-W2']);
  });
});
