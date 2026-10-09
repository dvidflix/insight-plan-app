import type { ColumnDef } from './columns';
import type { FieldFilterState, FilterFieldDef, TextMode } from './filterFields';
import { emptyFilterState } from './filterFields';

/** Primavera P6 layout files (.plf) -> this app's layouts (Programmes > Layouts).

    A .plf is a tree of nested brackets, "(0||Name(key|value|key|value)(children))", in Windows-1252.
    What carries over from an Activities layout: the columns and their widths, the sort and group rules,
    and the filter where this app's filters can say the same thing. What does not (Gantt bars and
    colours, row heights, the other P6 tabs) is left out; `notes` lists anything that was skipped or
    approximated so the layout can be checked. */

export interface PlfNode {
  name: string;
  attrs: Record<string, string>;
  kids: PlfNode[];
}

export function decodePlf(buf: ArrayBuffer): string {
  return new TextDecoder('windows-1252').decode(buf).replace(/\r?\n/g, '');
}

export function parsePlf(text: string): PlfNode {
  let i = 0;
  const node = (): PlfNode => {
    if (text[i] !== '(') throw new Error(`Not a P6 layout file (unexpected text at ${i}).`);
    i++;
    const levelEnd = text.indexOf('||', i);
    if (levelEnd < 0) throw new Error('Not a P6 layout file.');
    i = levelEnd + 2;
    const nameEnd = text.indexOf('(', i);
    const name = text.slice(i, nameEnd);
    i = nameEnd + 1;
    const attrEnd = text.indexOf(')', i);
    const parts = text.slice(i, attrEnd).split('|');
    const attrs: Record<string, string> = {};
    for (let k = 0; k + 1 < parts.length; k += 2) attrs[parts[k]] = parts[k + 1];
    i = attrEnd + 1;
    const kids: PlfNode[] = [];
    if (text[i] === '(') {
      i++;
      while (text[i] === '(') kids.push(node());
      if (text[i] !== ')') throw new Error('Not a P6 layout file (unbalanced brackets).');
      i++;
    }
    if (text[i] !== ')') throw new Error('Not a P6 layout file (unbalanced brackets).');
    i++;
    return { name, attrs, kids };
  };
  return node();
}

const child = (n: PlfNode | undefined, name: string) => n?.kids.find((k) => k.name === name);

/** P6 escapes some characters in titles as "\28" (hex code). */
const unescape = (s: string) => s.replace(/\\([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
const norm = (s: string) => unescape(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** P6 field -> column id of this app. */
const FIELD_TO_COLUMN: Record<string, string> = {
  task_code: 'code', task_name: 'name', wbs_name: 'wbsName', task_type: 'type', status_code: 'status', clndr_id: 'calendar',
  duration_type: 'durationType', complete_pct_type: 'percentCompleteType', primary_rsrc_id: 'primaryResource',
  start_date: 'start', end_date: 'finish', act_start_date: 'actualStart', act_end_date: 'actualFinish',
  early_start_date: 'earlyStart', early_end_date: 'earlyFinish', late_start_date: 'lateStart', late_end_date: 'lateFinish',
  restart_date: 'remainingStart', reend_date: 'remainingFinish', target_start_date: 'targetStart', target_end_date: 'targetFinish',
  target_drtn_hr_cnt: 'durationDays', remain_drtn_hr_cnt: 'remainingDays',
  total_float_hr_cnt: 'floatDays', free_float_hr_cnt: 'freeFloatDays', critical_flag: 'critical',
  sched_complete_pct: 'durationPct', phys_complete_pct: 'physicalPct', complete_pct: 'percentComplete',
  pred_list: 'predecessors', pred_details: 'predecessors', succ_list: 'successors', succ_details: 'successors',
  resource_code_list: 'resources', cstr_type: 'constraint', cstr_date: 'constraintDate', cstr_type2: 'constraint2', cstr_date2: 'constraintDate2',
};

const TASK_TYPE: Record<string, string> = { TT_Task: 'task', TT_Rsrc: 'task', TT_LOE: 'loe', TT_Mile: 'milestone-start', TT_FinMile: 'milestone-finish', TT_WBS: 'wbs-summary' };

export interface PlfImport {
  name: string;
  /** localStorage view settings, as a layout holds them. */
  settings: Record<string, string>;
  filters: FieldFilterState;
  notes: string[];
}

interface Ctx {
  catalog: ColumnDef[];
  filterFields: FilterFieldDef[];
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `r${Math.random().toString(36).slice(2)}`);

export function plfToLayout(text: string, ctx: Ctx, fallbackName = 'P6 layout'): PlfImport {
  const root = parsePlf(text);
  const notes: string[] = [];
  const view = root.attrs.view_type;
  if (view && view !== 'VP_ACT') throw new Error(`This is a P6 "${view}" layout; only Activities layouts (VP_ACT) can be imported.`);
  const name = unescape(root.attrs.view_name || '').trim() || fallbackName;
  const taskView = child(root, 'TaskView');
  if (!taskView) throw new Error('No Activities view in this layout.');

  const byId = new Map(ctx.catalog.map((c) => [c.id, c]));
  const byLabel = new Map<string, ColumnDef>();
  for (const c of ctx.catalog) if (!byLabel.has(norm(c.label))) byLabel.set(norm(c.label), c);

  /** The column a P6 field / title stands for in this schedule (activity codes and user fields by their title). */
  const columnFor = (field: string, title?: string): ColumnDef | undefined => {
    const direct = FIELD_TO_COLUMN[field];
    if (direct && byId.has(direct)) return byId.get(direct);
    if (title) {
      const t = norm(title);
      const exact = byLabel.get(t);
      if (exact) return exact;
      // A user field titled "2201_BYLOR - ECS Combined Code" may be "BYLOR - ECS Combined Code" in the file.
      if (/^(user_field|actv_code)/.test(field)) {
        const hit = ctx.catalog.find((c) => /^(udf|code):/.test(c.id) && (t.endsWith(norm(c.label)) || norm(c.label).endsWith(t)));
        if (hit) return hit;
      }
    }
    return undefined;
  };

  // ---- columns ----
  const columnsNode = child(taskView, 'Columns');
  const ids: string[] = [];
  const widths: Record<string, number> = {};
  const titleOfField = new Map<string, string>();
  const missing: string[] = [];
  for (const c of columnsNode?.kids ?? []) {
    const title = c.attrs.column_title;
    if (title) titleOfField.set(c.name, title);
    const col = columnFor(c.name, title);
    if (!col) {
      missing.push(unescape(title || c.name));
      continue;
    }
    if (ids.includes(col.id)) continue;
    ids.push(col.id);
    const w = parseInt(c.attrs.width, 10);
    if (w > 0) widths[col.id] = w;
  }
  if (missing.length) notes.push(`Columns this schedule does not have, left out: ${missing.join(', ')}.`);
  if (ids.length === 0) notes.push('None of the layout\'s columns exist in this schedule, so the columns are unchanged.');

  // ---- sort and group ----
  const groupSort = child(taskView, 'GroupSortBy');
  const rulesOf = (node: PlfNode | undefined, what: string) => {
    const rules: { id: string; field: string; direction: 'up' | 'down' }[] = [];
    for (const it of node?.kids ?? []) {
      const field = it.attrs.source_field;
      if (!field) continue;
      const col = columnFor(field, titleOfField.get(field));
      if (!col) {
        notes.push(`${what} on "${unescape(field)}" left out: this schedule has no such column.`);
        continue;
      }
      if (rules.some((r) => r.field === col.id)) continue;
      rules.push({ id: newId(), field: col.id, direction: it.attrs.sort_type === 'DESC' ? 'down' : 'up' });
    }
    return rules;
  };
  const sortRules = rulesOf(child(groupSort, 'SortBys'), 'Sort');
  const groupRules = rulesOf(child(groupSort, 'GroupBys'), 'Group');

  const settings: Record<string, string> = {
    'table.sortRules': JSON.stringify(sortRules),
    'table.groupRules': JSON.stringify(groupRules),
  };
  if (ids.length) {
    settings['table.columns'] = JSON.stringify(ids);
    settings['table.columnWidths'] = JSON.stringify(widths);
  }

  // ---- filter ----
  const filters = filterFrom(child(taskView, 'Filter'), ctx, titleOfField, notes, columnFor);
  return { name, settings, filters, notes };
}

// ---------------------------------------------------------------- filters

interface Item {
  field: string;
  op: string;
  arg: string;
}
interface Group {
  name: string;
  or: boolean;
  items: Item[];
}

/** One field's condition in this app's filter state (null: it cannot be expressed). */
function condition(fieldDef: FilterFieldDef, group: Group, items: Item[]): { selection?: string[]; text?: string; mode?: TextMode } | null {
  const ops = new Set(items.map((i) => i.op));
  if (fieldDef.kind === 'select') {
    if (ops.size !== 1 || !(ops.has('=') || ops.has('contains'))) return null;
    if (!group.or && items.length > 1) return null;
    const out = new Set<string>();
    for (const it of items) {
      const arg = fieldDef.id === 'type' ? TASK_TYPE[it.arg] ?? it.arg : it.arg;
      for (const v of fieldDef.values) {
        const hit = it.op === '=' ? v.value === arg || v.label === arg : v.value.toLowerCase().includes(arg.toLowerCase()) || v.label.toLowerCase().includes(arg.toLowerCase());
        if (hit) out.add(v.value);
      }
    }
    return out.size ? { selection: [...out] } : null;
  }
  if (fieldDef.kind !== 'text') return null;
  if (ops.size !== 1) return null;
  const op = [...ops][0];
  const args = items.map((i) => i.arg).filter((a) => a !== '');
  if (op === '<>' && args.length === 0) return { mode: 'filled' };
  if (op === '=' && args.length === 0) return { mode: 'empty' };
  if (args.length === 0) return null;
  const text = args.join('\n');
  const all = !group.or && items.length > 1;
  switch (op) {
    case 'contains': return { text, mode: all ? 'all' : 'contains' };
    case '=': return all ? null : { text, mode: 'equals' };
    case 'startswith': return all ? null : { text, mode: 'starts' };
    case 'endswith': return all ? null : { text, mode: 'ends' };
    case 'notcontains': return { text, mode: 'excludes' };
    default: return null;
  }
}

function filterFrom(
  filterNode: PlfNode | undefined,
  ctx: Ctx,
  titleOfField: Map<string, string>,
  notes: string[],
  columnFor: (field: string, title?: string) => ColumnDef | undefined,
): FieldFilterState {
  const state = emptyFilterState();
  const groups: Group[] = [];
  for (const g of filterNode?.kids ?? []) {
    const items = g.kids
      .filter((k) => k.attrs.source_field)
      .map((k) => ({ field: k.attrs.source_field, op: (k.attrs.op || '').toLowerCase(), arg: unescape(k.attrs.arg1 ?? '') }));
    if (items.length) groups.push({ name: g.attrs.filter_name || g.name, or: g.attrs.source_field === 'bool_or', items });
  }
  if (groups.length === 0) return state;

  const fieldDefFor = (field: string): FilterFieldDef | undefined => {
    const id = field === 'task_name' ? 'name' : field === 'task_code' ? 'code' : field === 'resource_code_list' ? 'resource' : field === 'task_type' ? 'type' : undefined;
    if (id) return ctx.filterFields.find((f) => f.id === id);
    const col = columnFor(field, titleOfField.get(field));
    return col ? ctx.filterFields.find((f) => f.id === col.id) : undefined;
  };

  // One OR group over several fields is "any of the filters"; everything else is "all of them".
  const multiFieldOr = groups.length === 1 && groups[0].or && new Set(groups[0].items.map((i) => i.field)).size > 1;
  state.combine = multiFieldOr ? 'any' : 'all';

  const used = new Set<string>();
  for (const g of groups) {
    const fieldsInGroup = [...new Set(g.items.map((i) => i.field))];
    if (g.or && fieldsInGroup.length > 1 && !multiFieldOr) {
      notes.push(`Filter "${g.name}" left out: it matches on several fields (${fieldsInGroup.map((f) => titleOfField.get(f) ?? f).join(', ')}) within a larger filter, which this app's filters cannot say.`);
      continue;
    }
    for (const field of fieldsInGroup) {
      const items = g.items.filter((i) => i.field === field);
      const def = fieldDefFor(field);
      const label = titleOfField.get(field) ?? field;
      if (!def) {
        notes.push(`Filter "${g.name}" on ${label} left out: this schedule has no such field.`);
        continue;
      }
      if (used.has(def.id)) {
        notes.push(`Filter "${g.name}" on ${def.label} left out: the field already has a condition from another filter.`);
        continue;
      }
      const c = condition(def, g, items);
      if (!c) {
        notes.push(`Filter "${g.name}" on ${def.label} left out: its condition (${items.map((i) => `${i.op} ${i.arg}`.trim()).join(g.or ? ' or ' : ' and ')}) cannot be expressed here.`);
        continue;
      }
      used.add(def.id);
      if (c.selection) state.selections[def.id] = new Set(c.selection);
      else {
        if (c.text !== undefined) state.textFilters[def.id] = c.text;
        state.textModes = { ...(state.textModes ?? {}), [def.id]: c.mode ?? 'contains' };
      }
    }
  }
  return state;
}
