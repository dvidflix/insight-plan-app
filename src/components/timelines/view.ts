import type { GroupRule } from '../schedule/GroupPanel';
import { shortName, type Person, type Timeline, type TimelineRow } from '../../state/timelinesStore';

/** The rows of a timeline as shown: filtered, and grouped by the timeline's
    group rules (the first outermost) the way the Programmes table groups. A
    group is a header item followed by its rows (or sub-groups), unless it is
    collapsed. */

export const GROUP_PLANNER = 'planner';
export const GROUP_NAME = 'name';

export type ViewItem =
  | { kind: 'group'; key: string; label: string; field: string; depth: number; count: number; collapsed: boolean; rows: TimelineRow[] }
  | { kind: 'row'; row: TimelineRow; depth: number };

/** A row's value for a built-in field ('name', 'planner') or a user field. */
export function valueOfRow(row: TimelineRow, field: string, personName: (id: string | null) => string): string {
  if (field === GROUP_NAME) return row.name;
  if (field === GROUP_PLANNER) return personName(row.plannerId);
  return row.values?.[field] ?? '';
}

const compare = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

/** A merged (pivot-style) cell: one group value over `len` consecutive rows from `start`, at group level `level`. */
export interface Merge {
  level: number;
  start: number;
  len: number;
  label: string;
  field: string;
}

/** Where equal group values meet in consecutive rows, for merging their cells like a pivot table. */
export function mergesOf(rows: TimelineRow[], rules: GroupRule[], people: Person[]): Merge[] {
  const names = new Map(people.map((p) => [p.id, shortName(p)]));
  const personName = (id: string | null) => (id ? names.get(id) ?? '' : '');
  const out: Merge[] = [];
  rules.forEach((rule, level) => {
    let current: Merge | null = null;
    let prefix = '';
    rows.forEach((row, i) => {
      const key = rules.slice(0, level + 1).map((x) => valueOfRow(row, x.field, personName)).join('');
      if (current && key === prefix) current.len++;
      else {
        current = { level, start: i, len: 1, label: valueOfRow(row, rule.field, personName), field: rule.field };
        out.push(current);
        prefix = key;
      }
    });
  });
  return out;
}

export function buildView(timeline: Timeline, people: Person[], collapsed: ReadonlySet<string>, filter = ''): { items: ViewItem[]; rows: TimelineRow[]; groupKeys: string[] } {
  const names = new Map(people.map((p) => [p.id, shortName(p)]));
  const personName = (id: string | null) => (id ? names.get(id) ?? '' : '');
  const q = filter.trim().toLowerCase();
  const matches = (r: TimelineRow) =>
    !q || r.name.toLowerCase().includes(q) || (r.note ?? '').toLowerCase().includes(q) || Object.values(r.values ?? {}).some((v) => v.toLowerCase().includes(q)) || personName(r.plannerId).toLowerCase().includes(q);
  const list = timeline.rows.filter(matches);
  const rules: GroupRule[] = timeline.groups ?? [];
  const items: ViewItem[] = [];
  const rows: TimelineRow[] = [];
  const groupKeys: string[] = [];

  const walk = (group: TimelineRow[], level: number, prefix: string) => {
    const rule = rules[level];
    if (!rule) {
      for (const row of group) {
        items.push({ kind: 'row', row, depth: level });
        rows.push(row);
      }
      return;
    }
    const buckets = new Map<string, TimelineRow[]>();
    for (const row of group) {
      const v = valueOfRow(row, rule.field, personName);
      (buckets.get(v) ?? buckets.set(v, []).get(v)!).push(row);
    }
    const keys = [...buckets.keys()].sort((a, b) => (rule.direction === 'up' ? compare(a, b) : compare(b, a)));
    for (const k of keys) {
      const key = `${prefix}/${rule.field}=${k}`;
      const isCollapsed = collapsed.has(key);
      if (!timeline.mergeGroups) groupKeys.push(key);
      // Merged cells (pivot-style): no header rows, the rows just follow in group order.
      if (timeline.mergeGroups) {
        walk(buckets.get(k)!, level + 1, key);
        continue;
      }
      items.push({ kind: 'group', key, label: k || '(blank)', field: rule.field, depth: level, count: buckets.get(k)!.length, collapsed: isCollapsed, rows: buckets.get(k)! });
      if (!isCollapsed) walk(buckets.get(k)!, level + 1, key);
    }
  };
  walk(list, 0, '');
  return { items, rows, groupKeys };
}
