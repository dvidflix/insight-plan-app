import { combineTests } from '../viewer/filterLogic';
import type { GroupRule } from '../components/schedule/GroupPanel';
import type { SortRule } from '../components/schedule/SortPanel';

/** View settings for the Scenarios pour table (Configuration > Columns /
    Filters / Group / Sort / Color). They change only what is shown — the
    pour order itself is edited with the move buttons and drag & drop. */

export type ScnOp = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'empty' | 'notEmpty';

export const SCN_OPS: { id: ScnOp; label: string; needsValue: boolean }[] = [
  { id: 'equals', label: 'is', needsValue: true },
  { id: 'notEquals', label: 'is not', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'notContains', label: 'does not contain', needsValue: true },
  { id: 'empty', label: 'is empty', needsValue: false },
  { id: 'notEmpty', label: 'is not empty', needsValue: false },
];

export interface ScnFilterRule {
  id: string;
  field: string;
  op: ScnOp;
  value: string;
}

export interface ScnColorRule extends ScnFilterRule {
  color: string | null;
}

export interface ScnColumnPreset {
  name: string;
  columns: string[];
}

export interface ScnTableConfig {
  /** Shown column ids in order; null = every column (the default). */
  columns: string[] | null;
  filters: ScnFilterRule[];
  /** How the filters combine, by their numbers ("(1 and 2) or 3"); empty: all / any of them, as `filterMatch` says. */
  filterLogic?: string;
  filterMatch?: 'all' | 'any';
  groups: GroupRule[];
  /** What the groups are ordered by: their name (the default) or their highest Step. The group rule's direction applies. */
  groupOrder?: 'name' | 'maxStep';
  sorts: SortRule[];
  colors: ScnColorRule[];
  presets: ScnColumnPreset[];
}

export const DEFAULT_SCN_TABLE: ScnTableConfig = { columns: null, filters: [], groups: [], sorts: [], colors: [], presets: [] };

/** Computed columns, ahead of the SequenceOrder sheet's own. */
export const STEP_COL = '#step';
export const BASE_COL = '#base';
export const SHIFT_COL = '#shift';
/** Dates of the pour in the generated programme (earliest start, latest finish of its activities), by week / month. */
export const START_WEEK_COL = '#startWeek';
export const START_MONTH_COL = '#startMonth';
export const FINISH_WEEK_COL = '#finishWeek';
export const FINISH_MONTH_COL = '#finishMonth';
export const COMPUTED_COLUMNS = [
  { id: STEP_COL, label: 'Step' },
  { id: BASE_COL, label: 'Base' },
  { id: SHIFT_COL, label: 'Shift' },
  { id: START_WEEK_COL, label: 'Start Week' },
  { id: START_MONTH_COL, label: 'Start Month' },
  { id: FINISH_WEEK_COL, label: 'Finish Week' },
  { id: FINISH_MONTH_COL, label: 'Finish Month' },
];

export function matches(value: string, op: ScnOp, target: string): boolean {
  const v = value.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  switch (op) {
    case 'equals':
      return v === t;
    case 'notEquals':
      return v !== t;
    case 'contains':
      return v.includes(t);
    case 'notContains':
      return !v.includes(t);
    case 'empty':
      return v === '';
    case 'notEmpty':
      return v !== '';
  }
}

const compare = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

export type ViewItem<T> =
  | { kind: 'row'; item: T; depth: number }
  | { kind: 'group'; key: string; label: string; field: string; depth: number; count: number; collapsed: boolean; items: T[] };

/** Filters (all rules must hold), sorts and groups `items`. With no sort or
    group rules the items keep their order — the pour order. */
export function applyView<T>(items: T[], cfg: ScnTableConfig, valueOf: (item: T, field: string) => string, collapsed: Set<string>): ViewItem<T>[] {
  const keep = combineTests(
    cfg.filters.map((f) => (f.field && (!SCN_OPS.find((o) => o.id === f.op)?.needsValue || f.value !== '') ? (it: T) => matches(valueOf(it, f.field), f.op, f.value) : null)),
    cfg.filterMatch ?? 'all',
    cfg.filterLogic ?? '',
  );
  let list = keep ? items.filter(keep) : items;
  if (cfg.sorts.length) {
    list = [...list].sort((a, b) => {
      for (const s of cfg.sorts) {
        const c = compare(valueOf(a, s.field), valueOf(b, s.field));
        if (c) return s.direction === 'up' ? c : -c;
      }
      return 0;
    });
  }
  const out: ViewItem<T>[] = [];
  const walk = (group: T[], level: number, prefix: string) => {
    const rule = cfg.groups[level];
    if (!rule) {
      for (const item of group) out.push({ kind: 'row', item, depth: level });
      return;
    }
    const buckets = new Map<string, T[]>();
    for (const it of group) {
      const v = valueOf(it, rule.field);
      (buckets.get(v) ?? buckets.set(v, []).get(v)!).push(it);
    }
    const byStep = cfg.groupOrder === 'maxStep';
    const maxStep = (k: string) => buckets.get(k)!.reduce((m, it) => Math.max(m, Number(valueOf(it, STEP_COL)) || 0), 0);
    const keys = [...buckets.keys()].sort((a, b) => {
      const c = byStep ? maxStep(a) - maxStep(b) || compare(a, b) : compare(a, b);
      return rule.direction === 'up' ? c : -c;
    });
    for (const k of keys) {
      const key = `${prefix}/${rule.field}=${k}`;
      const isCollapsed = collapsed.has(key);
      out.push({ kind: 'group', key, label: k || '(blank)', field: rule.field, depth: level, count: buckets.get(k)!.length, collapsed: isCollapsed, items: buckets.get(k)! });
      if (!isCollapsed) walk(buckets.get(k)!, level + 1, key);
    }
  };
  walk(list, 0, '');
  return out;
}

/** First matching colour rule (top to bottom) wins. */
export function rowColor<T>(item: T, rules: ScnColorRule[], valueOf: (item: T, field: string) => string): string | null {
  for (const r of rules) {
    if (!r.color || !r.field) continue;
    const needs = SCN_OPS.find((o) => o.id === r.op)?.needsValue;
    if (needs && r.value === '') continue;
    if (matches(valueOf(item, r.field), r.op, r.value)) return r.color;
  }
  return null;
}
