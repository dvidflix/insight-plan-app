import * as XLSX from 'xlsx';
import type { Activity, ScheduleModel } from './types';

export function exportActivitiesXlsx(activities: Activity[], fileName: string) {
  const rows = activities.map((a) => ({
    Code: a.code,
    Name: a.name,
    WBS: a.wbsPath,
    Type: a.type,
    Status: a.status,
    Start: (a.earlyStart ?? a.targetStart)?.toISOString().slice(0, 10) ?? '',
    Finish: (a.earlyFinish ?? a.targetFinish)?.toISOString().slice(0, 10) ?? '',
    'Duration (d)': Math.round((a.durationHours / 8) * 10) / 10,
    'Total Float (d)': a.totalFloatHours !== null ? Math.round((a.totalFloatHours / 8) * 10) / 10 : '',
    Critical: a.isCritical ? 'Yes' : 'No',
    '% Complete': a.percentComplete,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Activities');
  XLSX.writeFile(book, fileName);
}

const dayStr = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
const TYPE_TEXT: Record<Activity['type'], string> = { task: 'Task', 'milestone-start': 'Start Milestone', 'milestone-finish': 'Finish Milestone', loe: 'Level of Effort', 'wbs-summary': 'WBS Summary' };

/** A whole programme as a workbook this app (and others) can read back: Activities
    with their predecessors in the Excel-import layout ("A100FS+2d"), plus WBS and
    Relationships sheets. Used for the anonymised copy. */
export function exportScheduleXlsx(model: ScheduleModel, fileName: string) {
  const codeById = new Map(model.activities.map((a) => [a.id, a.code || a.id]));
  const predsOf = new Map<string, string[]>();
  for (const r of model.relationships) {
    const lagDays = r.lagHours / 8;
    const text = `${codeById.get(r.predId) ?? r.predId}${r.type}${lagDays ? `${lagDays > 0 ? '+' : ''}${lagDays}d` : ''}`;
    (predsOf.get(r.succId) ?? predsOf.set(r.succId, []).get(r.succId)!).push(text);
  }
  const activities = model.activities.map((a) => ({
    'Activity ID': a.code,
    'Activity Name': a.name,
    WBS: a.wbsPath.replace(/ \/ /g, ' / '),
    Type: TYPE_TEXT[a.type],
    Start: dayStr(a.actualStart ?? a.earlyStart ?? a.targetStart),
    Finish: dayStr(a.actualFinish ?? a.earlyFinish ?? a.targetFinish),
    Duration: Math.round((a.durationHours / 8) * 10) / 10,
    Predecessors: (predsOf.get(a.id) ?? []).join(', '),
    '% Complete': a.percentComplete,
    'Actual Start': dayStr(a.actualStart),
    'Actual Finish': dayStr(a.actualFinish),
  }));
  const relationships = model.relationships.map((r) => ({ Predecessor: codeById.get(r.predId) ?? r.predId, Successor: codeById.get(r.succId) ?? r.succId, Type: r.type, 'Lag (d)': r.lagHours / 8 }));
  const wbs = model.wbs.map((w) => ({ Code: w.code ?? '', Name: w.name }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(activities), 'Activities');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(relationships), 'Relationships');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(wbs), 'WBS');
  XLSX.writeFile(book, fileName);
}
