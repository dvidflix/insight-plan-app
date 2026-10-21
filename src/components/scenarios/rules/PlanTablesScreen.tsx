import { useState } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { RecipeWorkbookButtons } from './RecipeWorkbookButtons';
import { STEPS_ID, previewDays, formulaProblem } from '../../../prs/recipesWorkbook';
import type { LimitRow, ParameterRow, RelType, RuleSequence, SequenceStep } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';

/** The tables that drive the recipes, as plain tables (spreadsheet-first): Parameters (the named rates, curing days and set counts the duration
    formulas read), Limits (how many activities of a kind run at once: formwork sets, a specialist crew) and Steps (the search sets in the order they
    are built, with the link into each). All of it can be downloaded as one Excel workbook, edited there and uploaded again. */

export type PlanTab = 'parameters' | 'limits' | 'steps';
type Tab = PlanTab;
const TABS: { id: Tab; label: string }[] = [{ id: 'parameters', label: 'Parameters' }, { id: 'limits', label: 'Limits' }, { id: 'steps', label: 'Steps' }];
const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? 0 : Number(v.replace(',', '.')));

const stepsOf = (sequences: RuleSequence[]) => sequences.find((s) => s.id.toUpperCase() === STEPS_ID)?.steps ?? [];

/** The tables as a panel of their own (the Generate view): `only` limits it to some tabs (one tab: no tab bar); `book` shows the workbook buttons. */
export function PlanTablesPanel({ only, onClose, book = true }: { only?: Tab[]; onClose?: () => void; book?: boolean }) {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const recipes = useRecipeStore((s) => s.recipes);
  const shownTabs = TABS.filter((t) => !only || only.includes(t.id));
  const [tab, setTab] = useState<Tab>(shownTabs[0].id);
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const { parameters, limits, sequences } = ctx.rules;
  const setParameters = (next: ParameterRow[]) => ctx.change((r) => ({ ...r, parameters: next }));
  const setLimits = (next: LimitRow[]) => ctx.change((r) => ({ ...r, limits: next }));
  const setSteps = (steps: SequenceStep[]) => ctx.change((r) => {
    const others = r.sequences.filter((s) => s.id.toUpperCase() !== STEPS_ID);
    return { ...r, sequences: steps.length ? [{ id: STEPS_ID, name: 'Steps', steps }, ...others] : others };
  });
  const steps = stepsOf(sequences);

  const names = parameters.map((p) => p.name);
  // The Parameters table is typed in like a spreadsheet: click a cell, arrows and Tab move, Ctrl+D / the corner square fill down, copy and paste ranges.
  const pRows = parameters.map((p, i) => ({ p, i }));
  const pGrid = useEditableGrid({ widthsKey: 'plan.parameters',
    rows: pRows,
    get: (col, { p }) => (col === 'value' ? String(p.value) : col === 'name' ? p.name : col === 'unit' ? p.unit ?? '' : p.note ?? ''),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [pRows[at].i, text]));
      setParameters(parameters.map((x, j) => {
        const t = to.get(j);
        if (t === undefined) return x;
        return col === 'value' ? { ...x, value: num(t) } : col === 'name' ? { ...x, name: t.trim(), id: t.trim() } : col === 'unit' ? { ...x, unit: t || undefined } : { ...x, note: t || undefined };
      }));
    },
  });
  // The Limits table is typed in the same way.
  const limitMax = (t: string): number | string => (t.trim() !== '' && Number.isFinite(Number(t)) ? Number(t) : t);
  const lRows = limits.map((l, i) => ({ l, i }));
  const lGrid = useEditableGrid({ widthsKey: 'plan.limits',
    rows: lRows,
    get: (col, { l }) => (col === 'phase' ? l.phase : col === 'group' ? l.group ?? '' : col === 'max' ? String(l.max) : l.note ?? ''),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [lRows[at].i, text]));
      setLimits(limits.map((x, j) => {
        const t = to.get(j);
        if (t === undefined) return x;
        return col === 'phase' ? { ...x, phase: t } : col === 'group' ? { ...x, group: t || undefined } : col === 'max' ? { ...x, max: limitMax(t) } : { ...x, note: t || undefined };
      }));
    },
  });
  const problemOf = (l: LimitRow) => (typeof l.max === 'string' && l.max.trim() !== '' && !names.some((n) => n.toLowerCase() === l.max.toString().trim().toLowerCase()) ? `“${l.max}” is not a parameter` : '');
  // A sample pour for the preview: 150 m³ of concrete and 3.5 t of rebar.
  const sample = { Concrete_m3: 150, Rebar_t: 3.5, Rebar_kg: 3500, Footprint_m2: 200, Sides_m2: 120 };
  const withFormula = recipes.filter((r) => r.chain !== false).flatMap((r) => r.tasks.filter((t) => t.formula).map((t) => ({ r, t })));

  return (
    <div className="gen-panel">
      <div className="rg-full__bar gen-bar">
        {onClose && <strong>Parameters, limits and steps</strong>}
        {book && <RecipeWorkbookButtons onNote={setNote} />}
        {onClose && <button type="button" className="btn btn--small primary" onClick={onClose}>Close (Esc)</button>}
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {shownTabs.length > 1 && (
        <div className="scn-rules__tabs" role="tablist">
          {shownTabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
      )}
      <div className="rg-full__body gen-body">
        {!scenarioOpen ? <div className="scn-dim scn-editor__help">Open a scenario (Scenarios panel) to edit its parameters, limits and steps: they are part of the scenario. You can still download the workbook, and upload one for the recipes and resources.</div>
          : tab === 'parameters' ? (
            <div>
              <div className="rel-bar">
                <button type="button" className="btn btn--small primary" onClick={() => setParameters([...parameters, { id: `Parameter_${parameters.length + 1}`, name: `Parameter_${parameters.length + 1}`, value: 0 }])}>+ Parameter</button>
                <span className="scn-dim">A named value the duration formulas read, e.g. <code>Rebar_Rate</code> = 500 (kg per day). Write the name in a recipe task’s Duration formula: <code>Rebar_kg / Rebar_Rate</code>. Change a value and Update 4D.</span>
              </div>
              {parameters.length === 0 ? <div className="scn-dim scn-editor__help">None yet. Typical: Rebar_Rate, Concrete_Rate, Curing_Days, Formwork_Sets_Available.</div> : (
                <table className="xl xgrid" {...pGrid.grid}>
                  <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 260 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 32 }} /></colgroup>
                  <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this parameter" /><th>Name</th><th>Value</th><th>Unit</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
                  <tbody>
                    {pRows.map(({ p, i }, at) => {
                      const set = (patch: Partial<ParameterRow>) => setParameters(parameters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      const bad = !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(p.name) ? 'Letters, digits and _, starting with a letter' : '';
                      return (
                        <tr key={i} data-line={at} className={p.enabled === false ? 'is-off' : ''}>
                          <th className="xl__row" scope="row">{at + 1}</th>
                          <td className="xl__check"><input type="checkbox" checked={p.enabled !== false} onChange={(e) => set({ enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                          <td className={`xl__cell xgrid__cell${pGrid.sel('name', at)}${bad ? ' is-bad' : ''}`} data-col="name" data-row={at}><input {...pGrid.cell('name', at)} value={p.name} spellCheck={false} title={bad} aria-invalid={!!bad} onChange={(e) => set({ name: e.target.value, id: e.target.value })} />{pGrid.handle('name', at)}</td>
                          <td className={`xl__cell xl__num xgrid__cell${pGrid.sel('value', at)}`} data-col="value" data-row={at}><input {...pGrid.cell('value', at)} type="text" inputMode="decimal" value={p.value} onChange={(e) => set({ value: num(e.target.value) })} />{pGrid.handle('value', at)}</td>
                          <td className={`xl__cell xgrid__cell${pGrid.sel('unit', at)}`} data-col="unit" data-row={at}><input {...pGrid.cell('unit', at)} value={p.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} />{pGrid.handle('unit', at)}</td>
                          <td className={`xl__cell xgrid__cell${pGrid.sel('note', at)}`} data-col="note" data-row={at}><input {...pGrid.cell('note', at)} value={p.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />{pGrid.handle('note', at)}</td>
                          <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => setParameters(parameters.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
                        </tr>
                      );
                    })}
                    <tr className="xl__add"><th className="xl__row">*</th><td colSpan={6}><button type="button" onClick={() => setParameters([...parameters, { id: `Parameter_${parameters.length + 1}`, name: `Parameter_${parameters.length + 1}`, value: 0 }])}>+ Add a parameter</button></td></tr>
                  </tbody>
                </table>
              )}
              {withFormula.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="scn-dim">Durations the formulas give for a sample pour (150 m³ of concrete, 3.5 t of rebar):</div>
                  <table className="rel-table">
                    <thead><tr><th>Recipe</th><th>Activity</th><th>Formula</th><th>Days</th></tr></thead>
                    <tbody>
                      {withFormula.map(({ r, t }) => {
                        const res = previewDays(t.formula!, parameters, sample);
                        const problem = formulaProblem(t.formula!, names);
                        return <tr key={`${r.id}|${t.phase}`}><td>{r.id}</td><td>{t.phase}</td><td><code>{t.formula}</code></td><td>{'days' in res ? Math.round(res.days * 100) / 100 : <span className="scn-dim" title={res.error}>{problem || res.error}</span>}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : tab === 'limits' ? (
            <div>
              <div className="rel-bar">
                <button type="button" className="btn btn--small primary" onClick={() => setLimits([...limits, { id: `Formwork-${limits.length + 1}`, phase: 'Formwork', max: 1 }])}>+ Limit</button>
                <span className="scn-dim">At most this many activities of the kind run at once (formwork sets, a specialist crew, a crane team). The programme is linked in lanes, in the order of the Steps. “Maximize resource availability” lifts every limit.</span>
              </div>
              {limits.length === 0 ? <div className="scn-dim scn-editor__help">None yet: add Formwork with the number of sets you have (or the parameter Formwork_Sets_Available).</div> : (
                <table className="xl xgrid" {...lGrid.grid}>
                  <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 200 }} /><col style={{ width: 200 }} /><col style={{ width: 240 }} /><col /><col style={{ width: 32 }} /></colgroup>
                  <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this limit" /><th>Activity</th><th>Logical group</th><th>Max at once</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
                  <tbody>
                    {lRows.map(({ l, i }, at) => {
                      const set = (patch: Partial<LimitRow>) => setLimits(limits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      const problem = problemOf(l);
                      return (
                        <tr key={i} data-line={at} className={l.enabled === false ? 'is-off' : ''}>
                          <th className="xl__row" scope="row">{at + 1}</th>
                          <td className="xl__check"><input type="checkbox" checked={l.enabled !== false} onChange={(e) => set({ enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                          <td className={`xl__cell xgrid__cell${lGrid.sel('phase', at)}`} data-col="phase" data-row={at}><input {...lGrid.cell('phase', at)} list="recipe-phases" value={l.phase} onChange={(e) => set({ phase: e.target.value })} />{lGrid.handle('phase', at)}</td>
                          <td className={`xl__cell xgrid__cell${lGrid.sel('group', at)}`} data-col="group" data-row={at}><input {...lGrid.cell('group', at)} list="recipe-groups" value={l.group ?? ''} placeholder="every pour" onChange={(e) => set({ group: e.target.value || undefined })} />{lGrid.handle('group', at)}</td>
                          <td className={`xl__cell xgrid__cell${lGrid.sel('max', at)}${problem ? ' is-bad' : ''}`} data-col="max" data-row={at}><input {...lGrid.cell('max', at)} list="plan-parameters" value={l.max} placeholder="4 or Formwork_Sets_Available" aria-invalid={!!problem} title={problem} onChange={(e) => set({ max: limitMax(e.target.value) })} />{lGrid.handle('max', at)}</td>
                          <td className={`xl__cell xgrid__cell${lGrid.sel('note', at)}`} data-col="note" data-row={at}><input {...lGrid.cell('note', at)} value={l.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />{lGrid.handle('note', at)}</td>
                          <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => setLimits(limits.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
                        </tr>
                      );
                    })}
                    <tr className="xl__add"><th className="xl__row">*</th><td colSpan={6}><button type="button" onClick={() => setLimits([...limits, { id: `Formwork-${limits.length + 1}`, phase: 'Formwork', max: 1 }])}>+ Add a limit</button></td></tr>
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div>
              <div className="rel-bar">
                <button type="button" className="btn btn--small primary" onClick={() => setSteps([...steps, { group: '' }])}>+ Step</button>
                <span className="scn-dim">The search sets in the order they are built. Each step starts when the one before it is done (finish to start) unless its link says otherwise. Per level repeats the step for every level in turn.</span>
              </div>
              {steps.length === 0 ? <div className="scn-dim scn-editor__help">No steps: the pours follow the order of the scenario. Add a step for each search set (Raft, Double height walls, L01 internal walls ...).</div> : (
                <table className="rel-table">
                  <thead><tr><th>#</th><th>Search set / group</th><th>Per level</th><th>Link into it</th><th>Lag (h)</th><th>Notes</th><th aria-label="Move" /><th aria-label="Delete" /></tr></thead>
                  <tbody>
                    {steps.map((s, i) => {
                      const set = (patch: Partial<SequenceStep>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      const move = (by: number) => { const to = i + by; if (to < 0 || to >= steps.length) return; const next = [...steps]; [next[i], next[to]] = [next[to], next[i]]; setSteps(next); };
                      const unknown = s.group.trim() !== '' && ctx.groupIds.length > 0 && !ctx.groupIds.some((g) => g.toUpperCase() === s.group.trim().toUpperCase());
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><input className="rel-cell" style={{ width: 280 }} list="recipe-groups" value={s.group} aria-invalid={unknown} title={unknown ? 'No search set or group has this name' : ''} onChange={(e) => set({ group: e.target.value })} /></td>
                          <td><input type="checkbox" checked={!!s.perLevel} onChange={(e) => set({ perLevel: e.target.checked || undefined })} aria-label="Per level" /></td>
                          <td>
                            <select className="rel-cell" value={s.type ?? 'FS'} disabled={i === 0} onChange={(e) => set({ type: e.target.value === 'FS' ? undefined : (e.target.value as RelType) })}>
                              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td><input className="rel-cell" type="number" step="any" style={{ width: 70 }} disabled={i === 0} value={s.lagHours ?? ''} onChange={(e) => set({ lagHours: e.target.value === '' ? undefined : num(e.target.value) })} /></td>
                          <td><input className="rel-cell" style={{ width: 220 }} value={s.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} /></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button type="button" className="cols__icon" onClick={() => move(-1)} disabled={i === 0} aria-label="Move up" title="Earlier">↑</button>
                            <button type="button" className="cols__icon" onClick={() => move(1)} disabled={i === steps.length - 1} aria-label="Move down" title="Later">↓</button>
                          </td>
                          <td><button type="button" className="cols__icon cols__icon--remove" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
      </div>
      <datalist id="plan-parameters">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}
