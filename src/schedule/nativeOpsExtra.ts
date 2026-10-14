import type { Activity, ActivityCodeTypeDef, ResourceAssignment, ScheduleModel, UdfTypeDef } from './types';
import type { DbRowOp } from '../db/api';

/** The row changes for what a programme edited in place holds besides its activities, links, WBS and calendars (see nativeOps.ts):
    resources and their assignments (RSRC, RSRCRATE, TASKRSRC), activity codes and their assignments (ACTVTYPE, ACTVCODE,
    TASKACTV), user fields and their values (UDFTYPE, UDFVALUE). `gone` takes the deletes, `made` the upserts. */

type Cell = string | number | null;

const idValue = (id: string): string | number => (/^\d+$/.test(id) ? Number(id) : id);
const short = (s: string, n = 20) => s.slice(0, n);

/** P6's date text, "2029-03-15 08:00". */
const xerDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const RSRC_TYPE: Record<ResourceAssignment['resourceType'], string> = { labor: 'RT_Labor', material: 'RT_Mat', equipment: 'RT_Equip', other: 'RT_Labor' };

/** The TASKRSRC columns of a changed or new assignment. */
export function assignmentColumns(r: ResourceAssignment, prev?: ResourceAssignment): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  if (!prev || r.resourceType !== prev.resourceType) out.rsrc_type = RSRC_TYPE[r.resourceType];
  if (!prev || r.targetQty !== prev.targetQty) out.target_qty = r.targetQty;
  if (!prev || r.remainQty !== prev.remainQty) out.remain_qty = r.remainQty;
  if (!prev || r.unitsPerTime !== prev.unitsPerTime) {
    out.target_qty_per_hr = r.unitsPerTime ?? null;
    out.remain_qty_per_hr = r.unitsPerTime ?? null;
  }
  if (!prev || r.targetCost !== prev.targetCost) out.target_cost = r.targetCost;
  return out;
}

export function resourceOps(before: ScheduleModel, after: ScheduleModel, gone: DbRowOp[], made: DbRowOp[]) {
  const had = new Map((before.resourceCatalog ?? []).filter((r) => !r.virtual).map((r) => [r.id, r]));
  const has = new Map((after.resourceCatalog ?? []).filter((r) => !r.virtual).map((r) => [r.id, r]));
  for (const id of had.keys()) {
    if (has.has(id)) continue;
    gone.push({ table: 'RSRCRATE', op: 'delete', key: { column: 'rsrc_id', value: null }, match: { rsrc_id: idValue(id) } });
    gone.push({ table: 'RSRC', op: 'delete', key: { column: 'rsrc_id', value: idValue(id) } });
  }
  for (const [id, r] of has) {
    const prev = had.get(id);
    if (prev === r) continue;
    const set: Record<string, Cell> = {};
    if (!prev || r.name !== prev.name) { set.rsrc_name = r.name; set.rsrc_short_name = short(r.name); }
    if (!prev || r.type !== prev.type) set.rsrc_type = RSRC_TYPE[r.type];
    if (!prev) Object.assign(set, { active_flag: 'Y', rsrc_seq_num: 0 });
    if (Object.keys(set).length) made.push({ table: 'RSRC', op: 'upsert', key: { column: 'rsrc_id', value: idValue(id) }, set });
    if (!prev || r.capacity !== prev.capacity || r.costPerUnit !== prev.costPerUnit) {
      const rate: Record<string, Cell> = {};
      if (!prev || r.capacity !== prev.capacity) rate.max_qty_per_hr = r.capacity;
      if (!prev || r.costPerUnit !== prev.costPerUnit) rate.cost_per_qty = r.costPerUnit ?? 0;
      if (!prev) rate.start_date = xerDate(new Date());
      made.push({ table: 'RSRCRATE', op: 'upsert', key: { column: 'rsrc_rate_id', value: null }, match: { rsrc_id: idValue(id) }, set: rate });
    }
  }

  // What the activities have of them: by the activity and the resource.
  const beforeActs = new Map(before.activities.map((a) => [a.id, a]));
  const project = (a: Activity) => idValue(a.projectId ?? after.project.id);
  for (const a of after.activities) {
    const prev = beforeActs.get(a.id);
    if (prev && prev.resources === a.resources) continue;
    const mine = new Map(a.resources.filter((r) => !r.virtual).map((r) => [r.resourceId, r]));
    const was = new Map((prev?.resources ?? []).filter((r) => !r.virtual).map((r) => [r.resourceId, r]));
    for (const rid of was.keys()) if (!mine.has(rid)) gone.push({ table: 'TASKRSRC', op: 'delete', key: { column: 'taskrsrc_id', value: null }, match: { task_id: idValue(a.id), rsrc_id: idValue(rid) } });
    for (const [rid, r] of mine) {
      const p = was.get(rid);
      const set = assignmentColumns(r, p);
      if (!p) Object.assign(set, { proj_id: project(a), cost_qty_link_flag: 'Y' });
      if (Object.keys(set).length) made.push({ table: 'TASKRSRC', op: 'upsert', key: { column: 'taskrsrc_id', value: null }, match: { task_id: idValue(a.id), rsrc_id: idValue(rid) }, set });
    }
  }
}

const sameCodes = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

export function codeOps(before: ScheduleModel, after: ScheduleModel, gone: DbRowOp[], made: DbRowOp[]) {
  const typesOf = (m: ScheduleModel) => new Map((m.activityCodeCatalog ?? []).map((t) => [t.id, t]));
  const had = typesOf(before);
  const has = typesOf(after);
  for (const [id, t] of had) {
    if (has.has(id)) continue;
    for (const v of t.values) gone.push({ table: 'ACTVCODE', op: 'delete', key: { column: 'actv_code_id', value: idValue(v.id) } });
    gone.push({ table: 'ACTVTYPE', op: 'delete', key: { column: 'actv_code_type_id', value: idValue(id) } });
  }
  for (const [id, t] of has) {
    const prev = had.get(id);
    if (prev === t) continue;
    if (!prev || prev.name !== t.name) {
      made.push({ table: 'ACTVTYPE', op: 'upsert', key: { column: 'actv_code_type_id', value: idValue(id) }, set: { actv_code_type: t.name, ...(prev ? {} : { actv_short_len: 20, seq_num: 0, actv_code_type_scope: 'AS_Global' }) } });
    }
    const was = new Map((prev?.values ?? []).map((v) => [v.id, v]));
    const now = new Map(t.values.map((v) => [v.id, v]));
    for (const vid of was.keys()) if (!now.has(vid)) gone.push({ table: 'ACTVCODE', op: 'delete', key: { column: 'actv_code_id', value: idValue(vid) } });
    for (const [vid, v] of now) {
      const p = was.get(vid);
      if (p && p.value === v.value && p.parentId === v.parentId) continue;
      // The app reads a code's value from actv_code_name, so that is what is kept; short_name is the same text, cut to P6's length.
      made.push({
        table: 'ACTVCODE', op: 'upsert', key: { column: 'actv_code_id', value: idValue(vid) },
        set: { actv_code_type_id: idValue(id), actv_code_name: v.value, short_name: short(v.value), parent_actv_code_id: v.parentId === null ? null : idValue(v.parentId), ...(p ? {} : { seq_num: 0 }) },
      });
    }
  }

  // What the activities have: by the type's name, to its id, and the value's text, to its id.
  const typeByName = new Map((after.activityCodeCatalog ?? []).map((t) => [t.name, t]));
  const typeByNameBefore = new Map((before.activityCodeCatalog ?? []).map((t) => [t.name, t]));
  const valueId = (t: ActivityCodeTypeDef, value: string) => t.values.find((v) => v.value === value)?.id;
  const beforeActs = new Map(before.activities.map((a) => [a.id, a]));
  for (const a of after.activities) {
    const prev = beforeActs.get(a.id);
    const was = prev?.activityCodes ?? {};
    if (prev && sameCodes(was, a.activityCodes)) continue;
    const task = idValue(a.id);
    for (const name of Object.keys(was)) {
      const t = typeByName.get(name) ?? typeByNameBefore.get(name);
      if (t && !(name in a.activityCodes)) gone.push({ table: 'TASKACTV', op: 'delete', key: { column: 'task_id', value: null }, match: { task_id: task, actv_code_type_id: idValue(t.id) } });
    }
    for (const [name, value] of Object.entries(a.activityCodes)) {
      if (was[name] === value) continue;
      const t = typeByName.get(name);
      const vid = t ? valueId(t, value) : undefined;
      if (!t || vid === undefined) continue;
      made.push({ table: 'TASKACTV', op: 'upsert', key: { column: 'task_id', value: task }, match: { task_id: task, actv_code_type_id: idValue(t.id) }, set: { actv_code_id: idValue(vid), proj_id: idValue(a.projectId ?? after.project.id) } });
    }
  }
}

const udfDataType = (t: UdfTypeDef) => (t.dataType === 'number' ? 'FT_FLOAT' : 'FT_TEXT');

export function udfOps(before: ScheduleModel, after: ScheduleModel, gone: DbRowOp[], made: DbRowOp[]) {
  const had = new Map((before.udfTypes ?? []).map((t) => [t.id, t]));
  const types = after.udfTypes ?? [];
  for (const id of had.keys()) if (!types.some((t) => t.id === id)) gone.push({ table: 'UDFTYPE', op: 'delete', key: { column: 'udf_type_id', value: idValue(id) } });
  for (const t of types) {
    const p = had.get(t.id);
    if (p && p.label === t.label && p.dataType === t.dataType) continue;
    made.push({ table: 'UDFTYPE', op: 'upsert', key: { column: 'udf_type_id', value: idValue(t.id) }, set: { table_name: 'TASK', udf_type_name: t.label, udf_type_label: t.label, logical_data_type: udfDataType(t) } });
  }
  const typeOf = new Map(types.map((t) => [t.label, t]));
  const typeOfBefore = new Map((before.udfTypes ?? []).map((t) => [t.label, t]));
  const beforeActs = new Map(before.activities.map((a) => [a.id, a]));
  for (const a of after.activities) {
    const prev = beforeActs.get(a.id);
    if (prev && prev.udf === a.udf) continue;
    const was = prev?.udf ?? {};
    const fk = idValue(a.id);
    for (const label of Object.keys(was)) {
      const t = typeOf.get(label) ?? typeOfBefore.get(label);
      if (t && !(label in a.udf)) gone.push({ table: 'UDFVALUE', op: 'delete', key: { column: 'fk_id', value: null }, match: { udf_type_id: idValue(t.id), fk_id: fk } });
    }
    for (const [label, value] of Object.entries(a.udf)) {
      const t = typeOf.get(label);
      if (!t || value instanceof Date || was[label] === value) continue;
      const set: Record<string, Cell> = { proj_id: idValue(a.projectId ?? after.project.id), ...(t.dataType === 'number' ? { udf_number: Number(value), udf_text: null } : { udf_text: String(value), udf_number: null }) };
      made.push({ table: 'UDFVALUE', op: 'upsert', key: { column: 'fk_id', value: fk }, match: { udf_type_id: idValue(t.id), fk_id: fk }, set });
    }
  }
}
