import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { clndrExceptions, clndrWeek, normalizeXer } from '../../src/schedule/parsers/normalize';
import { parseXer } from '../../src/schedule/parsers/xer';
import { tablesToXer } from '../../src/schedule/exportXer';
import { calendarData, dayHours, weekHours, weekWithDayLength } from '../../src/schedule/calendarData';
import { addCalendar, deleteCalendar, standardCalendar, updateCalendar, type Result } from '../../src/schedule/programmeCommands';
import { calendarColumns, programmeRowOps } from '../../src/schedule/nativeOps';
import { recomputeCpm } from '../../src/schedule/cpm';
import type { ScheduleCalendar } from '../../src/schedule/calendar';
import { activity, day, model } from './helpers';

const ok = <T extends object>(r: Result<T>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

/** The calendar of a P6 file: split days (a lunch break), holidays, an extra working day. */
const P6_CALENDAR = '(0||CalendarData()(  (0||DaysOfWeek()(    (0||1()())    (0||2()(      (0||0(s|08:00|f|16:00)())))    (0||3()(      (0||0(s|08:00|f|12:00)())      (0||1(s|13:00|f|17:00)())))    (0||4()(      (0||0(s|08:00|f|16:00)())))    (0||5()(      (0||0(s|08:00|f|16:00)())))    (0||6()(      (0||0(s|08:00|f|16:00)())))    (0||7()())))  (0||VIEW(ShowTotal|N)())  (0||Exceptions()(    (0||0(d|38824)())    (0||1(d|38899)(      (0||0(s|08:00|f|12:00)())      (0||1(s|13:00|f|17:00)())))    (0||2(d|38945)())))))';

const readCalendar = (data: string): ScheduleCalendar => ({ id: '1', name: 'P6', hoursPerDay: 8, days: clndrWeek(data), exceptions: clndrExceptions(data) });

describe('a calendar as P6 writes it', () => {
  it('reads and writes the same calendar, split days and exceptions included', () => {
    const cal = readCalendar(P6_CALENDAR);
    expect(cal.days.Tuesday.spans).toEqual([{ start: '08:00', finish: '12:00' }, { start: '13:00', finish: '17:00' }]);
    expect(cal.exceptions).toHaveLength(3);
    const again = readCalendar(calendarData(cal));
    expect(again.days).toEqual(cal.days);
    expect(again.exceptions).toEqual(cal.exceptions);
    expect(calendarData(again)).toBe(calendarData(cal));
  });

  it('counts the hours of a day from its runs', () => {
    const cal = readCalendar(P6_CALENDAR);
    expect([dayHours(cal.days.Monday), dayHours(cal.days.Tuesday), dayHours(cal.days.Sunday)]).toEqual([8, 8, 0]);
    expect(weekHours(cal)).toBe(40);
    expect(weekHours(standardCalendar('1', 'Standard'))).toBe(40);
  });

  it('writes a calendar with no week of its own as Monday-Friday, and a working day with no run as one of its hours', () => {
    const bare: ScheduleCalendar = { id: '2', name: 'Bare', hoursPerDay: 10, days: {} };
    const days = clndrWeek(calendarData(bare));
    expect(Object.entries(days).filter(([, d]) => d.working).map(([n]) => n)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    expect(days.Monday.range).toBe('08:00–18:00');
  });
});

describe('editing calendars', () => {
  const base = () => {
    const m = model([activity('A', { calendarId: '1', status: 'not-started', durationHours: 80, remainingDurationHours: 80 })]);
    return { ...m, calendars: [standardCalendar('1', 'Five day')] };
  };

  it('adds a calendar, new or a copy, with a name of its own', () => {
    const m = base();
    const fresh = ok(addCalendar(m, 'Six day'));
    expect(fresh.id).toBe('2');
    expect(fresh.model.calendars[1].hoursPerDay).toBe(8);
    const copy = ok(addCalendar(m, 'Copy', '1'));
    expect(copy.model.calendars[1].days).toEqual(m.calendars[0].days);
    expect(copy.model.calendars[1].days).not.toBe(m.calendars[0].days);
    expect(addCalendar(m, 'five DAY')).toHaveProperty('error');
    expect(addCalendar(m, '  ')).toHaveProperty('error');
  });

  it('calculates the programme again when the working time changes, not when only the name does', () => {
    const m = base();
    expect(recomputeCpm(m).activities[0].earlyFinish).toEqual(day(2028, 1, 17)); // 10 days of 8 h
    const longer = ok(updateCalendar(m, '1', { hoursPerDay: 10 }));
    // 80 h on 10 h days is 8 days.
    expect(longer.model.activities[0].earlyFinish).toEqual(day(2028, 1, 13));
    const renamed = ok(updateCalendar(m, '1', { name: 'Site week' }));
    expect(renamed.model.activities[0]).toBe(m.activities[0]);
    expect(renamed.model.calendars[0].name).toBe('Site week');
    const holiday = ok(updateCalendar(m, '1', { exceptions: [{ date: '2028-01-05', working: false }] }));
    expect(holiday.model.activities[0].earlyFinish).toEqual(day(2028, 1, 18));
    expect(updateCalendar(m, '1', { hoursPerDay: 30 })).toHaveProperty('error');
    expect(updateCalendar(m, '9', { name: 'x' })).toHaveProperty('error');
  });

  it('keeps a calendar in use, and the last one', () => {
    const m = ok(addCalendar(base(), 'Spare')).model;
    expect(deleteCalendar(m, '1')).toHaveProperty('error', expect.stringContaining('used by 1 activity'));
    expect(ok(deleteCalendar(m, '2')).model.calendars.map((c) => c.id)).toEqual(['1']);
    expect(deleteCalendar(base(), '1')).toHaveProperty('error', expect.stringContaining('at least one'));
  });
});

describe('what saving writes for a calendar', () => {
  it('writes only the name for a rename, and the week and hours for a change of working time', () => {
    const before = readCalendar(P6_CALENDAR);
    expect(calendarColumns({ ...before, name: 'Renamed' }, before)).toEqual({ clndr_name: 'Renamed' });
    const longer = calendarColumns({ ...before, hoursPerDay: 10 }, before);
    expect(Object.keys(longer).sort()).toEqual(['clndr_data', 'day_hr_cnt', 'last_chng_date', 'month_hr_cnt', 'week_hr_cnt', 'year_hr_cnt']);
    expect(longer).toMatchObject({ day_hr_cnt: 10, week_hr_cnt: 40, year_hr_cnt: 2080 });
    const fresh = calendarColumns(standardCalendar('7', 'New'));
    expect(fresh).toMatchObject({ clndr_name: 'New', clndr_type: 'CA_Base', default_flag: 'N', week_hr_cnt: 40 });
  });

  it('reaches the P6 tables and comes back, in the XER as well', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-cal-'));
    let db: ProjectDb | undefined;
    try {
      const xer = [
        'ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD',
        '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date', '%R\t1\tDEMO\t2029-01-01 08:00\t2029-01-01 08:00',
        '%T\tCALENDAR', '%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data', `%R\t5\tSite\t8\t${P6_CALENDAR}`,
        '%T\tTASK', '%F\ttask_id\tproj_id\tclndr_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt', '%R\t1\t1\t5\tA1\tFirst\t16',
        '%E',
      ].join('\n');
      fs.writeFileSync(path.join(dir, 'p.xer'), xer);
      db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      const src = db.importXer(path.join(dir, 'p.xer'), { name: 'S', sourceFile: 'p.xer', sourceFormat: 'xer', kind: 'import', scenario: null, stem: null, projectIds: null });
      const copy = db.copyProgramme(src.id, 'Mine');
      const load = () => {
        const { tables } = db.programmeTables(copy.id);
        const rows: Record<string, Record<string, string>[]> = {};
        for (const [name, t] of Object.entries(tables)) rows[name] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
        return normalizeXer(rows, 'p.xer');
      };
      const before = load();
      const site = before.calendars[0];
      const holidays = [...(site.exceptions ?? []), { date: '2029-05-07', working: false }];
      const edited = ok(updateCalendar(before, '5', { hoursPerDay: 9, exceptions: holidays })).model;
      const added = ok(addCalendar(edited, 'Night shift', '5')).model;
      db.applyOps(copy.id, programmeRowOps(before, added));
      const back = load();
      expect(back.calendars.map((c) => [c.id, c.name, c.hoursPerDay])).toEqual([['5', 'Site', 9], ['6', 'Night shift', 9]]);
      expect(back.calendars[0].exceptions?.map((e) => [e.date, e.working])).toEqual(holidays.map((e) => [e.date, e.working]));
      expect(back.calendars[0].days).toEqual(added.calendars[0].days);
      expect(back.calendars[1].days).toEqual(added.calendars[0].days);
      // The first calendar's split Tuesday is still split.
      expect(back.calendars[0].days.Tuesday.spans).toHaveLength(2);
      const out = db.exportProgramme(copy.id);
      const written = parseXer(tablesToXer(out.tables, out.header));
      expect(written.CALENDAR.map((r) => [r.clndr_id, r.clndr_name, r.day_hr_cnt, r.clndr_type ?? ''])).toEqual([['5', 'Site', '9', ''], ['6', 'Night shift', '9', 'CA_Base']]);
      // Deleting one takes its row.
      db.applyOps(copy.id, programmeRowOps(added, ok(deleteCalendar(added, '6')).model));
      expect(load().calendars.map((c) => c.id)).toEqual(['5']);
    } finally {
      db?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('changing the length of the working day', () => {
  it('makes every working day that long by moving the end of its last run, and leaves the days off', () => {
    const cal = readCalendar(P6_CALENDAR);
    const longer = weekWithDayLength(cal.days, 10);
    expect(longer.Monday.spans).toEqual([{ start: '08:00', finish: '18:00' }]);
    expect(longer.Tuesday.spans).toEqual([{ start: '08:00', finish: '12:00' }, { start: '13:00', finish: '19:00' }]);
    expect(longer.Sunday).toBe(cal.days.Sunday);
    expect(weekHours({ ...cal, hoursPerDay: 10, days: longer })).toBe(50);
    const shorter = weekWithDayLength(cal.days, 6);
    expect(shorter.Monday.range).toBe('08:00–14:00');
    expect(weekWithDayLength(cal.days, 30).Monday.spans).toEqual([{ start: '08:00', finish: '24:00' }]);
  });
});
