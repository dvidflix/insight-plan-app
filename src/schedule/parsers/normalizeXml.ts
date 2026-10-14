import { deriveLoeDates } from '../loeDates';
import type { Activity, ActivityCodeTypeDef, ActivityCodeValue, ActivityStatus, ActivityType, Relationship, ResourceAssignment, ResourceInfo, ScheduleModel, WbsNode } from '../types';
import type { CalendarDay, CalendarException, ScheduleCalendar } from '../calendar';
import { normalizeRelType } from '../relType';
import { holidayOrExceptions, nested, str, type XmlRow, type XmlTables } from './xml';

function num(v: string, fallback = 0): number {
  if (v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function date(v: string): Date | null {
  if (!v) return null;
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function xmlDurHours(v: string): number {
  // P6 XML durations are decimal hours already.
  return v !== '' ? num(v) : 0;
}

const TASK_TYPE_MAP: Record<string, ActivityType> = {
  'Task Dependent': 'task',
  'Resource Dependent': 'task',
  'Level of Effort': 'loe',
  'WBS Summary': 'wbs-summary',
  'Start Milestone': 'milestone-start',
  'Finish Milestone': 'milestone-finish',
};

const STATUS_MAP: Record<string, ActivityStatus> = {
  'Not Started': 'not-started',
  'In Progress': 'in-progress',
  Completed: 'completed',
};

export function normalizeXml(tables: XmlTables, fileName: string, projectId?: string): ScheduleModel {
  const t = (name: string): XmlRow[] => tables[name] ?? [];
  const projectRows = t('Project');
  const projectRow = projectId ? projectRows.find((r) => str(r, 'ObjectId') === projectId) : projectRows[0];

  const wbsById = new Map<string, WbsNode>();
  for (const row of t('WBS')) {
    const id = str(row, 'ObjectId');
    wbsById.set(id, { id, name: str(row, 'Name'), code: str(row, 'Code'), parentId: str(row, 'ParentObjectId') || null });
  }
  const wbsPath = (wbsId: string | null, field: 'name' | 'code' = 'name'): string => {
    const parts: string[] = [];
    let cursor = wbsId;
    let guard = 0;
    while (cursor && guard++ < 50) {
      const node = wbsById.get(cursor);
      if (!node) break;
      parts.unshift(field === 'code' ? node.code ?? '' : node.name);
      cursor = node.parentId;
    }
    return parts.join(' / ');
  };

  const rsrcNames = new Map<string, string>();
  const rsrcTypeById = new Map<string, ResourceAssignment['resourceType']>();
  for (const row of t('Resource')) {
    const id = str(row, 'ObjectId');
    rsrcNames.set(id, str(row, 'Name') || str(row, 'Id') || id);
    const type = str(row, 'ResourceType');
    rsrcTypeById.set(id, type === 'Labor' ? 'labor' : type === 'Material' ? 'material' : 'equipment');
  }
  // Max units/time per resource (its latest rate): for labour, people available per day.
  const maxUnitsById = new Map<string, { date: string; units: number }>();
  for (const row of t('ResourceRate')) {
    const id = str(row, 'ResourceObjectId');
    const date = str(row, 'EffectiveDate');
    const units = num(str(row, 'MaxUnitsPerTime'));
    const prev = maxUnitsById.get(id);
    if (units > 0 && (!prev || date >= prev.date)) maxUnitsById.set(id, { date, units });
  }
  const resourceCatalog: ResourceInfo[] = [...rsrcNames.entries()].map(([id, name]) => {
    const type = rsrcTypeById.get(id) ?? 'other';
    const units = maxUnitsById.get(id)?.units ?? null;
    // (materials: the 0.125 of concrete and rebar is not a pool; a counted material, such as a set of formwork, has 1 or more)
    return { id, name, type, capacity: type === 'labor' || type === 'equipment' || (type === 'material' && (units ?? 0) >= 1) ? units : null };
  });
  const rsrcByActivity = new Map<string, ResourceAssignment[]>();
  for (const row of t('ResourceAssignment')) {
    const activityId = str(row, 'ActivityObjectId');
    const resourceId = str(row, 'ResourceObjectId');
    const list = rsrcByActivity.get(activityId) ?? [];
    list.push({
      resourceId,
      resourceName: rsrcNames.get(resourceId) ?? resourceId,
      resourceType: rsrcTypeById.get(resourceId) ?? 'other',
      targetQty: num(str(row, 'PlannedUnits')),
      remainQty: num(str(row, 'RemainingUnits')),
      targetCost: num(str(row, 'PlannedCost')),
      actualCost: num(str(row, 'ActualCost')),
      unitsPerTime: num(str(row, 'PlannedUnitsPerTime')) || undefined,
    });
    rsrcByActivity.set(activityId, list);
  }

  const codeTypeNames = new Map<string, string>();
  for (const row of t('ActivityCodeType')) codeTypeNames.set(str(row, 'ObjectId'), str(row, 'Name'));
  const codeDefs = new Map<string, { typeId: string; name: string }>();
  const codeValuesByType = new Map<string, ActivityCodeValue[]>();
  for (const row of t('ActivityCode')) {
    const typeId = str(row, 'CodeTypeObjectId');
    const id = str(row, 'ObjectId');
    const value = str(row, 'CodeValue') || str(row, 'Name') || id;
    const description = str(row, 'Description') || value;
    codeDefs.set(id, { typeId, name: value || description });
    const list = codeValuesByType.get(typeId) ?? [];
    list.push({ id, value, description, parentId: str(row, 'ParentObjectId') || null });
    codeValuesByType.set(typeId, list);
  }
  const activityCodeCatalog: ActivityCodeTypeDef[] = [...codeTypeNames.entries()].map(([typeId, name]) => ({
    id: typeId,
    name,
    values: codeValuesByType.get(typeId) ?? [],
  }));

  // UDFs: definitions are a top-level table, but each activity's own values
  // are nested <UDF> children (not a separate UDFValue table).
  const udfLabelById = new Map<string, string>();
  for (const row of t('UDFType')) {
    const subject = str(row, 'SubjectArea');
    if (/activity|task/i.test(subject)) {
      udfLabelById.set(str(row, 'ObjectId'), str(row, 'Title') || str(row, 'DataType') || str(row, 'ObjectId'));
    }
  }

  const activityRows = t('Activity').filter((r) => !projectId || str(r, 'ProjectObjectId') === projectId);
  const activities: Activity[] = activityRows.map((row) => {
    const id = str(row, 'ObjectId');
    const activityCodes: Record<string, string> = {};
    for (const codeRef of nested(row, 'Code')) {
      const codeDef = codeDefs.get(str(codeRef, 'ValueObjectId'));
      if (codeDef) {
        const typeName = codeTypeNames.get(codeDef.typeId) ?? codeDef.typeId;
        activityCodes[typeName] = codeDef.name;
      }
    }
    const udf: Record<string, string | number> = {};
    for (const u of nested(row, 'UDF')) {
      const label = udfLabelById.get(str(u, 'TypeObjectId'));
      if (!label) continue;
      if (str(u, 'TextValue')) udf[label] = str(u, 'TextValue');
      else if (str(u, 'IntegerValue')) udf[label] = num(str(u, 'IntegerValue'));
      else if (str(u, 'NumberValue')) udf[label] = num(str(u, 'NumberValue'));
      else if (str(u, 'DoubleValue')) udf[label] = num(str(u, 'DoubleValue'));
    }

    const totalFloat = str(row, 'TotalFloat') ? xmlDurHours(str(row, 'TotalFloat')) : null;
    const freeFloat = str(row, 'FreeFloat') ? xmlDurHours(str(row, 'FreeFloat')) : null;
    const targetDur = xmlDurHours(str(row, 'PlannedDuration') || str(row, 'AtCompletionDuration'));
    const remainDur = xmlDurHours(str(row, 'RemainingDuration'));
    const pctRaw = str(row, 'PercentComplete');
    const physPctRaw = str(row, 'PhysicalPercentComplete');
    const pct = pctRaw !== '' ? num(pctRaw) * (num(pctRaw) <= 1 ? 100 : 1) : physPctRaw !== '' ? num(physPctRaw) : 0;

    return {
      id,
      code: str(row, 'Id'),
      name: str(row, 'Name'),
      wbsId: str(row, 'WBSObjectId') || null,
      wbsPath: wbsPath(str(row, 'WBSObjectId') || null),
      wbsCodePath: wbsPath(str(row, 'WBSObjectId') || null, 'code'),
      type: TASK_TYPE_MAP[str(row, 'Type')] ?? 'task',
      status: STATUS_MAP[str(row, 'Status')] ?? 'not-started',
      targetStart: date(str(row, 'PlannedStartDate') || str(row, 'StartDate')),
      targetFinish: date(str(row, 'PlannedFinishDate') || str(row, 'FinishDate')),
      actualStart: date(str(row, 'ActualStartDate')),
      actualFinish: date(str(row, 'ActualFinishDate')),
      earlyStart: date(str(row, 'EarlyStartDate') || str(row, 'StartDate')),
      earlyFinish: date(str(row, 'EarlyFinishDate') || str(row, 'FinishDate')),
      lateStart: date(str(row, 'LateStartDate')),
      lateFinish: date(str(row, 'LateFinishDate')),
      durationHours: targetDur,
      remainingDurationHours: remainDur,
      totalFloatHours: totalFloat,
      freeFloatHours: freeFloat,
      isCritical: totalFloat !== null && totalFloat <= 0,
      percentComplete: pct,
      constraintType: str(row, 'PrimaryConstraintType') || null,
      constraintDate: date(str(row, 'PrimaryConstraintDate')),
      activityCodes,
      resources: rsrcByActivity.get(id) ?? [],
      calendarId: str(row, 'CalendarObjectId') || null,
      udf,
      physicalPercentComplete: physPctRaw !== '' ? num(physPctRaw) : null,
      durationType: str(row, 'DurationType'),
      percentCompleteType: str(row, 'PercentCompleteType'),
      secondaryConstraintType: str(row, 'SecondaryConstraintType') || null,
      secondaryConstraintDate: date(str(row, 'SecondaryConstraintDate')),
      remainingStart: date(str(row, 'RemainingEarlyStartDate')),
      remainingFinish: date(str(row, 'RemainingEarlyFinishDate')),
      suspendDate: date(str(row, 'SuspendDate')),
      resumeDate: date(str(row, 'ResumeDate')),
      expectedFinish: date(str(row, 'ExpectedFinishDate')),
      primaryResource: rsrcNames.get(str(row, 'PrimaryResourceObjectId')) ?? '',
      longestPath: /^(true|1)$/i.test(str(row, 'IsLongestPath')),
    };
  });

  const activityIds = new Set(activities.map((a) => a.id));
  const relationships: Relationship[] = t('Relationship')
    .map((row) => ({
      predId: str(row, 'PredecessorActivityObjectId'),
      succId: str(row, 'SuccessorActivityObjectId'),
      type: normalizeRelType(str(row, 'Type')),
      lagHours: xmlDurHours(str(row, 'Lag')),
    }))
    .filter((r) => activityIds.has(r.predId) && activityIds.has(r.succId));

  // Each <Calendar> carries its weekly working-hours pattern as nested
  // <StandardWorkWeek><StandardWorkHours><DayOfWeek>/<WorkTime>...> — a real
  // decodable weekly pattern, unlike XER's clndr_data.
  const calendars: ScheduleCalendar[] = t('Calendar').map((row) => {
    const days: Record<string, CalendarDay> = {};
    const weeks = nested(row, 'StandardWorkWeek');
    const stdWeek = weeks[0];
    if (stdWeek) {
      for (const d of nested(stdWeek, 'StandardWorkHours')) {
        const dow = str(d, 'DayOfWeek');
        const workTimes = nested(d, 'WorkTime');
        const first = workTimes[0];
        const start = first ? str(first, 'Start') : '';
        days[dow] = start
          ? { working: true, range: `${start.slice(0, 5)}–${str(first, 'Finish').slice(0, 5)}` }
          : { working: false, range: '' };
      }
    }
    return {
      id: str(row, 'ObjectId'),
      name: str(row, 'Name'),
      hoursPerDay: str(row, 'HoursPerDay') ? num(str(row, 'HoursPerDay')) : null,
      days,
      exceptions: xmlCalendarExceptions(row),
    };
  });

  return {
    id: '',
    sourceFileName: fileName,
    sourceFormat: 'xml',
    project: {
      id: projectRow ? str(projectRow, 'ObjectId') : '',
      name: projectRow ? str(projectRow, 'Name') || str(projectRow, 'Id') : fileName,
      dataDate: projectRow ? date(str(projectRow, 'DataDate')) : null,
      planStart: null,
      planFinish: null,
    },
    activities: deriveLoeDates(activities, relationships),
    relationships,
    wbs: [...wbsById.values()],
    activityCodeTypes: [...codeTypeNames.values()],
    activityCodeCatalog,
    resourceNames: [...rsrcNames.values()],
    resourceCatalog,
    calendars,
    computedFloat: false,
  };
}

/** The calendar's dated exceptions, sorted: a holiday has no work time. */
function xmlCalendarExceptions(cal: XmlRow): CalendarException[] {
  return holidayOrExceptions(cal)
    .map(({ date, spans }) => (spans.length ? { date, working: true, range: `${spans[0].start}–${spans[spans.length - 1].finish}` } : { date, working: false, range: '' }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function listXmlProjects(tables: XmlTables): { id: string; name: string }[] {
  return (tables.Project ?? []).map((p) => ({ id: str(p, 'ObjectId'), name: str(p, 'Name') || str(p, 'Id') }));
}

export function hasUsableXmlFloat(tables: XmlTables): boolean {
  const rows = tables.Activity ?? [];
  if (rows.length === 0) return true;
  const withFloat = rows.filter((r) => str(r, 'TotalFloat') !== '').length;
  return withFloat >= rows.length / 2;
}
