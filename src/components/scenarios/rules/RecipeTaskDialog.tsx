import { useState, type ReactNode } from 'react';
import { TaskResources } from './TaskResources';
import type { PoolKind, ScenarioRules } from '../../../prs/rules';
import type { RecipeTask, ResourceUse } from '../../../prs/recipes';
import { IconChevronDown, IconRemove } from '../../icons';

/** The operation dialog of a task, like ALICE's: its name and tag, and the tabs Labor, Equipment, Cranes, Materials, Rates and Duration. Opens from
    the graph (double-click a task); every change goes straight into the recipe. */

type Tab = 'labor' | 'equipment' | 'cranes' | 'materials' | 'rates' | 'duration';
const TABS: { id: Tab; label: string }[] = [
  { id: 'labor', label: 'Labor' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'cranes', label: 'Cranes' },
  { id: 'materials', label: 'Materials' },
  { id: 'rates', label: 'Rates' },
  { id: 'duration', label: 'Duration' },
];
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const POOL_OF: Record<'equipment' | 'cranes' | 'materials', { kind: PoolKind; key: 'equipment' | 'cranes' | 'materials'; one: string }> = {
  equipment: { kind: 'equipment', key: 'equipment', one: 'Equipment' },
  cranes: { kind: 'crane', key: 'cranes', one: 'Crane' },
  materials: { kind: 'material', key: 'materials', one: 'Material' },
};

export function RecipeTaskDialog({ task, rules, onPatch, onRename, onDelete, onClose, panel }: {
  /** Laid out as folds for the side panel of the graph instead of the dialog. */
  panel?: boolean;
  task: RecipeTask;
  rules: ScenarioRules;
  onPatch: (patch: Partial<RecipeTask>) => void;
  onRename: (phase: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('labor');
  const crew = rules.crewTemplates.find((c) => c.id.trim().toUpperCase() === (task.crew ?? '').trim().toUpperCase());
  const people = crew ? crew.trades.reduce((n, t) => n + (t.size || 0), 0) : 0;

  const uses = (which: 'equipment' | 'cranes' | 'materials') => {
    const { kind, key, one } = POOL_OF[which];
    const pools = rules.resourcePools.filter((p) => p.kind === kind);
    const list: ResourceUse[] = task[key] ?? [];
    const set = (next: ResourceUse[]) => onPatch({ [key]: next.length ? next : undefined });
    return (
      <div className="rtd__pane">
        <button type="button" className="btn btn--small primary" disabled={!pools.length} onClick={() => set([...list, { type: pools[0].id }])} title={pools.length ? undefined : `Add a ${one.toLowerCase()} in Resources… first`}>+ Assign {one}</button>
        {list.length === 0 && <p className="scn-dim">Nothing assigned.</p>}
        {list.map((u, i) => (
          <div key={i} className="rtd__row">
            <label>Type
              <select className="rel-cell" value={u.type} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                {!pools.some((p) => p.id.toUpperCase() === u.type.toUpperCase()) && <option value={u.type}>{u.type}</option>}
                {pools.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </select>
            </label>
            <label>How many
              <input className="rel-cell" type="number" min={0} step="any" style={{ width: 64 }} value={u.count ?? 1} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, count: num(e.target.value) } : x)))} />
            </label>
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => set(list.filter((_, j) => j !== i))} aria-label="Remove"><IconRemove /></button>
          </div>
        ))}
      </div>
    );
  };

  const head = (
    <>
      <label className="rtd__name">Operation name
        <input className="rel-cell" value={task.name ?? ''} placeholder={task.phase} onChange={(e) => onPatch({ name: e.target.value || undefined })} spellCheck={false} />
      </label>
      <label>Phase
        <input className="rel-cell" style={{ width: 130 }} list="recipe-phases" value={task.phase} onChange={(e) => onRename(e.target.value)} spellCheck={false} title="The activity the generator knows it by (Rebar, Formwork, Concrete, Curing ...)" />
      </label>
      <label>Tag
        <input className="rel-cell" style={{ width: 56 }} value={task.suffix ?? ''} onChange={(e) => onPatch({ suffix: e.target.value || undefined })} spellCheck={false} title="The end of the activity ID (-R)" />
      </label>
    </>
  );
  const labor = (
        <div className="rtd__pane">
          <label>Crew
            <select className="rel-cell" value={task.crew ?? ''} onChange={(e) => onPatch({ crew: e.target.value || undefined })}>
              <option value="">(none)</option>
              {task.crew && !crew && <option value={task.crew}>{task.crew}</option>}
              {rules.crewTemplates.map((c) => <option key={c.id} value={c.id}>{c.subcontractor ? `${c.subcontractor} · ${c.id}` : c.id}</option>)}
            </select>
          </label>
          {crew ? (
            <p className="scn-dim">{crew.subcontractor ? `${crew.subcontractor}: ` : ''}{crew.trades.map((t) => `${t.trade} ${t.size}`).join(', ') || 'no trades'} — {people} {people === 1 ? 'person' : 'people'} per crew{crew.available ? `, ${crew.available} crews available` : ', crews not limited'}</p>
          ) : (
            <p className="scn-dim">The crews are defined in Resources… (at the top of the Recipes panel), with their trades and how many people.</p>
          )}
        </div>
  );
  const rates = (
        <div className="rtd__pane rtd__grid">
          <label>Rate
            <select className="rel-cell" value={task.rate ?? ''} onChange={(e) => onPatch({ rate: e.target.value || undefined })}>
              <option value="">(none)</option>
              {task.rate && !rules.rates.some((r) => r.id === task.rate) && <option value={task.rate}>{task.rate}</option>}
              {rules.rates.filter((r) => r.type !== 'rebar').map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </label>
          <label>Rebar rate
            <select className="rel-cell" value={task.density ?? ''} onChange={(e) => onPatch({ density: e.target.value || undefined })}>
              <option value="">(none)</option>
              {task.density && !rules.rates.some((r) => r.id === task.density) && <option value={task.density}>{task.density}</option>}
              {rules.rates.filter((r) => r.type === 'rebar').map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </label>
          <label>Calendar
            <select className="rel-cell" value={task.calendar ?? ''} onChange={(e) => onPatch({ calendar: e.target.value || undefined })}>
              <option value="">(the task's own)</option>
              {task.calendar && !rules.calendars.some((c) => c.id === task.calendar) && <option value={task.calendar}>{task.calendar}</option>}
              {rules.calendars.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
          </label>
        </div>
  );
  // The duration is either fixed days, or worked out from a quantity (a productivity rate: quantity x man-hours per unit / (people x shifts x hours)).
  const productivity = rules.rates.filter((r) => r.type === 'productivity');
  const rateRow = rules.rates.find((r) => r.id === task.rate);
  const fromQuantity = task.days === undefined && rateRow?.type === 'productivity';
  const BASIS: Record<string, string> = { rebar: 'tonnes of rebar', concrete: 'm³ of concrete', footprint: 'footprint area', sides: 'side area', property: 'a model quantity' };
  const rateText = (r: (typeof productivity)[number]) => `${BASIS[r.basis ?? 'rebar'] ?? r.basis} × ${r.manhoursPerUnit ?? '?'} man-hours per unit ÷ (${r.people || people || 'crew'} people × ${r.shifts ?? 1} shift${(r.shifts ?? 1) === 1 ? '' : 's'} × ${r.hoursPerShift ?? 8} h)`;
  const setFromQuantity = (on: boolean) => {
    if (!on) { onPatch({ days: task.days ?? 1 }); return; }
    const pick = rateRow?.type === 'productivity' ? rateRow : productivity[0];
    onPatch({ days: undefined, ...(pick ? { rate: pick.id } : {}), ...(pick && (pick.basis ?? 'rebar') === 'rebar' && !task.material ? { material: 'rebar' as const } : {}) });
  };
  const duration = (
        <div className="rtd__pane rtd__grid">
          <div className="segmented-choice" title="How the duration of this task is decided">
            <button type="button" className={!fromQuantity ? 'active' : ''} onClick={() => setFromQuantity(false)}>Fixed days</button>
            <button type="button" className={fromQuantity ? 'active' : ''} onClick={() => setFromQuantity(true)} title="From the quantity of the objects (for example the tonnes of rebar) and a productivity rate">From quantity</button>
          </div>
          {fromQuantity ? (
            <>
              <label>Productivity rate
                <select className="rel-cell" value={task.rate ?? ''} onChange={(e) => onPatch({ rate: e.target.value || undefined })}>
                  {productivity.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                </select>
              </label>
              {rateRow && rateRow.type === 'productivity' && <p className="scn-dim" style={{ gridColumn: '1 / -1' }}>Days = {rateText(rateRow)}{rateRow.rounding === 'none' ? '' : `, rounded ${rateRow.rounding === 'round' ? '' : 'up '}to whole days`}{rateRow.minDays ? `, at least ${rateRow.minDays}` : ''}.{(rateRow.basis ?? 'rebar') === 'rebar' && !task.density ? ' Rebar tonnes come from the concrete volume × a Rebar rate: pick one under Rates.' : ''}</p>}
              {productivity.length === 0 && <p className="scn-dim" style={{ gridColumn: '1 / -1' }}>No productivity rate yet: add one in Resources… › Rates (type “productivity”, basis rebar), with its man-hours per tonne.</p>}
            </>
          ) : (
            <label>Days
              <input className="rel-cell" type="number" min={0} step="any" style={{ width: 80 }} value={task.days ?? ''} onChange={(e) => onPatch({ days: num(e.target.value) })} title="Fixed days; empty: the rate decides" />
            </label>
          )}
          <label>Priority
            <input className="rel-cell" type="number" style={{ width: 80 }} value={task.priority ?? ''} onChange={(e) => onPatch({ priority: num(e.target.value) })} title="Of the values of this task: a higher number wins" />
          </label>
          <label>Quantity on the activity
            <select className="rel-cell" value={task.material ?? ''} onChange={(e) => onPatch({ material: (e.target.value || undefined) as RecipeTask['material'] })}>
              <option value="">none</option>
              <option value="rebar">rebar tonnes</option>
              <option value="concrete">concrete volume</option>
            </select>
          </label>
          <label className="rtd__check"><input type="checkbox" checked={!!task.finishAfter} onChange={(e) => onPatch({ finishAfter: e.target.checked || undefined })} /> Cannot finish before what it follows</label>
          <label className="rtd__check"><input type="checkbox" checked={!!task.gates} onChange={(e) => onPatch({ gates: e.target.checked || undefined })} /> What follows the object waits for this task</label>
          <label className="rtd__check"><input type="checkbox" checked={task.enabled !== false} onChange={(e) => onPatch({ enabled: e.target.checked ? undefined : false })} /> On</label>
        </div>
  );

  // In the graph's side panel (the N panel): every group of settings is a fold, no tabs and no dialog frame.
  if (panel) {
    const fold = (title: string, body: ReactNode, open = true) => (
      <details className="np__fold" open={open}><summary><IconChevronDown className="np__chev" width={18} height={18} />{title}</summary><div className="np__body">{body}</div></details>
    );
    return (
      <div className="np__task">
        {fold('Node', <div className="rtd__pane">{head}<label className="rtd__check"><input type="checkbox" checked={task.enabled !== false} onChange={(e) => onPatch({ enabled: e.target.checked ? undefined : false })} /> On</label></div>)}
        {fold('Labor', labor)}
        {fold('Resources', <TaskResources task={task} rules={rules} onPatch={onPatch} />)}
        {fold('Rates', rates, false)}
        {fold('Duration', duration)}
        <button type="button" className="btn btn--small" onClick={onDelete}>Delete task</button>
      </div>
    );
  }

  return (
    <div className="rtd" role="dialog" aria-label={`Task ${task.phase}`}>
      <div className="rtd__head">
        {head}
        <button type="button" className="mini-btn rtd__close" onClick={onClose} aria-label="Close" title="Close">–</button>
      </div>
      <div className="rtd__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'labor' && labor}
      {tab === 'equipment' && uses('equipment')}
      {tab === 'cranes' && uses('cranes')}
      {tab === 'materials' && uses('materials')}
      {tab === 'rates' && rates}
      {tab === 'duration' && duration}
      <div className="rtd__foot">
        <button type="button" className="btn btn--small" onClick={onDelete}>Delete task</button>
        <button type="button" className="btn btn--small primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
