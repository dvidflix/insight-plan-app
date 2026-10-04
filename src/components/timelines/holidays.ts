/** Bank holidays of England and Wales for a year (the days off with the
    usual "substitute day" rules), as "YYYY-MM-DD" dates. */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (y: number, m: number, d: number) => new Date(y, m, d);

/** Easter Sunday (the Gregorian computus). */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return at(y, month - 1, day);
}

const plus = (d: Date, days: number) => at(d.getFullYear(), d.getMonth(), d.getDate() + days);
/** A weekend day moves to the Monday (or, for Boxing Day / Christmas after one, the next free weekday). */
const substitute = (d: Date, shift: number) => (d.getDay() === 6 ? plus(d, shift) : d.getDay() === 0 ? plus(d, shift === 2 ? 2 : 1) : d);
const firstMonday = (y: number, m: number) => { const d = at(y, m, 1); return plus(d, (8 - d.getDay()) % 7); };
const lastMonday = (y: number, m: number) => { const d = at(y, m + 1, 0); return plus(d, -((d.getDay() + 6) % 7)); };

export function ukBankHolidays(year: number): { name: string; date: string }[] {
  const e = easter(year);
  const newYear = at(year, 0, 1);
  const christmas = at(year, 11, 25);
  const boxing = at(year, 11, 26);
  return [
    { name: "New Year's Day", date: iso(newYear.getDay() === 6 ? plus(newYear, 2) : newYear.getDay() === 0 ? plus(newYear, 1) : newYear) },
    { name: 'Good Friday', date: iso(plus(e, -2)) },
    { name: 'Easter Monday', date: iso(plus(e, 1)) },
    { name: 'Early May bank holiday', date: iso(firstMonday(year, 4)) },
    { name: 'Spring bank holiday', date: iso(lastMonday(year, 4)) },
    { name: 'Summer bank holiday', date: iso(lastMonday(year, 7)) },
    { name: 'Christmas Day', date: iso(substitute(christmas, 2)) },
    { name: 'Boxing Day', date: iso(substitute(boxing, 2)) },
  ].sort((a, b) => a.date.localeCompare(b.date));
}
