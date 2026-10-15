import { useEffect, useMemo, useState } from 'react';
import { IconRemove } from '../icons';
import { useEditableGrid } from '../useEditableGrid';
import type { Activity, ResourceAssignment, ScheduleModel } from '../../schedule/types';
import type { Result } from '../../schedule/programmeCommands';
import { addResource, assignResource, crewOf, daysFromProductivity, deleteResource, productivityOf, RESOURCE_TYPES, setAssignment, setProductivity, unassignResource, updateResource } from '../../schedule/planResources';
import { addCodeType, addCodeValue, assignCode, deleteCodeType, deleteCodeValue, renameCodeType, renameCodeValue } from '../../schedule/planCodes';
import { hoursPerDayOfCalendar } from '../../schedule/planEdit';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';

/** Two panels for building a programme: what the picked activities need (quantity and productivity, which make the duration; the
    resources and crew; the activity codes), and the dictionaries those come from (the resources, the code types and their values). */

type Run = <T extends object>(label: string, command: (m: ScheduleModel) => Result<T>) => (Omit<{ model: ScheduleModel } & T, 'model'>) | null;

/** One undoable edit of the programme, or a note saying why not. */
function useRun(model: ScheduleModel, onNote: (text: string) => void): Run {
  return function run<T extends object>(label: string, command: (m: ScheduleModel) => Result<T>) {
    if (!model.editable) { onNote('This programme is not edited in place: make an editable copy of it first (Inputs, the pencil).'); return null; }
    const r = commit(label, () => editStructure(programmeKey(model), command));
    if ('error' in r) { onNote(r.error); return null; }
    return r as Omit<{ model: ScheduleModel } & T, 'model'>;
  };
}

/** The activities the panel acts on: the ones picked in the planner / table / Gantt, else the one last clicked. */
function usePicked(model: ScheduleModel, selectedId: string | null): Activity[] {
  const ids = useActivitySelectionStore((s) => s.ids);
  return useMemo(() => {
    const list = ids.size ? model.activities.filter((a) => ids.has(a.id)) : [];
    if (list.length) return list;
    const one = selectedId ? model.activities.find((a) => a.id === selectedId) : undefined;
    return one ? [one] : [];
  }, [model.activities, ids, selectedId]);
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/** A number box that applies when it loses focus or Enter is pressed. */
function NumberBox({ value, onApply, step = 'any', width = 78, label, min = 0, cls = 'plan-panel__num' }: { value: number | null; onApply: (v: number | null) => void; step?: string; width?: number | string; label: string; min?: number; cls?: string }) {
  const [draft, setDraft] = useState(value === null ? '' : String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(value === null ? '' : String(Math.round(value * 1000) / 1000)), [value]);
  const apply = () => {
    const v = num(draft);
    if (v !== null && !Number.isFinite(v)) return setDraft(value === null ? '' : String(value));
    if (v !== value) onApply(v);
  };
  return <input className={cls} type="number" min={min} step={step} style={{ width }} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={apply} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** What the picked activities need: quantity and productivity (and the duration they make), resources and crew, activity codes. */
export function ActivityPlanningPanel({ model, selectedId, onNote }: { model: ScheduleModel; selectedId: string | null; onNote: (text: string) => void }) {
  const run = useRun(model, onNote);
  const picked = usePicked(model, selectedId);
  const a = picked[0];
  const many = picked.length > 1;
  const ids = picked.map((x) => x.id);
  const catalog = model.resourceCatalog ?? [];
  const [resource, setResource] = useState('');
  const [units, setUnits] = useState('1');
  const [qty, setQty] = useState('');
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});
  useEffect(() => setValueDraft({}), [a?.id]);

  if (!a) return <div className="scn-dim plan-panel__empty">Pick an activity in the Planner to give it a quantity, a productivity, resources and codes.</div>;
  const prod = productivityOf(a);
  const perDay = hoursPerDayOfCalendar(model, a.calendarId);
  const crew = crewOf(a);
  const days = daysFromProductivity(a);
  const chosen = catalog.find((r) => r.id === resource);
  const crewType = chosen ? chosen.type === 'labor' || chosen.type === 'equipment' : true;
  const types = model.activityCodeCatalog ?? [];

  const setProd = (patch: Parameters<typeof setProductivity>[2]) => { for (const id of ids) if (!run(`Set productivity of ${model.activities.find((x) => x.id === id)?.code}`, (m) => setProductivity(m, id, patch))) break; };

  const fmt = (n: number) => Math.round(n * 100) / 100;
  const hasCrew = a.resources.some((r) => r.unitsPerTime);
  const own = a.resources.filter((r) => !r.virtual);

  return (
    <div className="pp">
      <header className="pp__head">
        {many ? <span className="pp__name">{picked.length} activities <span className="pp__code">(the first shown)</span></span> : <><span className="pp__code">{a.code}</span><span className="pp__name" title={a.name}>{a.name}</span></>}
      </header>

      <section className="pp__card">
        <h3 className="pp__title" title="The duration can follow the quantity: quantity ÷ (productivity × crew)">Quantity and duration</h3>
        <div className="pp__fields">
          <label className="pp__field"><span>Quantity</span>
            <NumberBox cls="pp__in" width="100%" label="Quantity" value={prod.quantity} onApply={(v) => setProd({ quantity: v })} />
          </label>
          <label className="pp__field"><span>Unit</span>
            <input className="pp__in" aria-label="Unit" placeholder="m3, m2…" defaultValue={prod.unit} key={`${a.id}:${prod.unit}`} onBlur={(e) => { if (e.target.value !== prod.unit) setProd({ unit: e.target.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </label>
          <label className="pp__field" title="Output per day for each person or machine of the crew"><span>Productivity / day</span>
            <NumberBox cls="pp__in" width="100%" label="Productivity per day" value={prod.perDay} onApply={(v) => setProd({ perDay: v })} />
          </label>
        </div>
        <div className="pp__result">
          <div><span className="pp__big">{fmt(a.durationHours / perDay)} d</span><span className="pp__dim"> duration</span></div>
          <div className="pp__dim">
            {hasCrew ? `Crew of ${crew}` : 'No crew: the activity as one'}
            {days !== null && ` · quantity ÷ productivity ÷ crew = ${fmt(days)} d`}
          </div>
        </div>
        <label className="pp__switch" title="The duration is made from the quantity, the productivity and the crew, and follows them when they change. Typing a duration in the Planner turns this off.">
          <input type="checkbox" checked={prod.driven} disabled={days === null && !prod.driven} onChange={(e) => setProd({ driven: e.target.checked })} />
          <span className="pp__track" aria-hidden="true" />
          Duration follows quantity and productivity
        </label>
      </section>

      <section className="pp__card">
        <h3 className="pp__title">Resources</h3>
        {own.length === 0 && <div className="pp__empty">None assigned yet.</div>}
        {own.map((r: ResourceAssignment) => {
          const crewR = r.resourceType === 'labor' || r.resourceType === 'equipment';
          const typeLabel = RESOURCE_TYPES.find((t) => t.id === r.resourceType)?.label ?? r.resourceType;
          return (
            <div key={r.resourceId} className="pp__res">
              <div className="pp__resname">
                <span className="pp__resttl" title={r.resourceName}>{r.resourceName}</span>
                <span className="pp__badge">{typeLabel}</span>
              </div>
              {crewR
                ? <><NumberBox cls="pp__in pp__in--sm" width={64} label={`${r.resourceName}: units at once`} value={r.unitsPerTime ?? 0} onApply={(v) => v !== null && run('Set the crew', (m) => setAssignment(m, a.id, r.resourceId, { units: v }))} /><span className="pp__dim pp__calc" title="Quantity: units × hours">× {a.durationHours} h = {Math.round(r.targetQty)}</span></>
                : <><NumberBox cls="pp__in pp__in--sm" width={84} label={`${r.resourceName}: quantity`} value={r.targetQty} onApply={(v) => v !== null && run('Set the quantity', (m) => setAssignment(m, a.id, r.resourceId, { qty: v }))} /><span className="pp__dim pp__calc">total</span></>}
              <button type="button" className="icon-btn" aria-label={`Take ${r.resourceName} off`} title="Take it off the picked activities" onClick={() => run('Unassign resource', (m) => unassignResource(m, ids, r.resourceId))}><IconRemove /></button>
            </div>
          );
        })}
        <div className="pp__add">
          <select className="pp__in" value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Resource to assign">
            <option value="">Add a resource…</option>
            {catalog.filter((r) => !r.virtual).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {crewType
            ? <input className="pp__in pp__in--sm" type="number" min={0} step="any" style={{ width: 64 }} value={units} onChange={(e) => setUnits(e.target.value)} aria-label="Units at once (crew size)" title="Units working at once: people or machines" />
            : <input className="pp__in pp__in--sm" type="number" min={0} step="any" style={{ width: 84 }} placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" />}
          <button type="button" className="btn btn--small" disabled={!resource} onClick={() => { const r = run('Assign resource', (m) => assignResource(m, ids, resource, crewType ? { units: num(units) ?? 1 } : { qty: num(qty) ?? 0 })); if (r) onNote(`Assigned ${chosen?.name} to ${(r as { assigned: number }).assigned} ${(r as { assigned: number }).assigned === 1 ? 'activity' : 'activities'}.`); }}>Assign{many ? ` to ${picked.length}` : ''}</button>
        </div>
        {catalog.length === 0 && <div className="pp__empty">No resources yet: add them in the Dictionary panel.</div>}
      </section>

      <section className="pp__card">
        <h3 className="pp__title">Activity codes</h3>
        {types.length === 0 && <div className="pp__empty">No code types yet: add them in the Dictionary panel.</div>}
        <div className="pp__codes">
          {types.map((t) => {
            const now = a.activityCodes[t.name] ?? '';
            const draft = valueDraft[t.name] ?? now;
            const listId = `plan-codes-${t.id}`;
            return (
              <label key={t.id} className="pp__field">
                <span title={t.name}>{t.name}</span>
                <input className="pp__in" list={listId} value={draft} placeholder="—" aria-label={t.name}
                  onChange={(e) => setValueDraft({ ...valueDraft, [t.name]: e.target.value })}
                  onBlur={() => { if (draft !== now) run(`Set ${t.name}`, (m) => assignCode(m, ids, t.name, draft.trim() === '' ? null : draft)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                <datalist id={listId}>{t.values.map((v) => <option key={v.id} value={v.value} />)}</datalist>
              </label>
            );
          })}
        </div>
        {many && types.length > 0 && <div className="pp__empty">A code typed here goes to all {picked.length} picked activities.</div>}
      </section>
    </div>
  );
}

/** The programme's resources and activity codes: add, rename, price, delete. */
export function DictionaryPanel({ model, onNote }: { model: ScheduleModel; onNote: (text: string) => void }) {
  const run = useRun(model, onNote);
  const resources = (model.resourceCatalog ?? []).filter((r) => !r.virtual);
  const types = model.activityCodeCatalog ?? [];
  const [name, setName] = useState('');
  const [type, setType] = useState<ResourceAssignment['resourceType']>('labor');
  const [typeName, setTypeName] = useState('');
  const [valueFor, setValueFor] = useState<Record<string, string>>({});
  const used = (id: string) => model.activities.filter((a) => a.resources.some((r) => r.resourceId === id)).length;
  // Type, Available and Cost / unit typed as a spreadsheet's: range, fill down (Ctrl+D, the corner square), copy and paste; one undo step.
  const grid = useEditableGrid({
    rows: resources,
    get: (col, r) => (col === 'type' ? r.type : col === 'capacity' ? (r.capacity === null || r.capacity === undefined ? '' : String(r.capacity)) : r.costPerUnit === undefined ? '' : String(r.costPerUnit)),
    write: (col, cells) => {
      run('Fill resources', (m) => {
        let cur = m;
        for (const [at, text] of cells) {
          const r = resources[at];
          const value = text.trim();
          let patch: Parameters<typeof updateResource>[2];
          if (col === 'type') {
            const t = RESOURCE_TYPES.find((x) => x.id === value || x.label.toLowerCase() === value.toLowerCase());
            if (!t) continue;
            patch = { type: t.id };
          } else if (col === 'capacity') patch = { capacity: value === '' ? null : Number(value.replace(',', '.')) };
          else patch = { costPerUnit: value === '' ? 0 : Number(value.replace(',', '.')) };
          if ((col !== 'type') && !Number.isFinite(Object.values(patch)[0] ?? 0)) continue;
          const res = updateResource(cur, r.id, patch);
          if ('error' in res) return res;
          cur = res.model;
        }
        return { model: cur };
      });
    },
  });

  return (
    <div className="plan-panel">
      <section className="plan-panel__sec">
        <div className="plan-panel__title">Resources</div>
        {resources.length > 0 && (
          <table className="plan-panel__table xgrid" {...grid.grid}>
            <thead><tr><th>Name</th><th>Type</th><th title="People or machines available at once (P6: max units per time)">Available</th><th title="Cost of one unit">Cost / unit</th><th /></tr></thead>
            <tbody>
              {resources.map((r, at) => (
                <tr key={r.id} data-line={at}>
                  <td><input className="plan-panel__text" defaultValue={r.name} key={`${r.id}:${r.name}`} aria-label="Resource name" onBlur={(e) => { if (e.target.value.trim() !== r.name) run('Rename resource', (m) => updateResource(m, r.id, { name: e.target.value })); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
                  <td className={`xgrid__cell${grid.sel('type', at)}`} data-col="type" data-row={at}>
                    <select value={r.type} aria-label="Type" onChange={(e) => run('Change the resource type', (m) => updateResource(m, r.id, { type: e.target.value as ResourceAssignment['resourceType'] }))}>
                      {RESOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    {grid.handle('type', at)}
                  </td>
                  <td className={`xgrid__cell${grid.sel('capacity', at)}`} data-col="capacity" data-row={at}><NumberBox label={`${r.name}: available`} value={r.capacity} onApply={(v) => run('Set the availability', (m) => updateResource(m, r.id, { capacity: v }))} width={60} />{grid.handle('capacity', at)}</td>
                  <td className={`xgrid__cell${grid.sel('cost', at)}`} data-col="cost" data-row={at}><NumberBox label={`${r.name}: cost per unit`} value={r.costPerUnit ?? null} onApply={(v) => run('Set the cost', (m) => updateResource(m, r.id, { costPerUnit: v ?? 0 }))} width={64} />{grid.handle('cost', at)}</td>
                  <td><button type="button" className="icon-btn" aria-label={`Delete ${r.name}`} title={used(r.id) ? `Delete it, and take it off ${used(r.id)} activities` : 'Delete it'} onClick={() => { if (used(r.id) && !window.confirm(`${r.name} is assigned to ${used(r.id)} activities. Delete it and take it off them?`)) return; run('Delete resource', (m) => deleteResource(m, r.id)); }}><IconRemove /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="plan-panel__row plan-panel__add" onSubmit={(e) => { e.preventDefault(); if (run('Add resource', (m) => addResource(m, { name, type, capacity: type === 'material' ? null : 1 }))) setName(''); }}>
          <input className="plan-panel__text" placeholder="New resource (e.g. Concrete gang)" value={name} onChange={(e) => setName(e.target.value)} aria-label="New resource name" />
          <select value={type} onChange={(e) => setType(e.target.value as ResourceAssignment['resourceType'])} aria-label="Type of the new resource">
            {RESOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="submit" className="btn btn--small" disabled={!name.trim()}>Add</button>
        </form>
      </section>

      <section className="plan-panel__sec">
        <div className="plan-panel__title">Activity codes</div>
        {types.map((t) => (
          <div key={t.id} className="plan-panel__codetype">
            <div className="plan-panel__row">
              <input className="plan-panel__text plan-panel__strong" defaultValue={t.name} key={`${t.id}:${t.name}`} aria-label="Code type" onBlur={(e) => { if (e.target.value.trim() !== t.name) run('Rename code type', (m) => renameCodeType(m, t.id, e.target.value)); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <button type="button" className="icon-btn" aria-label={`Delete ${t.name}`} title="Delete the type and its values (taken off the activities)" onClick={() => { if (window.confirm(`Delete the code type “${t.name}” with its ${t.values.length} values?`)) run('Delete code type', (m) => deleteCodeType(m, t.id)); }}><IconRemove /></button>
            </div>
            <div className="plan-panel__values">
              {t.values.map((v) => (
                <span key={v.id} className="plan-panel__chip">
                  <input defaultValue={v.value} key={`${v.id}:${v.value}`} aria-label={`${t.name} value`} size={Math.max(4, v.value.length)} onBlur={(e) => { if (e.target.value.trim() !== v.value) run('Rename code', (m) => renameCodeValue(m, t.id, v.id, e.target.value)); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  <button type="button" aria-label={`Delete ${v.value}`} onClick={() => run('Delete code', (m) => deleteCodeValue(m, t.id, v.id))}><IconRemove /></button>
                </span>
              ))}
              <form className="plan-panel__chip plan-panel__chip--add" onSubmit={(e) => { e.preventDefault(); if (run('Add code', (m) => addCodeValue(m, t.id, valueFor[t.id] ?? ''))) setValueFor({ ...valueFor, [t.id]: '' }); }}>
                <input placeholder="+ value" size={8} value={valueFor[t.id] ?? ''} onChange={(e) => setValueFor({ ...valueFor, [t.id]: e.target.value })} aria-label={`New value for ${t.name}`} />
              </form>
            </div>
          </div>
        ))}
        <form className="plan-panel__row plan-panel__add" onSubmit={(e) => { e.preventDefault(); if (run('Add code type', (m) => addCodeType(m, typeName))) setTypeName(''); }}>
          <input className="plan-panel__text" placeholder="New code type (e.g. Area, Trade, Phase)" value={typeName} onChange={(e) => setTypeName(e.target.value)} aria-label="New code type" />
          <button type="submit" className="btn btn--small" disabled={!typeName.trim()}>Add type</button>
        </form>
      </section>
    </div>
  );
}
