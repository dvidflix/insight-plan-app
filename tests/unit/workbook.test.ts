import { describe, expect, it } from 'vitest';
import { applySheets, toSheets, type Applied, type Sheets } from '../../src/schedule/workbook';
import type { ScheduleModel } from '../../src/schedule/types';
import { activity, day, model, rel } from './helpers';

const base = (): ScheduleModel => {
  const m = model(
    [
      activity('1', { code: 'A1', name: 'Dig', type: 'task', durationHours: 16, remainingDurationHours: 16, earlyStart: day(2030, 1, 7), earlyFinish: day(2030, 1, 8) }),
      activity('2', { code: 'A2', name: 'Pour', type: 'task', durationHours: 24, remainingDurationHours: 24, earlyStart: day(2030, 1, 9), earlyFinish: day(2030, 1, 11) }),
      activity('3', { code: 'A3', name: 'Cure', type: 'task', durationHours: 8, remainingDurationHours: 8 }),
    ],
    [rel('1', '2'), rel('2', '3', 'FS', 8)],
  );
  return { ...m, resourceCatalog: [{ id: '10', name: 'Gang', type: 'labor', capacity: 2 }] } as ScheduleModel;
};
const ok = (r: Applied | { error: string }): Applied => { if ('error' in r) throw new Error(r.error); return r; };
const copy = (s: ReturnType<typeof toSheets>): Sheets => JSON.parse(JSON.stringify(s));

describe('the programme as a workbook', () => {
  it('writes the sheets with their required and read-only columns', () => {
    const s = toSheets(base());
    expect(Object.keys(s.tasks[0])).toEqual(expect.arrayContaining(['Task Code*', 'Task Name*', 'Duration (d)', 'Start (read only)']));
    expect(s.relationships).toHaveLength(2);
    expect(s.resources[0]).toMatchObject({ 'Name*': 'Gang', 'Max units': 2 });
  });

  it('read back unchanged changes nothing', () => {
    const r = ok(applySheets(base(), copy(toSheets(base()))));
    expect(r.summary).toEqual(['Nothing in the workbook differs from the programme.']);
    expect(r.warnings).toEqual([]);
  });

  it('changes tasks by their code, and ignores the read-only columns', () => {
    const s = copy(toSheets(base()));
    s.tasks[0]['Task Name*'] = 'Dig deeper';
    s.tasks[0]['Duration (d)'] = 4;
    s.tasks[1]['Start (read only)'] = '1999-01-01';
    const r = ok(applySheets(base(), s));
    const a = r.model.activities.find((x) => x.code === 'A1')!;
    expect(a.name).toBe('Dig deeper');
    expect(a.durationHours).toBe(32);
    expect(r.summary[0]).toMatch(/Tasks: 1 changed/);
  });

  it('finds columns by name, in any order, and refuses a missing one', () => {
    const s = copy(toSheets(base()));
    s.tasks = s.tasks.map((row) => Object.fromEntries(Object.entries(row).reverse()));
    expect(ok(applySheets(base(), s)).warnings).toEqual([]);
    const broken = copy(toSheets(base()));
    broken.tasks = broken.tasks.map(({ 'Task Name*': _n, ...rest }) => rest);
    expect('error' in applySheets(base(), broken)).toBe(true);
  });

  it('adds a task for a new code', () => {
    const s = copy(toSheets(base()));
    s.tasks.push({ 'Task Code*': 'A9', 'Task Name*': 'Extra', 'Duration (d)': 2, Type: 'Task' });
    const r = ok(applySheets(base(), s));
    const added = r.model.activities.find((x) => x.code === 'A9')!;
    expect(added).toMatchObject({ name: 'Extra', durationHours: 16 });
    expect(r.summary[0]).toMatch(/1 added/);
  });

  it('keeps the links as the sheet has them: rows added, changed and deleted', () => {
    const s = copy(toSheets(base()));
    s.relationships = [
      { 'From Task Code*': 'A1', 'To Task Code*': 'A2', Type: 'SS', 'Lag (d)': 0, Soft: 'Yes' }, // changed: type and soft
      { 'From Task Code*': 'A1', 'To Task Code*': 'A3', Type: 'FS', 'Lag (d)': 1 }, // added
      // A2 > A3 deleted
    ];
    const r = ok(applySheets(base(), s));
    expect(r.model.relationships.map((x) => `${x.predId}>${x.succId} ${x.type} ${x.lagHours}${x.soft ? ' soft' : ''}`).sort()).toEqual(['1>2 SS 0 soft', '1>3 FS 8']);
    expect(r.summary.join(' ')).toMatch(/Relationships: 1 added, 1 changed, 1 removed/);
  });

  it('leaves out a link to an unknown code, to itself, or that closes a loop, and says so', () => {
    const s = copy(toSheets(base()));
    s.relationships = [
      { 'From Task Code*': 'A1', 'To Task Code*': 'A2', Type: 'FS', 'Lag (d)': 0 },
      { 'From Task Code*': 'A2', 'To Task Code*': 'A1', Type: 'FS', 'Lag (d)': 0 },
      { 'From Task Code*': 'A1', 'To Task Code*': 'A1', Type: 'FS', 'Lag (d)': 0 },
      { 'From Task Code*': 'A1', 'To Task Code*': 'ZZ', Type: 'FS', 'Lag (d)': 0 },
    ];
    const r = ok(applySheets(base(), s));
    expect(r.model.relationships).toHaveLength(1);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join(' ')).toMatch(/loop/);
  });

  it('assigns resources by name: rows added and deleted, primary kept', () => {
    const s = copy(toSheets(base()));
    s.assignments = [{ 'Task Code*': 'A1', 'Resource*': 'Gang', 'Units at once': 3, Primary: 'Yes' }];
    const r = ok(applySheets(base(), s));
    const a = r.model.activities.find((x) => x.code === 'A1')!;
    expect(a.resources).toHaveLength(1);
    expect(a.resources[0]).toMatchObject({ resourceName: 'Gang', unitsPerTime: 3, primary: true, targetQty: 48 });
    // And a second upload without the row takes it off again.
    const again = copy(toSheets(r.model));
    again.assignments = [];
    const gone = ok(applySheets(r.model, again));
    expect(gone.model.activities.find((x) => x.code === 'A1')!.resources).toHaveLength(0);
    expect(gone.summary.join(' ')).toMatch(/1 removed/);
    // An unknown resource is left out with a word.
    const bad = copy(toSheets(base()));
    bad.assignments = [{ 'Task Code*': 'A1', 'Resource*': 'Nobody' }];
    expect(ok(applySheets(base(), bad)).warnings[0]).toMatch(/not in Resources/);
  });

  it('adds a resource that is new and updates the max units of one that is there', () => {
    const s = copy(toSheets(base()));
    s.resources = [{ 'Name*': 'Gang', 'Max units': 5 }, { 'Name*': 'Crane', Type: 'equipment', 'Max units': 1 }];
    const r = ok(applySheets(base(), s));
    expect(r.model.resourceCatalog).toHaveLength(2);
    expect(r.model.resourceCatalog!.find((x) => x.name === 'Gang')!.capacity).toBe(5);
    expect(r.summary.join(' ')).toMatch(/Resources: 1 added, 1 changed/);
  });

  it('applies a duration formula and a quantity', () => {
    const s = copy(toSheets(base()));
    s.tasks[1].Quantity = 120;
    s.tasks[1]['Productivity / day'] = 15;
    s.tasks[1]['Duration Formula'] = 'ceil(qty / (rate * crews))';
    const r = ok(applySheets(base(), s));
    expect(r.model.activities.find((x) => x.code === 'A2')!.durationHours).toBe(64);
  });
});
