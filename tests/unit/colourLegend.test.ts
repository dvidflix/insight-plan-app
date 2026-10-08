import { describe, expect, it } from 'vitest';
import { legendRows, valuesOfRow } from '../../src/viewer/colourLegend';
import { NO_VALUE } from '../../src/viewer/bimTables';

const values = [
  { value: 'Wall', count: 120 },
  { value: 'Slab', count: 40 },
  { value: NO_VALUE, count: 7 },
  { value: 'Stair', count: 3 },
  { value: 'Ghost', count: 0 },
];
const colours = [{ value: 'Wall', color: '#111111' }, { value: 'Slab', color: '#222222' }, { value: NO_VALUE, color: '#999999' }];

describe('colour legend', () => {
  it('lists the coloured values largest first, with their counts', () => {
    const rows = legendRows(values, colours, null);
    expect(rows.map((r) => [r.label, r.count, r.color])).toEqual([
      ['Wall', 120, '#111111'],
      ['Slab', 40, '#222222'],
      ['No value', 7, '#999999'],
      ['Own colours (1)', 3, null],
    ]);
  });

  it('gathers uncoloured values into one row with the "other" colour', () => {
    const rows = legendRows(values, [colours[0]], '#d4d4d8');
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ kind: 'other', label: 'Other values (3)', count: 50, color: '#d4d4d8' });
  });

  it('leaves out values nothing carries and adds no gathered row when all are coloured', () => {
    const all = [...colours, { value: 'Stair', color: '#333333' }];
    const rows = legendRows(values, all, '#d4d4d8');
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === 'value')).toBe(true);
  });

  it('says which values a row selects', () => {
    const rows = legendRows(values, [colours[0]], '#d4d4d8');
    expect(valuesOfRow(rows[0], values, [colours[0]])).toEqual(['Wall']);
    expect(valuesOfRow(rows[rows.length - 1], values, [colours[0]])).toEqual(['Slab', NO_VALUE, 'Stair', 'Ghost']);
  });

  it('is empty with no values', () => {
    expect(legendRows([], colours, null)).toEqual([]);
  });
});
