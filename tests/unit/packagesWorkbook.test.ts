import { describe, expect, it } from 'vitest';
import type { Recipe } from '../../src/prs/recipes';
import { packagesToRows, parseParts, partsText, rowsToPackages } from '../../src/prs/packagesWorkbook';
import { normalizePackages, type WorkPackage } from '../../src/prs/workPackages';

const colors = (n: number) => Array.from({ length: n }, (_, i) => `#c${i}`);
const recipes: Recipe[] = [{ id: 'R1', name: 'Own way', group: 'X', tasks: [{ phase: 'A' }] }];
const info = { objects: () => ({ count: 2, volume: 10 }), method: () => undefined };

const packages: WorkPackage[] = normalizePackages([
  { id: 'P1', name: 'Block A', color: '#111', parts: [] },
  { id: 'P2', name: 'L00', color: '#222', parts: [{ set: 'S1' }, { storey: 'L00', cls: 'IFCWALL', where: { 'P.Zone': 'N' } }], parent: 'P1', method: 'std:insitu', totalDays: 12 },
  { id: 'P3', name: 'L01', color: '#333', parts: [{ guids: ['g1', 'g2'] }], parent: 'P1', link: 'with', lagDays: 2, people: 8, extra: { name: 'Check', days: 1, before: true }, days: { Rebar: 3 } },
  { id: 'P4', name: 'Block B', color: '#444', parts: [{ set: 'S2' }], after: 'P1', method: 'recipe:R1', bar: true, maxAtOnce: 2 },
])!;

describe('work packages to Excel and back', () => {
  it('writes and reads parts', () => {
    const text = partsText(packages[1].parts);
    expect(text).toBe('set = S1 | storey = L00; class = IFCWALL; P.Zone = N');
    expect(parseParts(text)).toEqual({ parts: packages[1].parts });
    expect(parseParts('set S1')).toHaveProperty('error');
  });

  it('gives the same packages back when nothing is edited', () => {
    const rows = packagesToRows(packages, info, recipes);
    expect(rows.map((r) => [r['Code (info)'], r.Starts, r.Method])).toEqual([['WP-01', '', ''], ['WP-01.01', '', 'In-situ concrete'], ['WP-01.02', 'with the one above', ''], ['WP-02', 'after P1', 'recipe: R1']]);
    const back = rowsToPackages(rows, packages, recipes, colors);
    expect(back).toMatchObject({ added: 0, changed: 0, removed: 0, warnings: [] });
    expect(back.packages).toEqual(packages);
  });

  it('reads edits, new rows, the order of the rows and removed packages', () => {
    const rows = packagesToRows(packages, info, recipes);
    rows[1] = { ...rows[1], Method: 'steel erection', Days: '', 'Made of': 'set = S9' };
    const fresh = { ...rows[3], ID: '', Name: 'Block C', 'Made of': 'class = ifcslab', Starts: 'after WP-01.01', Method: 'Own way', 'Summary bar': 'no' };
    const edited = [rows[3], rows[0], rows[1], fresh];
    const back = rowsToPackages(edited, packages, recipes, colors);
    expect(back).toMatchObject({ added: 1, changed: 1, removed: 1, warnings: [] });
    expect(back.packages.map((p) => [p.id, p.parent ?? ''])).toEqual([['P4', ''], ['P1', ''], ['P2', 'P1'], [back.packages[3].id, '']]);
    expect(packages.some((p) => p.id === back.packages[3].id)).toBe(false);
    expect(back.packages[2]).toMatchObject({ method: 'std:steel', parts: [{ set: 'S9' }] });
    expect(back.packages[2].totalDays).toBeUndefined();
    expect(back.packages[3]).toMatchObject({ name: 'Block C', parts: [{ cls: 'IFCSLAB' }], after: 'P2', method: 'recipe:R1', bar: false });
  });

  it('keeps picked objects when Made of is unchanged, and says what it could not read', () => {
    const rows = packagesToRows(packages, info, recipes);
    rows[2] = { ...rows[2], Method: 'Nonsense', Starts: 'after Nowhere', 'Inside (ID)': 'P99' };
    const back = rowsToPackages(rows, packages, recipes, colors);
    const p3 = back.packages.find((p) => p.id === 'P3')!;
    expect(p3.parts).toEqual([{ guids: ['g1', 'g2'] }]);
    expect(p3.method).toBeUndefined();
    expect(p3.parent).toBeUndefined();
    expect(back.warnings).toHaveLength(3);
    rows[2] = { ...rows[2], 'Made of': 'picked = 5 objects' };
    expect(rowsToPackages(rows, packages, recipes, colors).warnings.some((w) => /picked in 3D/.test(w))).toBe(true);
  });

  it('refuses a sheet with no packages', () => {
    expect(() => rowsToPackages([{ Other: 'x' }], packages, recipes, colors)).toThrow(/No packages/);
  });
});
