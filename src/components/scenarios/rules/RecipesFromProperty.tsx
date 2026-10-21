import { useMemo } from 'react';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { buildSpoolSets } from '../../../viewer/spoolSets';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { usePersistedState } from '../../../utils/persistedState';
import { templateFor } from '../../../prs/recipeMatch';
import type { Recipe } from '../../../prs/recipes';
import { elementValue, NO_VALUE } from '../../../viewer/bimTables';
import { useFieldValues, useModelFields } from '../../modelFields';
import { FieldPicker } from '../../schedule/FieldRules';

/** The easy way to make recipes: pick a property of the objects (Logical Group 1, Pour Type, anything), and every value of it becomes a recipe,
    with the tasks of the recipe it looks most like (or Rebar and Concrete). Behind each recipe is a search set of the objects that have that
    value, made in the Recipes folder, so the recipe finds its objects by itself and new values are one click away. Recipes that exist are kept. */

const MAX_ROWS = 200;

/** Properties that usually name how an object is built, best first: the app picks the first that most objects have, with a handful of values. */
const LIKELY = [/logical\s*group\s*1/i, /logical\s*group/i, /pour\s*type/i, /pour/i, /recipe/i, /sequence/i, /element\s*type/i, /\btype\b/i];

export function bestProperty(engine: ReturnType<typeof useViewerEngine>, fields: { id: string; label: string }[]): string {
  const indexes = [...engine.getIndexes().values()];
  const total = indexes.reduce((n, i) => n + i.elements.size, 0);
  if (!total) return '';
  const ranked = fields.filter((f) => f.id.includes('.') && LIKELY.some((re) => re.test(f.id))).sort((a, b) => LIKELY.findIndex((re) => re.test(a.id)) - LIKELY.findIndex((re) => re.test(b.id)));
  for (const f of ranked) {
    const seen = new Set<string>();
    let have = 0;
    for (const index of indexes) for (const e of index.elements.values()) {
      const v = elementValue(e, f.id);
      if (v !== NO_VALUE && v.trim() !== '') { have++; seen.add(v); }
    }
    if (have / total >= 0.3 && seen.size >= 2 && seen.size <= 80) return f.id;
  }
  return '';
}

export function RecipesFromProperty({ recipes, folder, onMake, onClose }: {
  recipes: Recipe[];
  folder: string;
  /** Makes a recipe for each of these values (their sets exist by then). */
  onMake: (values: string[]) => void;
  onClose: () => void;
}) {
  const engine = useViewerEngine();
  const fields = useModelFields();
  const [saved, setField] = usePersistedState('recipes.fromProperty', '');
  // Nothing chosen yet: the app picks the likeliest property itself (change it below).
  const guess = useMemo(() => (saved ? '' : bestProperty(engine, fields)), [saved, engine, fields]);
  const field = saved || guess;
  const values = useFieldValues(field, true);
  const label = fields.find((f) => f.id === field)?.label ?? field;
  const key = (s: string) => s.trim().toUpperCase();

  const rows = useMemo(() => values.filter((v) => v.value.trim() !== '').map((v) => {
    const have = recipes.some((r) => key(r.group) === key(v.value));
    const template = have ? null : templateFor(v.value, recipes);
    return { ...v, have, template };
  }), [values, recipes]);
  const fresh = rows.filter((r) => !r.have);

  const make = () => {
    if (!field || !fresh.length) return;
    // The sets: one per value, in the recipes' folder, that find the objects with that value. A set of that name that is there is left as it is.
    const made = buildSpoolSets(engine.getIndexes(), { fields: [field], folder, output: 'search' });
    const named = new Set(useSearchSetsStore.getState().sets.filter((s) => s.group === folder).map((s) => key(s.name)));
    const add = made.sets.filter((s) => !named.has(key(s.name)));
    if (add.length) useSearchSetsStore.setState((st) => ({ sets: [...st.sets, ...add] }));
    onMake(fresh.map((r) => r.value));
  };

  return (
    <div className="rec-prop" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, margin: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Make recipes from a property</b>
        <span className="scn-dim" style={{ flex: 1 }}>Each value of the property becomes a recipe, with the objects that have it.</span>
        <button type="button" className="btn btn--small" onClick={onClose}>Close</button>
      </div>
      <div>
        <div className="scn-dim" style={{ marginBottom: 4 }}>{field ? <>Property: <b>{label}</b>{saved ? '' : ' (chosen for you)'}: pick another below if it is not the right one</> : 'Pick the property the recipes are named by, for example Logical Group 1 or Pour Type.'}</div>
        <div className="cols" style={{ maxHeight: 180, overflow: 'auto' }}>
          <FieldPicker catalog={fields} picked={new Set(field ? [field] : [])} placeholder="Search properties…" onPick={(f) => setField(f.id)} />
        </div>
      </div>
      {field && rows.length === 0 && <div className="scn-dim">No values: load a model that has this property.</div>}
      {rows.length > 0 && (
        <>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            <table className="rel-table rel-table--grid">
              <thead><tr><th>Value</th><th style={{ textAlign: 'right' }}>Objects</th><th>Starts with the tasks of</th></tr></thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map((r) => (
                  <tr key={r.value} style={r.have ? { opacity: 0.55 } : undefined}>
                    <td>{r.value}</td>
                    <td style={{ textAlign: 'right' }}>{r.count.toLocaleString()}</td>
                    <td className="scn-dim">{r.have ? 'has a recipe' : r.template ? r.template.id : 'Rebar + Concrete'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > MAX_ROWS && <div className="scn-dim">…and {rows.length - MAX_ROWS} more values.</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn--small primary" disabled={!fresh.length} onClick={make}>
              {fresh.length ? `Make ${fresh.length} recipe${fresh.length === 1 ? '' : 's'}` : 'Every value has a recipe'}
            </button>
            <span className="scn-dim">Then set the days, rate or crew of each in the table.</span>
          </div>
        </>
      )}
    </div>
  );
}
