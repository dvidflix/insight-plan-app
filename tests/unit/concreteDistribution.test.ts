import { describe, expect, it } from 'vitest';
import { buildSeries, concreteResources, cumulative, isConcreteByName, mondayOnOrBefore, periodStart, periodVolumes, scopeMatcher } from '../../src/schedule/concreteDistribution';
import type { Activity, ScheduleModel } from '../../src/schedule/types';

const d = (s: string) => new Date(`${s}T00:00:00`);
const act = (id: string, name: string, start: string, finish: string, resources: { name: string; qty: number; type?: string }[], codes: Record<string, string> = {}): Activity => ({
  id, code: id, name, wbsPath: 'P / L1', activityCodes: codes, targetStart: d(start), targetFinish: d(finish), earlyStart: d(start), earlyFinish: d(finish),
  actualStart: null, actualFinish: null,
  resources: resources.map((r) => ({ resourceId: r.name, resourceName: r.name, resourceType: (r.type ?? 'material') as never, targetQty: r.qty, remainQty: r.qty, targetCost: 0, actualCost: 0 })),
} as unknown as Activity);
const model = (activities: Activity[]): ScheduleModel => ({ activities, project: { planStart: null, dataDate: null } } as unknown as ScheduleModel);

describe('concrete distribution', () => {
  it('tells concrete the material from the gang that places it', () => {
    expect(isConcreteByName('Concrete (m3)')).toBe(true);
    expect(isConcreteByName('Concrete gang')).toBe(false);
    expect(isConcreteByName('Rebar (t)')).toBe(false);
    const res = concreteResources([model([act('A', 'Pour', '2026-01-05', '2026-01-05', [{ name: 'Concrete (m3)', qty: 50 }, { name: 'Concrete gang', qty: 48, type: 'labor' }, { name: 'Rebar (t)', qty: 3 }])])]);
    expect(res.map((r) => [r.name, r.byDefault])).toEqual([['Concrete (m3)', true], ['Rebar (t)', false]]);
  });

  it('spreads a pour over its days and adds them up per week from the origin', () => {
    // Mon 5 Jan to Wed 14 Jan 2026 (finish at midnight ends the day before): 8 days, 80 m3 -> 10 a day
    const items = [{ activity: act('A', 'x', '2026-01-05', '2026-01-14', []), start: d('2026-01-05'), finish: d('2026-01-14'), qty: 90 }];
    const weekly = periodVolumes(items, d('2026-01-05'));
    expect(weekly.map((v) => Math.round(v))).toEqual([70, 20]);
    expect(cumulative(weekly).map(Math.round)).toEqual([70, 90]);
  });

  it('builds a series, aligned on its first pour or on the calendar', () => {
    const m = model([
      act('A', 'Slab 1 Concrete', '2026-03-02', '2026-03-02', [{ name: 'Concrete (m3)', qty: 100 }]),
      act('B', 'Slab 2 Concrete', '2026-03-16', '2026-03-16', [{ name: 'Concrete (m3)', qty: 60 }]),
    ]);
    const opts = { resources: new Set(['Concrete (m3)']), basis: 'current' as const, scope: '' };
    const first = buildSeries(m, 'k', 'X', '#000', opts, 'first', null);
    expect(first.volume.map(Math.round)).toEqual([100, 0, 60]);
    expect(first.total).toBe(160);
    const cal = buildSeries(m, 'k', 'X', '#000', opts, 'calendar', mondayOnOrBefore(d('2026-02-23')));
    expect(cal.volume.map(Math.round)).toEqual([0, 100, 0, 60]);
  });

  it('groups by month, quarter or year as well', () => {
    const items = [
      { activity: act('A', 'x', '2026-02-10', '2026-02-10', []), start: d('2026-02-10'), finish: d('2026-02-10'), qty: 10 },
      { activity: act('B', 'x', '2026-03-31', '2026-03-31', []), start: d('2026-03-31'), finish: d('2026-03-31'), qty: 20 },
      { activity: act('C', 'x', '2026-04-02', '2026-04-02', []), start: d('2026-04-02'), finish: d('2026-04-02'), qty: 30 },
      { activity: act('D', 'x', '2027-01-15', '2027-01-15', []), start: d('2027-01-15'), finish: d('2027-01-15'), qty: 40 },
    ];
    const origin = d('2026-02-10');
    expect(periodVolumes(items, origin, 'month').slice(0, 3)).toEqual([10, 20, 30]);
    expect(periodVolumes(items, origin, 'quarter')).toEqual([30, 30, 0, 0, 40]);
    expect(periodVolumes(items, origin, 'year')).toEqual([60, 40]);
    expect(periodStart(origin, 'quarter', 1)).toEqual(d('2026-04-01'));
    expect(periodStart(origin, 'year', 1)).toEqual(d('2027-01-01'));
  });

  it('narrows to a scope by ID, name, WBS or activity code', () => {
    const a = act('A', 'Pour', '2026-01-05', '2026-01-05', [], { 'CWA-Building': 'HDAB' });
    expect(scopeMatcher('')(a)).toBe(true);
    expect(scopeMatcher('hdab, hdcd')(a)).toBe(true);
    expect(scopeMatcher('HDCD')(a)).toBe(false);
  });
});
