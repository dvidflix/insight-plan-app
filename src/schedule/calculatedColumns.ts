import { useMemo } from 'react';
import { useColumnLabelsStore } from '../state/columnLabelsStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildColumnContext, buildColumns, type ColumnCtx, type ColumnDef } from './columns';
import { useModelsStore } from '../state/modelsStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { sharedActivityObjects } from './activityObjects';
import { buildObjectColumns } from './objectColumns';
import type { ExtraNumberField } from './filterFields';
import type { Activity, ScheduleModel } from './types';

/** Calculated columns: a formula over the table's numeric columns, for example
    [Rebar (t) (units)] / [Original Duration (h)] for tonnes per hour. Defined once,
    saved with the project (the "schedule." settings go into the project database)
    and offered as an ordinary column (group "Calculated") in the Gantt, the Activities
    table and the 4D Tasks list.

    Formula: numbers, + - * / ^, brackets, [Column name] for a column's value (any numeric
    column, spelt as in the column picker) and the functions ABS, ROUND(x, digits), CEIL(x, step) (up to the next multiple of step, 1 if left out), MIN, MAX.
    A row where a used column is empty, or a division by zero, shows nothing. */
export interface CalcColumn {
  id: string;
  name: string;
  formula: string;
  /** Text after the number in a cell, e.g. "t/h". */
  unit?: string;
  decimals?: number;
}

/** Wiki › Calculations SF-003: days of steel fixing from the rebar quantity at 75 Mh/t, 12 men, 2 shifts, 9.17 h/day.
    Added once to every browser (edit or delete it like any other calculated column). */
export const COMPUTED_DURATION: CalcColumn = { id: 'computed-duration', name: 'Computed duration (days)', formula: '[Rebar (t) (units)] * 75 / (12 * 2 * 9.17)', unit: 'days', decimals: 2 };
/** The first version used the resource's own name, which the programmes show as "Rebar (t)": a saved copy still carrying it is corrected. */
/** The same, rounded up to whole days. */
export const COMPUTED_DURATION_UP: CalcColumn = { id: 'computed-duration-up', name: 'Computed duration (days, rounded up)', formula: 'CEIL([Rebar (t) (units)] * 75 / (12 * 2 * 9.17), 1)', unit: 'days', decimals: 0 };
/** The built-in columns, with the version they came in: a browser gets the ones newer than what it has seen (so a deleted one stays deleted). */
const BUILT_INS: { version: number; column: CalcColumn }[] = [
  { version: 1, column: COMPUTED_DURATION },
  { version: 2, column: COMPUTED_DURATION_UP },
];

const OLD_COMPUTED_FORMULA = '[MCW - Reinforcement(T) (units)] * 75 / (12 * 2 * 9.17)';

interface CalcColumnsState {
  columns: CalcColumn[];
  /** The built-in columns were added (so deleting one keeps it deleted). */
  seeded?: boolean | number;
  save: (c: CalcColumn) => void;
  remove: (id: string) => void;
}

export const useCalcColumnsStore = create<CalcColumnsState>()(
  persist(
    (set) => ({
      columns: [],
      save: (c) => set((s) => ({ columns: s.columns.some((x) => x.id === c.id) ? s.columns.map((x) => (x.id === c.id ? c : x)) : [...s.columns, c] })),
      remove: (id) => set((s) => ({ columns: s.columns.filter((x) => x.id !== id) })),
    }),
    {
      name: 'schedule.calcColumns',
      merge: (saved, current) => {
        const next = { ...current, ...(saved as Partial<CalcColumnsState>) };
        const seen = next.seeded === true ? 1 : next.seeded || 0;
        for (const b of BUILT_INS) {
          if (b.version > seen && !next.columns.some((c) => c.id === b.column.id)) next.columns = [...next.columns, b.column];
        }
        next.seeded = BUILT_INS[BUILT_INS.length - 1].version;
        next.columns = next.columns.map((c) => (c.id === COMPUTED_DURATION.id && c.formula === OLD_COMPUTED_FORMULA ? { ...c, formula: COMPUTED_DURATION.formula, decimals: COMPUTED_DURATION.decimals } : c));
        return next;
      },
    },
  ),
);

// ---------------------------------------------------------------- parsing

type Node =
  | { t: 'num'; v: number }
  | { t: 'ref'; label: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'fn'; name: string; args: Node[] };

type Tok = { k: 'num' | 'ref' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; s: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if (c === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) throw new Error('A [ has no closing ].');
      out.push({ k: 'ref', s: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i));
      if (!m) throw new Error(`Cannot read the number at "${src.slice(i, i + 6)}".`);
      out.push({ k: 'num', s: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i))!;
      out.push({ k: 'id', s: m[0] });
      i += m[0].length;
    } else if ('+-*/^'.includes(c)) {
      out.push({ k: 'op', s: c });
      i++;
    } else if (c === '(') {
      out.push({ k: 'lp', s: c });
      i++;
    } else if (c === ')') {
      out.push({ k: 'rp', s: c });
      i++;
    } else if (c === ',') {
      out.push({ k: 'comma', s: c });
      i++;
    } else throw new Error(`Unexpected "${c}".`);
  }
  return out;
}

const FUNCTIONS: Record<string, { min: number; max: number }> = { ABS: { min: 1, max: 1 }, ROUND: { min: 1, max: 2 }, CEIL: { min: 1, max: 2 }, MIN: { min: 2, max: 8 }, MAX: { min: 2, max: 8 } };

function parse(src: string): Node {
  const toks = tokenize(src);
  if (toks.length === 0) throw new Error('Type a formula, for example [Rebar (t) (units)] / [Original Duration (h)].');
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expr = (): Node => {
    let a = term();
    while (peek()?.k === 'op' && (peek().s === '+' || peek().s === '-')) a = { t: 'bin', op: take().s as '+' | '-', a, b: term() };
    return a;
  };
  const term = (): Node => {
    let a = power();
    while (peek()?.k === 'op' && (peek().s === '*' || peek().s === '/')) a = { t: 'bin', op: take().s as '*' | '/', a, b: power() };
    return a;
  };
  const power = (): Node => {
    const a = unary();
    if (peek()?.k === 'op' && peek().s === '^') {
      take();
      return { t: 'bin', op: '^', a, b: power() };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek()?.k === 'op' && peek().s === '-') {
      take();
      return { t: 'neg', a: unary() };
    }
    if (peek()?.k === 'op' && peek().s === '+') {
      take();
      return unary();
    }
    return primary();
  };
  const primary = (): Node => {
    const t = take();
    if (!t) throw new Error('The formula ends too soon.');
    if (t.k === 'num') return { t: 'num', v: Number(t.s) };
    if (t.k === 'ref') return { t: 'ref', label: t.s };
    if (t.k === 'lp') {
      const e = expr();
      if (take()?.k !== 'rp') throw new Error('A ( has no closing ).');
      return e;
    }
    if (t.k === 'id') {
      const name = t.s.toUpperCase();
      const spec = FUNCTIONS[name];
      if (!spec) throw new Error(`Unknown function ${t.s}. Use ABS, ROUND, CEIL, MIN or MAX, or put a column name in [brackets].`);
      if (take()?.k !== 'lp') throw new Error(`${name} needs brackets: ${name}( … ).`);
      const args: Node[] = [];
      if (peek()?.k !== 'rp') {
        args.push(expr());
        while (peek()?.k === 'comma') {
          take();
          args.push(expr());
        }
      }
      if (take()?.k !== 'rp') throw new Error(`${name}( has no closing ).`);
      if (args.length < spec.min || args.length > spec.max) throw new Error(`${name} takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} value(s).`);
      return { t: 'fn', name, args };
    }
    throw new Error(`Unexpected "${t.s}".`);
  };
  const root = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].s}".`);
  return root;
}

// ---------------------------------------------------------------- compiling

export type Compiled = { ok: true; value: (a: Activity, ctx: ColumnCtx) => number | null; refs: string[] } | { ok: false; error: string };

/** The numeric columns a formula may use, by lower-case label. */
export function numericColumns(catalog: ColumnDef[]): Map<string, ColumnDef> {
  return new Map(catalog.filter((c) => c.value && !c.id.startsWith('calc:')).map((c) => [c.label.toLowerCase(), c]));
}

export function compileFormula(formula: string, catalog: ColumnDef[]): Compiled {
  let tree: Node;
  try {
    tree = parse(formula);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const byLabel = numericColumns(catalog);
  const refs: string[] = [];
  const missing: string[] = [];
  const walk = (n: Node) => {
    if (n.t === 'ref') {
      if (byLabel.has(n.label.toLowerCase())) refs.push(n.label);
      else missing.push(n.label);
    } else if (n.t === 'neg') walk(n.a);
    else if (n.t === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.t === 'fn') n.args.forEach(walk);
  };
  walk(tree);
  if (missing.length) return { ok: false, error: `No numeric column called [${missing[0]}]. Spell it as in the column picker (for example [Original Duration (h)]).` };
  const ev = (n: Node, a: Activity, ctx: ColumnCtx): number | null => {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'ref':
        return byLabel.get(n.label.toLowerCase())!.value!(a, ctx);
      case 'neg': {
        const v = ev(n.a, a, ctx);
        return v === null ? null : -v;
      }
      case 'bin': {
        const x = ev(n.a, a, ctx);
        const y = ev(n.b, a, ctx);
        if (x === null || y === null) return null;
        if (n.op === '+') return x + y;
        if (n.op === '-') return x - y;
        if (n.op === '*') return x * y;
        if (n.op === '/') return y === 0 ? null : x / y;
        return x ** y;
      }
      case 'fn': {
        const vals = n.args.map((x) => ev(x, a, ctx));
        if (vals.some((v) => v === null)) return null;
        const v = vals as number[];
        if (n.name === 'ABS') return Math.abs(v[0]);
        if (n.name === 'CEIL') {
          // Up to the next multiple of `step` (1 if left out); a tiny tolerance keeps 3.0000000001 from jumping to 4.
          const step = v[1] ?? 1;
          return step > 0 ? Math.ceil(v[0] / step - 1e-9) * step : null;
        }
        if (n.name === 'ROUND') return Number(v[0].toFixed(Math.max(0, Math.min(10, Math.round(v[1] ?? 0)))));
        return n.name === 'MIN' ? Math.min(...v) : Math.max(...v);
      }
    }
  };
  return {
    ok: true,
    refs,
    value: (a, ctx) => {
      const r = ev(tree, a, ctx);
      return r === null || !Number.isFinite(r) ? null : r;
    },
  };
}

// ---------------------------------------------------------------- columns

/** The calculated columns as ordinary catalog columns (group "Calculated"). */
export function calcColumnDefs(calc: CalcColumn[], base: ColumnDef[]): ColumnDef[] {
  return calc.map((c): ColumnDef => {
    const compiled = compileFormula(c.formula, base);
    const value = compiled.ok ? compiled.value : () => null;
    const decimals = c.decimals ?? 2;
    const fmt = (v: number | null) => (v === null ? '' : `${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })}${c.unit ? ` ${c.unit}` : ''}`);
    return {
      id: `calc:${c.id}`,
      label: c.name,
      group: 'Calculated',
      width: 120,
      align: 'right',
      value,
      text: (a, ctx) => fmt(value(a, ctx)),
      sort: (a, ctx) => value(a, ctx) ?? Number.NEGATIVE_INFINITY,
    };
  });
}

/** The column catalog of a programme: its own columns plus the calculated ones (rebuilt when they change). */
export function useColumnCatalog(model: ScheduleModel | null): ColumnDef[] {
  const calc = useCalcColumnsStore((s) => s.columns);
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const labels = useColumnLabelsStore((s) => s.labels);
  return useMemo(() => {
    if (!model) return [];
    // Columns from the linked 3D objects join the catalog, so calculated columns can use them too.
    const base = [...buildColumns(model), ...buildObjectColumns(sharedActivityObjects(model, loadedModels, groups), loadedModels)];
    // The user's own names for columns replace the headings (baseLabel keeps the original, to reset to).
    return [...base, ...calcColumnDefs(calc, base)].map((c) => (labels[c.id] ? { ...c, label: labels[c.id], baseLabel: c.label } : c));
  }, [model, calc, loadedModels, groups, labels]);
}

/** The calculated columns as number fields for the Filters panel (group "Calculated"). */
export function useCalcFilterFields(model: ScheduleModel | null): ExtraNumberField[] {
  const catalog = useColumnCatalog(model);
  return useMemo(() => {
    if (!model) return [];
    const ctx = buildColumnContext(model);
    return catalog.filter((c) => c.id.startsWith('calc:') && c.value).map((c) => ({ id: c.id, label: c.label, numberValue: (a: Activity) => c.value!(a, ctx) }));
  }, [model, catalog]);
}
