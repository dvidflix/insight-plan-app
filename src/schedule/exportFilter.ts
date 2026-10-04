import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PRECAST_ACTIVITY, PRECAST_RESOURCE, QUANTITY_FIELD } from './virtualResources';
import { projectConfig } from '../projectConfig';

/** What stays out of the XML / XER files the app writes: user fields, resources and
    activity codes that are for your own use. Names as the programme shows them
    (UDF title, resource name, activity code type). Saved with the project (the
    "schedule." settings go into the project database and the configuration file). */
export interface ExportExclusions {
  udfs: string[];
  resources: string[];
  codes: string[];
  /** App-only resources (see virtualResources.ts) written into the files. They are out unless listed here. */
  includeVirtual: string[];
}

type ListKind = 'udfs' | 'resources' | 'codes';

interface ExportExclusionsState extends ExportExclusions {
  setIncludeVirtual: (name: string, included: boolean) => void;
  setExcluded: (kind: ListKind, name: string, excluded: boolean) => void;
  setMany: (kind: ListKind, names: string[], excluded: boolean) => void;
}

export const useExportExclusionsStore = create<ExportExclusionsState>()(
  persist(
    (set) => ({
      udfs: [],
      resources: [],
      codes: [],
      includeVirtual: [],
      setIncludeVirtual: (name, included) =>
        set((s) => ({ includeVirtual: included ? [...new Set([...s.includeVirtual, name])] : s.includeVirtual.filter((n) => n !== name) })),
      setExcluded: (kind, name, excluded) =>
        set((s) => ({ [kind]: excluded ? (s[kind].includes(name) ? s[kind] : [...s[kind], name]) : s[kind].filter((n) => n !== name) }) as Partial<ExportExclusionsState>),
      setMany: (kind, names, excluded) =>
        set((s) => ({ [kind]: excluded ? [...new Set([...s[kind], ...names])] : s[kind].filter((n) => !names.includes(n)) }) as Partial<ExportExclusionsState>),
    }),
    { name: 'schedule.exportExclusions' },
  ),
);

export const currentExclusions = (): ExportExclusions => {
  const { udfs, resources, codes, includeVirtual } = useExportExclusionsStore.getState();
  return { udfs, resources, codes, includeVirtual };
};

const hasExclusions = (ex: ExportExclusions) => ex.udfs.length + ex.resources.length + ex.codes.length + ex.includeVirtual.length > 0;

// ---- P6 XML (APIBusinessObjects) ----

const childText = (el: Element, tag: string) => {
  for (const c of Array.from(el.children)) if (c.tagName === tag) return c.textContent ?? '';
  return '';
};
const all = (doc: Document, tag: string) => Array.from(doc.getElementsByTagName(tag));

/** The XML text without the excluded user fields, resources and activity codes
    (their definitions and every value / assignment that points at them). */
export function filterXmlText(xml: string, ex: ExportExclusions = currentExclusions()): string {
  if (!hasExclusions(ex)) return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  const drop = (els: Element[]) => els.forEach((e) => e.parentNode?.removeChild(e));
  const idsOf = (tag: string, match: (el: Element) => boolean) => {
    const ids = new Set<string>();
    for (const el of all(doc, tag)) if (match(el)) ids.add(childText(el, 'ObjectId'));
    return ids;
  };

  const udfNames = new Set(ex.udfs);
  const udfIds = idsOf('UDFType', (e) => udfNames.has(childText(e, 'Title')));
  drop(all(doc, 'UDFType').filter((e) => udfIds.has(childText(e, 'ObjectId'))));
  drop(all(doc, 'UDFValue').filter((e) => udfIds.has(childText(e, 'UDFTypeObjectId'))));
  // The values written inside each Activity (<UDF><TypeObjectId>…).
  drop(all(doc, 'UDF').filter((e) => udfIds.has(childText(e, 'TypeObjectId'))));

  const resNames = new Set(ex.resources);
  const resIds = idsOf('Resource', (e) => resNames.has(childText(e, 'Name')) || resNames.has(childText(e, 'Id')));
  drop(all(doc, 'Resource').filter((e) => resIds.has(childText(e, 'ObjectId'))));
  for (const tag of ['ResourceAssignment', 'ResourceRate']) drop(all(doc, tag).filter((e) => resIds.has(childText(e, 'ResourceObjectId'))));

  const codeNames = new Set(ex.codes);
  const typeIds = idsOf('ActivityCodeType', (e) => codeNames.has(childText(e, 'Name')));
  drop(all(doc, 'ActivityCodeType').filter((e) => typeIds.has(childText(e, 'ObjectId'))));
  const codeIds = new Set(all(doc, 'ActivityCode').filter((e) => typeIds.has(childText(e, 'CodeTypeObjectId'))).map((e) => childText(e, 'ObjectId')));
  drop(all(doc, 'ActivityCode').filter((e) => codeIds.has(childText(e, 'ObjectId'))));
  // The codes written inside each Activity (<Code><TypeObjectId>…).
  drop(all(doc, 'Code').filter((e) => (e.parentNode as Element | null)?.tagName === 'Activity' && typeIds.has(childText(e, 'TypeObjectId'))));
  drop(all(doc, 'ActivityCodeAssignment').filter((e) => typeIds.has(childText(e, 'ActivityCodeTypeObjectId')) || codeIds.has(childText(e, 'ActivityCodeObjectId'))));

  if (ex.includeVirtual.includes(PRECAST_RESOURCE)) addPrecastResourceXml(doc);

  return new XMLSerializer().serializeToString(doc);
}

/** Precast (m3): the precast concrete of each Precast Installation activity, from its CWA-Quantity. */
function addPrecastResourceXml(doc: Document) {
  const ns = doc.documentElement.namespaceURI;
  const make = (tag: string, text?: string) => {
    const el = doc.createElementNS(ns, tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const qtyTypeIds = new Set(all(doc, 'UDFType').filter((e) => childText(e, 'Title') === QUANTITY_FIELD || /quantity/i.test(childText(e, 'Title'))).map((e) => childText(e, 'ObjectId')));
  const used = [...all(doc, 'Resource'), ...all(doc, 'ResourceRate'), ...all(doc, 'ResourceAssignment')].map((e) => Number(childText(e, 'ObjectId')) || 0);
  let next = Math.max(900000, ...used) + 1;
  const rid = String(next++);

  const jobs: { id: string; volume: number }[] = [];
  for (const a of all(doc, 'Activity')) {
    if (!childText(a, 'Name').toLowerCase().includes(PRECAST_ACTIVITY)) continue;
    let volume = 0;
    for (const u of Array.from(a.children)) {
      if (u.tagName === 'UDF' && qtyTypeIds.has(childText(u, 'TypeObjectId'))) volume = Number(childText(u, 'DoubleValue') || childText(u, 'NumberValue')) || 0;
    }
    jobs.push({ id: childText(a, 'ObjectId'), volume });
  }
  if (jobs.length === 0) return;

  const resource = make('Resource');
  for (const [k, v] of [['ObjectId', rid], ['Id', `${projectConfig.projectPrefix}-P`], ['Name', PRECAST_RESOURCE], ['ResourceType', 'Material'], ['CalendarObjectId', '1'], ['CurrencyObjectId', '1'], ['IsActive', '1'], ['GUID', crypto.randomUUID().toUpperCase()]]) resource.appendChild(make(k, v));
  const rate = make('ResourceRate');
  for (const [k, v] of [['EffectiveDate', '1970-01-02T00:00:00'], ['MaxUnitsPerTime', '0.125'], ['ObjectId', rid], ['PricePerUnit', '0'], ['ResourceObjectId', rid]]) rate.appendChild(make(k, v));
  const lastRes = all(doc, 'ResourceRate').pop() ?? all(doc, 'Resource').pop();
  const firstActivity = all(doc, 'Activity')[0];
  const resParent = (lastRes ?? firstActivity).parentNode!;
  const resRef = lastRes ? lastRes.nextSibling : firstActivity;
  resParent.insertBefore(resource, resRef);
  resParent.insertBefore(rate, resRef);

  const lastAssign = all(doc, 'ResourceAssignment').pop();
  const projectId = lastAssign ? childText(lastAssign, 'ProjectObjectId') : '1';
  const assignParent = (lastAssign ?? firstActivity).parentNode!;
  const assignRef = lastAssign ? lastAssign.nextSibling : null;
  for (const j of jobs) {
    const ra = make('ResourceAssignment');
    for (const [k, v] of [['ObjectId', String(next++)], ['ActivityObjectId', j.id], ['ResourceObjectId', rid], ['ProjectObjectId', projectId || '1'], ['PlannedUnits', String(j.volume)], ['RemainingUnits', String(j.volume)], ['AtCompletionUnits', String(j.volume)]]) ra.appendChild(make(k, v));
    assignParent.insertBefore(ra, assignRef);
  }
}

// ---- XER tables ----

interface XerTable {
  columns: string[];
  rows: string[][];
}

/** The tables without the excluded user fields, resources and activity codes. */
export function filterXerTables<T extends Record<string, XerTable>>(tables: T, ex: ExportExclusions = currentExclusions()): T {
  if (!hasExclusions(ex)) return tables;
  const withVirtual = ex.includeVirtual.includes(PRECAST_RESOURCE) ? addPrecastResourceTables(tables) : tables;
  return filterLists(withVirtual, ex);
}

/** The XER tables with Precast (m3) added: an RSRC row and a TASKRSRC row for each Precast Installation task. */
function addPrecastResourceTables<T extends Record<string, XerTable>>(tables: T): T {
  const task = tables.TASK;
  const rsrc = tables.RSRC;
  const taskrsrc = tables.TASKRSRC;
  if (!task || !rsrc || !taskrsrc) return tables;
  const ix = (t: XerTable, name: string) => t.columns.findIndex((c) => c.toLowerCase() === name);
  const idI = ix(task, 'task_id');
  const nameI = ix(task, 'task_name');
  const projI = ix(task, 'proj_id');
  if (idI < 0 || nameI < 0) return tables;
  // CWA-Quantity per task, from UDFVALUE.
  const qty = new Map<string, number>();
  const types = tables.UDFTYPE;
  const values = tables.UDFVALUE;
  if (types && values) {
    const labelI = ix(types, 'udf_type_label');
    const typeIdI = ix(types, 'udf_type_id');
    const typeIds = new Set(types.rows.filter((r) => /quantity/i.test(r[labelI] ?? '')).map((r) => r[typeIdI]));
    const tI = ix(values, 'udf_type_id');
    const fI = ix(values, 'fk_id');
    const nI = ix(values, 'udf_number');
    for (const r of values.rows) if (typeIds.has(r[tI])) qty.set(r[fI], Number(r[nI]) || 0);
  }
  const maxId = (t: XerTable, c: string) => Math.max(900000, ...t.rows.map((r) => Number(r[ix(t, c)]) || 0));
  const rid = String(maxId(rsrc, 'rsrc_id') + 1);
  let trid = maxId(taskrsrc, 'taskrsrc_id');
  const row = (t: XerTable, v: Record<string, string>) => t.columns.map((c) => v[c.toLowerCase()] ?? '');
  const jobs = task.rows.filter((r) => (r[nameI] ?? '').toLowerCase().includes(PRECAST_ACTIVITY));
  if (jobs.length === 0) return tables;
  return {
    ...tables,
    RSRC: { columns: rsrc.columns, rows: [...rsrc.rows, row(rsrc, { rsrc_id: rid, rsrc_name: PRECAST_RESOURCE, rsrc_short_name: `${projectConfig.projectPrefix}-P`, rsrc_type: 'RT_Mat', active_flag: 'Y', def_qty_per_hr: '1', cost_qty_type: 'QT_Hour', curr_id: '1', guid: crypto.randomUUID().toUpperCase() })] },
    TASKRSRC: {
      columns: taskrsrc.columns,
      rows: [
        ...taskrsrc.rows,
        ...jobs.map((r) => {
          const v = String(qty.get(r[idI]) ?? 0);
          return row(taskrsrc, { taskrsrc_id: String(++trid), task_id: r[idI], proj_id: projI >= 0 ? r[projI] : '', rsrc_id: rid, remain_qty: v, target_qty: v, remain_qty_per_hr: '1', target_qty_per_hr: '1', target_lag_drtn_hr_cnt: '0', act_ot_qty: '0', act_reg_qty: '0', target_cost: '0', act_reg_cost: '0', act_ot_cost: '0', remain_cost: '0', rsrc_type: 'RT_Mat', curr_id: '1' });
        }),
      ],
    },
  } as T;
}

function filterLists<T extends Record<string, XerTable>>(tables: T, ex: ExportExclusions): T {
  const col = (t: XerTable | undefined, name: string) => (t ? t.columns.findIndex((c) => c.toLowerCase() === name) : -1);
  const idsWhere = (t: XerTable | undefined, idCol: string, nameCols: string[], names: string[]) => {
    const ids = new Set<string>();
    const set = new Set(names);
    const ci = col(t, idCol);
    const ni = nameCols.map((n) => col(t, n)).filter((i) => i >= 0);
    if (t && ci >= 0) for (const r of t.rows) if (ni.some((i) => set.has(r[i]))) ids.add(r[ci]);
    return ids;
  };
  const udfIds = idsWhere(tables.UDFTYPE, 'udf_type_id', ['udf_type_label', 'udf_type_name'], ex.udfs);
  const rsrcIds = idsWhere(tables.RSRC, 'rsrc_id', ['rsrc_name', 'rsrc_short_name'], ex.resources);
  const typeIds = idsWhere(tables.ACTVTYPE, 'actv_code_type_id', ['actv_code_type'], ex.codes);
  const rules: [string, Set<string>][] = [['udf_type_id', udfIds], ['rsrc_id', rsrcIds], ['actv_code_type_id', typeIds]];

  const out: Record<string, XerTable> = {};
  for (const [name, t] of Object.entries(tables)) {
    const checks = rules.map(([c, ids]) => [col(t, c), ids] as const).filter(([i, ids]) => i >= 0 && ids.size > 0);
    out[name] = checks.length ? { columns: t.columns, rows: t.rows.filter((r) => !checks.some(([i, ids]) => ids.has(r[i]))) } : t;
  }
  return out as T;
}
