import { useMemo } from 'react';
import { isDirty, saveOrder, useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore, setRecipes } from '../../../state/recipeStore';
import { QUANTITY_BASES, type QuantityBasis } from '../../../prs/rules';
import { applyLabourEdit, crewLabour, type LabourData, type LabourEdit } from '../../../prs/labourView';
import { addCrew, addTradeLine, applyCrewTradeEdit, crewTradeLines, removeCrewTradeLine, type CrewTradeData, type CrewTradeEdit, type CrewTradeLine } from '../../../prs/crewTradeView';
import { IconRemove } from '../../icons';
import { useEditableGrid } from '../../useEditableGrid';
import { useRuleContext, useTrades } from './RuleParts';

/** The Labour table: crews and trades as one spreadsheet (prs/crewTradeView.ts), a line for each trade of each crew, so a trade that is in several crews
    is simply repeated. Number (the people the site has of a trade) and Gangs (how many crews there are) are the trade's and the crew's own values; Productivity,
    Unit and Used for (prs/labourView.ts) are the rate of the crew's work, on the crew's first line. It is a view over the scenario's trades, crews, rates and
    recipe activities: editing a cell writes to the row it comes from, nothing new is saved. */

/** Productivity is man-hours per unit of a quantity, so the unit reads that way: Mh/t, Mh/m³ ... */
const UNIT_LABEL: Record<QuantityBasis, string> = { rebar: 'Mh/t', concrete: 'Mh/m³', footprint: 'Mh/m² footprint', sides: 'Mh/m² side faces', property: 'Mh/model property' };
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? undefined : Number(v.replace(',', '.')));

export function CrewsAndTrades() {
  const ctx = useRuleContext();
  const dirty = useScenarioStore((st) => isDirty(st));
  const busy = useScenarioStore((st) => !!st.busy);
  const trades = useTrades();
  const { rules } = ctx;
  const data: CrewTradeData = useMemo(() => ({ trades: rules.trades, crewTemplates: rules.crewTemplates }), [rules.trades, rules.crewTemplates]);
  const lines = useMemo(() => crewTradeLines(rules.crewTemplates, trades), [rules.crewTemplates, trades]);
  const recipes = useRecipeStore((st) => st.recipes);
  const full: LabourData = useMemo(() => ({ ...data, rates: rules.rates, recipes }), [data, rules.rates, recipes]);
  const phases = useMemo(() => [...new Set(recipes.filter((x) => x.enabled !== false && x.chain !== false).flatMap((x) => x.tasks.filter((t) => t.enabled !== false).map((t) => t.phase)).filter(Boolean))], [recipes]);
  const commitFull = (next: LabourData) => {
    if (next.recipes !== full.recipes) setRecipes(next.recipes);
    ctx.change((r) => ({ ...r, trades: next.trades, crewTemplates: next.crewTemplates, rates: next.rates }));
  };
  const commit = (next: CrewTradeData) => commitFull({ ...full, ...next });
  const edit = (line: CrewTradeLine, change: CrewTradeEdit) => commit(applyCrewTradeEdit(data, line, change));
  /** The rate of a line's work: the crew's, on its first line; a trade no crew uses has none until it is used for something (that makes it a crew). */
  const labourOf = (l: CrewTradeLine) => (l.crew === null ? { rateId: undefined, productivity: undefined, basis: undefined, usedFor: '', alsoFor: [] as string[] } : crewLabour(l.crewId, full));
  const labourEdit = (l: CrewTradeLine, change: LabourEdit) => commitFull(applyLabourEdit(full, { code: l.trade, name: l.name }, change, l.crew !== null ? l.crewId : undefined));
  const known = new Set(trades.map((t) => t.code.toUpperCase()));

  const grid = useEditableGrid({ widthsKey: 'crewsTrades',
    rows: lines,
    get: (col, l) => (col === 'crew' ? l.crewId : col === 'trade' ? l.trade : col === 'name' ? l.name : col === 'size' ? String(l.size ?? '') : col === 'capacity' ? String(l.capacity ?? '') : col === 'available' ? String(l.available ?? '') : col === 'productivity' ? String(labourOf(l).productivity ?? '') : l.subcontractor ?? ''),
    write: (col, cells) => {
      // Cells that belong to the crew are written on its first line only.
      let next = full;
      const at = lines;
      for (const [row, text] of cells) {
        const l = at[row];
        if (!l) continue;
        const patch: CrewTradeEdit | null = col === 'crew' && l.first ? { crewId: text }
          : col === 'trade' ? { trade: text }
          : col === 'name' ? { name: text }
          : col === 'size' ? { size: num(text) ?? 0 }
          : col === 'capacity' ? { capacity: num(text) ?? 0 }
          : col === 'available' && l.first ? { available: num(text) }
          : col === 'sub' && l.first ? { subcontractor: text }
          : null;
        if (patch) next = { ...next, ...applyCrewTradeEdit(next, l, patch) };
        else if (col === 'productivity' && l.first && l.trade.trim()) next = applyLabourEdit(next, { code: l.trade, name: l.name }, { productivity: num(text) }, l.crew !== null ? l.crewId : undefined);
      }
      commitFull(next);
    },
  });

  return (
    <div>
      <h2 className="gen-title">Labour</h2>
      <div className="scn-dim seq__explain gen-title__sub">
        <p>Define the labour, the crews they work in and the productivity used in the plan.</p>
        <p>There is a line for each trade of each crew.</p>
        <p>A trade in several crews is repeated, and its name and Number are the same on each line.</p>
        <p>Productivity, Unit and Used for belong to the crew, on its first line.</p>
      </div>
      {lines.length === 0 ? <div className="scn-dim scn-editor__help">No crews or trades yet. Add a crew, then the trades it is made of.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 130 }} /><col style={{ width: 80 }} /><col style={{ width: 200 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 160 }} /><col style={{ width: 160 }} /><col style={{ width: 60 }} /></colgroup>
          <thead><tr>
            <th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this crew" />
            <th title="The crew: it is linked to recipe activities by this ID">Crew</th>
            <th title="The trade's code (SF, CP …)">Trade</th>
            <th title="The trade's name">Trade name</th>
            <th title="People of this trade in the crew, per day">In crew</th>
            <th title="The people per day the site has of this trade: the limit the programme is levelled to">Number</th>
            <th title="How many crews of this kind there are, the most that can work at once (empty: not limited)">Gangs</th>
            <th title="Man-hours per unit of the quantity, for the work of this crew">Productivity</th>
            <th title="What the productivity is measured per">Unit</th>
            <th title="The recipe activity this crew's productivity is for: the rate and the crew are put on the activities of that name">Used for</th>
            <th title="The company the crew belongs to">Subcontractor</th>
            <th aria-label="Add or delete" />
          </tr></thead>
          <tbody>
            {lines.map((l, at) => {
              const crewCell = l.crew !== null;
              const unknown = l.trade.trim() !== '' && !known.has(l.trade.trim().toUpperCase());
              const cell = (col: string, value: string | number | undefined, onChange: (v: string) => void, o: { num?: boolean; off?: boolean; title?: string; bad?: boolean } = {}) => (
                o.off ? <td className="xl__cell xl__ro" title={o.title}>{value === undefined ? '' : <span className="scn-dim">{value}</span>}</td> : (
                  <td className={`xl__cell${o.num ? ' xl__num' : ''} xgrid__cell${grid.sel(col, at)}${o.bad ? ' is-bad' : ''}`} data-col={col} data-row={at}>
                    <input {...grid.cell(col, at)} {...(o.num ? { type: 'text', inputMode: 'decimal' as const } : {})} value={value ?? ''} spellCheck={false} list={col === 'trade' ? 'crew-trade-codes' : undefined} title={o.title} aria-invalid={!!o.bad} onChange={(e) => onChange(e.target.value)} />{grid.handle(col, at)}
                  </td>
                )
              );
              return (
                <tr key={`${l.crew}|${l.at}|${l.trade}`} data-line={at} className={l.enabled ? (l.first && at > 0 ? 'is-group-start' : '') : 'is-off'}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__check">{crewCell ? <input type="checkbox" checked={l.enabled} aria-label="On" title="Switches the whole crew on or off: it is the same on every line of the crew" onChange={(e) => edit(l, { enabled: e.target.checked })} /> : null}</td>
                  {crewCell ? cell('crew', l.crewId, (v) => edit(l, { crewId: v }), { off: !l.first, title: l.first ? undefined : 'The crew’s ID is on its first line' }) : <td className="xl__cell xl__ro"><span className="scn-dim">no crew</span></td>}
                  {cell('trade', l.trade, (v) => edit(l, { trade: v }), { off: !crewCell, title: unknown ? `The trade “${l.trade}” has no name or people yet: type them on this line` : crewCell ? 'The trade’s code' : 'A trade no crew uses yet', bad: false })}
                  {cell('name', l.name, (v) => edit(l, { name: v }), { off: !l.trade.trim() && crewCell, title: l.trade.trim() ? undefined : 'Give the line a trade first' })}
                  {cell('size', l.size, (v) => edit(l, { size: num(v) ?? 0 }), { num: true, off: !crewCell || l.at === null })}
                  {cell('capacity', l.capacity, (v) => edit(l, { capacity: num(v) ?? 0 }), { num: true, off: !l.trade.trim() })}
                  {cell('available', l.available, (v) => edit(l, { available: num(v) }), { num: true, off: !crewCell || !l.first, title: l.first ? undefined : 'Set on the first line of the crew' })}
                  {(() => {
                    const lab = labourOf(l);
                    const linked = lab.usedFor !== '';
                    const own = l.first;
                    const why = !own ? 'Set on the first line of the crew' : linked ? undefined : 'Not put to work yet: choose Used for to put it on an activity';
                    return (
                      <>
                        {cell('productivity', lab.productivity, (v) => labourEdit(l, { productivity: num(v) }), { num: true, off: !own || !l.trade.trim(), title: why })}
                        <td className="xl__cell"><select value={lab.basis ?? ''} disabled={!own || !l.trade.trim()} title={why} aria-label="Unit" onChange={(e) => labourEdit(l, { basis: e.target.value as QuantityBasis })}><option value="">—</option>{QUANTITY_BASES.map((b) => <option key={b.value} value={b.value}>{UNIT_LABEL[b.value]}</option>)}</select></td>
                        <td className="xl__cell"><select className={lab.usedFor ? "is-pill" : undefined} value={lab.usedFor} aria-label="Used for" disabled={!own || !l.trade.trim() || (phases.length === 0 && !linked)} title={!own ? why : lab.alsoFor.length ? `Also on: ${lab.alsoFor.join(', ')}` : phases.length ? 'The recipe activity this crew does' : 'No recipe has activities yet: make recipes first'} onChange={(e) => labourEdit(l, { usedFor: e.target.value })}>
                          <option value="">—</option>
                          {lab.usedFor && !phases.includes(lab.usedFor) && <option value={lab.usedFor}>{lab.usedFor}</option>}
                          {phases.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select></td>
                      </>
                    );
                  })()}
                  {cell('sub', l.subcontractor, (v) => edit(l, { subcontractor: v }), { off: !crewCell || !l.first, title: l.first ? undefined : 'Set on the first line of the crew' })}
                  <td className="xl__check">
                    {crewCell && <button type="button" className="cols__icon" aria-label="Add a trade to this crew" title="Add another trade to this crew" onClick={() => commit(addTradeLine(data, l.crew!))}>+</button>}
                    <button type="button" className="cols__icon cols__icon--remove" aria-label="Delete" title={crewCell ? (l.first && lines.filter((x) => x.crew === l.crew).length === 1 ? 'Delete the crew' : 'Delete this trade from the crew') : 'Switch this trade off: no crew uses it'} onClick={() => commit(removeCrewTradeLine(data, l))}><IconRemove /></button>
                  </td>
                </tr>
              );
            })}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={12}><button type="button" onClick={() => commit(addCrew(data))}>+ Add a crew</button></td></tr>
          </tbody>
        </table>
      )}
      <div className="gen-foot">
        <div className="scn-dim seq__explain">
          <p>Productivity is man-hours per unit of the quantity.</p>
          <p>Gangs is how many crews of a kind there are, the most that can work at once.</p>
        </div>
        <button type="button" className="btn" onClick={() => commit(addCrew(data))} title="Add a crew: then give it its trades">+ Add labour</button>
        <button type="button" className="btn primary" disabled={!dirty || !!busy} onClick={() => void saveOrder()} title={dirty ? 'Save the scenario to the project database' : 'Nothing to save: the scenario is as saved'}>Save changes</button>
      </div>
      <datalist id="crew-trade-codes">{trades.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</datalist>
    </div>
  );
}
