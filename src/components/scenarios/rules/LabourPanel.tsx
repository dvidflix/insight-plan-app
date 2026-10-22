import { useMemo } from 'react';
import { useRecipeStore, setRecipes } from '../../../state/recipeStore';
import { QUANTITY_BASES, type QuantityBasis } from '../../../prs/rules';
import { applyLabourEdit, labourRows, type LabourData, type LabourEdit } from '../../../prs/labourView';
import { useEditableGrid } from '../../useEditableGrid';
import { useRuleContext, useTrades } from './RuleParts';

/** Advanced › Labour: the numbers a planner already thinks in, in one table: how many people, how many gangs, the productivity and what it is for. It is a
    view over the scenario's trades, crews, rates and recipe tasks (prs/labourView.ts): editing a cell writes to the row it comes from, nothing new is saved. */

const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? undefined : Number(v.replace(',', '.')));

export function LabourPanel() {
  const ctx = useRuleContext();
  const trades = useTrades();
  const recipes = useRecipeStore((s) => s.recipes);
  const { rules } = ctx;
  const data: LabourData = useMemo(() => ({ trades: rules.trades, crewTemplates: rules.crewTemplates, rates: rules.rates, recipes }), [rules.trades, rules.crewTemplates, rules.rates, recipes]);
  const rows = useMemo(() => labourRows(trades, data), [trades, data]);
  const phases = useMemo(() => [...new Set(recipes.filter((r) => r.enabled !== false && r.chain !== false).flatMap((r) => r.tasks.filter((t) => t.enabled !== false).map((t) => t.phase)).filter(Boolean))], [recipes]);

  const commit = (next: LabourData) => {
    if (next.recipes !== data.recipes) setRecipes(next.recipes);
    ctx.change((r) => ({ ...r, trades: next.trades, crewTemplates: next.crewTemplates, rates: next.rates }));
  };
  const edit = (at: number, change: LabourEdit) => commit(applyLabourEdit(data, trades[at], change));

  const grid = useEditableGrid({ widthsKey: 'labour',
    rows,
    get: (col, r) => String((col === 'number' ? r.number : col === 'gangs' ? r.gangs : r.productivity) ?? ''),
    write: (col, cells) => {
      let next = data;
      for (const [at, text] of cells) {
        const n = num(text);
        next = applyLabourEdit(next, trades[at], col === 'number' ? { number: n ?? 0 } : col === 'gangs' ? { gangs: n } : { productivity: n });
      }
      commit(next);
    },
  });

  return (
    <div>
      <div className="scn-dim seq__explain"><p>Sets numbers, gangs and productivity. Values are saved to the existing trades, crews and rates.</p></div>
      {rows.length === 0 ? <div className="scn-dim scn-editor__help">No labour yet: the generator lists its trades once a scenario is open.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 220 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 130 }} /><col style={{ width: 170 }} /><col style={{ width: 200 }} /></colgroup>
          <thead><tr>
            <th className="xl__corner" aria-label="Row" />
            <th title="The trade">Labour</th>
            <th title="People on site (the trade's capacity)">Number</th>
            <th title="How many crews there are of the crew that does this labour's work">Gangs</th>
            <th title="Man-hours per unit of the quantity">Productivity</th>
            <th title="What the productivity is measured per">Unit</th>
            <th title="The recipe activity the productivity is for: the rate and the crew are put on the activities of that name">Used for</th>
          </tr></thead>
          <tbody>
            {rows.map((r, at) => {
              const linked = r.usedFor !== '';
              const why = linked ? undefined : 'Choose what it is used for first: the productivity belongs to an activity';
              return (
                <tr key={r.code} data-line={at}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__cell xl__ro" title={`Trade ${r.code}`}>{r.name}</td>
                  <td className={`xl__cell xl__num xgrid__cell${grid.sel('number', at)}`} data-col="number" data-row={at}><input {...grid.cell('number', at)} type="text" inputMode="decimal" value={r.number || ''} onChange={(e) => edit(at, { number: num(e.target.value) ?? 0 })} />{grid.handle('number', at)}</td>
                  <td className={`xl__cell xl__num xgrid__cell${grid.sel('gangs', at)}`} data-col="gangs" data-row={at}><input {...grid.cell('gangs', at)} type="text" inputMode="decimal" value={r.gangs ?? ''} onChange={(e) => edit(at, { gangs: num(e.target.value) })} />{grid.handle('gangs', at)}</td>
                  <td className={`xl__cell xl__num xgrid__cell${grid.sel('productivity', at)}`} data-col="productivity" data-row={at}><input {...grid.cell('productivity', at)} type="text" inputMode="decimal" disabled={!linked} title={why} value={r.productivity ?? ''} onChange={(e) => edit(at, { productivity: num(e.target.value) })} />{grid.handle('productivity', at)}</td>
                  <td className="xl__cell">
                    <select value={r.basis ?? ''} disabled={!linked} title={why} aria-label="Unit" onChange={(e) => edit(at, { basis: e.target.value as QuantityBasis })}>
                      <option value="">{linked ? '—' : ''}</option>
                      {QUANTITY_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                  </td>
                  <td className="xl__cell">
                    <select value={r.usedFor} aria-label="Used for" title={r.alsoFor.length ? `Also on: ${r.alsoFor.join(', ')}` : phases.length ? 'The recipe activity this labour does' : 'No recipe has activities yet: make recipes first'} disabled={phases.length === 0 && !linked} onChange={(e) => edit(at, { usedFor: e.target.value })}>
                      <option value="">—</option>
                      {r.usedFor && !phases.includes(r.usedFor) && <option value={r.usedFor}>{r.usedFor}</option>}
                      {phases.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
