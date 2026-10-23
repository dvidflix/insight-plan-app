import { describe, expect, it } from 'vitest';
import { indexWhy, shortType, whyKey, whyWords } from '../../src/schedule/whyText';

describe('why a link is there', () => {
  it('says what each source of the generator means, and shows one it does not know as it is', () => {
    expect(whyWords('intra')).toMatch(/inside the object/);
    expect(whyWords('level_gate')).toMatch(/level below/);
    expect(whyWords('attach:X1')).toBe('an extra activity attached to a search set or folder (X1)');
    expect(whyWords('limit:Formwork')).toMatch(/at once \(Formwork\)/);
    expect(whyWords('something-new')).toBe('something-new');
  });
  it('matches the generator\'s long link types to the programme\'s short ones', () => {
    expect(shortType('FinishToStart')).toBe('FS');
    expect(whyKey('A', 'B', 'StartToStart')).toBe(whyKey('A', 'B', 'SS'));
  });
  it('indexes the links by successor and by predecessor', () => {
    const i = indexWhy({ version: 1, links: [['A', 'B', 'FinishToStart', 0, 'intra'], ['A', 'C', 'FinishToStart', 8, 'sequence']] });
    expect(i.into.get('B')).toHaveLength(1);
    expect(i.out.get('A')).toHaveLength(2);
    expect(indexWhy(null).into.size).toBe(0);
  });
});
