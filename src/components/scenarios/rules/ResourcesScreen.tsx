import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScenarioStore } from '../../../state/scenarioStore';
import { setPools, useRecipeStore } from '../../../state/recipeStore';
import { freshId, type PoolKind, type PoolRow } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';
import { CrewsTableCard, RatesTableCard, TradesTableCard } from './RelationalTables';

/** Resources: what the recipes pick from, defined once, in tabs like ALICE's scenario screen: Crews (and their trades), Equipment, Cranes,
    Materials (how many of each the scenario has). A recipe task only names them. The calendars are the programmes' own (Programmes > Calendars). */

type Tab = 'crews' | 'rates' | 'equipment' | 'cranes' | 'materials';
const POOL_TABS: { id: Tab; kind: PoolKind; label: string; one: string }[] = [
  { id: 'equipment', kind: 'equipment', label: 'Equipment', one: 'equipment' },
  { id: 'cranes', kind: 'crane', label: 'Cranes', one: 'crane' },
  { id: 'materials', kind: 'material', label: 'Materials', one: 'material' },
];

const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

function PoolTable({ kind, one }: { kind: PoolKind; one: string }) {
  const pools = useRecipeStore((s) => s.pools);
  const rows = pools.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === kind);
  const set = (i: number, patch: Partial<PoolRow>) => setPools(pools.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Range, fill down (Ctrl+D, the corner square), copy and paste of the ID, Name and Quantity columns.
  const grid = useEditableGrid({
    rows,
    get: (col, { p }) => (col === 'quantity' ? String(p.quantity) : col === 'id' ? p.id : p.name),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [rows[at].i, text]));
      setPools(pools.map((r, j) => (to.has(j) ? { ...r, ...(col === 'quantity' ? { quantity: num(to.get(j)!) } : { [col]: to.get(j)! }) } : r)));
    },
  });
  const add = () => setPools([...pools, { id: freshId(kind.toUpperCase().slice(0, 3), pools.map((p) => p.id)), kind, name: '', quantity: 1 }]);
  return (
    <div>
      <div className="rel-bar">
        <button type="button" className="btn btn--small primary" onClick={add}>+ {one[0].toUpperCase() + one.slice(1)}</button>
        <span className="scn-dim">How many of each there are: the most that can be in use at once (0: not limited). A recipe task names the ID.</span>
      </div>
      {rows.length === 0 ? <div className="scn-dim scn-editor__help">None yet.</div> : (
        <table className="rel-table rel-table--grid xgrid" {...grid.grid}>
          <thead><tr><th aria-label="On" /><th>ID</th><th>Name</th><th>Quantity</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map(({ p, i }, at) => (
              <tr key={i} data-line={at} className={p.enabled === false ? 'is-off' : ''}>
                <td><input type="checkbox" checked={p.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                <td className={`xgrid__cell${grid.sel('id', at)}`} data-col="id" data-row={at}><input className="rel-cell" style={{ width: 110 }} value={p.id} spellCheck={false} onChange={(e) => set(i, { id: e.target.value })} />{grid.handle('id', at)}</td>
                <td className={`xgrid__cell${grid.sel('name', at)}`} data-col="name" data-row={at}><input className="rel-cell" style={{ width: 220 }} value={p.name} spellCheck={false} placeholder={kind === 'crane' ? 'Tower crane 1' : kind === 'material' ? 'Slab formwork set' : 'Concrete pump'} onChange={(e) => set(i, { name: e.target.value })} />{grid.handle('name', at)}</td>
                <td className={`xgrid__cell${grid.sel('quantity', at)}`} data-col="quantity" data-row={at}><input className="rel-cell" type="number" min={0} step="any" style={{ width: 70 }} value={p.quantity} onChange={(e) => set(i, { quantity: num(e.target.value) })} />{grid.handle('quantity', at)}</td>
                <td><button type="button" className="cols__icon cols__icon--remove" onClick={() => setPools(pools.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ResourcesScreen({ onClose }: { onClose: () => void }) {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const [tab, setTab] = useState<Tab>('equipment');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const maximized = ctx.rules.settings.maximizeResources === true;
  const needsScenario = (tab === 'crews' || tab === 'rates') && !scenarioOpen;
  const pool = POOL_TABS.find((t) => t.id === tab);

  return createPortal(
    <div className="rg-full" role="dialog" aria-label="Resources">
      <div className="rg-full__bar">
        <strong>Resources</strong>
        <button type="button" className={`btn btn--small${maximized ? ' primary' : ''}`} disabled={!scenarioOpen} aria-pressed={maximized}
          onClick={() => ctx.change((r) => ({ ...r, settings: { ...r.settings, maximizeResources: maximized ? undefined : true } }))}
          title="No pool, crew pool or labour trade has a limit: the shortest programme the logic allows. The counts are kept.">
          Maximize resource availability{maximized ? ': on' : ''}
        </button>
        <button type="button" className="btn btn--small primary" onClick={onClose}>Close (Esc)</button>
      </div>
      <div className="scn-rules__tabs" role="tablist">
        {([['crews', 'Crews'], ['rates', 'Rates'], ...POOL_TABS.map((t) => [t.id, t.label]), ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="rg-full__body">
        {needsScenario ? <div className="scn-dim scn-editor__help">Open a scenario to edit its {tab}: they are part of the scenario's rules.</div>
          : pool ? <PoolTable kind={pool.kind} one={pool.one} />
          : tab === 'rates' ? <RatesTableCard ctx={ctx} />
          : <><CrewsTableCard ctx={ctx} /><TradesTableCard ctx={ctx} /></>}
      </div>
    </div>,
    document.body,
  );
}
