import { useMemo } from 'react';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { freshId, type RelType, type RuleSequence, type SequenceStep } from '../../../prs/rules';
import { STEPS_ID } from '../../../prs/recipesWorkbook';
import { IconRemove } from '../../icons';
import { useEditableGrid } from '../../useEditableGrid';
import { useRuleContext } from './RuleParts';

/** Other build orders as one spreadsheet: a line for each work item of each order, so no order needs a card of its own. The work breakdown (the STEPS order) is
    the Work breakdown tab and is not here. It is the scenario's own sequences (rules.sequences), changed in place: nothing new is saved. An order whose work
    items come from a folder of search sets (Models › Search sets) lists them too: the folder is chosen on its first line and its work items follow the folder,
    so only their per-level and link settings are changed here. */

const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? undefined : Number(v.replace(',', '.')));

interface Line { seq: number; k: number | null; first: boolean; s: RuleSequence; step: SequenceStep | null }

export function BuildOrders() {
  const ctx = useRuleContext();
  const { rules } = ctx;
  const sets = useSearchSetsStore((st) => st.sets);
  const folders = [...new Set(sets.map((x) => x.group ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const lines = useMemo<Line[]>(() => rules.sequences.flatMap((s, seq) => (s.id.toUpperCase() === STEPS_ID ? [] : s.steps.length === 0
    ? [{ seq, k: null, first: true, s, step: null }]
    : s.steps.map((step, k) => ({ seq, k, first: k === 0, s, step })))), [rules.sequences]);

  const setSeq = (seq: number, patch: (s: RuleSequence) => RuleSequence) => ctx.change((r) => ({ ...r, sequences: r.sequences.map((x, j) => (j === seq ? patch(x) : x)) }));
  const setStep = (l: Line, patch: Partial<SequenceStep>) => setSeq(l.seq, (s) => ({ ...s, steps: s.steps.map((x, j) => (j === l.k ? { ...x, ...patch } : x)) }));
  const clean = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);
  const addOrder = () => ctx.change((r) => ({ ...r, sequences: [...r.sequences, { id: freshId('ORDER', r.sequences.map((s) => s.id)), steps: [{ group: '' }, { group: '' }] }] }));
  const addStep = (l: Line) => setSeq(l.seq, (s) => ({ ...s, steps: [...s.steps, { group: '' }] }));
  const remove = (l: Line) => ctx.change((r) => ({
    ...r,
    sequences: r.sequences.flatMap((x, j) => (j !== l.seq ? [x] : l.k === null || x.steps.length <= 1 ? [] : [{ ...x, steps: x.steps.filter((_, n) => n !== l.k) }])),
  }));

  const grid = useEditableGrid({ widthsKey: 'buildOrders',
    rows: lines,
    get: (col, l) => (col === 'id' ? l.s.id : col === 'group' ? l.step?.group ?? '' : col === 'lag' ? String(l.step?.lagHours ?? l.s.lagHours ?? '') : ''),
    write: (col, cells) => {
      let sequences = rules.sequences;
      for (const [at, text] of cells) {
        const l = lines[at];
        if (!l) continue;
        if (col === 'id' && l.first && text.trim()) sequences = sequences.map((x, j) => (j === l.seq ? { ...x, id: text.trim() } : x));
        else if (col === 'group' && l.k !== null && !l.s.stepsFolder) sequences = sequences.map((x, j) => (j === l.seq ? { ...x, steps: x.steps.map((st, n) => (n === l.k ? { ...st, group: text.trim() } : st)) } : x));
        else if (col === 'lag' && l.k !== null) sequences = sequences.map((x, j) => (j === l.seq ? { ...x, steps: x.steps.map((st, n) => (n === l.k ? { ...st, lagHours: num(text) } : st)) } : x));
      }
      ctx.change((r) => ({ ...r, sequences }));
    },
  });

  return (
    <div>
      {lines.length === 0 ? <div className="scn-dim scn-editor__help">None: the Work breakdown tab is the only order.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 160 }} /><col style={{ width: 170 }} /><col style={{ width: 40 }} /><col style={{ width: 260 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} /><col style={{ width: 90 }} /><col style={{ width: 60 }} /></colgroup>
          <thead><tr>
            <th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this build order" />
            <th title="The build order">Build order</th>
            <th title="Each search set of a folder is a work item, in the folder's order. Add, remove or reorder the sets in Models › Search sets and the order follows. None: the work items are written here">Work items from</th>
            <th title="The place of the work item in the order">#</th>
            <th title="The search set built in this work item">Work item</th>
            <th title="Built level by level, or once for the whole building">Per level</th>
            <th title="How it follows the work item above (default: finish to start)">Link</th>
            <th title="Lag into it, in working hours (8 h = 1 day)">Lag (h)</th>
            <th aria-label="Add or delete" />
          </tr></thead>
          <tbody>
            {lines.map((l, at) => {
              const folder = l.s.stepsFolder;
              return (
                <tr key={`${l.seq}|${l.k}`} data-line={at} className={l.s.enabled === false ? 'is-off' : l.first && at > 0 ? 'is-group-start' : ''}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__check">{l.first && <input type="checkbox" checked={l.s.enabled !== false} aria-label="On" onChange={(e) => setSeq(l.seq, (s) => ({ ...s, enabled: e.target.checked ? undefined : false }))} />}</td>
                  {l.first
                    ? <td className={`xl__cell xgrid__cell${grid.sel('id', at)}`} data-col="id" data-row={at}><input {...grid.cell('id', at)} value={l.s.id} spellCheck={false} onChange={(e) => setSeq(l.seq, (s) => ({ ...s, id: e.target.value }))} />{grid.handle('id', at)}</td>
                    : <td className="xl__cell xl__ro"><span className="scn-dim">{l.s.id}</span></td>}
                  {l.first
                    ? <td className="xl__cell"><select value={l.s.stepsFolder ?? ''} aria-label="Work items from a folder of search sets" onChange={(e) => setSeq(l.seq, (x) => ({ ...x, stepsFolder: e.target.value || undefined }))}><option value="">None: written here</option>{folder && !folders.includes(folder) && <option value={folder}>{folder} (not found)</option>}{folders.map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                    : <td className="xl__cell xl__ro" />}
                  <td className="xl__cell xl__num xl__ro">{l.k === null ? '' : l.k + 1}</td>
                  {l.step
                    ? <td className={`xl__cell xgrid__cell${grid.sel('group', at)}`} data-col="group" data-row={at}><input {...grid.cell('group', at)} list="build-order-groups" value={l.step.group} placeholder="a search set" spellCheck={false} readOnly={!!folder} title={folder ? `From the folder “${folder}”: change it in Models › Search sets` : undefined} onChange={(e) => setStep(l, { group: e.target.value })} />{grid.handle('group', at)}</td>
                    : <td className="xl__cell xl__ro" colSpan={4}>No work items</td>}
                  {l.step && <>
                    <td className="xl__check"><button type="button" className={`btn btn--small${l.step.perLevel ? ' primary' : ''}`} aria-pressed={!!l.step.perLevel} onClick={() => setStep(l, { perLevel: l.step!.perLevel ? undefined : true })} title={l.step.perLevel ? 'Built level by level. Click to build it once' : 'Built once. Click to build it level by level'}>{l.step.perLevel ? 'per level' : 'once'}</button></td>
                    <td className="xl__cell"><select value={l.step.type ?? l.s.type ?? 'FS'} aria-label="Link" disabled={l.k === 0} onChange={(e) => setStep(l, { type: e.target.value === 'FS' ? undefined : (e.target.value as RelType) })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                    {l.k === 0 ? <td className="xl__cell xl__ro" /> : <td className={`xl__cell xl__num xgrid__cell${grid.sel('lag', at)}`} data-col="lag" data-row={at}><input {...grid.cell('lag', at)} type="text" inputMode="decimal" value={l.step.lagHours ?? l.s.lagHours ?? ''} onChange={(e) => setStep(l, { lagHours: clean(e.target.value) === undefined ? undefined : num(e.target.value) })} />{grid.handle('lag', at)}</td>}
                  </>}
                  <td className="xl__check">
                    {l.k !== null && !folder && <button type="button" className="cols__icon" aria-label="Add a work item" title="Add another work item to this order" onClick={() => addStep(l)}>+</button>}
                    {(!folder || l.first) && <button type="button" className="cols__icon cols__icon--remove" aria-label="Delete" title={folder ? 'Delete the build order' : l.k === null || l.s.steps.length <= 1 ? 'Delete the build order' : 'Delete this work item from the order'} onClick={() => (folder ? ctx.change((r) => ({ ...r, sequences: r.sequences.filter((_, j) => j !== l.seq) })) : remove(l))}><IconRemove /></button>}
                  </td>
                </tr>
              );
            })}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={9}><button type="button" onClick={addOrder}>+ Add a build order</button></td></tr>
          </tbody>
        </table>
      )}
      <datalist id="build-order-groups">{ctx.groupIds.map((g) => <option key={g} value={g} />)}</datalist>
    </div>
  );
}

/** The section of the Work breakdown tab: its heading, what it is for, Add, and the table. */
export function BuildOrdersSection() {
  const ctx = useRuleContext();
  return (
    <section className="rules-sec gen-order__orders" id="rules-order">
      <div className="rules-sec__head"><h3 className="gen-sec">Other build orders</h3><div className="rules-sec__add"><button type="button" className="btn btn--small" onClick={() => addBuildOrder(ctx.change)}>+ Build order</button></div></div>
      <div className="scn-dim seq__explain"><p>Groups put in a set order, level by level. The list above is your main order: use this only for another order that has to hold as well.</p></div>
      <BuildOrders />
    </section>
  );
}

/** What a heading needs to add an order. */
export const addBuildOrder = (change: ReturnType<typeof useRuleContext>['change']) => change((r) => ({ ...r, sequences: [...r.sequences, { id: freshId('ORDER', r.sequences.map((s) => s.id)), steps: [{ group: '' }, { group: '' }] }] }));
