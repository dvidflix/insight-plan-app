/** A working day is as long as the activity's calendar says (8 h for a Monday-Friday office week, 10 h for a site on a 6-day week ...),
    not always 8. Durations, lags and float are kept in hours; days are hours over this. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** Hours in a working day of the calendar; 8 when the activity has none, or it does not say. */
export function hoursPerDayOf(calendarId: string | null | undefined, calendars: ReadonlyMap<string, { hoursPerDay: number | null }> | undefined): number {
  const hours = calendarId ? calendars?.get(calendarId)?.hoursPerDay : null;
  return hours && hours > 0 ? hours : DEFAULT_HOURS_PER_DAY;
}
