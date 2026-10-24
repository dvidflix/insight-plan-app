import { describe, expect, it } from 'vitest';
import { packageWarnings, readiness } from '../../src/prs/packageReadiness';
import { compareVersions, type VersionSide } from '../../src/prs/compareVersions';
import { contentsOf, resolveMethod, type PackageObject, type WorkPackage } from '../../src/prs/workPackages';

const obj = (n: number, extra: Partial<PackageObject> = {}): PackageObject => ({ key: `m:${n}`, guid: `G${n}`, name: `o${n}`, cls: 'IFCWALL', storey: 'L00', storeyRank: 0, material: '', props: {}, volume: 10, area: 0, ...extra });

describe('model readiness', () => {
  const objects = [obj(1), obj(2, { volume: 0 }), obj(3, { guid: '' }), obj(4, { cls: 'IFCSLAB' })];
  const view = (pkgs: WorkPackage[]) => {
    const contents = contentsOf(pkgs, objects, () => false);
    return { contents, methods: new Map(pkgs.map((p) => [p.id, resolveMethod(p, contents.objects.get(p.id)!, [], () => [])])) };
  };

  it('cannot generate with no model or no package holding objects', () => {
    expect(readiness([], [], view([]).contents, new Map()).verdict).toBe('cannot');
    const pkgs: WorkPackage[] = [{ id: 'A', name: 'A', color: '', parts: [{ cls: 'IFCBEAM' }] }];
    const v = view(pkgs);
    expect(readiness(objects, pkgs, v.contents, v.methods)).toMatchObject({ verdict: 'cannot', findings: [{ id: 'nopackages' }] });
  });

  it('lists the gaps with their objects, and is ready without them', () => {
    const pkgs: WorkPackage[] = [{ id: 'A', name: 'Walls', color: '', parts: [{ cls: 'IFCWALL' }], method: 'std:insitu' }, { id: 'B', name: 'Empty', color: '', parts: [{ cls: 'IFCBEAM' }] }];
    const v = view(pkgs);
    const r = readiness(objects, pkgs, v.contents, v.methods);
    expect(r.verdict).toBe('gaps');
    expect(r.findings.map((f) => [f.id, f.count])).toEqual([['unassigned', 1], ['novolume', 1], ['noguid', 1], ['empty', 1]]);
    expect(r.findings[0].objects.map((o) => o.key)).toEqual(['m:4']);
    expect(packageWarnings(pkgs[0], v.contents.objects.get('A')!, v.methods.get('A')).map((w) => w.text)).toEqual(['1 without volume', '1 without GlobalId']);
    const fine: WorkPackage[] = [{ id: 'A', name: 'All', color: '', parts: [{ storey: 'L00' }], method: 'std:install' }];
    const w = view(fine);
    const ok = readiness([obj(1), obj(4)], fine, contentsOf(fine, [obj(1), obj(4)], () => false), w.methods);
    expect(ok.verdict).toBe('ready');
  });
});

describe('comparing versions', () => {
  const side = (name: string, pkgs: VersionSide['packages'], days: number | null): VersionSide => ({ name, programme: days === null ? null : { days, activities: 10, criticalShare: 0.5, start: null, finish: null }, packages: pkgs });
  const p = (id: string, name: string, method: string, days: number, objects = 2, code = 'WP-01') => ({ id, code, name, method, days, objects, volume: 5, fineTuned: false });

  it('puts the figures side by side and lists what differs, matching by ID then name', () => {
    const a = side('v1', [p('P1', 'Walls', 'In-situ concrete', 6), p('P2', 'Slabs', 'Install', 2, 2, 'WP-02'), p('P3', 'Gone', 'Install', 1, 1, 'WP-03')], 70);
    const b = side('v2', [p('P1', 'Walls', 'Steel erection', 6), p('P9', 'Slabs', 'Install', 4, 2, 'WP-02'), p('P4', 'New', 'Install', 1, 1, 'WP-03')], null);
    const r = compareVersions(a, b);
    expect(r.figures.find((f) => f.label === 'Length')).toMatchObject({ a: '10 weeks', b: 'not generated', differs: true });
    expect(r.figures.find((f) => f.label === 'Packages with objects')!.differs).toBe(false);
    expect(r.packages.map((d) => [d.name, d.what])).toEqual([['Walls', 'method'], ['Slabs', 'days'], ['Gone', 'only in v1'], ['New', 'only in v2']]);
  });

  it('gives the change of each figure, and the packages whose critical path, objects or object order differ', () => {
    const crit = (s: VersionSide, ids: string[]): VersionSide => ({ ...s, programme: { ...s.programme!, criticalPackages: ids } });
    const a = crit(side('v1', [{ ...p('P1', 'One', 'M', 2), objectsKey: 'x' }, { ...p('P2', 'Two', 'M', 2, 2, 'WP-02'), orderKey: '' }, p('P3', 'Three', 'M', 2, 2, 'WP-03')], 70), ['P1']);
    const b = crit(side('v2', [{ ...p('P1', 'One', 'M', 2), objectsKey: 'y' }, { ...p('P2', 'Two', 'M', 2, 2, 'WP-02'), orderKey: 'k' }, p('P3', 'Three', 'M', 2, 2, 'WP-03')], 84), ['P1', 'P3']);
    const r = compareVersions(a, b);
    expect(r.figures.find((f) => f.label === 'Length')!.delta).toBe('+2 weeks');
    expect(r.figures.find((f) => f.label === 'Activities')!.delta).toBe('');
    expect(r.figures.find((f) => f.label === 'Packages on the critical path')).toMatchObject({ a: '1', b: '2', delta: '+1' });
    expect(r.packages.map((d) => [d.name, d.what])).toEqual([['One', 'objects'], ['Two', 'object order'], ['Three', 'critical only in v2']]);
    expect(r.packages[2]).toMatchObject({ criticalA: false, criticalB: true });
  });

  it('leaves the critical-path row out when a programme does not say which packages are critical', () => {
    const r = compareVersions(side('v1', [p('P1', 'One', 'M', 2)], 70), side('v2', [p('P1', 'One', 'M', 2)], 70));
    expect(r.figures.some((f) => f.label === 'Packages on the critical path')).toBe(false);
    expect(r.packages).toEqual([]);
  });
});
