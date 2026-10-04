import type { XmlRow, XmlTables } from './xml';

/** Programmes from MS Project (its XML: File > Save As > XML) and Excel
    (.xlsx / .xls / .csv), turned into the same tables a P6 XML export parses
    to (see xml.ts): the rest of the import — normalizeXml for the app,
    xmlToXer for the project database — then works unchanged. Durations,
    lags and floats are in hours, as in P6 XML. */

const HOURS_PER_DAY = 8;
const PROJECT_ID = '1';
const CALENDAR_ID = '1';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const isSpreadsheet = (name: string) => /\.(xlsx|xlsm|xls|csv)$/i.test(name);
export const isMsProjectXml = (text: string) => /<Project[^>]*schemas\.microsoft\.com\/project/i.test(text.slice(0, 2000));

// ---- shared -----------------------------------------------------------------

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

/** A Mon-Fri 08:00-17:00 calendar (8 h with a lunch hour), for Excel sheets. */
function standardCalendar(): XmlRow {
  const work = [{ Start: '08:00:00', Finish: '12:00:00' }, { Start: '13:00:00', Finish: '17:00:00' }];
  return {
    ObjectId: CALENDAR_ID,
    Name: 'Standard 5 day',
    HoursPerDay: String(HOURS_PER_DAY),
    HoursPerWeek: String(HOURS_PER_DAY * 5),
    StandardWorkWeek: {
      StandardWorkHours: DAYS.map((d): XmlRow => (d === 'Saturday' || d === 'Sunday' ? { DayOfWeek: d } : { DayOfWeek: d, WorkTime: work })),
    },
  };
}

type Status = 'Not Started' | 'In Progress' | 'Completed';
const statusOf = (pct: number, actualStart: string, actualFinish: string): Status =>
  actualFinish || pct >= 100 ? 'Completed' : actualStart || pct > 0 ? 'In Progress' : 'Not Started';

// ---- MS Project XML (MSPDI) ------------------------------------------------------

/** ISO 8601 duration (PT16H0M0S, P2DT4H) in hours. */
function isoHours(v: string): number {
  const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, d, h, min, s] = m;
  const hours = Number(d ?? 0) * HOURS_PER_DAY + Number(h ?? 0) + Number(min ?? 0) / 60 + Number(s ?? 0) / 3600;
  return v.trim().startsWith('-') ? -hours : hours;
}

/** MS Project link types: 0 FF, 1 FS, 2 SF, 3 SS. */
const MSP_LINK: Record<string, string> = { '0': 'Finish to Finish', '1': 'Finish to Start', '2': 'Start to Finish', '3': 'Start to Start' };

export function parseMsProjectXml(text: string): XmlTables {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid MS Project XML (parse error).');
  const root = doc.documentElement;
  const kids = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.localName === tag);
  const one = (el: Element | undefined, tag: string) => (el ? kids(el, tag)[0] : undefined);
  const val = (el: Element | undefined, tag: string) => one(el, tag)?.textContent?.trim() ?? '';
  const minutesPerDay = Number(val(root, 'MinutesPerDay')) || HOURS_PER_DAY * 60;
  const hoursPerDay = minutesPerDay / 60;
  const projectName = val(root, 'Title') || val(root, 'Name') || 'MS Project';
  const projectCalendar = val(root, 'CalendarUID') || CALENDAR_ID;

  // Calendars: weekly working times (DayType 1 = Sunday … 7 = Saturday) and
  // non-working exceptions (Project 2007+ <Exceptions>, or older DayType 0 days).
  const calendars: XmlRow[] = kids(one(root, 'Calendars') ?? root, 'Calendar').map((cal) => {
    const week: XmlRow[] = [];
    const holidays: XmlRow[] = [];
    const addHolidays = (from: string, to: string) => {
      const start = new Date(from.slice(0, 10) + 'T00:00:00');
      const end = new Date((to || from).slice(0, 10) + 'T00:00:00');
      for (let d = start, n = 0; d <= end && n < 400; d = new Date(d.getTime() + 86_400_000), n++) holidays.push({ Date: iso(d) });
    };
    for (const wd of kids(one(cal, 'WeekDays') ?? cal, 'WeekDay')) {
      const type = Number(val(wd, 'DayType'));
      const working = val(wd, 'DayWorking') === '1';
      const times = kids(one(wd, 'WorkingTimes') ?? wd, 'WorkingTime').map((t) => ({ Start: val(t, 'FromTime'), Finish: val(t, 'ToTime') })).filter((t) => t.Start);
      if (type >= 1 && type <= 7) week.push(working && times.length ? { DayOfWeek: DAYS[type - 1], WorkTime: times } : { DayOfWeek: DAYS[type - 1] });
      else if (type === 0 && !working) {
        const period = one(wd, 'TimePeriod');
        addHolidays(val(period, 'FromDate'), val(period, 'ToDate'));
      }
    }
    for (const ex of kids(one(cal, 'Exceptions') ?? cal, 'Exception')) {
      if (val(ex, 'DayWorking') === '1') continue;
      const period = one(ex, 'TimePeriod');
      addHolidays(val(period, 'FromDate'), val(period, 'ToDate'));
    }
    const row: XmlRow = { ObjectId: val(cal, 'UID'), Name: val(cal, 'Name') || `Calendar ${val(cal, 'UID')}`, HoursPerDay: String(hoursPerDay), HoursPerWeek: String(hoursPerDay * 5) };
    const base = val(cal, 'BaseCalendarUID');
    if (base && base !== '-1') row.BaseCalendarObjectId = base;
    if (week.length) row.StandardWorkWeek = { StandardWorkHours: week };
    if (holidays.length) row.HolidayOrExceptions = { HolidayOrException: holidays };
    return row;
  }).filter((c) => c.ObjectId);
  // Resource calendars carry no week of their own: keep the ones tasks can use.
  const usable = calendars.filter((c) => c.StandardWorkWeek);
  const calendarRows = usable.length ? usable : [standardCalendar()];
  const calendarIds = new Set(calendarRows.map((c) => c.ObjectId as string));
  const defaultCalendar = calendarIds.has(projectCalendar) ? projectCalendar : (calendarRows[0].ObjectId as string);

  // Summary tasks become the WBS (by outline level); the others, activities.
  const wbs: XmlRow[] = [];
  const activities: XmlRow[] = [];
  const relationships: XmlRow[] = [];
  const parents: string[] = [];
  let dataDate = val(root, 'StatusDate') || val(root, 'CurrentDate');
  for (const task of kids(one(root, 'Tasks') ?? root, 'Task')) {
    const uid = val(task, 'UID');
    if (!uid || uid === '0' || val(task, 'IsNull') === '1') continue; // 0: the project summary task
    const level = Math.max(1, Number(val(task, 'OutlineLevel')) || 1);
    parents.length = level - 1;
    const parent = [...parents].reverse().find(Boolean) ?? '';
    const name = val(task, 'Name');
    if (val(task, 'Summary') === '1') {
      const id = `W${uid}`;
      wbs.push({ ObjectId: id, ParentObjectId: parent, ProjectObjectId: PROJECT_ID, Code: val(task, 'WBS') || val(task, 'OutlineNumber'), Name: name || id });
      parents[level - 1] = id;
      continue;
    }
    const start = val(task, 'Start');
    const finish = val(task, 'Finish');
    const actualStart = val(task, 'ActualStart');
    const actualFinish = val(task, 'ActualFinish');
    const pct = Number(val(task, 'PercentComplete')) || 0;
    const duration = isoHours(val(task, 'Duration'));
    const baseline = kids(task, 'Baseline').find((b) => val(b, 'Number') === '0');
    const cal = val(task, 'CalendarUID');
    const row: XmlRow = {
      ObjectId: uid,
      ProjectObjectId: PROJECT_ID,
      Id: val(task, 'WBS') || val(task, 'ID') || uid,
      Name: name,
      WBSObjectId: parent,
      Type: val(task, 'Milestone') === '1' ? 'Finish Milestone' : 'Task Dependent',
      Status: statusOf(pct, actualStart, actualFinish),
      PercentComplete: String(pct),
      PlannedDuration: String(duration),
      RemainingDuration: String(val(task, 'RemainingDuration') ? isoHours(val(task, 'RemainingDuration')) : duration * (1 - pct / 100)),
      StartDate: start,
      FinishDate: finish,
      PlannedStartDate: val(baseline, 'Start') || start,
      PlannedFinishDate: val(baseline, 'Finish') || finish,
      EarlyStartDate: val(task, 'EarlyStart') || start,
      EarlyFinishDate: val(task, 'EarlyFinish') || finish,
      LateStartDate: val(task, 'LateStart'),
      LateFinishDate: val(task, 'LateFinish'),
      ActualStartDate: actualStart,
      ActualFinishDate: actualFinish,
      CalendarObjectId: cal && calendarIds.has(cal) ? cal : defaultCalendar,
    };
    activities.push(row);
    for (const link of kids(task, 'PredecessorLink')) {
      const pred = val(link, 'PredecessorUID');
      if (!pred) continue;
      // LinkLag is in tenths of minutes; a percentage lag (LagFormat 19/20) is left as none.
      const lagFormat = Number(val(link, 'LagFormat'));
      const lag = lagFormat === 19 || lagFormat === 20 ? 0 : (Number(val(link, 'LinkLag')) || 0) / 600;
      relationships.push({ ObjectId: `${pred}-${uid}-${relationships.length}`, PredecessorActivityObjectId: pred, SuccessorActivityObjectId: uid, Type: MSP_LINK[val(link, 'Type')] ?? 'Finish to Start', Lag: String(lag) });
    }
  }
  if (!activities.length) throw new Error('This MS Project file has no tasks (only summary tasks, or none at all).');
  const firstStart = activities.map((a) => a.StartDate as string).filter(Boolean).sort()[0] ?? '';
  dataDate = dataDate || val(root, 'StartDate') || firstStart;

  return {
    Project: [{ ObjectId: PROJECT_ID, Id: projectName.slice(0, 40), Name: projectName, PlannedStartDate: val(root, 'StartDate') || firstStart, DataDate: dataDate, ActivityDefaultCalendarObjectId: defaultCalendar }],
    Calendar: calendarRows,
    WBS: wbs,
    Activity: activities,
    Relationship: relationships.filter((r) => activities.some((a) => a.ObjectId === r.PredecessorActivityObjectId)),
  };
}

// ---- Excel / CSV ----------------------------------------------------------------

/** Column names each field is recognised by (case, spaces and punctuation ignored). */
const COLUMNS: Record<string, string[]> = {
  id: ['activityid', 'taskid', 'id', 'activitycode', 'code', 'uniqueid', 'ref', 'reference'],
  name: ['activityname', 'taskname', 'name', 'description', 'activity', 'task', 'title'],
  start: ['start', 'startdate', 'plannedstart', 'earlystart', 'begin'],
  finish: ['finish', 'finishdate', 'end', 'enddate', 'plannedfinish', 'earlyfinish'],
  duration: ['duration', 'originalduration', 'plannedduration', 'durationdays', 'days', 'od'],
  wbs: ['wbs', 'wbscode', 'wbspath', 'wbsname', 'outlinenumber'],
  predecessors: ['predecessors', 'predecessor', 'preds', 'dependencies', 'dependson'],
  percent: ['complete', 'percentcomplete', 'pctcomplete', 'progress', 'durationcomplete'],
  actualStart: ['actualstart', 'actualstartdate'],
  actualFinish: ['actualfinish', 'actualfinishdate', 'actualend'],
  type: ['type', 'activitytype', 'tasktype'],
};
const key = (h: string) => h.toLowerCase().replace(/%/g, 'percent').replace(/[^a-z0-9]/g, '');

type Cell = string | number | boolean | Date | null | undefined;

/** A date from a cell: a real date, an Excel serial, ISO, or day-first text
    ("06/01/2026", "Mon 06/01/26" as MS Project writes it). */
function cellDate(v: Cell): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86_400_000) + new Date().getTimezoneOffset() * 60_000) : null;
  const s = String(v ?? '').trim().replace(/^[A-Za-z]{3,9},?\s+/, '');
  if (!s) return null;
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s);
  if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3], +(isoMatch[4] ?? 8), +(isoMatch[5] ?? 0));
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (dmy) {
    const year = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3];
    return new Date(year, +dmy[2] - 1, +dmy[1], +(dmy[4] ?? 8), +(dmy[5] ?? 0));
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Hours from a duration cell: a number (days) or text ("5 days", "3d", "16h", "2 wks", "0"). */
function cellHours(v: Cell): number | null {
  if (typeof v === 'number') return v * HOURS_PER_DAY;
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-z]*)\??$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (/^(h|hr|hrs|hour|hours)$/.test(unit)) return n;
  if (/^(w|wk|wks|week|weeks)$/.test(unit)) return n * HOURS_PER_DAY * 5;
  if (/^(mo|mon|mons|month|months)$/.test(unit)) return n * HOURS_PER_DAY * 20;
  if (/^(m|min|mins|minute|minutes)$/.test(unit)) return n / 60;
  return n * HOURS_PER_DAY; // days, "d", "ed", or no unit
}

const LINK_TYPES: Record<string, string> = { FS: 'Finish to Start', SS: 'Start to Start', FF: 'Finish to Finish', SF: 'Start to Finish' };

/** "A100FS+2d, A200; 3SS-1 day" -> links (activity ref, type, lag hours). */
function parsePredecessors(v: Cell): { ref: string; type: string; lag: number }[] {
  return String(v ?? '')
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.+?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?\s*[a-z]*))?$/i.exec(p);
      if (!m) return { ref: p, type: 'Finish to Start', lag: 0 };
      const lag = m[4] ? (cellHours(m[4]) ?? 0) * (m[3] === '-' ? -1 : 1) : 0;
      return { ref: m[1].trim(), type: LINK_TYPES[(m[2] ?? 'FS').toUpperCase()], lag };
    });
}

export async function parseExcelSchedule(data: ArrayBuffer, fileName: string): Promise<XmlTables> {
  const XLSX = await import('xlsx');
  // CSV text stays text (the library would read 05/10/2026 US-style): dates are read day-first below.
  const csv = /\.csv$/i.test(fileName);
  const book = XLSX.read(data, { type: 'array', cellDates: true, ...(csv ? { raw: true } : {}) });
  // The first sheet with a recognisable header row (within its first 20 rows).
  let rows: Cell[][] = [];
  let headerAt = -1;
  let cols: Record<string, number> = {};
  for (const sheetName of book.SheetNames) {
    const all = XLSX.utils.sheet_to_json<Cell[]>(book.Sheets[sheetName], { header: 1, raw: true, defval: null });
    for (let r = 0; r < Math.min(20, all.length); r++) {
      const found: Record<string, number> = {};
      (all[r] ?? []).forEach((h, c) => {
        const k = key(String(h ?? ''));
        for (const [field, names] of Object.entries(COLUMNS)) if (!(field in found) && names.includes(k)) found[field] = c;
      });
      if ('name' in found && ('start' in found || 'duration' in found || 'finish' in found)) {
        rows = all;
        headerAt = r;
        cols = found;
        break;
      }
    }
    if (headerAt >= 0) break;
  }
  if (headerAt < 0) {
    throw new Error(`No programme found in ${fileName}: it needs a header row with a name column (Activity Name / Task Name / Name) and Start, Finish or Duration.`);
  }
  const header = rows[headerAt].map((h) => String(h ?? '').trim());
  const known = new Set(Object.values(cols));
  // Any other named column is kept as a user field (text) on each activity.
  const extra = header.map((h, c) => ({ h, c })).filter(({ h, c }) => h && !known.has(c));
  const udfTypes: XmlRow[] = extra.map(({ h }, i) => ({ ObjectId: String(9000 + i), Title: h, SubjectArea: 'Activity', DataType: 'Text' }));

  const cell = (row: Cell[], field: string): Cell => (field in cols ? row[cols[field]] : null);
  const wbsByPath = new Map<string, string>();
  const wbs: XmlRow[] = [];
  /** A WBS path ("Civils / Level 1", "1.2.3") -> its node id, creating the chain. */
  const wbsFor = (raw: string): string => {
    const parts = raw.includes('/') || raw.includes('>') || raw.includes('\\') ? raw.split(/\s*[/>\\]\s*/).filter(Boolean) : /^\d+(\.\d+)+$/.test(raw) ? raw.split('.').map((_, i, a) => a.slice(0, i + 1).join('.')) : [raw];
    let parent = '';
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let id = wbsByPath.get(path);
      if (!id) {
        id = `W${wbs.length + 1}`;
        wbsByPath.set(path, id);
        wbs.push({ ObjectId: id, ParentObjectId: parent, ProjectObjectId: PROJECT_ID, Code: part, Name: part });
      }
      parent = id;
    }
    return parent;
  };

  const activities: XmlRow[] = [];
  const idByRef = new Map<string, string>();
  const pending: { succ: string; preds: Cell }[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = String(cell(row, 'name') ?? '').trim();
    if (!name) continue;
    const objectId = String(activities.length + 1);
    const code = String(cell(row, 'id') ?? '').trim() || `A${(activities.length + 1) * 10}`;
    const start = cellDate(cell(row, 'start'));
    const finish = cellDate(cell(row, 'finish'));
    let hours = cellHours(cell(row, 'duration'));
    if (hours === null && start && finish) hours = Math.max(0, Math.round(((finish.getTime() - start.getTime()) / 86_400_000) * (5 / 7) + 1)) * HOURS_PER_DAY;
    hours ??= HOURS_PER_DAY;
    const pctRaw = cell(row, 'percent');
    const pct = typeof pctRaw === 'number' ? (pctRaw <= 1 ? pctRaw * 100 : pctRaw) : Number(String(pctRaw ?? '').replace('%', '')) || 0;
    const actualStart = cellDate(cell(row, 'actualStart'));
    const actualFinish = cellDate(cell(row, 'actualFinish'));
    const typeText = String(cell(row, 'type') ?? '').toLowerCase();
    const milestone = hours === 0 || /milestone/.test(typeText);
    const wbsText = String(cell(row, 'wbs') ?? '').trim();
    const a: XmlRow = {
      ObjectId: objectId,
      ProjectObjectId: PROJECT_ID,
      Id: code,
      Name: name,
      WBSObjectId: wbsText ? wbsFor(wbsText) : '',
      Type: milestone ? (/start/.test(typeText) ? 'Start Milestone' : 'Finish Milestone') : 'Task Dependent',
      Status: statusOf(pct, actualStart ? 'y' : '', actualFinish ? 'y' : ''),
      PercentComplete: String(pct),
      PlannedDuration: String(hours),
      RemainingDuration: String(hours * (1 - Math.min(100, pct) / 100)),
      CalendarObjectId: CALENDAR_ID,
    };
    if (start) Object.assign(a, { StartDate: iso(start), PlannedStartDate: iso(start) });
    if (finish) Object.assign(a, { FinishDate: iso(finish), PlannedFinishDate: iso(finish) });
    if (actualStart) a.ActualStartDate = iso(actualStart);
    if (actualFinish) a.ActualFinishDate = iso(actualFinish);
    const udf = extra.map(({ c }, i) => ({ TypeObjectId: String(9000 + i), TextValue: String(row[c] instanceof Date ? iso(row[c] as Date).slice(0, 10) : row[c] ?? '').trim() })).filter((u) => u.TextValue);
    if (udf.length) a.UDF = udf;
    activities.push(a);
    // Predecessors may name an activity by its ID, or by its row number (MS Project's "ID").
    idByRef.set(code, objectId);
    idByRef.set(`#${activities.length}`, objectId);
    if (cell(row, 'predecessors') !== null) pending.push({ succ: objectId, preds: cell(row, 'predecessors') });
  }
  if (!activities.length) throw new Error(`No activities found in ${fileName} under its header row.`);

  const relationships: XmlRow[] = [];
  const unknown = new Set<string>();
  for (const { succ, preds } of pending) {
    for (const p of parsePredecessors(preds)) {
      const pred = idByRef.get(p.ref) ?? idByRef.get(`#${p.ref}`);
      if (!pred || pred === succ) {
        unknown.add(p.ref);
        continue;
      }
      relationships.push({ ObjectId: String(relationships.length + 1), PredecessorActivityObjectId: pred, SuccessorActivityObjectId: succ, Type: p.type, Lag: String(p.lag) });
    }
  }
  if (unknown.size) console.warn(`${fileName}: predecessors not found and left out: ${[...unknown].slice(0, 20).join(', ')}`);

  // Activities without a start take the programme's first start (the CPM run then places them).
  const starts = activities.map((a) => a.StartDate as string | undefined).filter((s): s is string => !!s).sort();
  const projectStart = starts[0] ?? iso(new Date(new Date().setHours(8, 0, 0, 0)));
  for (const a of activities) {
    if (!a.StartDate) Object.assign(a, { StartDate: projectStart, PlannedStartDate: projectStart });
    if (!a.FinishDate) {
      const days = Math.ceil(Number(a.PlannedDuration) / HOURS_PER_DAY);
      const end = new Date(a.StartDate as string);
      for (let added = 0; added < Math.max(0, days - 1); ) {
        end.setDate(end.getDate() + 1);
        if (end.getDay() !== 0 && end.getDay() !== 6) added++;
      }
      end.setHours(17, 0, 0, 0);
      Object.assign(a, { FinishDate: iso(end), PlannedFinishDate: iso(end) });
    }
  }

  const title = fileName.replace(/\.[^.]+$/, '');
  return {
    Project: [{ ObjectId: PROJECT_ID, Id: title.slice(0, 40), Name: title, PlannedStartDate: projectStart, DataDate: projectStart, ActivityDefaultCalendarObjectId: CALENDAR_ID }],
    Calendar: [standardCalendar()],
    WBS: wbs,
    Activity: activities,
    Relationship: relationships,
    ...(udfTypes.length ? { UDFType: udfTypes } : {}),
  };
}
