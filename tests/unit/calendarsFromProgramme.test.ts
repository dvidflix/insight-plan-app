import { describe, expect, it } from 'vitest';
import { calendarsFromProgrammes, syncCalendars } from '../../src/prs/calendarsFromProgramme';

const day = (working: boolean, start = '09:00', finish = '17:00') => ({ working, spans: working ? [{ start, finish }] : undefined });
const week = (days: string[]) => Object.fromEntries(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => [d, day(days.includes(d))]));

describe('the programmes\' calendars as generator calendars', () => {
  it('reads the working days, the start and the hours, and names a calendar as the programme does', () => {
    const [six, seven] = calendarsFromProgrammes([
      { id: 'C1', name: 'CWA 6d Calendar', hoursPerDay: 8, days: week(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) },
      { id: 'C2', name: 'CWA 7d Curing Calendar', hoursPerDay: null, days: week(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) },
    ]);
    expect(six).toMatchObject({ id: 'CWA 6d Calendar', name: 'CWA 6d Calendar', workDays: [0, 1, 2, 3, 4], start: '09:00', hoursPerDay: 8 });
    expect(seven.workDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(seven.hoursPerDay).toBe(8);
  });

  it('keeps one calendar of a name; a calendar with no pattern is Mon-Fri', () => {
    const rows = calendarsFromProgrammes([
      { id: 'A', name: 'Same', hoursPerDay: 8, days: {} },
      { id: 'B', name: 'same', hoursPerDay: 8, days: {} },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].workDays).toEqual([0, 1, 2, 3, 4]);
  });

  it('are the only calendars: the old ID of a calendar of the same name stays, the others go', () => {
    const programme = calendarsFromProgrammes([{ id: 'C1', name: 'CWA 6d Calendar', hoursPerDay: 8, days: week(['Monday', 'Tuesday']) }]);
    const next = syncCalendars([{ id: '6D', name: 'CWA 6d Calendar', workDays: [0, 1, 2, 3, 4], start: '09:00', hoursPerDay: 8, default: true }, { id: 'Z', name: 'Old', workDays: [0], start: '07:00', hoursPerDay: 9 }], programme);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: '6D', workDays: [0, 1], default: true });
    expect(syncCalendars(next, programme)).toBe(next); // nothing changed: the same list
  });

  it('keeps the rules\' own calendars while no programme with calendars is loaded', () => {
    const own = [{ id: '6D', name: '6D', workDays: [0], start: '09:00', hoursPerDay: 8 }];
    expect(syncCalendars(own, [])).toBe(own);
  });
});
