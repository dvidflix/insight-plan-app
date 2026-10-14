import { addWorkingDays, type WorkingCalendar } from './calendar';

/** Activity constraints, as P6 has them (XER codes) or as other tools word them. */
export type ConstraintKind =
  | 'snet' // start on or after
  | 'snlt' // start on or before
  | 'on-start'
  | 'fnet' // finish on or after
  | 'fnlt' // finish on or before
  | 'on-finish'
  | 'mandatory-start'
  | 'mandatory-finish'
  | 'alap';

export function constraintKind(type: string | null | undefined): ConstraintKind | null {
  const t = (type ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/alap|as late as possible/.test(t)) return 'alap';
  if (/mandstart|mandatory start/.test(t)) return 'mandatory-start';
  if (/mandfin|mandatory finish/.test(t)) return 'mandatory-finish';
  if (/^cs_msoa$|start on or after|start no earlier/.test(t)) return 'snet';
  if (/^cs_msob$|start on or before|start no later/.test(t)) return 'snlt';
  if (/^cs_mso$|^start on$/.test(t)) return 'on-start';
  if (/^cs_meoa$|finish on or after|finish no earlier/.test(t)) return 'fnet';
  if (/^cs_meob$|finish on or before|finish no later/.test(t)) return 'fnlt';
  if (/^cs_meo$|^finish on$/.test(t)) return 'on-finish';
  return null;
}

/** What a constraint does to the start found from the links (forward pass): never earlier than a "no earlier" date, exactly on a
    mandatory one. The "on or before" kinds only bound the late dates. `days` is the working time of the activity. */
export function constrainStart(kind: ConstraintKind | null, date: Date | null, start: Date, days: number, cal: WorkingCalendar): Date {
  if (!kind || !date) return start;
  switch (kind) {
    case 'snet':
    case 'on-start':
      return date > start ? date : start;
    case 'mandatory-start':
      return date;
    case 'fnet':
    case 'on-finish': {
      const finish = addWorkingDays(start, days, cal);
      return finish < date ? addWorkingDays(date, -days, cal) : start;
    }
    case 'mandatory-finish':
      return addWorkingDays(date, -days, cal);
    default:
      return start;
  }
}

/** What a constraint does to the late dates (backward pass): a "no later" date caps them, a mandatory one fixes them. */
export function constrainLate(kind: ConstraintKind | null, date: Date | null, ls: Date, lf: Date, days: number, cal: WorkingCalendar): { ls: Date; lf: Date } {
  if (!kind || !date) return { ls, lf };
  switch (kind) {
    case 'snlt':
    case 'on-start':
      return ls > date ? { ls: date, lf: addWorkingDays(date, days, cal) } : { ls, lf };
    case 'mandatory-start':
      return { ls: date, lf: addWorkingDays(date, days, cal) };
    case 'fnlt':
    case 'on-finish':
      return lf > date ? { ls: addWorkingDays(date, -days, cal), lf: date } : { ls, lf };
    case 'mandatory-finish':
      return { ls: addWorkingDays(date, -days, cal), lf: date };
    default:
      return { ls, lf };
  }
}
