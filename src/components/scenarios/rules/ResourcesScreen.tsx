import { useEffect, useState } from 'react';
import { useResourceFocus } from '../../../state/resourceFocusStore';
import { useGenerateTab } from '../GenerateTabs';
import { useScenarioStore } from '../../../state/scenarioStore';
import { setPools, useRecipeStore } from '../../../state/recipeStore';
import { freshId, type PoolKind, type PoolRow } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';
import { CrewsTableCard, RatesTableCard, TradesTableCard } from './RelationalTables';

/** Resources: what the recipes pick from, defined once, in tabs like ALICE's scenario screen: Crews (and their trades), Equipment, Cranes,
    Materials (how many of each the scenario has). A recipe task only names them. The calendars are the programmes' own (Programmes > Calendars). */

export type ResourcesTab = 'crews' | 'rates' | 'equipment' | 'cranes' | 'materials';
type Tab = ResourcesTab;
const POOL_TABS: { id: Tab; kind: PoolKind; label: string; one: string }[] = [
  { id: 'equipment', kind: 'equipment', label: 'Equipment', one: 'equipment' },
  { id: 'cranes', kind: 'crane', label: 'Cranes', one: 'crane' },
  { id: 'materials', kind: 'material', label: 'Materials', one: 'material' },
];

const KEY: Record<PoolKind, 'equipment' | 'cranes' | 'materials'> = { equipment: 'equipment', crane: 'cranes', material: 'materials' };
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

function PoolTable({ kind, one }: { kind: PoolKind; one: string }) {
  const pools = useRecipeStore((s) => s.pools);
  const recipes = useRecipeStore((s) => s.recipes);
  const { limits } = useRuleContext().rules;
  const focused = useResourceFocus((s) => s.id);
  const setTab = useGenerateTab((s) => s.setTab);
  useEffect(() => { if (focused) document.querySelector('tr.is-focus')?.scrollIntoView({ block: 'center' }); }, [focused]);
  /** Where a pool is used: the recipe tasks that name it, and the limits whose "how many at once" is its quantity. */
  const usage = (p: PoolRow) => {
    const tasks = recipes.filter((r) => r.chain !== false && r.enabled !== false).flatMap((r) => r.tasks.filter((t) => (t[KEY[p.kind]] ?? []).some((u) => same(u.type, p.id))).map((t) => `${r.id} · ${t.name || t.phase}`));
    const lims = limits.filter((l) => l.enabled !== false && typeof l.max === 'string' && (same(l.max, p.id) || (p.name.trim() !== '' && same(l.max, p.name))))
      .map((l) => `${l.phase}${l.group ? ` (${l.group})` : ''}`);
    return { tasks, lims };
  };
  const rows = pools.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === kind);
  const set = (i: number, patch: Partial<PoolRow>) => setPools(pools.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Range, fill down (Ctrl+D, the corner square), copy and paste of the ID, Name and Quantity columns.
  const grid = useEditableGrid({ widthsKey: 'resources.pools',
    rows,
    get: (col, { p }) => (col === 'quantity' ? String(p.quantity) : col === 'id' ? p.id : col === 'note' ? p.note ?? '' : p.name),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [rows[at].i, text]));
      setPools(pools.map((r, j) => (to.has(j) ? { ...r, ...(col === 'quantity' ? { quantity: num(to.get(j)!) } : col === 'note' ? { note: to.get(j)! || undefined } : { [col]: to.get(j)! }) } : r)));
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
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 160 }} /><col style={{ width: 300 }} /><col style={{ width: 110 }} /><col style={{ width: 260 }} /><col style={{ width: 240 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this one" /><th>ID</th><th>Name</th><th title="How many exist, and so how many can be in use at the same time">Quantity</th><th title="The recipe tasks that use it, and the limits that take their number from it">Used by</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map(({ p, i }, at) => {
              const u = usage(p);
              const used = [u.tasks.length ? `${u.tasks.length} task${u.tasks.length === 1 ? '' : 's'}` : '', u.lims.length ? `limits ${u.lims.join(', ')}` : ''].filter(Boolean).join(' · ');
              return (
              <tr key={i} data-line={at} className={`${p.enabled === false ? 'is-off' : ''}${focused && same(focused, p.id) ? ' is-focus is-selected' : ''}`}>
                <th className="xl__row" scope="row">{at + 1}</th>
                <td className="xl__check"><input type="checkbox" checked={p.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                <td className={`xl__cell xgrid__cell${grid.sel('id', at)}`} data-col="id" data-row={at}><input {...grid.cell('id', at)} value={p.id} spellCheck={false} onChange={(e) => set(i, { id: e.target.value })} />{grid.handle('id', at)}</td>
                <td className={`xl__cell xgrid__cell${grid.sel('name', at)}`} data-col="name" data-row={at}><input {...grid.cell('name', at)} value={p.name} spellCheck={false} placeholder={kind === 'crane' ? 'Tower crane 1' : kind === 'material' ? 'Slab formwork set' : 'Concrete pump'} onChange={(e) => set(i, { name: e.target.value })} />{grid.handle('name', at)}</td>
                <td className={`xl__cell xl__num xgrid__cell${grid.sel('quantity', at)}`} data-col="quantity" data-row={at}><input {...grid.cell('quantity', at)} type="text" inputMode="decimal" value={p.quantity} onChange={(e) => set(i, { quantity: num(e.target.value) })} />{grid.handle('quantity', at)}</td>
                <td className="scn-dim" onClick={() => u.tasks.length && setTab('recipes')} title={[...u.tasks.map((t) => `Task ${t}`), ...u.lims.map((l) => `Limit ${l}`)].join(String.fromCharCode(10)) || 'Nothing uses it yet'}>{used || 'not used yet'}</td>
                <td className={`xl__cell xgrid__cell${grid.sel('note', at)}`} data-col="note" data-row={at}><input {...grid.cell('note', at)} value={p.note ?? ''} spellCheck={false} placeholder="e.g. limited by storage space" onChange={(e) => set(i, { note: e.target.value || undefined })} />{grid.handle('note', at)}</td>
                <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => setPools(pools.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
              </tr>
              );
            })}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={7}><button type="button" onClick={add}>+ Add {one}</button></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The resources as a panel of its own (the Generate view): `only` limits it to some tabs (one tab: no tab bar). */
export function ResourcesPanel({ only, onClose, bare }: { only?: Tab[]; onClose?: () => void; /** No bar (the Maximize button): the panel is one section of a longer page. */ bare?: boolean }) {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const shown = (['crews', 'rates', 'equipment', 'cranes', 'materials'] as Tab[]).filter((t) => !only || only.includes(t));
  const [tab, setTab] = useState<Tab>(shown[0]);
  const maximized = ctx.rules.settings.maximizeResources === true;
  const needsScenario = (tab === 'crews' || tab === 'rates') && !scenarioOpen;
  const pool = POOL_TABS.find((t) => t.id === tab);

  return (
    <div className="gen-panel">
      {!bare && <div className="rg-full__bar gen-bar">
        {onClose && <strong>Resources</strong>}
        <button type="button" className={`btn btn--small${maximized ? ' primary' : ''}`} disabled={!scenarioOpen} aria-pressed={maximized}
          onClick={() => ctx.change((r) => ({ ...r, settings: { ...r.settings, maximizeResources: maximized ? undefined : true } }))}
          title="No pool, crew pool or labour trade has a limit: the shortest programme the logic allows. The counts are kept.">
          Maximize resource availability{maximized ? ': on' : ''}
        </button>
        {onClose && <button type="button" className="btn btn--small primary" onClick={onClose}>Close (Esc)</button>}
      </div>}
      {shown.length > 1 && (
        <div className="scn-rules__tabs" role="tablist">
          {([['crews', 'Crews'], ['rates', 'Rates'], ...POOL_TABS.map((t) => [t.id, t.label]), ] as [Tab, string][]).filter(([id]) => shown.includes(id)).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      <div className="rg-full__body gen-body">
        {needsScenario ? <div className="scn-dim scn-editor__help">Open a scenario to edit its {tab}: they are part of the scenario's rules.</div>
          : pool ? <PoolTable kind={pool.kind} one={pool.one} />
          : tab === 'rates' ? <RatesTableCard ctx={ctx} />
          : <><CrewsTableCard ctx={ctx} /><TradesTableCard ctx={ctx} /></>}
      </div>
    </div>
  );
}
