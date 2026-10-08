import type { Activity, Relationship, ScheduleModel } from '../../src/schedule/types';

/** A local-time date, so tests read the same in any time zone. */
export const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

export function activity(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id, code: id, name: id, wbsId: null, wbsPath: '', type: 'Task Dependent', status: 'Not Started',
    targetStart: null, targetFinish: null, actualStart: null, actualFinish: null,
    earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null,
    durationHours: 8, remainingDurationHours: 8, totalFloatHours: null, freeFloatHours: null,
    isCritical: false, percentComplete: 0, constraintType: null, constraintDate: null,
    activityCodes: {}, resources: [], calendarId: null, udf: {},
    ...over,
  } as Activity;
}

export const rel = (predId: string, succId: string, type: Relationship['type'] = 'FS', lagHours = 0): Relationship =>
  ({ predId, succId, type, lagHours }) as Relationship;

export function model(activities: Activity[], relationships: Relationship[] = [], start = day(2028, 1, 3)): ScheduleModel {
  return {
    id: 'm', sourceFileName: 'test.xml', sourceFormat: 'xml',
    project: { id: 'p', name: 'Test', dataDate: start, planStart: start, planFinish: null },
    activities, relationships, wbs: [], activityCodeTypes: [], calendars: [], resourceNames: [], computedFloat: false,
  } as ScheduleModel;
}
