import { describe, expect, it } from 'vitest';
import { matchesQuery, packageColor, packageFacts, passesFilters, visiblePackages } from '../../src/prs/packageFields';
import type { PackageObject, ResolvedMethod, WorkPackage } from '../../src/prs/workPackages';

const obj = (storey: string, cls: string): PackageObject => ({ key: `${storey}${cls}`, guid: '', name: '', cls, storey, storeyRank: 0, material: '', props: {}, volume: 0, area: 0 });
const method = (name: string, crew: string) => ({ name, crew }) as ResolvedMethod;
const pk = (id: string, name: string, parent?: string): WorkPackage => ({ id, name, color: '#000', parts: [{ set: `${name} set` }], ...(parent ? { parent } : {}) });

const facts = [
  packageFacts(pk('A', 'Block A'), 'WP-01', '', 2, [obj('L00', 'IFCWALL'), obj('L01', 'IFCSLAB')], 0, undefined),
  packageFacts(pk('A1', 'Ground', 'A'), 'WP-01.01', 'WP-01 Block A', 0, [obj('L00', 'IFCWALL')], 1, method('In-situ concrete', 'Concrete gang (6)')),
  packageFacts(pk('A2', 'First', 'A'), 'WP-01.02', 'WP-01 Block A', 0, [obj('L01', 'IFCSLAB')], 1, method('Precast install', 'Precast erection crew (5)')),
];

describe('the package list as a list', () => {
  it('gives each package its values', () => {
    expect(facts[0].values).toMatchObject({ method: [], storey: ['L00', 'L01'], type: ['Wall', 'Slab'], holds: ['other packages'] });
    expect(facts[1].values).toMatchObject({ code: ['WP-01.01'], inside: ['WP-01 Block A'], method: ['In-situ concrete'], set: ['Ground set'], holds: ['objects'], order: ['one piece'] });
  });

  it('searches every value, with alternatives', () => {
    expect(matchesQuery(facts[1], 'concrete gang')).toBe(true);
    expect(matchesQuery(facts[2], 'concrete gang')).toBe(false);
    expect(matchesQuery(facts[2], 'concrete gang, precast')).toBe(true);
  });

  it('filters by kept values, a missing value being (none)', () => {
    expect(passesFilters(facts[1], { method: ['In-situ concrete'] }, '(none)')).toBe(true);
    expect(passesFilters(facts[0], { method: ['(none)'] }, '(none)')).toBe(true);
    expect(passesFilters(facts[2], { method: ['In-situ concrete'] }, '(none)')).toBe(false);
  });

  it('shows what matches and the packages that hold it, and everything when nothing is asked', () => {
    expect(visiblePackages(facts, {}, '  ', '(none)')).toBeNull();
    const v = visiblePackages(facts, { storey: ['L01'] }, 'precast', '(none)')!;
    expect([...v.matched]).toEqual(['A2']);
    expect([...v.visible].sort()).toEqual(['A', 'A2']);
  });

  it('colours by the first rule that matches, else the package’s own colour', () => {
    const rules = [{ id: 'r', field: 'method', op: 'contains' as const, value: 'precast', color: '#f00' }];
    expect(packageColor(facts[2], rules, '#000')).toBe('#f00');
    expect(packageColor(facts[1], rules, '#123')).toBe('#123');
  });
});
