import type { Activity, ActivityStatus, ActivityType, RelationType, Relationship, ResourceAssignment, ResourceInfo, ScheduleModel } from './types';
import { recomputeCpm } from './cpm';
import { CONSTRAINT_TYPES } from './bulkEdit';
import { wbsPathOf } from './programmeCommands';
import { addActivity } from './programmeCommands';
import { hoursPerDayOfCalendar, patchActivities } from './planEdit';
import { crewOf, followProductivity, formulaOf, productivityOf, setDurationFormula, setProductivity } from './planResources';
import { setPercent } from './planEdit';
import { parseLooseDate } from './ganttEdit';
import { linkKey } from './linkTools';

/** A programme edited in place as one Excel workbook (ALICE's "Edit data in Excel"): download it, change it in Excel, upload it, and the changes
    come back as one undo step. Sheets: Tasks (a row per task, by Task Code), Relationships (a row per link: delete a row to remove the link),
    Resources, Assignments (a row per task and resource: delete a row to take it off) and a Read me. Columns marked * are needed; those marked
    "read only" are ignored on upload. Headers are matched by name, in any order, so a column that was moved still reads. What the upload would
    do is counted first (`apply` with `dryRun`) so it can be looked at before it is applied. */

export type Row = Record<string, string | number>;
export interface Sheets {
  tasks: Row[];
  relationships?: Row[];
  resources?: Row[];
  assignments?: Row[];
}

const TYPE_TEXT: Record<ActivityType, string> = { task: 'Task', 'milestone-start': 'Start Milestone', 'milestone-finish': 'Finish Milestone', loe: 'Level of Effort', 'wbs-summary': 'WBS Summary' };
const STATUS_TEXT: Record<ActivityStatus, string> = { 'not-started': 'Not Started', 'in-progress': 'In Progress', completed: 'Completed' };
const pad = (n: number) => String(n).padStart(2, '0');
const dayText = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const round2 = (n: number) => Math.round(n * 100) / 100;
const yes = (v: unknown) => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());

export const SHEET_NAMES = { tasks: 'Tasks', relationships: 'Relationships', resources: 'Resources', assignments: 'Assignments', readme: 'Read me' } as const;

export const README: string[] = [
  'Edit the programme in Excel, then upload the file in the Planning tools (Excel > Upload workbook).',
  'Columns marked * are needed. Columns marked "read only" are for your eyes and are ignored on upload. Do not rename a header.',
  'Tasks: one row per task, found by its Task Code. A code that is not in the programme adds a new task (its WBS Path must exist). A task whose row you delete is NOT deleted.',
  'Relationships: the sheet is the whole list of links. A row you add makes a link; a row you delete removes it; change the Type, Lag or Soft to change it. Codes must exist in Tasks.',
  'Assignments: the sheet is the whole list of what is assigned to the tasks (a row each). A row you delete takes the resource off the task. The resource must be in Resources.',
  'Resources: a resource is added when its name is new; its Max units and Type are updated when it is there. A resource you delete from the sheet is kept.',
  'Dates are year-month-day (2030-05-31). Durations are in working days of the task\'s calendar. Duration Formula uses qty, rate, crews, hours_per_day and udf_<Name>.',
  'Nothing is changed until you confirm the summary shown after the upload. One Undo (Ctrl+Z) puts it all back.',
];

// ---- To rows ----

export function toSheets(m: ScheduleModel): Required<Sheets> {
  const codeOf = new Map(m.activities.map((a) => [a.id, a.code]));
  const calendars = new Map(m.calendars.map((c) => [c.id, c.name || c.id]));
  const tasks = m.activities.filter((a) => a.type !== 'wbs-summary').map((a): Row => {
    const perDay = hoursPerDayOfCalendar(m, a.calendarId);
    const p = productivityOf(a);
    return {
      'Task Code*': a.code,
      'Task Name*': a.name,
      'WBS Path': a.wbsPath,
      Type: TYPE_TEXT[a.type],
      Status: STATUS_TEXT[a.status],
      'Duration (d)': round2(a.durationHours / perDay),
      'Remaining (d)': round2(a.remainingDurationHours / perDay),
      '% Complete': a.percentComplete,
      Calendar: a.calendarId ? calendars.get(a.calendarId) ?? a.calendarId : '',
      Constraint: CONSTRAINT_TYPES.find((c) => c.value === (a.constraintType ?? ''))?.label ?? '',
      'Constraint Date': dayText(a.constraintDate),
      'Actual Start': dayText(a.actualStart),
      'Actual Finish': dayText(a.actualFinish),
      'Duration Formula': formulaOf(a),
      Quantity: p.quantity ?? '',
      'Quantity Unit': p.unit,
      'Productivity / day': p.perDay ?? '',
      'Start (read only)': dayText(a.actualStart ?? a.earlyStart ?? a.targetStart),
      'Finish (read only)': dayText(a.actualFinish ?? a.earlyFinish ?? a.targetFinish),
      'Total Float d (read only)': a.totalFloatHours === null ? '' : round2(a.totalFloatHours / perDay),
      'Critical (read only)': a.isCritical ? 'Yes' : 'No',
      'Crew (read only)': crewOf(a),
    };
  });
  const relationships = m.relationships.filter((r) => codeOf.has(r.predId) && codeOf.has(r.succId)).map((r): Row => ({
    'From Task Code*': codeOf.get(r.predId)!,
    'To Task Code*': codeOf.get(r.succId)!,
    Type: r.type,
    'Lag (d)': round2(r.lagHours / hoursPerDayOfCalendar(m, m.activities.find((a) => a.id === r.succId)?.calendarId ?? null)),
    Soft: r.soft ? 'Yes' : '',
  }));
  const resources = (m.resourceCatalog ?? []).filter((r) => !r.virtual).map((r): Row => ({ 'Name*': r.name, Type: r.type, 'Max units': r.capacity ?? '' }));
  const assignments: Row[] = [];
  for (const a of m.activities) {
    for (const r of a.resources) {
      if (r.virtual) continue;
      assignments.push({ 'Task Code*': a.code, 'Resource*': r.resourceName, 'Units at once': r.unitsPerTime ?? '', Quantity: r.unitsPerTime ? '' : r.targetQty, Primary: r.primary ? 'Yes' : '' });
    }
  }
  return { tasks, relationships, resources, assignments };
}

// ---- Reading rows ----

/** A header as it is matched: no asterisk or bracketed note ("(d)", "(read only)"), lower case, single spaces. */
const norm = (h: string) => h.replace(/\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function reader(sheet: Row[] | undefined, required: string[], what: string): { rows: Map<string, string | number>[]; error?: string } {
  if (!sheet) return { rows: [] };
  const rows = sheet.map((r) => new Map(Object.entries(r).map(([k, v]) => [norm(k), v])));
  const first = rows[0];
  if (first) {
    const missing = required.filter((h) => !first.has(h));
    if (missing.length) return { rows: [], error: `The ${what} sheet has no column “${missing.join('”, “')}”. Columns must keep their names.` };
  }
  return { rows };
}
const text = (row: Map<string, string | number>, h: string): string => String(row.get(h) ?? '').trim();
const has = (row: Map<string, string | number>, h: string): boolean => row.has(h) && text(row, h) !== '';
const numberOf = (row: Map<string, string | number>, h: string): number | null => {
  const t = text(row, h).replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export interface Applied {
  model: ScheduleModel;
  /** What was done, a line each (counts first). */
  summary: string[];
  /** What was left out and why. */
  warnings: string[];
}

const TYPE_FROM: Record<string, ActivityType> = { task: 'task', 'start milestone': 'milestone-start', 'finish milestone': 'milestone-finish', milestone: 'milestone-finish', 'level of effort': 'loe', loe: 'loe' };
const STATUS_FROM: Record<string, ActivityStatus> = { 'not started': 'not-started', 'in progress': 'in-progress', completed: 'completed', complete: 'completed' };
const REL: RelationType[] = ['FS', 'SS', 'FF', 'SF'];

/** What an upload does to the programme (nothing is touched when there is an error). `summary` counts the changes; the model is the programme after. */
export function applySheets(m0: ScheduleModel, sheets: Sheets): Applied | { error: string } {
  const summary: string[] = [];
  const warnings: string[] = [];
  let m = m0;

  const t = reader(sheets.tasks, ['task code', 'task name'], 'Tasks');
  if (t.error) return { error: t.error };
  const rel = reader(sheets.relationships, ['from task code', 'to task code'], 'Relationships');
  if (rel.error) return { error: rel.error };
  const res = reader(sheets.resources, ['name'], 'Resources');
  if (res.error) return { error: res.error };
  const asg = reader(sheets.assignments, ['task code', 'resource'], 'Assignments');
  if (asg.error) return { error: asg.error };

  // ---- Tasks ----
  const wbsByPath = new Map(m.wbs.map((n) => [wbsPathOf(m.wbs, n.id).toLowerCase(), n.id]));
  const calendarByName = new Map(m.calendars.flatMap((c) => [[(c.name || c.id).toLowerCase(), c.id], [c.id.toLowerCase(), c.id]] as [string, string][]));
  const constraintByLabel = new Map(CONSTRAINT_TYPES.map((c) => [c.label.toLowerCase(), c.value]));
  let byCode = new Map(m.activities.map((a) => [a.code.toLowerCase(), a]));
  const seen = new Set<string>();
  let added = 0;
  let changed = 0;
  const patches = new Map<string, Partial<Activity>>();
  const percents = new Map<number, string[]>();
  const productivityRows: { id: string; row: Map<string, string | number> }[] = [];
  const formulaRows: { id: string; formula: string }[] = [];

  t.rows.forEach((row, at) => {
    const line = at + 2;
    const code = text(row, 'task code');
    if (!code) return;
    if (seen.has(code.toLowerCase())) { warnings.push(`Tasks row ${line}: the code “${code}” is there twice; the first is used.`); return; }
    seen.add(code.toLowerCase());
    let a = byCode.get(code.toLowerCase());
    const wbsPath = text(row, 'wbs path');
    if (!a) {
      const wbsId = wbsPath ? wbsByPath.get(wbsPath.toLowerCase()) : undefined;
      if (wbsPath && wbsId === undefined) { warnings.push(`Tasks row ${line}: the new task “${code}” is left out: there is no WBS path “${wbsPath}”.`); return; }
      const type = TYPE_FROM[text(row, 'type').toLowerCase()] ?? 'task';
      const made = addActivity(m, { name: text(row, 'task name') || code, type, days: numberOf(row, 'duration') ?? 5, ...(wbsId !== undefined ? { wbsId } : {}) });
      if ('error' in made) { warnings.push(`Tasks row ${line}: ${made.error}`); return; }
      m = made.model;
      const fresh = m.activities.find((x) => x.id === made.id)!;
      m = { ...m, activities: m.activities.map((x) => (x.id === fresh.id ? { ...x, code } : x)) };
      a = m.activities.find((x) => x.id === made.id)!;
      byCode = new Map(m.activities.map((x) => [x.code.toLowerCase(), x]));
      added++;
    }
    const patch: Partial<Activity> = {};
    const name = text(row, 'task name');
    if (name && name !== a.name) patch.name = name;
    if (has(row, 'wbs path') && wbsPath !== a.wbsPath) {
      const id = wbsByPath.get(wbsPath.toLowerCase());
      if (id === undefined) warnings.push(`Tasks row ${line}: “${code}” stays where it is: there is no WBS path “${wbsPath}”.`);
      else patch.wbsId = id;
    }
    const type = TYPE_FROM[text(row, 'type').toLowerCase()];
    if (has(row, 'type') && !type) warnings.push(`Tasks row ${line}: the type “${text(row, 'type')}” is not known.`);
    if (type && type !== a.type && a.type !== 'wbs-summary') patch.type = type;
    const perDay = hoursPerDayOfCalendar(m, a.calendarId);
    const calName = text(row, 'calendar');
    let calendarId = a.calendarId;
    if (has(row, 'calendar')) {
      const id = calendarByName.get(calName.toLowerCase());
      if (id === undefined) warnings.push(`Tasks row ${line}: the calendar “${calName}” is not in the programme.`);
      else if (id !== a.calendarId) { patch.calendarId = id; calendarId = id; }
    }
    const perDayNow = calendarId === a.calendarId ? perDay : hoursPerDayOfCalendar(m, calendarId);
    const days = numberOf(row, 'duration');
    if (days !== null && (a.type === 'task' || a.type === 'loe')) {
      if (days < 0) warnings.push(`Tasks row ${line}: the duration of “${code}” is a number of days, 0 or more.`);
      else if (!has(row, 'duration formula')) {
        const hours = Math.round(days * perDayNow * 4) / 4;
        if (hours !== a.durationHours) {
          patch.durationHours = hours;
          patch.remainingDurationHours = a.status === 'not-started' ? hours : a.status === 'in-progress' ? Math.max(0, Math.round(hours * (1 - a.percentComplete / 100) * 4) / 4) : 0;
        }
      }
    }
    const remaining = numberOf(row, 'remaining');
    if (remaining !== null && remaining >= 0) { const h = Math.round(remaining * perDayNow * 4) / 4; if (h !== (patch.remainingDurationHours ?? a.remainingDurationHours)) patch.remainingDurationHours = h; }
    const pct = numberOf(row, '% complete');
    if (pct !== null) {
      if (pct < 0 || pct > 100) warnings.push(`Tasks row ${line}: the % complete of “${code}” is between 0 and 100.`);
      else if (pct !== a.percentComplete) (percents.get(pct) ?? percents.set(pct, []).get(pct)!).push(a.id);
    } else if (has(row, 'status')) {
      const st = STATUS_FROM[text(row, 'status').toLowerCase()];
      if (!st) warnings.push(`Tasks row ${line}: the status “${text(row, 'status')}” is not known.`);
      else if (st !== a.status) patch.status = st;
    }
    if (has(row, 'constraint') || (row.has('constraint') && a.constraintType)) {
      const label = text(row, 'constraint').toLowerCase();
      const value = label === '' ? '' : constraintByLabel.get(label);
      if (value === undefined) warnings.push(`Tasks row ${line}: the constraint “${text(row, 'constraint')}” is not known.`);
      else {
        const wanted = value === '' ? null : value;
        if (wanted !== a.constraintType) patch.constraintType = wanted;
        const dateText = text(row, 'constraint date');
        const date = wanted && dateText ? parseLooseDate(dateText) : null;
        if (wanted && dateText && !date) warnings.push(`Tasks row ${line}: “${dateText}” is not a date.`);
        const was = a.constraintDate?.getTime() ?? null;
        if ((date?.getTime() ?? null) !== was && (wanted || a.constraintDate)) patch.constraintDate = date;
      }
    }
    for (const [h, field] of [['actual start', 'actualStart'], ['actual finish', 'actualFinish']] as const) {
      if (!row.has(h)) continue;
      const tx = text(row, h);
      const d = tx ? parseLooseDate(tx) : null;
      if (tx && !d) { warnings.push(`Tasks row ${line}: “${tx}” is not a date.`); continue; }
      if (dayText(d) !== dayText(a[field])) patch[field] = d;
    }
    if (Object.keys(patch).length) { patches.set(a.id, patch); changed++; }
    // Quantity, productivity and formula: through their own commands, after the rest.
    if (has(row, 'quantity') || has(row, 'productivity / day') || has(row, 'quantity unit')) productivityRows.push({ id: a.id, row });
    if (row.has('duration formula')) formulaRows.push({ id: a.id, formula: text(row, 'duration formula') });
  });
  if (patches.size) {
    const done = patchActivities(m, patches);
    if ('error' in done) return { error: done.error };
    m = done.model;
  }
  for (const [pct, ids] of percents) {
    for (const id of ids) {
      const r = setPercent(m, id, pct);
      if ('error' in r) warnings.push(r.error); else { m = r.model; changed++; }
    }
  }
  for (const { id, row } of productivityRows) {
    const a = m.activities.find((x) => x.id === id)!;
    const p = productivityOf(a);
    const quantity = has(row, 'quantity') ? numberOf(row, 'quantity') : undefined;
    const perDay = has(row, 'productivity / day') ? numberOf(row, 'productivity / day') : undefined;
    const unit = has(row, 'quantity unit') ? text(row, 'quantity unit') : undefined;
    const patch: Parameters<typeof setProductivity>[2] = {};
    if (quantity !== undefined && quantity !== null && quantity !== p.quantity) patch.quantity = quantity;
    if (perDay !== undefined && perDay !== null && perDay !== p.perDay) patch.perDay = perDay;
    if (unit !== undefined && unit !== p.unit) patch.unit = unit;
    if (!Object.keys(patch).length) continue;
    const r = setProductivity(m, id, patch);
    if ('error' in r) warnings.push(`${a.code}: ${r.error}`); else { m = r.model; changed++; }
  }
  for (const { id, formula } of formulaRows) {
    const a = m.activities.find((x) => x.id === id)!;
    if (formula === formulaOf(a)) continue;
    const r = setDurationFormula(m, [id], formula);
    if ('error' in r) warnings.push(`${a.code}: the formula “${formula}” was not applied: ${r.error}`); else { m = r.model; changed++; }
  }
  if (added || changed) summary.push(`Tasks: ${changed} changed, ${added} added.`);
  const codeToId = () => new Map(m.activities.map((a) => [a.code.toLowerCase(), a.id]));

  // ---- Resources ----
  if (sheets.resources) {
    let made = 0;
    let updated = 0;
    const catalog: ResourceInfo[] = [...(m.resourceCatalog ?? [])];
    let nextId = 1 + Math.max(0, ...catalog.map((r) => Number(r.id) || 0), ...m.activities.flatMap((a) => a.resources.map((r) => Number(r.resourceId) || 0)));
    for (const row of res.rows) {
      const name = text(row, 'name');
      if (!name) continue;
      const type = (['labor', 'equipment', 'material'] as const).find((x) => x === text(row, 'type').toLowerCase() || (x === 'labor' && /^labou?r$/i.test(text(row, 'type'))));
      const capacity = numberOf(row, 'max units');
      const at = catalog.findIndex((r) => !r.virtual && r.name.toLowerCase() === name.toLowerCase());
      if (at >= 0) {
        const cur = catalog[at];
        const next = { ...cur, ...(type ? { type } : {}), ...(row.has('max units') ? { capacity } : {}) };
        if (next.type !== cur.type || next.capacity !== cur.capacity) { catalog[at] = next; updated++; }
      } else {
        catalog.push({ id: String(nextId++), name, type: type ?? 'labor', capacity: capacity ?? null });
        made++;
      }
    }
    if (made || updated) {
      m = { ...m, resourceCatalog: catalog, resourceNames: [...new Set(catalog.map((r) => r.name))] };
      summary.push(`Resources: ${made} added, ${updated} changed.`);
    }
  }

  // ---- Relationships (the sheet is the whole list) ----
  if (sheets.relationships) {
    const ids = codeToId();
    const had = new Map(m.relationships.map((r) => [linkKey(r), r]));
    const next: Relationship[] = [];
    const wanted = new Set<string>();
    let linksAdded = 0;
    let linksChanged = 0;
    const adjacency: Relationship[] = [];
    const leads = (from: string, to: string): boolean => {
      const nx = new Map<string, string[]>();
      for (const r of adjacency) (nx.get(r.predId) ?? nx.set(r.predId, []).get(r.predId)!).push(r.succId);
      const seenIds = new Set<string>();
      const stack = [from];
      while (stack.length) { const id = stack.pop()!; if (id === to) return true; if (seenIds.has(id)) continue; seenIds.add(id); stack.push(...(nx.get(id) ?? [])); }
      return false;
    };
    rel.rows.forEach((row, at) => {
      const line = at + 2;
      const from = text(row, 'from task code');
      const to = text(row, 'to task code');
      if (!from && !to) return;
      const p = ids.get(from.toLowerCase());
      const s = ids.get(to.toLowerCase());
      if (!p || !s) { warnings.push(`Relationships row ${line}: ${!p ? `“${from}”` : `“${to}”`} is not a task code.`); return; }
      if (p === s) { warnings.push(`Relationships row ${line}: a task cannot follow itself.`); return; }
      const key = `${p}>${s}`;
      if (wanted.has(key)) { warnings.push(`Relationships row ${line}: ${from} → ${to} is there twice; the first is used.`); return; }
      const type = (text(row, 'type').toUpperCase() || 'FS') as RelationType;
      if (!REL.includes(type)) { warnings.push(`Relationships row ${line}: the type “${text(row, 'type')}” is not FS, SS, FF or SF.`); return; }
      const lag = numberOf(row, 'lag') ?? 0;
      if (leads(s, p)) { warnings.push(`Relationships row ${line}: ${from} → ${to} would make a loop, so it is left out.`); return; }
      const perDay = hoursPerDayOfCalendar(m, m.activities.find((a) => a.id === s)?.calendarId ?? null);
      const link: Relationship = { predId: p, succId: s, type, lagHours: Math.round(lag * perDay * 4) / 4, ...(yes(row.get('soft')) ? { soft: true } : {}) };
      const old = had.get(key);
      if (old && old.type === link.type && old.lagHours === link.lagHours && !!old.soft === !!link.soft) next.push(old);
      else { next.push(link); if (old) linksChanged++; else linksAdded++; }
      wanted.add(key);
      adjacency.push(link);
    });
    const removed = [...had.keys()].filter((k) => !wanted.has(k)).length;
    if (linksAdded || linksChanged || removed) {
      m = { ...m, relationships: next };
      summary.push(`Relationships: ${linksAdded} added, ${linksChanged} changed, ${removed} removed.`);
    }
  }

  // ---- Assignments (the sheet is the whole list) ----
  if (sheets.assignments) {
    const ids = codeToId();
    const byName = new Map((m.resourceCatalog ?? []).filter((r) => !r.virtual).map((r) => [r.name.toLowerCase(), r]));
    const want = new Map<string, Map<string, { units: number | null; qty: number | null; primary: boolean }>>();
    asg.rows.forEach((row, at) => {
      const line = at + 2;
      const code = text(row, 'task code');
      const rname = text(row, 'resource');
      if (!code && !rname) return;
      const id = ids.get(code.toLowerCase());
      const r = byName.get(rname.toLowerCase());
      if (!id) { warnings.push(`Assignments row ${line}: “${code}” is not a task code.`); return; }
      if (!r) { warnings.push(`Assignments row ${line}: the resource “${rname}” is not in Resources.`); return; }
      const forTask = want.get(id) ?? want.set(id, new Map()).get(id)!;
      if (forTask.has(r.id)) { warnings.push(`Assignments row ${line}: ${code} has ${rname} twice; the first is used.`); return; }
      forTask.set(r.id, { units: numberOf(row, 'units at once'), qty: numberOf(row, 'quantity'), primary: yes(row.get('primary')) });
    });
    const resPatches = new Map<string, Partial<Activity>>();
    let asAdded = 0;
    let asChanged = 0;
    let asRemoved = 0;
    for (const a of m.activities) {
      const wanted = want.get(a.id) ?? new Map();
      const keep = a.resources.filter((r) => r.virtual);
      const mine = a.resources.filter((r) => !r.virtual);
      const out: ResourceAssignment[] = [];
      for (const [rid, w] of wanted) {
        const info = (m.resourceCatalog ?? []).find((r) => r.id === rid)!;
        const crew = info.type === 'labor' || info.type === 'equipment';
        const cur = mine.find((r) => r.resourceId === rid);
        const units = crew ? (w.units ?? cur?.unitsPerTime ?? 1) : undefined;
        const qty = crew ? Math.round((units ?? 1) * a.durationHours * 4) / 4 : w.qty ?? cur?.targetQty ?? 0;
        if (cur) {
          const { primary: _p, ...rest } = cur;
          const next: ResourceAssignment = { ...rest, ...(crew ? { unitsPerTime: units, targetQty: qty, remainQty: Math.round((units ?? 1) * a.remainingDurationHours * 4) / 4 } : { targetQty: qty, remainQty: qty }), ...(crew && w.primary ? { primary: true } : {}) };
          const same = next.unitsPerTime === cur.unitsPerTime && next.targetQty === cur.targetQty && !!next.primary === !!cur.primary;
          out.push(same ? cur : next);
          if (!same) asChanged++;
        } else {
          out.push({ resourceId: rid, resourceName: info.name, resourceType: info.type, targetQty: qty, remainQty: crew ? Math.round((units ?? 1) * a.remainingDurationHours * 4) / 4 : qty, targetCost: 0, actualCost: 0, ...(crew ? { unitsPerTime: units } : {}), ...(crew && w.primary ? { primary: true } : {}) });
          asAdded++;
        }
      }
      const gone = mine.filter((r) => !wanted.has(r.resourceId)).length;
      asRemoved += gone;
      const resources = [...out, ...keep];
      if (gone || resources.length !== a.resources.length || resources.some((r, i) => r !== a.resources[i])) resPatches.set(a.id, { resources });
    }
    if (resPatches.size) {
      const done = patchActivities(m, resPatches);
      if ('error' in done) return { error: done.error };
      m = followProductivity(done.model, [...resPatches.keys()]);
      summary.push(`Assignments: ${asAdded} added, ${asChanged} changed, ${asRemoved} removed.`);
    }
  }

  if (!summary.length) summary.push('Nothing in the workbook differs from the programme.');
  else m = recomputeCpm(m, { keepOwnStarts: true });
  return { model: m, summary, warnings };
}
