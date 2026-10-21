import { useMemo, useState } from 'react';
import type { Recipe, RecipeTask } from '../../../prs/recipes';
import type { ScenarioRules } from '../../../prs/rules';
import { useEditableGrid } from '../../useEditableGrid';
import { useScheduleStore } from '../../../state/scheduleStore';
import { suffixOf, templateFor } from '../../../prs/recipeMatch';
import { hoursPerDayOf } from '../../../schedule/hoursPerDay';

/** The Recipes as one table, like a spreadsheet: a row for each recipe (one per set), a column for each task, and one setting at a time in the
    cells (days, rate, rebar rate, crew or calendar). Typing, pasting from Excel and filling down change many recipes at once; "Copy tasks from" gives
    a recipe the tasks of another (a slab's, a wall's), so one worked-out recipe serves every set of its kind. Durations that come from quantities
    are a Rate (output per crew per day) on the task: the cell holds the rate's name. */

type Field = 'days' | 'formula' | 'rate' | 'density' | 'crew' | 'calendar';

const FIELDS: { id: Field; label: string; hint: string; numeric?: boolean; list?: 'recipe-rates' | 'recipe-crews' | 'recipe-calendars' }[] = [
  { id: 'days', label: 'Days', hint: 'A fixed number of days', numeric: true },
  { id: 'formula', label: 'Formula', hint: 'A duration formula in working days from the pour’s quantities and the scenario’s parameters, such as max(1, Concrete_m3 / Concrete_Rate); it beats a rate' },
  { id: 'rate', label: 'Rate', hint: 'A named Rate: days from the quantity (concrete m³, rebar tonnes …) divided by the output per crew per day', list: 'recipe-rates' },
  { id: 'density', label: 'Rebar rate', hint: 'A rebar rate: tonnes of rebar per m³ of concrete, for the Rebar task', list: 'recipe-rates' },
  { id: 'crew', label: 'Crew', hint: 'The crew template doing the task', list: 'recipe-crews' },
  { id: 'calendar', label: 'Calendar', hint: 'The working calendar of the task', list: 'recipe-calendars' },
];

const AUTO = '__best_match__';
const key = (s: string) => s.trim().toUpperCase();
const numOf = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

export function RecipeGrid({ recipes, rules, onChange, objects }: { recipes: Recipe[]; rules: ScenarioRules; onChange: (next: Recipe[]) => void; /** Objects in the loaded models for each set (by set name, upper case). */ objects?: Map<string, number> }) {
  const [field, setField] = useState<Field>('days');
  const f = FIELDS.find((x) => x.id === field)!;

  // The recipes that make activities, with their place in the whole list.
  const rows = useMemo(() => recipes.map((r, i) => ({ r, i })).filter(({ r }) => r.chain !== false), [recipes]);
  // The tasks as columns: every phase any recipe has, in the order they are met; the first task of each stands in for a task added from the grid.
  const phases = useMemo(() => {
    const out: { phase: string; proto: RecipeTask }[] = [];
    for (const { r } of rows) for (const t of r.tasks) if (t.phase.trim() && !out.some((p) => key(p.phase) === key(t.phase))) out.push({ phase: t.phase, proto: t });
    return out;
  }, [rows]);

  // What the generator made of each task: the days of its activities in the programme last generated (they carry the recipe in "CWA-Recipe"),
  // so a task whose days come from a rate shows the number it came to.
  const schedules = useScheduleStore((st) => st.schedules);
  const result = useMemo(() => {
    const out = new Map<string, { n: number; sum: number; min: number; max: number }>();
    for (const m of schedules) {
      const calendars = new Map(m.calendars.map((c) => [c.id, c as { hoursPerDay: number | null }]));
      const byRecipe = new Map(recipes.map((r) => [key(r.id), r]));
      for (const a of m.activities) {
        const id = a.udf?.['CWA-Recipe'];
        if (typeof id !== 'string' || !id) continue;
        const r = byRecipe.get(key(id));
        const t = r?.tasks.find((x) => a.code.toUpperCase().endsWith(suffixOf(x).toUpperCase()));
        if (!r || !t) continue;
        const d = a.durationHours / hoursPerDayOf(a.calendarId, calendars);
        const k = `${key(r.id)}|${key(t.phase)}`;
        const cur = out.get(k);
        if (cur) { cur.n++; cur.sum += d; cur.min = Math.min(cur.min, d); cur.max = Math.max(cur.max, d); } else out.set(k, { n: 1, sum: d, min: d, max: d });
      }
    }
    return out;
  }, [schedules, recipes]);
  const resultOf = (r: Recipe, phase: string) => result.get(`${key(r.id)}|${key(phase)}`);
  const round = (n: number) => (Math.round(n * 10) / 10).toString();

  const taskOf = (r: Recipe, phase: string) => r.tasks.find((t) => key(t.phase) === key(phase));
  const read = (r: Recipe, phase: string): string => {
    const v = taskOf(r, phase)?.[field];
    return v === undefined || v === null ? '' : String(v);
  };
  /** Sets the field of a task, adding the task to the recipe when it has none for that phase and a value is given. */
  const withValue = (r: Recipe, phase: string, text: string): Recipe => {
    const value = f.numeric ? numOf(text) : text.trim() === '' ? undefined : text.trim();
    const at = r.tasks.findIndex((t) => key(t.phase) === key(phase));
    if (at >= 0) return { ...r, tasks: r.tasks.map((t, j) => (j === at ? { ...t, [field]: value } : t)) };
    if (value === undefined) return r;
    const proto = phases.find((p) => key(p.phase) === key(phase))?.proto;
    return { ...r, tasks: [...r.tasks, { phase, suffix: proto?.suffix, name: proto?.name, material: proto?.material, [field]: value }] };
  };

  const grid = useEditableGrid({ widthsKey: 'recipe.grid',
    rows,
    get: (col, { r }) => read(r, col),
    write: (col, cells) => {
      const next = [...recipes];
      for (const [at, text] of cells) {
        const row = rows[at];
        if (row) next[row.i] = withValue(next[row.i], col, text);
      }
      onChange(next);
    },
  });

  const copyTasks = (i: number, fromId: string) => {
    const from = fromId === AUTO ? templateFor(recipes[i].id, recipes.filter((_, j) => j !== i)) : recipes.find((x) => x.id === fromId);
    if (!from && fromId === AUTO) { window.alert(`No other recipe looks like “${recipes[i].id}”. Pick one by name.`); return; }
    if (!from || from === recipes[i]) return;
    const has = recipes[i].tasks.length > 0;
    if (has && !window.confirm(`Replace the tasks of “${recipes[i].id}” with a copy of those of “${from.id}”?`)) return;
    onChange(recipes.map((x, j) => (j === i ? { ...x, tasks: from.tasks.map((t) => ({ ...t })), edges: from.edges?.length ? from.edges.map((e) => ({ ...e })) : undefined } : x)));
  };

  const options = {
    'recipe-rates': rules.rates.map((x) => x.id),
    'recipe-crews': rules.crewTemplates.map((x) => x.id),
    'recipe-calendars': rules.calendars.map((x) => x.id),
  };
  const unknown = (v: string): boolean => {
    if (!v || !f.list) return false;
    const have = options[f.list];
    return have.length > 0 && !have.some((o) => key(o) === key(v));
  };

  if (!rows.length) return <div className="scn-dim scn-editor__help" style={{ margin: 8 }}>No recipes yet. Press + Recipe (All N sets makes one for every set of the folder).</div>;

  return (
    <div className="recipe-grid">
      <div className="rel-bar">
        <span className="scn-dim">Show</span>
        <span className="cols__views" role="tablist">
          {FIELDS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={field === x.id} className={field === x.id ? 'active' : ''} title={x.hint} onClick={() => setField(x.id)}>{x.label}</button>
          ))}
        </span>
        <span className="scn-dim">{f.hint}. Type, paste from Excel or drag the corner square to fill.</span>
      </div>
      <div className="rel-scroll">
        <table className="rel-table rel-table--grid xgrid" {...grid.grid}>
          <thead>
            <tr>
              <th>Recipe</th>
              {objects && <th title="Objects of the set in the loaded models">Objects</th>}
              <th title="Give the recipe the tasks of another one">Copy tasks from</th>
              {phases.map((p) => <th key={p.phase} title={p.proto.name || p.phase}>{p.phase}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, i }, at) => (
              <tr key={i} data-line={at} className={r.enabled === false ? 'is-off' : undefined}>
                <td title={r.group ? `Objects of the set “${r.group}”` : 'Every object'}><b>{r.id}</b></td>
                {objects && <td className="scn-dim" style={{ textAlign: 'right' }}>{objects.get(r.group.trim().toUpperCase())?.toLocaleString() ?? ''}</td>}
                <td>
                  <select className="rel-cell" value="" onChange={(e) => { if (e.target.value) copyTasks(i, e.target.value); }} aria-label={`Copy tasks into ${r.id}`}>
                    <option value="">—</option>
                    <option value={AUTO} title="The recipe whose name fits this one best">Best match by name</option>
                    {recipes.filter((x) => x !== r && x.chain !== false && x.tasks.length > 0).map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                  </select>
                </td>
                {phases.map((p) => {
                  const value = read(r, p.phase);
                  const has = !!taskOf(r, p.phase);
                  return (
                    <td key={p.phase} className={`xgrid__cell${grid.sel(p.phase, at)}${has ? '' : ' is-none'}`} data-col={p.phase} data-row={at} style={has ? undefined : { opacity: 0.55 }}>
                      <input
                        className="rel-cell"
                        type="text"
                        inputMode={f.numeric ? 'decimal' : undefined}
                        value={value}
                        list={f.list}
                        placeholder={has ? '' : '+'}
                        title={has ? (unknown(value) ? `“${value}” is not in this scenario's list` : undefined) : `${r.id} has no ${p.phase} task: a value adds it`}
                        spellCheck={false}
                        style={{ width: 92, ...(unknown(value) ? { color: 'var(--danger)' } : {}) }}
                        onChange={(e) => onChange(recipes.map((x, j) => (j === i ? withValue(x, p.phase, e.target.value) : x)))}
                      />
                      {(() => {
                        const res = resultOf(r, p.phase);
                        return res ? <div className="scn-dim" style={{ fontSize: 11 }} title={`${res.n} activit${res.n === 1 ? 'y' : 'ies'} in the programme last generated: ${round(res.min)} to ${round(res.max)} days`}>→ {round(res.sum / res.n)} d{res.max - res.min > 0.05 ? ` (${round(res.min)}–${round(res.max)})` : ''}</div> : null;
                      })()}
                      {grid.handle(p.phase, at)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="recipe-calendars">{rules.calendars.map((c) => <option key={c.id} value={c.id} />)}</datalist>
    </div>
  );
}
