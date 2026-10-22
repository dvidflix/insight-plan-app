import { useEffect, useMemo, useState } from 'react';
import { setExtras, updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { STEPS_ID } from '../../../prs/recipesWorkbook';
import type { RelType, SequenceStep } from '../../../prs/rules';
import { IconChevronDown, IconChevronRight, IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { ResourceCheck, StepRecipe } from './StepRecipes';
import { useStepFocus } from '../../../state/resourceFocusStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { useIndexTick } from '../../modelFields';
import { guidsOfSet, pourRowsOfGroup } from '../../../scenarios/stepPours';
import { applyExtraRow, applyLevelTaskRow, extraRows, levelTaskRows, newExtra, type ExtraRow, type ExtraScope, type LevelTaskRow } from '../../../prs/sequenceRows';

/** The Order tab's sequence, as one list: on the left the locations the model has (building, then level, with the number of pours), on the right the
    steps in the order they are built. Drag a step to move it, flip "per level" / "once", and open a step to see the recipe it will generate and the
    resources it uses. The same steps (rules.sequences, "Steps") as the Steps table of the workbook: nothing is kept twice. */

const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];

type Place = { levels: Map<string, number>; zones: Map<string, number> };

/** Building → levels and zones → pours, from the order table, in the order they are first met. */
function useLocations() {
  const loaded = useScenarioStore((s) => s.loaded);
  const rows = useScenarioStore((s) => s.rows);
  return useMemo(() => {
    const b = loaded ? loaded.headers.indexOf('Building') : -1;
    const l = loaded ? loaded.headers.indexOf('Level') : -1;
    const z = loaded ? ['Building Zone', 'Zone'].map((h) => loaded.headers.indexOf(h)).find((i) => i >= 0) ?? -1 : -1;
    const tree = new Map<string, Place>();
    if (b < 0 && l < 0) return tree;
    for (const r of rows) {
      const building = (b >= 0 ? r.cells[b] : '')?.trim() || 'No building';
      const level = (l >= 0 ? r.cells[l] : '')?.trim() || 'No level';
      const place = tree.get(building) ?? tree.set(building, { levels: new Map(), zones: new Map() }).get(building)!;
      place.levels.set(level, (place.levels.get(level) ?? 0) + 1);
      const zone = z >= 0 ? r.cells[z]?.trim() : '';
      if (zone) place.zones.set(zone, (place.zones.get(zone) ?? 0) + 1);
    }
    return tree;
  }, [loaded, rows]);
}

const SCOPES: { value: ExtraScope; label: string; tip: string }[] = [
  { value: 'once', label: 'Once', tip: 'In the Extra activities folder of the WBS' },
  { value: 'level', label: 'On its level', tip: "On the building's level, beside the Walls and Slabs groups" },
  { value: 'slabs', label: 'In Slabs', tip: "In the level's Slabs group" },
  { value: 'folder', label: 'Own folder', tip: "A folder of its own under the building's Construction node" },
];

/** Which steps had their Pours section open, by group name, for the session (the section is rebuilt each time its step is opened). */
const poursOpen = new Map<string, boolean>();

/** The pours of a step: those of the pour table that are in the group of its name, whether that is a rule group or a search set of the model. */
function PoursOf({ group }: { group: string }) {
  const rows = useScenarioStore((s) => s.rows);
  const loaded = useScenarioStore((s) => s.loaded);
  const ctx = useRuleContext();
  const [show, setShow] = useState(() => poursOpen.get(group.trim().toUpperCase()) === true);
  const idCol = loaded ? ['PlanningProposedPourID', 'Pour ID'].map((h) => loaded.headers.indexOf(h)).find((i) => i >= 0) ?? -1 : -1;
  const levelCol = loaded ? loaded.headers.indexOf('Level') : -1;
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  const mine = useMemo(() => {
    const indexes = engine.getIndexes();
    return pourRowsOfGroup(group, rows, ctx.membership, sets, (set) => guidsOfSet(indexes, set));
  }, [rows, ctx.membership, sets, group, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <details className="seq__pours" open={show} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setShow(open); poursOpen.set(group.trim().toUpperCase(), open); }}>
      <summary title="The individual pours of this step">Pours ({mine.length.toLocaleString()})</summary>
      {mine.length === 0 ? <div className="scn-dim scn-editor__help">No model pours: nothing in the pour table is in “{group}” (a rule group or a search set of that name). For an extra activity this is as it should be.</div> : (
        <table className="xl">
          <thead><tr><th>Pour</th><th>Level</th></tr></thead>
          <tbody>{mine.slice(0, 50).map((r) => <tr key={r.key}><td className="xl__cell xl__ro">{idCol >= 0 ? r.cells[idCol] : r.key}</td><td className="xl__cell xl__ro">{levelCol >= 0 ? r.cells[levelCol] : ''}</td></tr>)}</tbody>
        </table>
      )}
      {mine.length > 50 && <div className="scn-dim xl__note">and {mine.length - 50} more: the Pours table below lists them all</div>}
    </details>
  );
}

/** Extra activities and level tasks, as labelled rows after the steps. They have no pours; where they sit in the programme is set by their dates and
    links (extras) or their group (level tasks), not by their place in the list, so they carry no drag handle. */
function OtherRows({ ctx }: { ctx: ReturnType<typeof useRuleContext> }) {
  const extras = useScenarioStore((s) => s.extras);
  const startDate = useScenarioStore((s) => s.startDate);
  const [open, setOpen] = useState<string | null>(null);
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
  const tags = ctx.rules.extraTags;
  const xs = extraRows(extras, tags);
  const lts = levelTaskRows(ctx.rules.levelTasks);
  const saveExtra = (was: string, row: ExtraRow) => { const out = applyExtraRow(extras, tags, was, row); setExtras(out.extras); ctx.change((r) => ({ ...r, extraTags: out.tags })); };
  const saveTask = (row: LevelTaskRow) => ctx.change((r) => ({ ...r, levelTasks: applyLevelTaskRow(r.levelTasks, row) }));
  const addExtra = () => { const x = newExtra(extras, startDate); setExtras([...extras, x]); setOpen(x.TaskID); setFresh(x.TaskID); };
  const input = (value: string | number, on: (v: string) => void, label: string, width?: number, type = 'text') => (
    <label className="scn-dim">{label} <input className="rel-cell" type={type} style={width ? { width } : undefined} value={value} spellCheck={false} onChange={(e) => on(e.target.value)} /></label>
  );
  return (
    <div className="seq__others">
      <div className="rel-bar seq__sep">
        <button type="button" className="btn btn--small" onClick={addExtra} title="Add an activity that is not built from the model (site setup, temporary works, a milestone). It starts on the scenario's start date: change its dates and WBS place in the row">+ Extra</button>
        <span className="scn-dim" title="They have no pours of their own, and no place in the order: their dates, links and group put them in the programme">Extra activities and level tasks (no pours; placed by their dates, links and group)</span>
      </div>
      {lts.map((t) => (
        <div key={`lt|${t.id}`} className={`seq__step${t.enabled ? '' : ' is-off'}`}>
          <div className="seq__row">
            <span className="seq__tag" title="One task per building and level, from the first to the last pour of its group">Level task</span>
            <input className="seq__name" value={t.name} spellCheck={false} aria-label="Name" onChange={(e) => saveTask({ ...t, name: e.target.value })} />
            <input className="seq__desc" list="seq-groups" value={t.group} spellCheck={false} aria-label="Group" title="The group whose pours it spans" onChange={(e) => saveTask({ ...t, group: e.target.value })} />
            <label className="scn-dim" title="Use this level task"><input type="checkbox" checked={t.enabled} onChange={(e) => saveTask({ ...t, enabled: e.target.checked })} /> on</label>
          </div>
        </div>
      ))}
      {xs.map((x) => (
        <div key={`x|${x.id}`} className="seq__step">
          <div className="seq__row">
            <span className="seq__tag seq__tag--extra" title="An activity added to the generated programme">Extra</span>
            <input className="seq__name" data-extra-name={x.id} value={x.name} spellCheck={false} aria-label="Name" onChange={(e) => saveExtra(x.id, { ...x, name: e.target.value })} />
            <input className="seq__days" type="number" min={0} step="any" value={x.days} aria-label="Days" title="Working days" onChange={(e) => saveExtra(x.id, { ...x, days: Number(e.target.value) || 0 })} />
            <span className="scn-dim">d</span>
            <select className="rel-cell" value={x.scope} aria-label="Where in the WBS" title="Where it goes in the WBS" onChange={(e) => saveExtra(x.id, { ...x, scope: e.target.value as ExtraScope })}>
              {SCOPES.map((o) => <option key={o.value} value={o.value} title={o.tip}>{o.label}</option>)}
            </select>
            <button type="button" className="cols__icon" aria-expanded={open === x.id} aria-label="More" title="ID, building, level, dates" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? <IconChevronDown /> : <IconChevronRight />}</button>
          </div>
          {open === x.id && (
            <div className="seq__more">
              <div className="rel-bar">
                {input(x.id, (v) => saveExtra(x.id, { ...x, id: v }), 'ID', 110)}
                {input(x.building, (v) => saveExtra(x.id, { ...x, building: v }), 'Building', 110)}
                {input(x.level, (v) => saveExtra(x.id, { ...x, level: v }), 'Level', 80)}
                {x.scope === 'folder' && input(x.path, (v) => saveExtra(x.id, { ...x, path: v }), 'Folder', 200)}
                {input(x.start, (v) => saveExtra(x.id, { ...x, start: v }), 'Baseline start', 120)}
                {input(x.finish, (v) => saveExtra(x.id, { ...x, finish: v }), 'Baseline finish', 120)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SequencePanel() {
  const ctx = useRuleContext();
  const stepFocus = useStepFocus((s) => s.group);
  const clearFocus = useStepFocus((s) => s.focus);
  const recipes = useRecipeStore((s) => s.recipes);
  const pools = useRecipeStore((s) => s.pools);
  const tree = useLocations();
  const [open, setOpen] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const steps = ctx.rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID)?.steps ?? [];
  // A recipe's "Built in steps" link opens the step of its group.
  useEffect(() => {
    if (!stepFocus) return;
    const at = steps.findIndex((s) => s.group.trim().toUpperCase() === stepFocus.trim().toUpperCase());
    if (at >= 0) setOpen(at);
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
    setOpen(null);
    setDrag(null);
  };
  const total = [...tree.values()].reduce((n, p) => n + [...p.levels.values()].reduce((a, b) => a + b, 0), 0);
  const levelCount = new Set([...tree.values()].flatMap((p) => [...p.levels.keys()])).size;
  const zoneCount = new Set([...tree.values()].flatMap((p) => [...p.zones.keys()])).size;
  const busy = useScenarioStore((s) => !!s.busy);

  return (
    <div className="seq">
      <aside className="seq__loc" aria-label="Locations">
        <div className="seq__head">Locations <span className="scn-dim">{total ? `${total} pours` : ''}</span></div>
        {tree.size === 0 ? <div className="scn-dim scn-editor__help">The model has no Building or Level column: its pours are not grouped by location.</div> : [...tree].map(([building, { levels, zones }]) => {
          const shut = closed.has(building);
          return (
            <div key={building}>
              <button type="button" className="seq__bld" aria-expanded={!shut} onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(building)) n.delete(building); else n.add(building); return n; })}>
                {shut ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}<strong>{building}</strong><span className="scn-dim">{[...levels.values()].reduce((a, b) => a + b, 0)}</span>
              </button>
              {!shut && [...levels].map(([level, n]) => <div key={level} className="seq__lvl" title={`${n} pours on ${level}`}><span>{level}</span><span className="scn-dim">{n}</span></div>)}
              {!shut && [...zones].map(([zone, n]) => <div key={`z|${zone}`} className="seq__lvl seq__zone" title={`${n} pours in ${zone}`}><span>{zone}</span><span className="scn-dim">{n}</span></div>)}
            </div>
          );
        })}
        {tree.size > 0 && <div className="seq__foot scn-dim">{levelCount} level{levelCount === 1 ? '' : 's'}{zoneCount > 0 ? ` · ${zoneCount} zone${zoneCount === 1 ? '' : 's'}` : ''}</div>}
      </aside>
      <section className="seq__steps" aria-label="Steps">
        <div className="rel-bar">
          <button type="button" className="btn btn--small primary" onClick={() => { setSteps([...steps, { group: '', perLevel: true }]); setOpen(steps.length); }}>+ Step</button>
          <span className="scn-dim">The order they are built, top first. Drag a step to move it. Open one to see what it generates and the resources it uses.</span>
          <button type="button" className="btn btn--small" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void updateFourD()} title="Generate the programme for this order and play it in 4D (Update 4D). Does not save the order."><span aria-hidden="true">⟳</span> Generate</button>
        </div>
        <ResourceCheck />
        {steps.length === 0 && <div className="scn-dim scn-editor__help">No steps: the pours follow the order of the scenario. Add a step for each search set (Raft, Walls, Slabs ...), then drag them into the build order.</div>}
        {steps.map((s, i) => {
          const unknown = s.group.trim() !== '' && ctx.groupIds.length > 0 && !ctx.groupIds.some((g) => g.toUpperCase() === s.group.trim().toUpperCase());
          const move = (by: number) => { const to = i + by; if (to < 0 || to >= steps.length) return; const next = [...steps]; [next[i], next[to]] = [next[to], next[i]]; setSteps(next); setOpen(null); };
          return (
            <div key={i} className={`seq__step${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`}
              onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
              <div className="seq__row">
                <span className="seq__grip" draggable title="Drag to move the step (or Alt+↑ / Alt+↓ in the box)" aria-hidden="true"
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('.seq__step'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                  onDragEnd={() => setDrag(null)}>⋮⋮</span>
                <span className="seq__no">{i + 1}</span>
                <input className="seq__name" list="seq-groups" value={s.group} placeholder="Search set / group" spellCheck={false} aria-invalid={unknown}
                  title={unknown ? 'No search set or group has this name' : 'The search set or group built in this step'}
                  onKeyDown={(e) => { if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(-1); } else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(1); } }}
                  onChange={(e) => set(i, { group: e.target.value })} />
                <input className="seq__desc" value={s.note ?? ''} placeholder="Description" spellCheck={false} title="A note on the step (saved with it, and in the workbook's Notes)" onChange={(e) => set(i, { note: e.target.value || undefined })} />
                <button type="button" className={`btn btn--small${s.perLevel ? ' primary' : ''}`} aria-pressed={!!s.perLevel} onClick={() => set(i, { perLevel: s.perLevel ? undefined : true })}
                  title={s.perLevel ? 'Built level by level. Click to build it once, for the whole building' : 'Built once. Click to build it level by level'}>{s.perLevel ? 'per level' : 'once'}</button>
                <button type="button" className="cols__icon" aria-expanded={open === i} aria-label="Show what this step generates" title={open === i ? 'Hide what this step generates' : 'Show the activities this step generates, their days and resources'} onClick={() => setOpen(open === i ? null : i)}>{open === i ? <IconChevronDown /> : <IconChevronRight />}</button>
                <button type="button" className="cols__icon cols__icon--remove" aria-label="Delete step" title="Delete the step" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setOpen(null); }}><IconRemove /></button>
              </div>
              {open === i && (
                <div className="seq__more">
                  <div className="rel-bar">
                    <label className="scn-dim">Link into it <select className="rel-cell" value={s.type ?? 'FS'} disabled={i === 0} onChange={(e) => set(i, { type: e.target.value === 'FS' ? undefined : (e.target.value as RelType) })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                    <label className="scn-dim">Lag (h) <input className="rel-cell" type="number" step="any" style={{ width: 70 }} disabled={i === 0} value={s.lagHours ?? ''} onChange={(e) => set(i, { lagHours: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                    <label className="scn-dim">Notes <input className="rel-cell" style={{ width: 240 }} value={s.note ?? ''} onChange={(e) => set(i, { note: e.target.value || undefined })} /></label>
                  </div>
                  <StepRecipe group={s.group} recipes={recipes} pools={pools} rules={ctx.rules} />
                  {s.group.trim() !== '' && <PoursOf group={s.group} />}
                </div>
              )}
            </div>
          );
        })}
        <OtherRows ctx={ctx} />
        <datalist id="seq-groups">{ctx.groupIds.map((g) => <option key={g} value={g} />)}</datalist>
      </section>
    </div>
  );
}
