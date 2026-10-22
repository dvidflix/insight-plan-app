import { Fragment, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { setExtras, updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { STEPS_ID } from '../../../prs/recipesWorkbook';
import type { RelType, SequenceStep } from '../../../prs/rules';
import { IconChevronDown, IconChevronRight, IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';
import { GroupPicker } from './GroupPicker';
import { ResourceCheck, StepRecipe } from './StepRecipes';
import { useStepFocus } from '../../../state/resourceFocusStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { useIndexTick } from '../../modelFields';
import { guidsOfSet, pourRowsOfGroup } from '../../../scenarios/stepPours';
import { readExtrasWorkbook, writeExtrasWorkbook } from '../../../prs/extrasWorkbookFile';
import { applyExtraRow, applyLevelTaskRow, extraRows, levelTaskRows, mergeExtras, newExtra, type ExtraRow, type ExtraScope, type LevelTaskRow } from '../../../prs/sequenceRows';

/** The Order tab's sequence, as one list: on the left the locations the model has (building, then level, with the number of pours), on the right the
    steps in the order they are built. Drag a step to move it, flip "per level" / "once", and open a step to see the recipe it will generate and the
    resources it uses. The same steps (rules.sequences, "Steps") as the Steps table of the workbook: nothing is kept twice. */

const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const LINK_WORDS: Record<RelType, string> = { FS: 'starts when it has finished', SS: 'starts when it starts', FF: 'finishes when it finishes', SF: 'finishes when it starts' };

const SCOPES: { value: ExtraScope; label: string; tip: string }[] = [
  { value: 'once', label: 'Once', tip: 'In the Extra activities folder of the WBS' },
  { value: 'level', label: 'On its level', tip: "On its building's level, beside that level's other groups" },
  { value: 'slabs', label: 'In Slabs', tip: "In the level's Slabs group" },
  { value: 'folder', label: 'Own folder', tip: "A folder of its own under the building's Construction node" },
];

const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? 0 : Number(v.replace(',', '.')));

/** The pours of a group: those of the pour table in the rule group or search set of that name. */
function useGroupRows(group: string) {
  const rows = useScenarioStore((s) => s.rows);
  const ctx = useRuleContext();
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  return useMemo(() => (group.trim() ? pourRowsOfGroup(group, rows, ctx.membership, sets, (set) => guidsOfSet(engine.getIndexes(), set)) : []), [rows, ctx.membership, sets, group, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Which steps had their Pours section open, by group name, for the session (the section is rebuilt each time its step is opened). */
const poursOpen = new Map<string, boolean>();

/** The steps that are open, for the session: by group name (a step with no group yet, by its place). */
const openSteps = new Set<string>();
const stepKey = (group: string, i: number) => (group.trim() ? group.trim().toUpperCase() : `#${i}`);

/** The pours of a step (the pour table is the model's own: nothing is assumed of its columns). */
function PoursOf({ group }: { group: string }) {
  const loaded = useScenarioStore((s) => s.loaded);
  const ctx = useRuleContext();
  const mine = useGroupRows(group);
  const [show, setShow] = useState(() => poursOpen.get(group.trim().toUpperCase()) === true);
  // What the search set of that name finds in the loaded models, apart from the order table: an empty list can then say why.
  const sets = useSearchSetsStore((st) => st.sets);
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const named = useMemo(() => sets.filter((x) => x.name.trim().toUpperCase() === group.trim().toUpperCase()), [sets, group]);
  const found = useMemo(() => named.reduce((n, x) => n + guidsOfSet(engine.getIndexes(), x).size, 0), [named, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // More than one type of object in the set: they all get this step's recipe (a recipe belongs to the group), so say so, and do not stop anything.
  const types = useMemo(() => {
    const keys = new Set(mine.map((r) => r.key));
    return [...new Set(ctx.facts.filter((f) => keys.has(f.key)).map((f) => f.type.replace(/_/g, ' ').trim()).filter(Boolean))];
  }, [mine, ctx.facts]);
  // The pour's own name: the column the rest of the app names it by, else the first column that has a name.
  const idCol = loaded ? ['PlanningProposedPourID', 'Pour ID'].map((h) => loaded.headers.indexOf(h)).find((i) => i >= 0) ?? loaded.headers.findIndex((h) => h.trim() !== '') : -1;
  const why = named.length === 0
    ? `There is no search set called “${group}”: it may have been renamed or deleted. Choose another in the step above.`
    : found > 0
      ? `“${group}” finds ${found.toLocaleString()} object${found === 1 ? '' : 's'} in the model, but none of them is in the order table. The order table holds the objects the generator builds activities for: other kinds of object are not generated.`
      : `No objects match the search set “${group}” in the loaded model: check its conditions in Models › Search sets, or load the model it is for.`;
  return (
    <>
      {types.length > 1 && <div className="scn-status scn-status--warn seq__warn" role="status">This set holds more than one type of object ({types.join(', ')}). They all get this step’s recipe: split the set if they should be built differently.</div>}
      <details className="seq__pours" open={show} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setShow(open); poursOpen.set(group.trim().toUpperCase(), open); }}>
        <summary title="The objects of this step that the generator builds activities for">Objects in this step ({mine.length.toLocaleString()})</summary>
        {mine.length === 0 ? <div className="scn-dim scn-editor__help">{why}</div> : (
          <table className="xl">
            <thead><tr><th>Object</th></tr></thead>
            <tbody>{mine.slice(0, 50).map((r) => <tr key={r.key}><td className="xl__cell xl__ro">{idCol >= 0 ? r.cells[idCol] : r.key}</td></tr>)}</tbody>
          </table>
        )}
        {mine.length > 50 && <div className="scn-dim xl__note">and {mine.length - 50} more: the Objects tab under Advanced lists them all</div>}
      </details>
    </>
  );
}

/** Extra activities, as a spreadsheet (like Parameters): ID, name, days, where in the WBS, building, level, folder and the baseline dates. They have
    no pours; where they sit in the programme is set by their dates and links, not by their place in a list, so there is nothing to drag. */
function ExtrasGrid({ ctx }: { ctx: ReturnType<typeof useRuleContext> }) {
  const extras = useScenarioStore((s) => s.extras);
  const startDate = useScenarioStore((s) => s.startDate);
  const tags = ctx.rules.extraTags;
  const rows = extraRows(extras, tags);
  const showFolder = rows.some((x) => x.scope === 'folder');
  const [freshPath, setFreshPath] = useState<string | null>(null);
  useEffect(() => {
    if (!freshPath) return;
    const el = document.querySelector<HTMLInputElement>(`input[data-extra-path="${CSS.escape(freshPath)}"]`);
    if (!el) return;
    el.focus();
    setFreshPath(null);
  }, [freshPath, extras]);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (!fresh) return;
    const el = document.querySelector<HTMLInputElement>(`input[data-extra-name="${CSS.escape(fresh)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
    el.select();
    setFresh(null);
  }, [fresh, extras]);

  /** Edited rows written back, all at once (one change for a fill or a paste). */
  const saveRows = (list: { was: string; row: ExtraRow }[]) => {
    let nextExtras = extras;
    let nextTags = tags;
    for (const { was, row } of list) ({ extras: nextExtras, tags: nextTags } = applyExtraRow(nextExtras, nextTags, was, row));
    setExtras(nextExtras);
    ctx.change((r) => ({ ...r, extraTags: nextTags }));
  };
  const patch = (x: ExtraRow, p: Partial<ExtraRow>) => saveRows([{ was: x.id, row: { ...x, ...p } }]);
  const FIELD: Record<string, (x: ExtraRow, t: string) => ExtraRow> = {
    id: (x, t) => ({ ...x, id: t.trim() }), name: (x, t) => ({ ...x, name: t }), days: (x, t) => ({ ...x, days: num(t) }),
    building: (x, t) => ({ ...x, building: t }), level: (x, t) => ({ ...x, level: t }), path: (x, t) => ({ ...x, path: t }), start: (x, t) => ({ ...x, start: t.trim() }), finish: (x, t) => ({ ...x, finish: t.trim() }),
  };
  const grid = useEditableGrid({ widthsKey: 'sequence.extras',
    rows,
    get: (col, x) => (col === 'days' ? String(x.days) : String((x as unknown as Record<string, string>)[col] ?? '')),
    write: (col, cells) => { const f = FIELD[col]; if (f) saveRows(cells.map(([at, text]) => ({ was: rows[at].id, row: f(rows[at], text) }))); },
  });
  const add = () => { const x = newExtra(extras, startDate); setExtras([...extras, x]); setFresh(x.TaskID); };
  // Excel: the table as a workbook, and a workbook back (a row with an ID that is there replaces it).
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = async (file: File) => {
    try {
      const incoming = await readExtrasWorkbook(file);
      const out = mergeExtras(extras, tags, incoming);
      setExtras(out.extras);
      ctx.change((r) => ({ ...r, extraTags: out.tags }));
      const replaced = incoming.extras.filter((e) => extras.some((x) => x.TaskID.toUpperCase() === e.TaskID.toUpperCase())).length;
      setNote({ ok: true, text: `Read ${incoming.extras.length} extra activit${incoming.extras.length === 1 ? 'y' : 'ies'} from ${file.name}: ${incoming.extras.length - replaced} added, ${replaced} replaced. Save the scenario, then Update 4D.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const remove = (x: ExtraRow) => {
    setExtras(extras.filter((e) => e.TaskID !== x.id));
    ctx.change((r) => { const next = { ...r.extraTags }; delete next[x.id]; return { ...r, extraTags: next }; });
  };
  const text = (x: ExtraRow, col: keyof typeof FIELD, at: number, cls = '', props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <td className={`xl__cell${cls} xgrid__cell${grid.sel(col, at)}`} data-col={col} data-row={at}>
      <input {...grid.cell(col, at)} {...(col === 'name' ? { 'data-extra-name': x.id } : col === 'path' ? { 'data-extra-path': x.id } : {})} value={col === 'days' ? x.days : String((x as unknown as Record<string, string>)[col] ?? '')} spellCheck={false} {...props}
        onChange={(e) => patch(x, FIELD[col](x, e.target.value) as Partial<ExtraRow>)} />{grid.handle(col, at)}
    </td>
  );
  return (
    <div>
      <div className="rel-bar">
        <button type="button" className="btn btn--small primary" onClick={add} title="Add an activity that is not built from the model (it is not built from model objects). It starts on the scenario's start date: change its dates and WBS place in the row">+ Extra</button>
        <button type="button" className="btn btn--small" disabled={rows.length === 0} onClick={() => writeExtrasWorkbook(extras, tags, 'extra-activities.xlsx')} title="Download the extra activities as an Excel file: edit it there and upload it again">Download Excel</button>
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()} title="Upload an Excel file made with Download Excel: a row with an ID that is here replaces it, the others are added">Upload Excel</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
        <span className="scn-dim">Activities added to the generated programme. They are not built from model objects: their dates, links and WBS place put them in it.</span>
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      {rows.length === 0 ? <div className="scn-dim scn-editor__help">None yet. An extra activity is not built from the model: add one with + Extra.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 190 }} /><col style={{ width: 280 }} /><col style={{ width: 70 }} /><col style={{ width: 130 }} /><col style={{ width: 90 }} /><col style={{ width: 70 }} />{showFolder && <col style={{ width: 200 }} />}<col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>ID</th><th>Name</th><th title="Working days">Days</th><th title="Where it goes in the WBS">WBS place</th><th>Building</th><th>Level</th>{showFolder && <th title="The WBS folder of the activities whose WBS place is Own folder, under the building's Construction node, e.g. Temporary / Hoarding">WBS folder</th>}<th>Start</th><th>Finish</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map((x, at) => (
              <tr key={x.id} data-line={at}>
                <th className="xl__row" scope="row">{at + 1}</th>
                {text(x, 'id', at)}
                {text(x, 'name', at)}
                {text(x, 'days', at, ' xl__num', { type: 'text', inputMode: 'decimal' })}
                <td className="xl__cell">
                  <select value={x.scope} aria-label="WBS place" title="Where it goes in the WBS" onChange={(e) => { patch(x, { scope: e.target.value as ExtraScope }); if (e.target.value === 'folder') setFreshPath(x.id); }}>
                    {SCOPES.map((o) => <option key={o.value} value={o.value} title={o.tip}>{o.label}</option>)}
                  </select>
                </td>
                {text(x, 'building', at)}
                {text(x, 'level', at)}
                {showFolder && text(x, 'path', at, '', { disabled: x.scope !== 'folder', placeholder: x.scope === 'folder' ? 'A / B' : '', title: x.scope === 'folder' ? 'The WBS folder of this activity' : 'Only for the WBS place Own folder' })}
                {text(x, 'start', at, '', { placeholder: 'yyyy-mm-dd' })}
                {text(x, 'finish', at, '', { placeholder: 'yyyy-mm-dd' })}
                <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" aria-label="Delete" title="Delete the extra activity" onClick={() => remove(x)}><IconRemove /></button></td>
              </tr>
            ))}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={showFolder ? 10 : 9}><button type="button" onClick={add}>+ Add an extra activity</button></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Level tasks, as a spreadsheet: one task per building and level, from the first to the last object of its group. */
function LevelTasksGrid({ ctx }: { ctx: ReturnType<typeof useRuleContext> }) {
  const rows = levelTaskRows(ctx.rules.levelTasks);
  const save = (list: LevelTaskRow[]) => ctx.change((r) => ({ ...r, levelTasks: list.reduce((tasks, row) => applyLevelTaskRow(tasks, row), r.levelTasks) }));
  const grid = useEditableGrid({ widthsKey: 'sequence.levelTasks',
    rows,
    get: (col, t) => (col === 'group' ? t.group : t.name),
    write: (col, cells) => save(cells.map(([at, text]) => (col === 'group' ? { ...rows[at], group: text } : { ...rows[at], name: text }))),
  });
  const add = () => ctx.change((r) => {
    let n = r.levelTasks.length + 1;
    while (r.levelTasks.some((t) => t.id.toUpperCase() === `LT-${n}`)) n++;
    return { ...r, levelTasks: [...r.levelTasks, { id: `LT-${n}`, name: 'New level task', group: '' }] };
  });
  const remove = (id: string) => ctx.change((r) => ({ ...r, levelTasks: r.levelTasks.filter((t) => t.id !== id) }));

  // What each level task will make: one task for every building and level that has objects of its group.
  const pourRows = useScenarioStore((s) => s.rows);
  const loaded = useScenarioStore((s) => s.loaded);
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  const made = useMemo(() => {
    const b = loaded ? loaded.headers.indexOf('Building') : -1;
    const l = loaded ? loaded.headers.indexOf('Level') : -1;
    const indexes = engine.getIndexes();
    return new Map(rows.map((t) => {
      const mine = pourRowsOfGroup(t.group, pourRows, ctx.membership, sets, (set) => guidsOfSet(indexes, set));
      const places = new Set(mine.map((r) => `${b >= 0 ? r.cells[b] : ''}|${l >= 0 ? r.cells[l] : ''}`));
      return [t.id, { pours: mine.length, tasks: b >= 0 || l >= 0 ? places.size : 0 }];
    }));
  }, [rows.map((t) => t.group).join('|'), pourRows, ctx.membership, sets, loaded, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="rel-bar">
        <button type="button" className="btn btn--small primary" onClick={add} title="Add a level task: pick the group of objects it spans">+ Level task</button>
      </div>
      <div className="scn-dim seq__explain">
        <p><strong>What is a level task?</strong> A summary bar for each building and level. It starts with the first object of its group on that level and finishes with the last one. Other activities (an extra activity, a link) can then be tied to that whole level of the group at once.</p>
        <p><strong>Group:</strong> the objects it spans: one of your search sets (made in Models › Search sets).</p>
      </div>
      {rows.length === 0 ? <div className="scn-dim scn-editor__help">No level tasks yet. You only need them to tie something to a whole level; most programmes need none.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 220 }} /><col style={{ width: 280 }} /><col style={{ width: 300 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this level task" /><th title="The name of the task on each level">Name</th><th title="The pours it spans: a search set or a rule group">Group of pours</th><th title="What it will make from the loaded model">It makes</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map((t, at) => {
              const m = made.get(t.id) ?? { pours: 0, tasks: 0 };
              return (
                <tr key={t.id} data-line={at} className={t.enabled ? '' : 'is-off'}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__check"><input type="checkbox" checked={t.enabled} aria-label="On" onChange={(e) => save([{ ...t, enabled: e.target.checked }])} /></td>
                  <td className={`xl__cell xgrid__cell${grid.sel('name', at)}`} data-col="name" data-row={at}><input {...grid.cell('name', at)} value={t.name} spellCheck={false} onChange={(e) => save([{ ...t, name: e.target.value }])} />{grid.handle('name', at)}</td>
                  <td className="xl__cell"><GroupPicker value={t.group} none="Choose a group…" folders={ctx.groupFolders} onChange={(group) => save([{ ...t, group }])} /></td>
                  <td className="xl__cell xl__ro" title="One task for every building and level that has objects of this group">{!t.group.trim() ? 'pick a group' : m.pours === 0 ? `no objects of “${t.group}” in the loaded model` : m.tasks > 0 ? `${m.tasks} task${m.tasks === 1 ? '' : 's'} (one per building and level), from ${m.pours.toLocaleString()} objects` : `from ${m.pours.toLocaleString()} objects`}</td>
                  <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" aria-label="Delete" title="Delete the level task" onClick={() => remove(t.id)}><IconRemove /></button></td>
                </tr>
              );
            })}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={5}><button type="button" onClick={add}>+ Add a level task</button></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The Order: one table, the steps in the order they are built. */
export function OrderPanel() {
  const ctx = useRuleContext();
  const stepFocus = useStepFocus((s) => s.group);
  const clearFocus = useStepFocus((s) => s.focus);
  const recipes = useRecipeStore((s) => s.recipes);
  const pools = useRecipeStore((s) => s.pools);
  const [, redraw] = useState(0);
  const isOpen = (i: number) => openSteps.has(stepKey(steps[i]?.group ?? '', i));
  const setOpen = (i: number, on: boolean) => { const k = stepKey(steps[i]?.group ?? '', i); if (on) openSteps.add(k); else openSteps.delete(k); redraw((n) => n + 1); };
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  const steps = ctx.rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID)?.steps ?? [];
  // A recipe's "Built in steps" link opens the step of its group.
  useEffect(() => {
    if (!stepFocus) return;
    const at = steps.findIndex((s) => s.group.trim().toUpperCase() === stepFocus.trim().toUpperCase());
    if (at >= 0) setOpen(at, true);
    clearFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFocus]);
  const setSteps = (next: SequenceStep[]) => ctx.change((r) => {
    const others = r.sequences.filter((s) => s.id.toUpperCase() !== STEPS_ID);
    return { ...r, sequences: next.length ? [{ id: STEPS_ID, name: 'Steps', steps: next }, ...others] : others };
  });
  const set = (i: number, patch: Partial<SequenceStep>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const drop = (to: number) => {
    if (!drag || drag.from === to || drag.from + 1 === to) return setDrag(null);
    const next = [...steps];
    const [moved] = next.splice(drag.from, 1);
    next.splice(to > drag.from ? to - 1 : to, 0, moved);
    setSteps(next);
    setDrag(null);
  };
  // The steps typed in as a spreadsheet's: range, fill down, copy and paste.
  const grid = useEditableGrid({ widthsKey: 'sequence.steps',
    rows: steps,
    get: (col, s) => (col === 'group' ? s.group : col === 'lag' ? String(s.lagHours ?? '') : s.note ?? ''),
    write: (col, cells) => {
      const to = new Map(cells);
      setSteps(steps.map((x, j) => {
        const t = to.get(j);
        if (t === undefined) return x;
        return col === 'group' ? { ...x, group: t } : col === 'lag' ? { ...x, lagHours: t.trim() === '' ? undefined : num(t) } : { ...x, note: t || undefined };
      }));
    },
  });
  const busy = useScenarioStore((s) => !!s.busy);
  const addStep = (group: string) => { setSteps([...steps, { group }]); openSteps.add(stepKey(group, steps.length)); };
  // Only the search sets that are not a step yet are offered.
  const used = new Set(steps.map((x) => x.group.trim().toUpperCase()));
  const free = ctx.groupFolders.map((f) => ({ folder: f.folder, names: f.names.filter((n) => !used.has(n.trim().toUpperCase())) })).filter((f) => f.names.length > 0);

  return (
    <div className="order">
      <div className="rel-bar">
        <span className="seq__add">
          <GroupPicker value="" none="+ Add a step…" folders={free} title={free.length ? 'Add a step: pick one of your search sets (made in Models › Search sets)' : 'Every search set is a step already. Make more in Models › Search sets'} onChange={(g) => { if (g) addStep(g); }} />
        </span>
        <span className="scn-dim">Your search sets, in the order they are built, top first. Drag a row number to move one. Open a step to see what it generates.</span>
        <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void updateFourD()} title="Generate the programme for this order and play it in 4D (Update 4D). Does not save the order."><span aria-hidden="true">⟳</span> Generate</button>
      </div>
      <ResourceCheck />
      {steps.length === 0 ? <div className="scn-dim scn-editor__help">No steps yet. Add the search sets you want built, in the order you want them. Make search sets in Models › Search sets.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 48 }} /><col style={{ width: 280 }} /><col style={{ width: 100 }} /><col style={{ width: 340 }} /><col style={{ width: 32 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Step" /><th title="The search set built in this step">Search set</th><th title="Built level by level, or once for the whole building">Built</th><th>Description</th><th aria-label="Show what it generates" /><th aria-label="Delete" /></tr></thead>
          <tbody>
            {steps.map((s, i) => {
              const unknown = s.group.trim() !== '' && ctx.groupIds.length > 0 && !ctx.groupIds.some((g) => g.toUpperCase() === s.group.trim().toUpperCase());
              return (
                <Fragment key={i}>
                  <tr data-line={i} className={`${isOpen(i) ? 'is-selected' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`}
                    onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                    <th scope="row" className="xl__row rel-grip" draggable title="Drag to move the step"
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                      onDragEnd={() => setDrag(null)}>{i + 1}</th>
                    <td className={`xl__cell${unknown ? ' is-bad' : ''}`}>
                      <GroupPicker value={s.group} none="Choose a search set…" folders={ctx.groupFolders} invalid={unknown} onChange={(group) => set(i, { group })} />
                    </td>
                    <td className="xl__check"><button type="button" className={`btn btn--small${s.perLevel ? ' primary' : ''}`} aria-pressed={!!s.perLevel} onClick={() => set(i, { perLevel: s.perLevel ? undefined : true })}
                      title={s.perLevel ? 'Built level by level. Click to build it once, for the whole building' : 'Built once. Click to build it level by level'}>{s.perLevel ? 'per level' : 'once'}</button></td>
                    <td className={`xl__cell xgrid__cell${grid.sel('note', i)}`} data-col="note" data-row={i}><input {...grid.cell('note', i)} value={s.note ?? ''} spellCheck={false} onChange={(e) => set(i, { note: e.target.value || undefined })} />{grid.handle('note', i)}</td>
                    <td className="xl__check"><button type="button" className="cols__icon" aria-expanded={isOpen(i)} aria-label="Show what this step generates" title={isOpen(i) ? 'Hide what this step generates' : 'Show the activities this step generates, their days and resources'} onClick={() => setOpen(i, !isOpen(i))}>{isOpen(i) ? <IconChevronDown /> : <IconChevronRight />}</button></td>
                    <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" aria-label="Delete step" title="Delete the step" onClick={() => { setOpen(i, false); setSteps(steps.filter((_, j) => j !== i)); }}><IconRemove /></button></td>
                  </tr>
                  {isOpen(i) && (
                    <tr><th className="xl__row" /><td colSpan={5} className="seq__more">
                      <StepRecipe group={s.group} recipes={recipes} pools={pools} rules={ctx.rules} />
                      {s.group.trim() !== '' && <PoursOf group={s.group} />}
                      {i > 0 && (
                        <div className="rel-bar seq__timing">
                          <span className="scn-dim" title="By default a step starts when the one above it has finished">How it follows the step above</span>
                          <select className="rel-cell" value={s.type ?? 'FS'} aria-label="Link" onChange={(e) => set(i, { type: e.target.value === 'FS' ? undefined : (e.target.value as RelType) })}>{TYPES.map((t) => <option key={t} value={t}>{LINK_WORDS[t]}</option>)}</select>
                          <label className="scn-dim">lag (hours) <input className="rel-cell" type="text" inputMode="decimal" style={{ width: 70 }} value={s.lagHours ?? ''} onChange={(e) => set(i, { lagHours: e.target.value.trim() === '' ? undefined : num(e.target.value) })} /></label>
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Extra activities and level tasks: two tables of the Advanced tab. */
export function ExtraActivitiesTab() { return <ExtrasGrid ctx={useRuleContext()} />; }
export function LevelTasksTab() { return <LevelTasksGrid ctx={useRuleContext()} />; }
