import { useEffect, useMemo, useState } from 'react';
import { IconRemove } from '../icons';
import { useEditableGrid } from '../useEditableGrid';
import type { Activity, ResourceAssignment, ScheduleModel } from '../../schedule/types';
import type { Result } from '../../schedule/programmeCommands';
import { addResource, assignResource, crewOf, daysFromFormula, daysFromProductivity, deleteResource, formulaOf, productivityOf, setDurationFormula, RESOURCE_TYPES, setAssignment, setProductivity, unassignResource, updateResource } from '../../schedule/planResources';
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
  const formula = formulaOf(a);
  const formulaDays = daysFromFormula(model, a);
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
        <label className="pp__field" title="A duration written as a formula, in working days: qty (quantity), rate (productivity per day), crews (the crew working at once, the primary crew when one is marked), hours_per_day, udf_<Name> (a number user field). Functions: ceil, floor, round, min, max, abs, sqrt. It follows the quantity, productivity and crew when they change; typing a duration in the Planner takes it off.">
          <span>Duration formula</span>
          <input
            className="pp__in"
            aria-label="Duration formula"
            placeholder="ceil(qty / (rate * crews))"
            defaultValue={formula}
            key={`${a.id}:${formula}`}
            spellCheck={false}
            onBlur={(e) => { const text = e.target.value.trim(); if (text !== formula) run('Set the duration formula', (m) => setDurationFormula(m, ids, text)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </label>
        {formula && formulaDays && (
          <div className="pp__dim">{'value' in formulaDays ? `= ${fmt(formulaDays.value)} d` : formulaDays.error}</div>
        )}
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
              {crewR && <button type="button" className={`pp__primary${r.primary ? ' is-on' : ''}`} aria-pressed={!!r.primary} aria-label={`${r.resourceName}: primary crew`} title={r.primary ? 'Primary crew: the duration follows this crew alone. Click to take it off.' : 'Make this the primary crew: the duration follows it, not the total of all crews.'} onClick={() => run('Primary crew', (m) => setAssignment(m, a.id, r.resourceId, { primary: !r.primary }))}>{r.primary ? '★' : '☆'}</button>}
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

/** A cell of a sheet: its text is kept while it is typed in and applied when the cell loses focus or Enter is pressed (one undoable edit, not one per key). */
function SheetCell({ value, onApply, label, bad, placeholder, className, cell }: { value: string; onApply: (text: string) => void; label: string; bad?: string; placeholder?: string; className?: string; cell: Record<string, string | number> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input {...cell} className={className} value={draft} placeholder={placeholder} spellCheck={false} aria-label={label} title={bad} aria-invalid={!!bad}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onApply(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); } }} />
  );
}

const numberText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000));

/** The programme's resources and activity codes, as two sheets: typed in like Excel (click a cell, arrows and Tab move, Ctrl+D or the corner square fills down,
    copy and paste ranges to and from Excel). Resources: a row each. Activity codes: a column for each code type, its values down the column. */
export function DictionaryPanel({ model, onNote }: { model: ScheduleModel; onNote: (text: string) => void }) {
  const run = useRun(model, onNote);
  const resources = (model.resourceCatalog ?? []).filter((r) => !r.virtual);
  const types = model.activityCodeCatalog ?? [];
  const [newName, setNewName] = useState('');
  const used = (id: string) => model.activities.filter((a) => a.resources.some((r) => r.resourceId === id)).length;
  const typeOf = (text: string) => RESOURCE_TYPES.find((x) => x.id === text.trim() || x.label.toLowerCase() === text.trim().toLowerCase());

  // ---- Resources
  const resourceText = (col: string, r: (typeof resources)[number]) => (col === 'name' ? r.name : col === 'type' ? r.type : col === 'capacity' ? numberText(r.capacity) : numberText(r.costPerUnit));
  const writeResources = (col: string, cells: [number, string][]) => {
    run('Fill resources', (m) => {
      let cur = m;
      for (const [at, text] of cells) {
        const r = resources[at];
        if (!r) continue;
        const value = text.trim();
        let patch: Parameters<typeof updateResource>[2];
        if (col === 'name') { if (!value) continue; patch = { name: value }; }
        else if (col === 'type') { const t = typeOf(value); if (!t) continue; patch = { type: t.id }; }
        else {
          const n = value === '' ? null : Number(value.replace(',', '.'));
          if (n !== null && !Number.isFinite(n)) continue;
          patch = col === 'capacity' ? { capacity: n } : { costPerUnit: n ?? 0 };
        }
        const res = updateResource(cur, r.id, patch);
        if ('error' in res) return res;
        cur = res.model;
      }
      return { model: cur };
    });
  };
  const rGrid = useEditableGrid({ widthsKey: 'planning.dictionary.resources', rows: resources, get: resourceText, write: writeResources });
  const addNamed = () => {
    const name = newName.trim();
    if (!name) return;
    if (run('Add resource', (m) => addResource(m, { name, type: 'labor', capacity: 1 }))) setNewName('');
  };

  // ---- Activity codes: one column per type, its values down the column (a blank row at the bottom of each adds a value)
  const rows = Math.max(0, ...types.map((t) => t.values.length)) + 1;
  const cRows = Array.from({ length: rows }, (_, i) => i);
  const writeCodes = (typeId: string, cells: [number, string][]) => {
    run('Fill codes', (m) => {
      const t = (m.activityCodeCatalog ?? []).find((x) => x.id === typeId);
      if (!t) return { error: 'That code type is not there any more.' };
      const values = t.values;
      let cur = m;
      const removals: string[] = [];
      const additions: string[] = [];
      for (const [at, text] of cells) {
        const value = text.trim();
        const old = values[at];
        if (old) {
          if (!value) removals.push(old.id);
          else if (value !== old.value) { const res = renameCodeValue(cur, typeId, old.id, value); if ('error' in res) return res; cur = res.model; }
        } else if (value && !additions.includes(value)) additions.push(value);
      }
      for (const v of additions) { const res = addCodeValue(cur, typeId, v); if ('error' in res) return res; cur = res.model; }
      for (const id of removals) { const res = deleteCodeValue(cur, typeId, id); if ('error' in res) return res; cur = res.model; }
      return { model: cur };
    });
  };
  const cGrid = useEditableGrid({
    widthsKey: 'planning.dictionary.codes',
    rows: cRows,
    get: (col, i) => types.find((t) => t.id === col)?.values[i]?.value ?? '',
    write: writeCodes,
  });
  const addType = () => {
    let n = types.length + 1;
    while (types.some((t) => t.name.toLowerCase() === `code type ${n}`)) n++;
    run('Add code type', (m) => addCodeType(m, `Code type ${n}`));
  };

  return (
    <div className="plan-panel">
      <section className="plan-panel__sec">
        <div className="plan-panel__title">Resources</div>
        <div className="rel-bar">
          <span className="scn-dim">What an activity can be given: people, machines or a material quantity. Available is how many can work at once (leave it empty for a material).</span>
        </div>
        <table className="xl xgrid" {...rGrid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 190 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 50 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>Name</th><th>Type</th><th title="People or machines available at once (P6: max units per time)">Available</th><th title="Cost of one unit">Cost / unit</th><th title="How many activities use it">Used</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {resources.map((r, at) => (
              <tr key={r.id} data-line={at}>
                <th className="xl__row" scope="row">{at + 1}</th>
                <td className={`xl__cell xgrid__cell${rGrid.sel('name', at)}`} data-col="name" data-row={at}><SheetCell cell={rGrid.cell('name', at)} value={r.name} label="Resource name" onApply={(t) => writeResources('name', [[at, t]])} />{rGrid.handle('name', at)}</td>
                <td className={`xl__cell xgrid__cell${rGrid.sel('type', at)}`} data-col="type" data-row={at}>
                  <select {...rGrid.cell('type', at)} value={r.type} aria-label="Type" onChange={(e) => writeResources('type', [[at, e.target.value]])}>
                    {RESOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  {rGrid.handle('type', at)}
                </td>
                <td className={`xl__cell xl__num xgrid__cell${rGrid.sel('capacity', at)}`} data-col="capacity" data-row={at}><SheetCell cell={rGrid.cell('capacity', at)} value={numberText(r.capacity)} label={`${r.name}: available`} onApply={(t) => writeResources('capacity', [[at, t]])} />{rGrid.handle('capacity', at)}</td>
                <td className={`xl__cell xl__num xgrid__cell${rGrid.sel('cost', at)}`} data-col="cost" data-row={at}><SheetCell cell={rGrid.cell('cost', at)} value={numberText(r.costPerUnit)} label={`${r.name}: cost per unit`} onApply={(t) => writeResources('cost', [[at, t]])} />{rGrid.handle('cost', at)}</td>
                <td className="xl__num scn-dim">{used(r.id) || ''}</td>
                <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" aria-label={`Delete ${r.name}`} title={used(r.id) ? `Delete it, and take it off ${used(r.id)} activities` : 'Delete it'} onClick={() => { if (used(r.id) && !window.confirm(`${r.name} is assigned to ${used(r.id)} activities. Delete it and take it off them?`)) return; run('Delete resource', (m) => deleteResource(m, r.id)); }}><IconRemove /></button></td>
              </tr>
            ))}
            <tr className="xl__add">
              <th className="xl__row">*</th>
              <td colSpan={6}><input className="plan-panel__text" placeholder="New resource: type a name and press Enter (e.g. Concrete gang)" value={newName} aria-label="New resource name" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNamed(); }} onBlur={addNamed} /></td>
            </tr>
          </tbody>
        </table>
        <div className="scn-dim plan-panel__foot">A new resource is Labour with 1 available: change its type and number in the row.</div>
      </section>

      <section className="plan-panel__sec">
        <div className="plan-panel__title">Activity codes</div>
        <div className="rel-bar">
          <button type="button" className="btn btn--small primary" onClick={addType}>+ Code type</button>
          <span className="scn-dim">One column for each code type (Area, Trade, Phase…), its values down the column. Type in the empty cell at the bottom to add a value; empty a cell to delete the value. Rename a type in its heading.</span>
        </div>
        {types.length === 0 ? <div className="scn-dim scn-editor__help">None yet: add a code type, then its values.</div> : (
          <div className="plan-panel__scroll">
            <table className="xl xgrid" {...cGrid.grid}>
              <colgroup><col style={{ width: 40 }} />{types.map((t) => <col key={t.id} style={{ width: 150 }} />)}</colgroup>
              <thead>
                <tr>
                  <th className="xl__corner" aria-label="Row" />
                  {types.map((t) => (
                    <th key={t.id} title={`${t.values.length} values`}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <SheetCell cell={{}} className="plan-panel__strong" value={t.name} label="Code type" onApply={(text) => { if (text.trim()) run('Rename code type', (m) => renameCodeType(m, t.id, text)); }} />
                        <button type="button" className="cols__icon cols__icon--remove" aria-label={`Delete ${t.name}`} title="Delete the type and its values (taken off the activities)" onClick={() => { if (window.confirm(`Delete the code type “${t.name}” with its ${t.values.length} values?`)) run('Delete code type', (m) => deleteCodeType(m, t.id)); }}><IconRemove /></button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cRows.map((i) => (
                  <tr key={i} data-line={i} className={i === rows - 1 ? 'xl__add' : undefined}>
                    <th className="xl__row" scope="row">{i === rows - 1 ? '*' : i + 1}</th>
                    {types.map((t) => (
                      <td key={t.id} className={`xl__cell xgrid__cell${cGrid.sel(t.id, i)}`} data-col={t.id} data-row={i}>
                        <SheetCell cell={cGrid.cell(t.id, i)} value={t.values[i]?.value ?? ''} label={`${t.name} value ${i + 1}`} placeholder={i === rows - 1 ? '+ value' : undefined} onApply={(text) => writeCodes(t.id, [[i, text]])} />
                        {cGrid.handle(t.id, i)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
