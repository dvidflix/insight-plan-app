import { describe, expect, it } from 'vitest';
import { applyFieldFilters, countActiveFilters, emptyFilterState, type FilterFieldDef, type TextMode } from '../../src/schedule/filterFields';
import { activity } from './helpers';

// A text field over one activity code, as the Filters panel builds them.
const ecs: FilterFieldDef = {
  id: 'ecs', label: 'ECS Code', group: 'Codes', kind: 'text', hasData: true, values: [],
  activityValues: (a) => [a.activityCodes.ecs ?? ''],
  rawValue: (a) => a.activityCodes.ecs ?? '',
};
const rows = [
  activity('1', { activityCodes: { ecs: 'W-100' } }),
  activity('2', { activityCodes: { ecs: 'W-200' } }),
  activity('3', { activityCodes: { ecs: '' } }),
  activity('4', { activityCodes: { ecs: '   ' } }),
  activity('5', {}),
];
const ids = (list: { id: string }[]) => list.map((a) => a.id);

function state(text: string, mode?: TextMode) {
  const s = emptyFilterState();
  s.textFilters.ecs = text;
  if (mode) s.textModes = { ecs: mode };
  return s;
}
const run = (text: string, mode?: TextMode) => ids(applyFieldFilters(rows, [ecs], state(text, mode)));

describe('text filters', () => {
  it('contains any / all / starts / ends / is', () => {
    expect(run('100, 200')).toEqual(['1', '2']);
    expect(run('w, 100', 'all')).toEqual(['1']);
    expect(run('w-2', 'starts')).toEqual(['2']);
    expect(run('-100', 'ends')).toEqual(['1']);
    expect(run('w-100', 'equals')).toEqual(['1']);
  });

  it('"Not" keeps the rows without the text, empty ones included', () => {
    expect(run('100', 'excludes')).toEqual(['2', '3', '4', '5']);
  });

  it('"Filled" leaves out empty, blank and missing values, with no text typed', () => {
    expect(run('', 'filled')).toEqual(['1', '2']);
  });

  it('"Empty" keeps only rows with no value', () => {
    expect(run('', 'empty')).toEqual(['3', '4', '5']);
  });

  it('a blank text with an ordinary mode filters nothing', () => {
    expect(run('')).toEqual(['1', '2', '3', '4', '5']);
  });

  it('counts Filled / Empty as one active filter', () => {
    expect(countActiveFilters(state('', 'filled'))).toBe(1);
    expect(countActiveFilters(state('ignored', 'empty'))).toBe(1);
    expect(countActiveFilters(state('x', 'contains'))).toBe(1);
    expect(countActiveFilters(state('', 'contains'))).toBe(0);
  });

  it('combines two fields with AND by default and OR on request', () => {
    const name: FilterFieldDef = { ...ecs, id: 'name', label: 'Name', rawValue: (a) => a.name };
    const s = state('100');
    s.textFilters.name = '2';
    expect(ids(applyFieldFilters(rows, [ecs, name], s))).toEqual([]);
    expect(ids(applyFieldFilters(rows, [ecs, name], { ...s, combine: 'any' }))).toEqual(['1', '2']);
  });
});
