import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { useOrderPreview } from '../../../state/orderPreviewStore';
import { STEPS_ID } from '../../../prs/recipesWorkbook';
import { makesItems } from '../../../prs/workBreakdown';
import type { RelType, SequenceStep } from '../../../prs/rules';
import {
  findNode, freshNodeId, patchNode, pathTo, placeEntry, removeEntry, setsOf, stepsOfRules, treeOfRules, unwrapNode, withStep, withTree,
  type WbsEntry, type WbsNode, type WbsPlace, type WbsTree,
} from '../../../prs/wbsTree';
import { useRuleContext } from '../rules/RuleParts';
import { ResourceCheck } from '../rules/StepRecipes';
import { OverflowMenu } from '../../TablePopovers';
import { useGenerateTab } from '../GenerateTabs';
import { usePlans, WorkItemPanel } from './WorkItemPanel';
import { GenerateStatus } from '../GenerateSummary';
import { stepColors } from '../OrderPreview';
import { InfoTip } from '../../InfoTip';
import { IconChevronDown, IconChevronRight, IconDragVert, IconRemove } from '../../icons';
import { usePersistedState } from '../../../utils/persistedState';
import { SetLibrary, useSetCounts, wbsDrag } from './SetLibrary';
import { useGenerate2Tab } from './Generate2Tabs';

/** Generate 2's Build tab: the search sets library on the left and the work breakdown tree beside it. Drag a set into the tree; drop it on a node to put
    it inside, above or below a row to put it there. Nesting is the WBS, top to bottom is the build order, and each set is a work item: open it to see
    the activities its recipe makes and how it follows the one before. The tree writes the scenario's steps (prs/wbsTree.ts), so Update 4D builds
    exactly what it shows. Picking a row colours its objects in 3D; picking an object in 3D picks its row. */

const norm = (s: string) => s.trim().toUpperCase();
const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const LINK_WORDS: Record<RelType, string> = { FS: 'starts when it has finished', SS: 'starts when it starts', FF: 'finishes when it finishes', SF: 'finishes when it starts' };
const num = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? 0 : Number(v.replace(',', '.')));

type Pick = { set: string } | { node: string } | null;
type DropAt = { key: string; where: 'before' | 'after' | 'inside' } | null;
const keyOf = (e: WbsEntry) => (e.kind === 'set' ? `s:${norm(e.group)}` : `n:${e.id}`);

/** A row of the tree as it is drawn: the entry, its depth and the place it is at. */
interface Line { entry: WbsEntry; depth: number; parent: string | null; index: number }

function linesOf(list: readonly WbsEntry[], closed: ReadonlySet<string>, depth = 0, parent: string | null = null): Line[] {
  return list.flatMap((entry, index) => [{ entry, depth, parent, index }, ...(entry.kind === 'node' && !closed.has(entry.id) ? linesOf(entry.children, closed, depth + 1, entry.id) : [])]);
}

export function WbsBuilder() {
  const ctx = useRuleContext();
  const rules = ctx.rules;
  const { tree, inOrder } = useMemo(() => treeOfRules(rules), [rules]);
  const steps = stepsOfRules(rules);
  const stepAt = useMemo(() => new Map(steps.map((s, i) => [norm(s.group), i] as const).reverse()), [steps]);
  const save = (next: WbsTree) => ctx.change((r) => withTree(r, next));
  const setStep = (group: string, patch: Partial<Omit<SequenceStep, 'group'>>) => ctx.change((r) => withStep(withTree(r, tree), group, patch));

  const [closedList, setClosedList] = usePersistedState<string[]>('generate2.closed', []);
  const closed = useMemo(() => new Set(closedList), [closedList]);
  const toggle = (id: string, open?: boolean) => setClosedList((l) => ((open ?? l.includes(id)) ? l.filter((x) => x !== id) : [...l, id]));
  const [openSets, setOpenSets] = useState<Set<string>>(() => new Set());
  const toggleSet = (group: string) => setOpenSets((s) => { const n = new Set(s); if (n.has(norm(group))) n.delete(norm(group)); else n.add(norm(group)); return n; });

  const preview = useOrderPreview();
  const [pick, setPickState] = useState<Pick>(null);
  const setPick = (p: Pick) => {
    setPickState(p);
    // Picking a work item opens it on its activities.
    if (p && 'set' in p) setOpenSets((s) => (s.has(norm(p.set)) ? s : new Set(s).add(norm(p.set))));
    if (!p) preview.setCurrent(null);
    else if ('set' in p) preview.setCurrent(norm(p.set));
    else { const n = findNode(tree.children, p.node); preview.setMany(n ? setsOf(n.children).map(norm) : []); }
  };
  // A pick in 3D (the preview makes its step current): pick its row, open the nodes above it, and bring it into view.
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  useEffect(() => {
    const cur = preview.current;
    if (!cur || (pick && 'set' in pick && norm(pick.set) === cur)) return;
    const group = setsOf(tree.children).find((g) => norm(g) === cur);
    if (!group) return;
    setPickState({ set: group });
    const above = pathTo(tree.children, { set: group }) ?? [];
    if (above.some((id) => closed.has(id))) setClosedList((l) => l.filter((x) => !above.includes(x)));
    requestAnimationFrame(() => rowRefs.current.get(`s:${cur}`)?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.current]);

  /** Where a new set or node goes: inside the picked node, or after the picked set, or at the bottom. */
  const addPlace = (): WbsPlace => {
    if (pick && 'node' in pick && findNode(tree.children, pick.node)) return { parent: pick.node, index: findNode(tree.children, pick.node)!.children.length };
    if (pick && 'set' in pick) {
      const above = pathTo(tree.children, { set: pick.set });
      if (above) {
        const parent = above.length ? above[above.length - 1] : null;
        const list = parent ? findNode(tree.children, parent)!.children : tree.children;
        return { parent, index: list.findIndex((e) => e.kind === 'set' && norm(e.group) === norm(pick.set)) + 1 };
      }
    }
    return { parent: null, index: tree.children.length };
  };
  const addSet = (group: string) => {
    if (setsOf(tree.children).some((g) => norm(g) === norm(group))) return;
    const at = addPlace();
    save(placeEntry(tree, { kind: 'set', group }, at));
    if (at.parent) toggle(at.parent, true);
  };
  const [freshNode, setFreshNode] = useState<string | null>(null);
  const addNode = () => {
    const id = freshNodeId(tree);
    const at = addPlace();
    save(placeEntry(tree, { kind: 'node', id, name: 'New node', children: [] }, at));
    if (at.parent) toggle(at.parent, true);
    setPickState({ node: id });
    setFreshNode(id);
  };
  useEffect(() => {
    if (!freshNode) return;
    const el = document.querySelector<HTMLInputElement>(`input[data-wbs-node="${CSS.escape(freshNode)}"]`);
    if (el) { el.focus(); el.select(); setFreshNode(null); }
  }, [freshNode, tree]);

  // Drag and drop: a set from the library or the tree, or a node, onto a row (above, inside a node, below) or onto the empty space under the tree.
  const [dropAt, setDropAt] = useState<DropAt>(null);
  const dragged = (): WbsEntry | null => {
    const d = wbsDrag.current;
    if (!d) return null;
    if (d.kind === 'set') return { kind: 'set', group: d.group };
    return findNode(tree.children, d.id);
  };
  const placeOf = (line: Line, where: 'before' | 'after' | 'inside'): WbsPlace =>
    where === 'inside' && line.entry.kind === 'node' ? { parent: line.entry.id, index: line.entry.children.length } : { parent: line.parent, index: line.index + (where === 'after' ? 1 : 0) };
  const overRow = (e: DragEvent, line: Line) => {
    const d = dragged();
    if (!d) return;
    // A node cannot go inside itself.
    if (d.kind === 'node' && (line.entry.kind === 'node' && line.entry.id === d.id || pathTo(d.children, line.entry.kind === 'set' ? { set: line.entry.group } : { node: line.entry.id }) !== null)) return;
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - box.top) / Math.max(box.height, 1);
    const where = line.entry.kind === 'node' ? (y < 0.25 ? 'before' : y > 0.75 && (closed.has(line.entry.id) || line.entry.children.length === 0) ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after';
    const key = keyOf(line.entry);
    if (dropAt?.key !== key || dropAt.where !== where) setDropAt({ key, where });
  };
  const dropOn = (e: DragEvent, line: Line | null) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragged();
    const at = line && dropAt && dropAt.key === keyOf(line.entry) ? placeOf(line, dropAt.where) : { parent: null, index: tree.children.length };
    setDropAt(null);
    wbsDrag.current = null;
    if (!d) return;
    save(placeEntry(tree, d, at));
    if (at.parent) toggle(at.parent, true);
  };

  // Keys: arrows move the pick, left / right fold and open a node, Alt+arrows move the row among its neighbours, Delete takes it out of the tree.
  const lines = linesOf(tree.children, closed);
  const pickedAt = lines.findIndex((l) => (pick ? ('set' in pick ? l.entry.kind === 'set' && norm(l.entry.group) === norm(pick.set) : l.entry.kind === 'node' && l.entry.id === pick.node) : false));
  const pickLine = (l: Line | undefined) => { if (l) { setPick(l.entry.kind === 'set' ? { set: l.entry.group } : { node: l.entry.id }); rowRefs.current.get(keyOf(l.entry))?.focus(); } };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const line = lines[pickedAt];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.altKey && line) {
        const list = line.parent ? findNode(tree.children, line.parent)!.children : tree.children;
        const to = line.index + (e.key === 'ArrowDown' ? 2 : -1);
        if (to >= 0 && to <= list.length) save(placeEntry(tree, line.entry, { parent: line.parent, index: to }));
        return;
      }
      pickLine(lines[Math.max(0, Math.min(lines.length - 1, pickedAt < 0 ? 0 : pickedAt + (e.key === 'ArrowDown' ? 1 : -1)))]);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && line?.entry.kind === 'node') {
      e.preventDefault();
      toggle(line.entry.id, e.key === 'ArrowRight');
    } else if (e.key === 'Delete' && line) {
      e.preventDefault();
      save(line.entry.kind === 'node' ? unwrapNode(tree, line.entry.id) : removeEntry(tree, line.entry));
      setPick(null);
    }
  };

  const counts = useSetCounts();
  const colors = stepColors(steps.length);
  const sets = setsOf(tree.children);
  const inTree = useMemo(() => new Set(sets.map(norm)), [sets.join('\u0001')]); // eslint-disable-line react-hooks/exhaustive-deps
  const objectsIn = (groups: string[]) => groups.reduce((n, g) => n + (counts.get(norm(g)) ?? 0), 0);
  const plans = usePlans(sets);
  // What Generate will make: each object of a work item gets its recipe's activities.
  const activities = sets.reduce((n, g) => { const p = plans.get(norm(g)); return n + (p ? p.activities.length * p.objects : 0); }, 0);
  const volume = sets.reduce((n, g) => n + (plans.get(norm(g))?.volume ?? 0), 0);
  const noCrew = sets.filter((g) => plans.get(norm(g))?.activities.some((a) => !a.crew)).length;

  const busy = useScenarioStore((s) => !!s.busy);
  const scenario = useScenarioStore((s) => s.scenario);
  const startDate = useScenarioStore((s) => s.startDate);
  const open = useGenerate2Tab((s) => s.open);
  const setAdvancedPart = useGenerateTab((s) => s.setAdvanced);
  const stepsSeq = rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID);
  const itemsInCharge = makesItems(rules.breakdown);

  const nodeRow = (n: WbsNode) => {
    const inside = setsOf(n.children);
    const open = !closed.has(n.id);
    return (
      <>
        <button type="button" className="cols__icon g2-row__fold" aria-expanded={open} aria-label={open ? 'Fold the node' : 'Open the node'} title={open ? 'Fold the node (Left arrow)' : 'Open the node (Right arrow)'} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>{open ? <IconChevronDown /> : <IconChevronRight />}</button>
        <span className="g2-row__strip g2-row__strip--node" aria-hidden="true" />
        <input className="g2-row__name" data-wbs-node={n.id} value={n.name} spellCheck={false} aria-label="Node name" title="The node's name: the name of its summary bar" onClick={(e) => e.stopPropagation()} onChange={(e) => save(patchNode(tree, n.id, { name: e.target.value }))} />
        <span className="g2-row__meta scn-dim">{inside.length} set{inside.length === 1 ? '' : 's'}{counts.size ? ` · ${objectsIn(inside).toLocaleString()} objects` : ''}</span>
        <button type="button" className={`btn btn--small${n.bar !== false ? ' primary' : ''}`} aria-pressed={n.bar !== false} onClick={(e) => { e.stopPropagation(); save(patchNode(tree, n.id, { bar: n.bar === false ? undefined : false })); }}
          title={n.bar !== false ? 'A summary bar for each building and level, from the first to the last object of the sets inside. Click for no bar' : 'No summary bar. Click for one bar per building and level over the sets inside'}>{n.bar !== false ? 'summary bar' : 'no bar'}</button>
        <button type="button" className="cols__icon cols__icon--remove" aria-label="Remove the node" title="Remove the node: the sets inside it move up to where it was (Delete)" onClick={(e) => { e.stopPropagation(); save(unwrapNode(tree, n.id)); setPick(null); }}><IconRemove /></button>
      </>
    );
  };

  const setRow = (line: Line, group: string) => {
    const at = stepAt.get(norm(group)) ?? -1;
    const step = steps[at];
    const plan = plans.get(norm(group));
    const chain = (plan?.activities ?? []).map((a) => a.name);
    const lacking = (plan?.activities ?? []).filter((a) => !a.crew).length;
    const n = counts.get(norm(group));
    const open = openSets.has(norm(group));
    const known = ctx.groupIds.length === 0 || ctx.groupIds.some((g) => norm(g) === norm(group));
    return (
      <>
        <span className="g2-row__grip" aria-hidden="true"><IconDragVert /></span>
        <span className="g2-row__strip" style={{ background: at >= 0 ? colors[at] : undefined }} aria-hidden="true" />
        <span className="g2-row__num scn-dim" title="Its place in the build order">{at + 1}</span>
        <span className={`g2-row__set${known ? '' : ' is-bad'}`} title={known ? group : `There is no search set called “${group}” any more: it was renamed or deleted in Models › Search sets. Remove it, or rename the set back`}>{group}</span>
        <span className="g2-row__meta scn-dim" title={n === 0 ? 'The set finds no object in the loaded models' : 'Objects the set finds in the loaded models'}>{n === undefined ? '' : `${n.toLocaleString()} objects`}</span>
        <span className="g2-row__chain scn-dim" title={chain.length ? `Each object gets: ${chain.join(' → ')}` : 'No recipe fits this set: its objects get the generator’s own activities'}>{chain.length ? chain.join(' → ') : 'the generator’s own activities'}</span>
        {lacking > 0 && <span className="source-chip source-chip--warn" title={`${lacking} of its activities ha${lacking === 1 ? 's' : 've'} no default crew: they are generated without labour. Open the work item to pick one`}>no crew</span>}
        <button type="button" className={`btn btn--small${step?.perLevel ? ' primary' : ''}`} aria-pressed={!!step?.perLevel} onClick={(e) => { e.stopPropagation(); setStep(group, { perLevel: step?.perLevel ? undefined : true }); }}
          title={step?.perLevel ? 'Built level by level (with the sets around it marked the same). Click to build it once' : 'Built once. Click to build it level by level'}>{step?.perLevel ? 'per level' : 'once'}</button>
        <button type="button" className="cols__icon" aria-expanded={open} aria-label="Show what this work item generates" title={open ? 'Hide what it generates' : 'Show the activities it generates, their days and resources, and how it follows the one before'} onClick={(e) => { e.stopPropagation(); toggleSet(group); }}>{open ? <IconChevronDown /> : <IconChevronRight />}</button>
        <button type="button" className="cols__icon cols__icon--remove" aria-label="Take out of the tree" title="Take the set out of the tree (Delete). The search set itself is kept" onClick={(e) => { e.stopPropagation(); save(removeEntry(tree, line.entry)); setPick(null); }}><IconRemove /></button>
      </>
    );
  };

  return (
    <div className="g2-build">
      <SetLibrary inTree={inTree} onAdd={addSet} />
      <section className="g2-tree" aria-label="Work breakdown tree">
        <div className="rel-bar g2-tree__bar">
          <b className="g2-tree__title">Work breakdown</b>
          <button type="button" className="btn btn--small" onClick={addNode} title="Add a node (a level of the work breakdown) inside the chosen node, or after the chosen set. Drag sets into it">+ Node</button>
          <InfoTip label="How the tree works">Drag search sets from the left into the tree. Drop on a node to put a set inside it; drop above or below a row to put it there. Nesting is the work breakdown, top to bottom is the build order: each set starts when the one above has finished, unless you change its link. Keys: arrows move, Alt+arrows move the row, Delete takes it out.</InfoTip>
          <span className="scn-dim g2-tree__scn" title="The scenario the tree is saved with, and its start date">
            <button type="button" className="link-btn" onClick={() => open('scenario')} title="Open the scenario: project, building, start date, Save">{scenario}</button>{startDate ? ` · starts ${new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
          </span>
          {!preview.show && <button type="button" className="btn btn--small" onClick={() => preview.setShow(true)} title="Show the model in 3D beside the tree, each set in its colour">Show 3D</button>}
          <OverflowMenu items={[
            { label: 'Add an extra activity (not built from the model)', onClick: () => open('extras'), title: 'Opens Extra activities under Advanced' },
            { label: 'Add a summary bar per building and level', onClick: () => setAdvancedPart('levelTasks'), title: 'A node of the tree already makes one over its sets; this adds one for any set or folder' },
            { label: 'Fine-tune individual objects', onClick: () => open('objects'), title: 'The objects one by one, in the order they are built' },
            { separator: true, label: '', onClick: () => {} },
            { label: 'Manage crews & rates', onClick: () => open('crews') },
            { label: 'All recipes', onClick: () => open('recipes') },
            { label: 'Rules & links', onClick: () => open('rules') },
          ]} />
          <GenerateStatus />
          <button type="button" className="btn primary" disabled={busy || sets.length === 0} onClick={() => void updateFourD()} title={sets.length === 0 ? 'Put search sets in the tree first' : 'Generate the programme from the tree and play it in 4D (Update 4D). Does not save the scenario'}><span aria-hidden="true">⟳</span> Generate</button>
        </div>
        <ResourceCheck quiet />
        {itemsInCharge && (
          <div className="scn-status scn-status--warn seq__warn" role="status">
            The grouping levels (Generate › Work breakdown) are on: the programme is made from their work items, and the tree only gives each of their groups its link to the one above.{' '}
            <button type="button" className="link-btn" onClick={() => ctx.change((r) => (r.breakdown ? { ...r, breakdown: { ...r.breakdown, levels: r.breakdown.levels.map((l) => ({ ...l, enabled: false })) } } : r))} title="Switch every grouping level off (they are kept, and can be switched on again in Generate › Work breakdown): the programme is then made from the tree">Build from the tree instead</button>
          </div>
        )}
        {stepsSeq?.stepsFolder && (
          <div className="scn-status scn-status--warn seq__warn" role="status">
            The steps are made from the folder “{stepsSeq.stepsFolder}” of Models › Search sets, so that folder's order wins over the tree.{' '}
            <button type="button" className="link-btn" onClick={() => ctx.change((r) => withTree({ ...r, sequences: r.sequences.map((q) => (q === stepsSeq ? { ...q, stepsFolder: undefined } : q)) }, tree))} title="Stop taking the steps from the folder: the tree's order is then the build order">Use the tree's order</button>
          </div>
        )}
        {!inOrder && (
          <div className="scn-status scn-status--warn seq__warn" role="status">
            The Work breakdown list in Generate was reordered, so the build order (the numbers) is not the tree's order from top to bottom.{' '}
            <button type="button" className="link-btn" onClick={() => save(tree)} title="Make the build order the tree's order, top to bottom">Use the tree's order</button>
          </div>
        )}
        <div className="g2-tree__body" role="tree" aria-label="Work breakdown" tabIndex={-1} onKeyDown={onKey}
          onDragOver={(e) => { if (wbsDrag.current) { e.preventDefault(); if (dropAt) setDropAt(null); } }} onDrop={(e) => dropOn(e, null)} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropAt(null); }}>
          {lines.length === 0 ? (
            <div className="scn-editor__help order__first g2-tree__empty"><b>Drag search sets here to build the work breakdown.</b> Nest them in nodes (+ Node) to make the levels of the breakdown; top to bottom is the order they are built. Then press Generate.</div>
          ) : lines.map((line) => {
            const k = keyOf(line.entry);
            const picked = pickedAt >= 0 && lines[pickedAt] === line;
            const drop = dropAt?.key === k ? ` is-drop-${dropAt.where}` : '';
            const group = line.entry.kind === 'set' ? line.entry.group : '';
            const step = line.entry.kind === 'set' ? steps[stepAt.get(norm(group)) ?? -1] : undefined;
            const first = line.entry.kind === 'set' && (stepAt.get(norm(group)) ?? 0) === 0;
            return (
              <Fragment key={k}>
                <div ref={(el) => { rowRefs.current.set(k, el); }} role="treeitem" aria-selected={picked} aria-level={line.depth + 1} aria-expanded={line.entry.kind === 'node' ? !closed.has(line.entry.id) : undefined} tabIndex={picked || (pickedAt < 0 && lines[0] === line) ? 0 : -1}
                  className={`g2-row g2-row--${line.entry.kind}${picked ? ' is-picked' : ''}${drop}`} style={{ paddingLeft: 8 + line.depth * 20 }} draggable
                  onDragStart={(e) => { wbsDrag.current = line.entry.kind === 'set' ? { kind: 'set', group } : { kind: 'node', id: line.entry.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', line.entry.kind === 'set' ? group : line.entry.name); }}
                  onDragEnd={() => { wbsDrag.current = null; setDropAt(null); }}
                  onDragOver={(e) => overRow(e, line)} onDrop={(e) => dropOn(e, line)}
                  onClick={() => setPick(picked ? null : line.entry.kind === 'set' ? { set: group } : { node: line.entry.id })}
                  title={line.entry.kind === 'node' ? 'Drag to move the node and what is in it. Click to colour its sets in 3D' : 'Drag to move. Click to colour its objects in 3D'}>
                  {line.entry.kind === 'node' ? nodeRow(line.entry) : setRow(line, group)}
                </div>
                {line.entry.kind === 'set' && openSets.has(norm(group)) && (
                  <div className="g2-more" style={{ marginLeft: 8 + line.depth * 20 + 28 }}>
                    {plans.get(norm(group)) && <WorkItemPanel group={group} plan={plans.get(norm(group))!} />}
                    {!first && (
                      <div className="rel-bar seq__timing">
                        <span className="scn-dim" title="By default a set starts when the one before it in the build order has finished">How it follows the one before</span>
                        <select className="rel-cell" value={step?.type ?? 'FS'} aria-label="Link" onChange={(e) => setStep(group, { type: e.target.value === 'FS' ? undefined : (e.target.value as RelType) })}>{TYPES.map((t) => <option key={t} value={t}>{LINK_WORDS[t]}</option>)}</select>
                        <label className="scn-dim">lag (hours) <input className="rel-cell" type="text" inputMode="decimal" style={{ width: 70 }} value={step?.lagHours ?? ''} onChange={(e) => setStep(group, { lagHours: e.target.value.trim() === '' ? undefined : num(e.target.value) })} /></label>
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="g2-tree__foot" role="status" title="Before Generate: each work item's recipe activities times its objects in the order table (the generator's own activities are not counted), and their concrete volume. After Generate the status line above has the programme's real figures">
          <span><b>{sets.length.toLocaleString()}</b> work item{sets.length === 1 ? '' : 's'}</span>
          {counts.size > 0 && <span><b>{objectsIn(sets).toLocaleString()}</b> objects</span>}
          {activities > 0 && <span>about <b>{activities.toLocaleString()}</b> activities</span>}
          {volume > 0 && <span><b>{volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b> m³</span>}
          {noCrew > 0 && <span className="scn-dim" title="Their activities are generated without labour: open one to pick a crew, or add crews with Manage crews & rates (⋯)">{noCrew} work item{noCrew === 1 ? ' has' : 's have'} an activity with no crew</span>}
          {counts.size === 0 && sets.length > 0 && <span className="scn-dim">Load the model (Models) to see the objects of each set</span>}
        </div>
      </section>
    </div>
  );
}
