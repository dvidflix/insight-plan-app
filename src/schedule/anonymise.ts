import type { Activity, ScheduleModel } from './types';

/** Masks a programme before it is shared outside the company: names, IDs, WBS,
    resources, calendars and text fields are replaced by neutral labels, the
    same value always by the same label (so the logic, structure and numbers
    still read the same). Dates can be moved by a fixed number of days. */

export interface AnonymiseOptions {
  /** Activity IDs (A0010, A0020 …) and names (Activity 0001 …). */
  activities: boolean;
  wbs: boolean;
  resources: boolean;
  /** Activity code values and text user fields. */
  codes: boolean;
  calendars: boolean;
  /** Project and file name. */
  project: boolean;
  /** Move every date by this many days (0 = leave them). */
  shiftDays: number;
}

export const DEFAULT_ANONYMISE: AnonymiseOptions = { activities: true, wbs: true, resources: true, codes: true, calendars: true, project: true, shiftDays: 0 };

/** The same input always gets the same label. */
function labeller(prefix: string, pad = 0) {
  const seen = new Map<string, string>();
  return (value: string): string => {
    if (!value) return value;
    let label = seen.get(value);
    if (!label) {
      label = `${prefix}${String(seen.size + 1).padStart(pad, '0')}`;
      seen.set(value, label);
    }
    return label;
  };
}

const DAY = 86_400_000;

export interface AnonymiseResult {
  model: ScheduleModel;
  /** What was replaced, for the summary. */
  counts: { activities: number; wbs: number; resources: number; codeValues: number; calendars: number };
}

export function anonymise(model: ScheduleModel, options: AnonymiseOptions): AnonymiseResult {
  const shift = (d: Date | null | undefined) => (d && options.shiftDays ? new Date(d.getTime() + options.shiftDays * DAY) : d);
  const shiftReq = (d: Date | null) => (d && options.shiftDays ? new Date(d.getTime() + options.shiftDays * DAY) : d);

  const codeOf = labeller('A', 4);
  const nameOf = labeller('Activity ', 4);
  const wbsNameOf = labeller('WBS ', 3);
  const wbsCodeOf = labeller('W', 3);
  const resourceOf = labeller('Resource ', 2);
  const calendarOf = labeller('Calendar ', 2);
  const valueLabellers = new Map<string, (v: string) => string>();
  const valueOf = (type: string, value: string) => {
    let l = valueLabellers.get(type);
    if (!l) valueLabellers.set(type, (l = labeller(`${type} `, 2)));
    return l(value);
  };
  const udfOf = labeller('Text ', 3);

  // WBS: rebuild each path from the masked names, segment for segment.
  const wbsPath = (path: string) => (options.wbs ? path.split(' / ').map((seg) => wbsNameOf(seg)).join(' / ') : path);
  const wbsCodePath = (path: string | undefined) => (options.wbs && path !== undefined ? path.split(' / ').map((seg) => wbsCodeOf(seg)).join(' / ') : path);

  const activities: Activity[] = model.activities.map((a, i) => ({
    ...a,
    code: options.activities ? `A${String((i + 1) * 10).padStart(5, '0')}` : a.code,
    name: options.activities ? nameOf(a.code + a.name) : a.name,
    wbsPath: wbsPath(a.wbsPath),
    wbsCodePath: wbsCodePath(a.wbsCodePath),
    targetStart: shiftReq(a.targetStart),
    targetFinish: shiftReq(a.targetFinish),
    actualStart: shiftReq(a.actualStart),
    actualFinish: shiftReq(a.actualFinish),
    earlyStart: shiftReq(a.earlyStart),
    earlyFinish: shiftReq(a.earlyFinish),
    lateStart: shiftReq(a.lateStart),
    lateFinish: shiftReq(a.lateFinish),
    constraintDate: shiftReq(a.constraintDate),
    secondaryConstraintDate: shiftReq(a.secondaryConstraintDate ?? null),
    remainingStart: shiftReq(a.remainingStart ?? null),
    remainingFinish: shiftReq(a.remainingFinish ?? null),
    suspendDate: shiftReq(a.suspendDate ?? null),
    resumeDate: shiftReq(a.resumeDate ?? null),
    expectedFinish: shiftReq(a.expectedFinish ?? null),
    activityCodes: options.codes ? Object.fromEntries(Object.entries(a.activityCodes).map(([t, v]) => [t, valueOf(t, v)])) : a.activityCodes,
    udf: Object.fromEntries(
      Object.entries(a.udf).map(([k, v]) => [k, v instanceof Date ? shift(v)! : typeof v === 'string' && options.codes ? udfOf(v) : v]),
    ),
    resources: options.resources ? a.resources.map((r) => ({ ...r, resourceName: resourceOf(r.resourceName) })) : a.resources,
    primaryResource: options.resources && a.primaryResource ? resourceOf(a.primaryResource) : a.primaryResource,
  }));

  const wbsNodes = model.wbs.map((w) => ({ ...w, name: options.wbs ? wbsNameOf(w.name) : w.name, code: options.wbs && w.code ? wbsCodeOf(w.code) : w.code }));

  const catalog = model.activityCodeCatalog?.map((t) => ({
    ...t,
    values: t.values.map((v) => (options.codes ? { ...v, value: valueOf(t.name, v.value), description: '' } : v)),
  }));

  const masked: ScheduleModel = {
    ...model,
    id: `${model.id}:anonymised`,
    sourceFileName: options.project ? 'Anonymised programme' : model.sourceFileName,
    dbProgrammeId: undefined,
    project: {
      ...model.project,
      name: options.project ? 'Project' : model.project.name,
      dataDate: shiftReq(model.project.dataDate),
      planStart: shiftReq(model.project.planStart),
      planFinish: shiftReq(model.project.planFinish),
    },
    activities,
    wbs: wbsNodes,
    activityCodeCatalog: catalog,
    resourceNames: options.resources ? model.resourceNames.map((n) => resourceOf(n)) : model.resourceNames,
    resourceCatalog: model.resourceCatalog?.map((r) => (options.resources ? { ...r, name: resourceOf(r.name) } : r)),
    calendars: model.calendars.map((c) => ({
      ...c,
      name: options.calendars ? calendarOf(c.name) : c.name,
      exceptions: c.exceptions?.map((e) => (options.shiftDays ? { ...e, date: new Date(new Date(`${e.date}T00:00:00`).getTime() + options.shiftDays * DAY).toISOString().slice(0, 10) } : e)),
    })),
  };

  // The activity IDs are renumbered in order; a plain "name" label is by distinct text, so equal names stay equal.
  return {
    model: masked,
    counts: {
      activities: options.activities ? activities.length : 0,
      wbs: options.wbs ? wbsNodes.length : 0,
      resources: options.resources ? model.resourceNames.length : 0,
      codeValues: options.codes ? (catalog ?? []).reduce((n, t) => n + t.values.length, 0) : 0,
      calendars: options.calendars ? model.calendars.length : 0,
    },
  };
}
