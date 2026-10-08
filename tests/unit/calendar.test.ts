import { describe, expect, it } from 'vitest';
import { addWorkingDays, getCalendar, workingDaysBetween, type ScheduleCalendar } from '../../src/schedule/calendar';
import { day } from './helpers';

const none = new Map<string, ScheduleCalendar>();
const standard = getCalendar(null, none); // Mon-Fri

const site = (off: string[], extra: string[] = []): ScheduleCalendar => ({
  id: 'c', name: 'Site', hoursPerDay: 8, days: {},
  exceptions: [...off.map((date) => ({ date, working: false })), ...extra.map((date) => ({ date, working: true, range: '08:00-16:00' }))],
});
const calendarOf = (c: ScheduleCalendar) => getCalendar('c', new Map([['c', c]]));

describe('working calendar', () => {
  it('has five working days in the standard week', () => {
    expect(standard.workingDaysPerWeek).toBe(5);
    expect(standard.isWorkingDay(day(2028, 1, 3))).toBe(true); // Monday
    expect(standard.isWorkingDay(day(2028, 1, 8))).toBe(false); // Saturday
  });

  it('adds working days over a weekend', () => {
    expect(addWorkingDays(day(2028, 1, 6), 1, standard)).toEqual(day(2028, 1, 7)); // Thu -> Fri
    expect(addWorkingDays(day(2028, 1, 7), 1, standard)).toEqual(day(2028, 1, 10)); // Fri -> Mon
    expect(addWorkingDays(day(2028, 1, 3), 10, standard)).toEqual(day(2028, 1, 17));
  });

  it('subtracts working days too', () => {
    expect(addWorkingDays(day(2028, 1, 10), -1, standard)).toEqual(day(2028, 1, 7));
    expect(addWorkingDays(day(2028, 1, 17), -10, standard)).toEqual(day(2028, 1, 3));
  });

  it('skips a holiday and counts an extra working Saturday', () => {
    expect(addWorkingDays(day(2028, 1, 4), 1, calendarOf(site(['2028-01-05'])))).toEqual(day(2028, 1, 6)); // Wed 5th is off
    expect(addWorkingDays(day(2028, 1, 7), 1, calendarOf(site([], ['2028-01-08'])))).toEqual(day(2028, 1, 8));
  });

  it('counts the working days in a range, negative when reversed', () => {
    expect(workingDaysBetween(day(2028, 1, 3), day(2028, 1, 10), standard)).toBe(5);
    expect(workingDaysBetween(day(2028, 1, 10), day(2028, 1, 3), standard)).toBe(-5);
    expect(workingDaysBetween(null, day(2028, 1, 3), standard)).toBeNull();
  });

  it('adding then counting gives the same number of days', () => {
    for (const n of [1, 4, 5, 6, 12, 33]) {
      const end = addWorkingDays(day(2028, 2, 1), n, standard);
      expect(workingDaysBetween(day(2028, 2, 1), end, standard)).toBe(n);
    }
  });
});
