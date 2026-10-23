import { useState } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { setPools, useRecipeStore } from '../../../state/recipeStore';
import { useResourceFocus } from '../../../state/resourceFocusStore';
import { freshId, POOL_KINDS, type ParameterRow, type PoolKind, type PoolRow } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useEditableGrid } from '../../useEditableGrid';
import { useGenerateTab } from '../GenerateTabs';
import { RecipeWorkbookButtons } from './RecipeWorkbookButtons';
import { openRecipe } from './StepRecipes';
import { useRuleContext } from './RuleParts';
import { BareGrid, RatesTableCard } from './RelationalTables';

/** Parameters and resources as one spreadsheet. Both are "a name and a number the recipes read": a parameter is a value a duration formula reads
    (Rebar_Rate = 500), a resource is equipment, a crane or a material and how many there are. The Kind column says which; the rows are the scenario's
    parameters and the recipe store's resource pools exactly as before (nothing new is saved), so the workbook's Parameters and Resources sheets are
    unchanged. Changing a row's Kind moves it from one list to the other. */

type Kind = 'value' | PoolKind;
type Line = { t: 'param'; i: number; p: ParameterRow } | { t: 'pool'; i: number; p: PoolRow };
const KEY: Record<PoolKind, 'equipment' | 'cranes' | 'materials'> = { equipment: 'equipment', crane: 'cranes', material: 'materials' };
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? 0 : Number(v.replace(',', '.')));

export function ParametersResourcesPanel() {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const pools = useRecipeStore((s) => s.pools);
  const recipes = useRecipeStore((s) => s.recipes);
  const focused = useResourceFocus((s) => s.id);
  const setTab = useGenerateTab((s) => s.setTab);
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const { parameters, limits } = ctx.rules;
  const setParameters = (next: ParameterRow[]) => ctx.change((r) => ({ ...r, parameters: next }));
  const active = recipes.filter((r) => r.chain !== false && r.enabled !== false);

  const lines: Line[] = [...parameters.map((p, i): Line => ({ t: 'param', i, p })), ...pools.map((p, i): Line => ({ t: 'pool', i, p }))];
  const kindOf = (l: Line): Kind => (l.t === 'param' ? 'value' : l.p.kind);

  /** Where a parameter is read (formulas, limits) and where a resource is used (activities, limits that take its quantity). */
  const usedByParam = (name: string) => {
    const key = name.trim().toLowerCase();
    const formulas = key ? active.flatMap((r) => r.tasks.filter((t) => t.formula && t.formula.toLowerCase().split(/[^a-z0-9_.]+/).includes(key))) : [];
    const lims = key ? limits.filter((l) => l.enabled !== false && typeof l.max === 'string' && l.max.trim().toLowerCase() === key) : [];
    return { formulas: formulas.length, lims: lims.length };
  };
  const usageOfPool = (p: PoolRow) => {
    const from = active.flatMap((r) => r.tasks.filter((t) => (t[KEY[p.kind]] ?? []).some((u) => same(u.type, p.id))).map((t) => ({ label: t.name || t.phase, phase: t.phase, group: r.group })));
    const lims = limits.filter((l) => l.enabled !== false && typeof l.max === 'string' && (same(l.max, p.id) || (p.name.trim() !== '' && same(l.max, p.name))));
    return { from, lims };
  };

  const setPool = (i: number, patch: Partial<PoolRow>) => setPools(pools.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setParam = (i: number, patch: Partial<ParameterRow>) => setParameters(parameters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  /** "Max at once" of a resource: a limit naming it takes its number from the quantity (the same behaviour as before: typing sets the quantity and limits every activity that uses it). */
  const setMax = (i: number, p: PoolRow, raw: string) => {
    const n = raw.trim() === '' ? 0 : num(raw);
    const mine = (l: (typeof limits)[number]) => typeof l.max === 'string' && (same(l.max, p.id) || (p.name.trim() !== '' && same(l.max, p.name)));
    const phases = [...new Set(usageOfPool(p).from.map((f) => f.phase).filter(Boolean))];
    if (n > 0) setPool(i, { quantity: n });
    ctx.change((r) => {
      if (n <= 0) return { ...r, limits: r.limits.filter((l) => !(mine(l) && l.id === `${p.id}-${l.phase}` && !l.group && !l.note)) };
      if (r.limits.some(mine)) return r;
      return { ...r, limits: [...r.limits, ...phases.map((phase) => ({ id: `${p.id}-${phase}`, phase, max: p.id }))] };
    });
  };
  /** Moves a row between the two lists when its Kind changes. */
  const setKind = (l: Line, kind: Kind) => {
    if (kindOf(l) === kind) return;
    if (l.t === 'pool' && kind !== 'value') return setPool(l.i, { kind });
    if (l.t === 'pool') {
      setPools(pools.filter((_, j) => j !== l.i));
      return setParameters([...parameters, { id: l.p.id, name: l.p.id, value: l.p.quantity, ...(l.p.note ? { note: l.p.note } : {}) }]);
    }
    if (kind === 'value') return;
    setParameters(parameters.filter((_, j) => j !== l.i));
    setPools([...pools, { id: freshId(l.p.name || kind.slice(0, 3).toUpperCase(), pools.map((p) => p.id)), kind, name: '', quantity: l.p.value, ...(l.p.note ? { note: l.p.note } : {}) }]);
  };
  const addParam = () => setParameters([...parameters, { id: `Parameter_${parameters.length + 1}`, name: `Parameter_${parameters.length + 1}`, value: 0 }]);
  const addPool = () => setPools([...pools, { id: freshId('RES', pools.map((p) => p.id)), kind: 'equipment', name: '', quantity: 1 }]);
  const remove = (l: Line) => (l.t === 'param' ? setParameters(parameters.filter((_, j) => j !== l.i)) : setPools(pools.filter((_, j) => j !== l.i)));

  const grid = useEditableGrid({ widthsKey: 'plan.parametersResources',
    rows: lines,
    get: (col, l) => (col === 'name' ? (l.t === 'param' ? l.p.name : l.p.id) : col === 'desc' ? (l.t === 'pool' ? l.p.name : '') : col === 'value' ? String(l.t === 'param' ? l.p.value : l.p.quantity) : col === 'unit' ? (l.t === 'param' ? l.p.unit ?? '' : '') : l.p.note ?? ''),
    write: (col, cells) => {
      let nextParams = parameters;
      let nextPools = pools;
      for (const [at, text] of cells) {
        const l = lines[at];
        if (l.t === 'param') {
          const patch: Partial<ParameterRow> | null = col === 'name' ? { name: text.trim(), id: text.trim() } : col === 'value' ? { value: num(text) } : col === 'unit' ? { unit: text || undefined } : col === 'note' ? { note: text || undefined } : null;
          if (patch) nextParams = nextParams.map((x, j) => (j === l.i ? { ...x, ...patch } : x));
        } else {
          const patch: Partial<PoolRow> | null = col === 'name' ? { id: text.trim() } : col === 'desc' ? { name: text } : col === 'value' ? { quantity: num(text) } : col === 'note' ? { note: text || undefined } : null;
          if (patch) nextPools = nextPools.map((x, j) => (j === l.i ? { ...x, ...patch } : x));
        }
      }
      if (nextParams !== parameters) setParameters(nextParams);
      if (nextPools !== pools) setPools(nextPools);
    },
  });

  return (
    <div>
      <div className="rg-full__bar gen-bar"><h3 className="gen-sec">Parameters and resources</h3><RecipeWorkbookButtons onNote={setNote} /></div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.lines.map((m, i) => <div key={i}>{m}</div>)}</div>}
      {!scenarioOpen ? <div className="scn-dim scn-editor__help">Open a scenario to edit its parameters and resources: they are part of the scenario.</div> : (
        <>
          <div className="rel-bar">
            <button type="button" className="btn btn--small primary" onClick={addParam} title="A named value that duration formulas read: write its name in a recipe activity’s formula">+ Value</button>
            <button type="button" className="btn btn--small" onClick={addPool} title="Equipment, a crane or a material: how many there are, and so how many can be in use at once">+ Resource</button>
            <div className="scn-dim seq__explain">
              <p>Names and numbers the recipes use.</p>
              <p>A <b>value</b> is read by duration formulas (Rebar_Rate = 500).</p>
              <p>A <b>resource</b> is how many of a piece of equipment, a crane or a material there are.</p>
            </div>
          </div>
          {lines.length === 0 ? <div className="scn-dim scn-editor__help">None yet.</div> : (
            <table className="xl xgrid" {...grid.grid}>
              <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 110 }} /><col style={{ width: 200 }} /><col style={{ width: 220 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 260 }} /><col style={{ width: 130 }} /><col style={{ width: 220 }} /><col style={{ width: 32 }} /></colgroup>
              <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this one" /><th title="A value a formula reads, or equipment, a crane or a material">Kind</th><th title="The name formulas write, or the ID a recipe activity gives for a resource">Name / ID</th><th title="What a resource is (a value needs none)">Description</th><th title="The value, or how many of the resource there are">Value / quantity</th><th>Unit</th><th title="The formulas and limits that read a value, or the recipe activities that use a resource: click one to open its recipe">Used in</th><th title="How many activities that use a resource can run at the same time (the limits that take their number from it)">Max at once</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
              <tbody>
                {lines.map((l, at) => {
                  const kind = kindOf(l);
                  const off = l.p.enabled === false;
                  const bad = l.t === 'param' && !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(l.p.name) ? 'Letters, digits and _, starting with a letter' : '';
                  const setOn = (e: boolean) => (l.t === 'param' ? setParam(l.i, { enabled: e ? undefined : false }) : setPool(l.i, { enabled: e ? undefined : false }));
                  const cell = (col: string, value: string, onChange: (v: string) => void, props: { num?: boolean; disabled?: boolean; title?: string; bad?: boolean } = {}) => (
                    <td className={`xl__cell${props.num ? ' xl__num' : ''} xgrid__cell${grid.sel(col, at)}${props.bad ? ' is-bad' : ''}`} data-col={col} data-row={at}>
                      <input {...grid.cell(col, at)} {...(props.num ? { type: 'text', inputMode: 'decimal' as const } : {})} value={value} spellCheck={false} disabled={props.disabled} title={props.title} aria-invalid={!!props.bad} onChange={(e) => onChange(e.target.value)} />{grid.handle(col, at)}
                    </td>
                  );
                  const pu = l.t === 'pool' ? usageOfPool(l.p) : null;
                  const vu = l.t === 'param' ? usedByParam(l.p.name) : null;
                  return (
                    <tr key={`${l.t}${l.i}`} data-line={at} className={`${off ? 'is-off' : ''}${l.t === 'pool' && focused && same(focused, l.p.id) ? ' is-focus is-selected' : ''}`}>
                      <th className="xl__row" scope="row">{at + 1}</th>
                      <td className="xl__check"><input type="checkbox" checked={!off} onChange={(e) => setOn(e.target.checked)} aria-label="On" /></td>
                      <td className="xl__cell"><select value={kind} aria-label="Kind" onChange={(e) => setKind(l, e.target.value as Kind)}><option value="value">Value</option>{POOL_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></td>
                      {l.t === 'param'
                        ? cell('name', l.p.name, (v) => setParam(l.i, { name: v, id: v }), { title: bad, bad: !!bad })
                        : cell('name', l.p.id, (v) => setPool(l.i, { id: v }))}
                      {l.t === 'pool' ? cell('desc', l.p.name, (v) => setPool(l.i, { name: v })) : <td className="xl__cell xl__ro" />}
                      {l.t === 'param' ? cell('value', String(l.p.value), (v) => setParam(l.i, { value: num(v) }), { num: true }) : cell('value', String(l.p.quantity), (v) => setPool(l.i, { quantity: num(v) }), { num: true })}
                      {l.t === 'param' ? cell('unit', l.p.unit ?? '', (v) => setParam(l.i, { unit: v || undefined })) : <td className="xl__cell xl__ro" />}
                      <td className="xl__cell xl__ro" title={pu ? pu.from.map((f) => f.label).join(String.fromCharCode(10)) || 'No recipe activity uses it yet: open an activity on the Recipes tab and give it this resource' : vu && (vu.formulas || vu.lims) ? `${vu.formulas} formula(s), ${vu.lims} limit(s)` : 'Nothing reads it yet'}>
                        {pu ? (pu.from.length === 0 ? <span className="scn-dim">no activity yet</span> : <>
                          {pu.from.slice(0, 3).map((f, k) => <span key={`${f.group}|${f.label}|${k}`}>{k > 0 && ', '}<button type="button" className="link-btn" title={`Open the recipe of ${f.group || 'every object'}`} onClick={() => openRecipe(f.group, setTab)}>{f.label}</button></span>)}
                          {pu.from.length > 3 && <span className="scn-dim"> +{pu.from.length - 3} more</span>}
                        </>) : <span className="scn-dim">{[vu!.formulas ? `${vu!.formulas} formula${vu!.formulas === 1 ? '' : 's'}` : '', vu!.lims ? `${vu!.lims} limit${vu!.lims === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'not used yet'}</span>}
                      </td>
                      {l.t === 'pool' && pu ? (
                        <td className="xl__cell xl__num"><input type="text" inputMode="decimal" value={pu.lims.length ? l.p.quantity : ''} placeholder="no limit" aria-label={`${l.p.id} max at once`}
                          title={pu.lims.length ? `Limits ${pu.lims.map((x) => x.phase).join(', ')} to ${l.p.quantity} at once. Type a number to change it (it is the quantity), empty to take the limits off` : pu.from.length ? 'Type a number to limit the activities that use it to that many at once' : 'No activity uses it yet, so there is nothing to limit'}
                          disabled={pu.from.length === 0 && pu.lims.length === 0} onChange={(e) => setMax(l.i, l.p, e.target.value)} /></td>
                      ) : <td className="xl__cell xl__ro" />}
                      {cell('note', l.p.note ?? '', (v) => (l.t === 'param' ? setParam(l.i, { note: v || undefined }) : setPool(l.i, { note: v || undefined })))}
                      <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => remove(l)} aria-label="Delete"><IconRemove /></button></td>
                    </tr>
                  );
                })}
                <tr className="xl__add"><th className="xl__row">*</th><td colSpan={10}><button type="button" onClick={addParam}>+ Add a value</button> <button type="button" onClick={addPool}>+ Add a resource</button></td></tr>
              </tbody>
            </table>
          )}
          <div className="scn-dim xl__note">Resources are limited by what you set here: the most that can be in use at once. “Maximize resource availability” (Rules › settings) lifts every limit.</div>
          <h3 className="gen-sec">Rates</h3>
          <BareGrid.Provider value><RatesTableCard ctx={ctx} /></BareGrid.Provider>
        </>
      )}
    </div>
  );
}
