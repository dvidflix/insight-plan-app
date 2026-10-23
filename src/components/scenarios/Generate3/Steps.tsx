import { Fragment, useMemo, useState } from 'react';
import { useScenarioStore, isDirty } from '../../../state/scenarioStore';
import { useSelectionStore } from '../../../state/selectionStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { FOLDER_SEP, isInFolder, walkFolder } from '../../../viewer/setTree';
import { isSelectionSet } from '../../../viewer/searchSets';
import {
  appendPackages, freshId, groupByFolders, isFineTuned, groupBySets, groupByStoreyAndClass, groupByStoreyAndProperty, mergePackages, orderBottomUp, quantities, splitPackage,
  type WorkPackage,
} from '../../../prs/workPackages';
import { indentPackage, movePackage, outdentPackage, removePackage, subtreeIds, type TreeRow } from '../../../prs/packageTree';
import { useModelFields } from '../../modelFields';
import { OverflowMenu } from '../../TablePopovers';
import { IconChevronDown, IconChevronRight, IconDragVert } from '../../icons';
import { MethodSelect, NumberField, StartSelect, packageAbove } from './Controls';
import { SpoolDialog } from './Spool';
import { ExcelButtons } from './ExcelButtons';
import { packageColors, useG3, useWorkPackages, type G3Step } from './useWorkPackages';

/** Generate 3, the guided way from a model to a programme, in three steps that are the header's tabs: 1 make work packages of the model's objects
    (a tree: a package can hold others), 2 put them in build order with simple "starts after" links, 3 check the method each is built with, and
    Generate. The page (pages/Generate3Page.tsx) shows the model on the left with the step's tools under it, the packages in the middle and a rough
    timeline on the right; Advanced (Advanced.tsx) slides over the timeline with the settings of the package picked. */

type WP = ReturnType<typeof useWorkPackages>;
type Row = TreeRow<WorkPackage>;
const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const sizeText = (q: { count: number; volume: number }) => `${n(q.count)} object${q.count === 1 ? '' : 's'}${q.volume > 0 ? ` · ${n(q.volume, q.volume < 10 ? 1 : 0)} m³` : ''}`;
const daysText = (d: number) => `${n(d, 1)} day${d === 1 ? '' : 's'}`;

export const STEPS: { id: G3Step; label: string; tip: string }[] = [
  { id: 1, label: '1 - Work packages', tip: 'Group the model’s objects into work packages, and packages into larger ones: automatically, from two properties, or from your search sets' },
  { id: 2, label: '2 - Sequence', tip: 'Put the packages in the order they are built, and say what starts after what' },
  { id: 3, label: '3 - Methods & Generate', tip: 'See how each package is built (its activities, crew and days), change it if needed, and generate the schedule' },
];

/** The steps as the header's tabs, after the search box. */
export function Generate3Tabs() {
  const step = useG3((s) => s.step);
  const setStep = useG3((s) => s.setStep);
  const { ready } = useScenarioView();
  const dirty = useScenarioStore((s) => isDirty(s));
  return (
    <div className="gen-tabs" role="tablist" aria-label="Generate 3">
      {STEPS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={step === t.id} disabled={!ready} className={step === t.id ? 'is-active' : ''} title={ready ? t.tip : 'Open a scenario first'} onClick={() => setStep(t.id)}>{t.label}</button>)}
      {dirty && <span className="scn-chip scn-chip--warn gen-tabs__dirty" title="The scenario has changes that are not saved">unsaved</span>}
    </div>
  );
}

/** Under the model: the tools of the step. */
export function StepTools({ wp }: { wp: WP }) {
  const step = useG3((s) => s.step);
  if (step === 1) return <MakeTools wp={wp} />;
  if (step === 2) return <OrderTools wp={wp} />;
  return <MethodTools wp={wp} />;
}

/** The rows that show: those not inside a package folded shut. */
function useVisibleRows(rows: Row[]): Row[] {
  const collapsed = useG3((s) => s.collapsed);
  return useMemo(() => {
    const shut = new Set(collapsed);
    const out: Row[] = [];
    let hideBelow = Infinity;
    for (const r of rows) {
      if (r.depth > hideBelow) continue;
      hideBelow = Infinity;
      out.push(r);
      if (r.children > 0 && shut.has(r.pkg.id)) hideBelow = r.depth;
    }
    return out;
  }, [rows, collapsed]);
}

/** The search sets (selection sets hold fixed objects and are left out) in the order of the folders. */
const useSearchSets = (wp: WP) => useMemo(() => walkFolder(wp.sets.filter((s) => !isSelectionSet(s)), ''), [wp.sets]);

const DRAG_SET = 'application/x-ip-set';
const DRAG_FOLDER = 'application/x-ip-set-folder';

function MakeTools({ wp }: { wp: WP }) {
  const fields = useModelFields();
  const props = fields.filter((f) => !f.id.startsWith('Attributes.'));
  const [field, setField] = useState('');
  const [spool, setSpool] = useState(false);
  const sets = useSearchSets(wp);
  const folders = useMemo(() => [...new Set(sets.map((s) => s.group).filter(Boolean))], [sets]);
  const byModel = useSelectionStore((s) => s.byModel);
  const pickedKeys = useMemo(() => new Set(Object.entries(byModel).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`))), [byModel]);
  const finds = (s: string) => wp.objects.filter((o) => wp.finds(s, o.key)).length;
  const replace = (next: WorkPackage[], what: string) => {
    if (!next.length) { window.alert(`No packages: ${what} finds no objects in the loaded model.`); return; }
    if (wp.packages.length && !window.confirm(`Replace the ${wp.packages.length} work packages with ${next.length} made ${what}?`)) return;
    wp.save(next);
    useG3.getState().pick(null);
  };
  const fromSelection = () => {
    const guids = wp.objects.filter((o) => pickedKeys.has(o.key)).map((o) => o.guid).filter(Boolean);
    if (!guids.length) return;
    const id = freshId(wp.packages);
    wp.save([...wp.packages, { id, name: `Picked objects ${wp.packages.length + 1}`, color: packageColors(wp.packages.length + 1)[wp.packages.length], parts: [{ guids }] }]);
    useG3.getState().pick(id);
  };
  // The list of search sets to drag from, with their folders as headings (a folder can be dragged too).
  let lastFolder = '';
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Make work packages</h3>
      <p className="scn-dim hint">A work package is a group of objects built together; a package can hold other packages. Start with one click, then rename, split, merge or nest.</p>
      <button type="button" className="btn primary g3-tools__main" disabled={!wp.objects.length} onClick={() => replace(groupByStoreyAndClass(wp.objects, packageColors), 'by storey and type')} title="One package for each kind of object on each storey (the IFC class), bottom storey first">Auto-group by storey and type</button>
      <button type="button" className="btn" disabled={!wp.objects.length} onClick={() => setSpool(true)} title="Pick two properties: a package for each value of the first, holding a package for each value of the second. Can also make the matching search sets">Spool from properties…</button>
      {folders.length > 0 && (
        <button type="button" className="btn" onClick={() => replace(groupByFolders(sets.map((s) => ({ name: s.name, folder: s.group })), FOLDER_SEP, finds, packageColors), 'from your search-set folders')} title="A package for each folder of search sets, holding a package for each folder and set inside it">Auto-group by search-set folders ({folders.length})</button>
      )}
      {sets.length > 0 && (
        <button type="button" className="btn" onClick={() => replace(groupBySets(sets.map((s) => s.name), finds, packageColors), 'from your search sets')} title="One package for each of your search sets (Models › Search sets), in their folders’ order, side by side">One package per search set ({sets.length})</button>
      )}
      <div className="g3-tools__row">
        <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Property" title="A property of the objects: one package for each of its values on each storey">
          <option value="">By storey and a property…</option>
          {props.map((f) => <option key={f.id} value={f.id}>{f.group ? `${f.group} › ` : ''}{f.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={!field} onClick={() => replace(groupByStoreyAndProperty(wp.objects, field, packageColors), `by storey and ${field}`)}>Group</button>
      </div>
      <button type="button" className="btn" disabled={pickedKeys.size === 0} onClick={fromSelection} title={pickedKeys.size ? `A new package of the ${pickedKeys.size} objects picked in 3D` : 'Pick objects in the 3D view first'}>New package from the 3D selection{pickedKeys.size ? ` (${pickedKeys.size})` : ''}</button>
      {sets.length > 0 && (
        <>
          <div className="g3-tools__sub">Your search sets: drag a set or a folder onto a package to add it, or under the list for new packages</div>
          <ul className="g3-sets">
            {sets.map((s) => {
              const head = s.group && s.group !== lastFolder ? s.group : '';
              lastFolder = s.group;
              return (
                <Fragment key={s.id}>
                  {head && <li className="g3-sets__folder" draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_FOLDER, head); e.dataTransfer.effectAllowed = 'copy'; }} title={`Drag the folder “${head}” for a package holding one package per set in it`}>{head}</li>}
                  <li className={s.group ? 'g3-sets__in' : ''} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_SET, s.name); e.dataTransfer.effectAllowed = 'copy'; }} title={`Drag “${s.name}” onto a package to add its objects, or under the list for a new package`}>{s.name}</li>
                </Fragment>
              );
            })}
          </ul>
        </>
      )}
      {spool && <SpoolDialog wp={wp} onClose={() => setSpool(false)} />}
    </div>
  );
}

function OrderTools({ wp }: { wp: WP }) {
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Build order</h3>
      <p className="scn-dim hint">Top is built first. Drag a package to move it (with what it holds); drop it in the middle of another to put it inside. Each package starts when the one above finishes, unless you choose otherwise in its row.</p>
      <button type="button" className="btn primary g3-tools__main" disabled={wp.packages.length < 2} onClick={() => wp.save(orderBottomUp(wp.packages, wp.contents))} title="Lowest storey first; on a storey, the usual order of the kinds of work. Packages stay inside the packages that hold them">Auto-order by level (bottom up)</button>
      <button type="button" className="btn" disabled={wp.packages.length < 2} onClick={() => wp.save(wp.packages.map((p) => { const { link: _l, lagDays: _g, after: _a, ...rest } = p; return rest; }))} title="Every package starts when the one above it has finished, with no gap">Each after the one above</button>
      <div className="g3-tools__sub">Optional</div>
      <FineTuneButton wp={wp} />
    </div>
  );
}

function MethodTools({ wp }: { wp: WP }) {
  const counts = new Map<string, number>();
  for (const p of wp.packages) { if (!(wp.contents.objects.get(p.id)?.length)) continue; const m = wp.methods.get(p.id); if (m) counts.set(m.name, (counts.get(m.name) ?? 0) + 1); }
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Methods</h3>
      <p className="scn-dim hint">Each package already has a method, chosen from what its objects are. Change one in its row if it is wrong. The days come from rough standard rates: type a package’s own days in its row.</p>
      <ul className="g3-counts">{[...counts].map(([name, c]) => <li key={name}><b>{c}</b> {name}</li>)}</ul>
      <div className="g3-tools__sub">Optional</div>
      <button type="button" className="btn" onClick={() => useG3.getState().setRecipeEditor('')} title="This project’s own recipes: a chain of activities with days and crews, for packages that need their own way">Edit recipes…</button>
    </div>
  );
}

type Drop = { id: string; where: 'before' | 'after' | 'inside' };

/** The packages as a tree, one row each; what a row shows depends on the step. */
export function PackageList({ wp }: { wp: WP }) {
  const step = useG3((s) => s.step);
  const picked = useG3((s) => s.picked);
  const pick = useG3((s) => s.pick);
  const collapsed = useG3((s) => s.collapsed);
  const toggle = useG3((s) => s.toggle);
  const rows = useVisibleRows(wp.rows);
  const [drag, setDrag] = useState<{ id: string; over: Drop | null } | null>(null);
  const [setOver, setSetOver] = useState<string | null>(null);
  const holds = (id: string) => (wp.contents.objects.get(id)?.length ?? 0) > 0;
  const dropAt = (e: React.DragEvent, id: string): Drop => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return { id, where: y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside' };
  };
  const addSet = (set: string, into: string | null) => {
    if (into) wp.save(wp.packages.map((p) => (p.id === into ? { ...p, parts: [...p.parts, { set }] } : p)));
    else wp.save([...wp.packages, { id: freshId(wp.packages), name: set, color: packageColors(wp.packages.length + 1)[wp.packages.length], parts: [{ set }] }]);
  };
  const addFolder = (folder: string, into: string | null) => {
    const parentPath = folder.includes(FOLDER_SEP) ? folder.slice(0, folder.lastIndexOf(FOLDER_SEP)) : '';
    const inside = walkFolder(wp.sets.filter((s) => !isSelectionSet(s) && isInFolder(s.group, folder)), '').map((s) => ({ name: s.name, folder: parentPath ? s.group.slice(parentPath.length + FOLDER_SEP.length) : s.group }));
    const made = groupByFolders(inside, FOLDER_SEP, (s) => wp.objects.filter((o) => wp.finds(s, o.key)).length, (k) => packageColors(wp.packages.length + k).slice(wp.packages.length));
    if (made.length) wp.save(appendPackages(wp.packages, made, into ?? undefined));
  };
  const onDrop = (e: React.DragEvent, id: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setSetOver(null);
    if (drag) { if (drag.over && drag.over.id !== drag.id) wp.save(movePackage(wp.packages, drag.id, drag.over.where, drag.over.id)); setDrag(null); return; }
    const s = e.dataTransfer.getData(DRAG_SET);
    if (s) return addSet(s, id);
    const f = e.dataTransfer.getData(DRAG_FOLDER);
    if (f) addFolder(f, id);
  };
  const outside = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_SET) || e.dataTransfer.types.includes(DRAG_FOLDER);
  const title = step === 1 ? 'Work packages' : step === 2 ? 'Build order' : 'Methods';
  const works = wp.rows.filter((r) => holds(r.pkg.id)).length;
  return (
    <div className="g3-list" onDragOver={(e) => { if (outside(e)) e.preventDefault(); }} onDrop={(e) => onDrop(e, null)}>
      <div className="g3-list__head">
        <h3>{title}</h3>
        <span className="scn-dim">{wp.packages.length ? `${works} package${works === 1 ? '' : 's'} with objects${wp.packages.length > works ? ` in ${wp.packages.length - works} group${wp.packages.length - works === 1 ? '' : 's'}` : ''}` : ''}{wp.packages.length > 1 ? ' · drag to move or nest' : ''}</span>
        <ExcelButtons wp={wp} />
      </div>
      {wp.packages.length === 0 ? (
        <div className="g3-empty">
          <b>No work packages yet</b>
          <span>Press <i>Auto-group by storey and type</i>: every kind of object on every storey becomes a package, bottom up. Or <i>Spool from properties</i> on the left for packages inside packages, or drag one of your search sets here.</span>
          <button type="button" className="btn primary" disabled={!wp.objects.length} onClick={() => wp.save(groupByStoreyAndClass(wp.objects, packageColors))}>Auto-group by storey and type</button>
        </div>
      ) : rows.map((r) => {
        const p = r.pkg;
        const own = wp.contents.objects.get(p.id) ?? [];
        const all = wp.contents.all.get(p.id) ?? own;
        const q = quantities(all);
        const m = wp.methods.get(p.id);
        const t = wp.timeline.get(p.id);
        const taken = wp.contents.taken.get(p.id) ?? 0;
        const isPicked = picked === p.id;
        const isGroup = r.children > 0;
        const shut = isGroup && collapsed.includes(p.id);
        const dropCls = drag?.over?.id === p.id && drag.id !== p.id ? ` is-drop-${drag.over.where}` : '';
        const empty = all.length === 0;
        return (
          <Fragment key={p.id}>
            {step === 2 && holds(p.id) && packageAbove(wp, p.id) && <div className="g3-link" style={{ marginLeft: 18 + r.depth * 20 }}><span className="g3-link__arrow" aria-hidden="true">↓</span><span className="scn-dim">starts</span><StartSelect wp={wp} p={p} /></div>}
            <div className={`g3-pkg${isGroup ? ' g3-pkg--group' : ''}${isPicked ? ' is-picked' : ''}${dropCls}${setOver === p.id ? ' is-drop-in' : ''}${empty ? ' is-empty' : ''}`}
              style={{ marginLeft: r.depth * 20 }}
              onClick={() => pick(isPicked ? null : p.id)}
              draggable={step !== 3}
              onDragStart={(e) => { if (step === 3) return; e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); setDrag({ id: p.id, over: null }); }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (drag) { e.preventDefault(); e.stopPropagation(); const d = dropAt(e, p.id); if (subtreeIds(wp.packages, drag.id).includes(p.id)) return; if (drag.over?.id !== d.id || drag.over.where !== d.where) setDrag({ ...drag, over: d }); return; }
                if (outside(e)) { e.preventDefault(); e.stopPropagation(); setSetOver(p.id); }
              }}
              onDragLeave={() => setSetOver(null)}
              onDrop={(e) => onDrop(e, p.id)}>
              {isGroup
                ? <button type="button" className="g3-pkg__fold" aria-expanded={!shut} aria-label={shut ? 'Show the packages inside' : 'Fold the packages inside'} title={shut ? `Show the ${r.children} packages inside` : 'Fold the packages inside'} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>{shut ? <IconChevronRight /> : <IconChevronDown />}</button>
                : step !== 3 ? <span className="g3-pkg__grip" aria-hidden="true"><IconDragVert /></span> : <span className="g3-pkg__fold" aria-hidden="true" />}
              <span className="g3-pkg__strip" style={{ background: p.color }} aria-hidden="true" />
              <div className="g3-pkg__main">
                <div className="g3-pkg__line">
                  <span className="g3-pkg__code">{r.code}</span>
                  {step === 1
                    ? <input className="g3-pkg__name" value={p.name} aria-label="Package name" spellCheck={false} onClick={(e) => e.stopPropagation()} onChange={(e) => wp.patch(p.id, { name: e.target.value })} />
                    : <span className="g3-pkg__title">{p.name || 'Package'}</span>}
                  <span className="g3-pkg__size">{sizeText(q)}</span>
                </div>
                {(step !== 3 || !holds(p.id)) && (
                  <div className="g3-pkg__sub scn-dim">
                    {isGroup ? `${r.children} package${r.children === 1 ? '' : 's'} inside${t ? ` · about ${daysText(t.finish - t.start)} in all` : ''}${own.length ? ` · ${n(own.length)} of its own objects` : ''}`
                      : m && own.length ? `${m.name} · about ${daysText(m.days)}` : ''}
                    {taken > 0 ? ` · ${n(taken)} more objects are in another package` : ''}
                    {empty ? 'No objects of the loaded model: add a search set, or delete it' : ''}
                    {isFineTuned(p) && own.length > 0 && <button type="button" className="source-chip g3-pkg__chip" onClick={(e) => { e.stopPropagation(); pick(p.id); useG3.getState().setOrderDialog('picked'); }} title="Its objects are built one by one in an order of their own: click to see or change it">objects in their own order</button>}
                  </div>
                )}
                {step === 3 && m && holds(p.id) && (
                  <div className="g3-pkg__method" onClick={(e) => e.stopPropagation()}>
                    <MethodSelect wp={wp} p={p} m={m} />
                    <span className="g3-pkg__chain" title={m.activities.map((a) => `${a.name}: ${n(a.days, 1)} days (${a.how})`).join('\n')}>{m.activities.map((a) => a.name).join(' → ') || 'one activity'}{m.crew ? ` · ${m.crew}` : ''}</span>
                    <label className="g3-pkg__days" title={`Type this package’s days to fix them; leave it empty for the estimate (${daysText(m.estimate)}). Its activities share the days as their estimates do`}>
                      <NumberField value={p.totalDays} placeholder={n(m.estimate, 1)} label="Days for this package" onChange={(v) => wp.patch(p.id, { totalDays: v, ...(v ? { days: undefined } : {}) })} /> days
                    </label>
                  </div>
                )}
              </div>
              {step === 1 && (
                <span onClick={(e) => e.stopPropagation()}>
                  <PackageMenu wp={wp} r={r} />
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
      {wp.packages.length > 0 && step === 1 && <div className="g3-list__drop scn-dim">Drop a search set or folder here for new packages</div>}
    </div>
  );
}

/** A package's menu (step 1): split, nest, merge, delete. */
function PackageMenu({ wp, r }: { wp: WP; r: Row }) {
  const p = r.pkg;
  const own = wp.contents.objects.get(p.id) ?? [];
  const siblings = wp.rows.filter((x) => x.pkg.parent === p.parent);
  const at = siblings.findIndex((x) => x.pkg.id === p.id);
  const next = siblings[at + 1]?.pkg;
  const prev = siblings[at - 1]?.pkg;
  const leaf = r.children === 0;
  const storeys = new Set(own.map((o) => o.storey)).size;
  const classes = new Set(own.map((o) => o.cls)).size;
  const wrap = () => {
    const id = freshId(wp.packages);
    const group: WorkPackage = { id, name: `${p.name} group`, color: p.color, parts: [], ...(p.parent ? { parent: p.parent } : {}) };
    const placed = movePackage([...wp.packages, group], id, 'before', p.id);
    wp.save(movePackage(placed, p.id, 'inside', id));
    useG3.getState().pick(id);
  };
  return (
    <OverflowMenu items={[
      { label: 'Split by storey, inside it', onClick: () => wp.save(splitPackage(wp.packages, p.id, 'storey', own, packageColors, true)), disabled: !leaf || storeys < 2, title: 'It holds one package for each storey its objects are on' },
      { label: 'Split by type, inside it', onClick: () => wp.save(splitPackage(wp.packages, p.id, 'cls', own, packageColors, true)), disabled: !leaf || classes < 2, title: 'It holds one package for each kind of object (IFC class) in it' },
      { label: 'Split by storey, side by side', onClick: () => wp.save(splitPackage(wp.packages, p.id, 'storey', own, packageColors)), disabled: !leaf || storeys < 2, title: 'One package for each storey, in its place' },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Put inside the package above', onClick: () => wp.save(indentPackage(wp.packages, p.id)), disabled: !prev, title: prev ? `Inside “${prev.name}”` : 'There is no package above it at this level' },
      { label: 'Take out of its package', onClick: () => wp.save(outdentPackage(wp.packages, p.id)), disabled: !p.parent, title: 'It comes after the package it was in' },
      { label: 'New package around it', onClick: wrap, title: 'A new package that holds this one; drag others into it' },
      { label: 'Merge with the one below', onClick: () => wp.save(mergePackages(wp.packages, p.id, next!.id)), disabled: !next, title: next ? `With “${next.name}”` : 'There is no package below it at this level' },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Delete the package', onClick: () => { wp.save(removePackage(wp.packages, p.id)); if (useG3.getState().picked === p.id) useG3.getState().pick(null); }, title: leaf ? 'Its objects are not in the schedule unless another package holds them' : 'The packages inside it are kept and move up a level' },
    ]} />
  );
}

/** A rough timeline of the packages before Generate: a bar for each package with objects (its method's days, placed by its link) and a summary bar
    over each package that holds others. */
export function Timeline({ wp }: { wp: WP }) {
  const picked = useG3((s) => s.picked);
  const pick = useG3((s) => s.pick);
  const rows = useVisibleRows(wp.rows);
  const end = Math.max(1, ...[...wp.timeline.values()].map((t) => t.finish));
  const step = end <= 20 ? 5 : end <= 60 ? 10 : end <= 200 ? 25 : 50;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const shown = picked ? new Set(subtreeIds(wp.packages, picked)) : null;
  return (
    <div className="g3-time">
      <div className="g3-list__head"><h3>Timeline preview</h3><span className="scn-dim" title="Working days from the start, from each package’s method and its link. Generate works out the real dates, crews and limits">rough, before Generate</span></div>
      {wp.packages.length === 0 ? <div className="scn-dim g3-time__none">The packages show here as bars once you have made them.</div> : (
        <>
          <div className="g3-time__axis">{ticks.map((t) => <span key={t} style={{ left: `${(t / end) * 100}%` }}>Day {t}</span>)}</div>
          <div className="g3-time__rows">
            {rows.map((r) => {
              const p = r.pkg;
              const t = wp.timeline.get(p.id);
              const group = r.children > 0;
              return (
                <button type="button" key={p.id} className={`g3-time__row${picked === p.id ? ' is-picked' : ''}${shown && !shown.has(p.id) ? ' is-faded' : ''}`} onClick={() => pick(picked === p.id ? null : p.id)} title={t ? `${r.code} ${p.name}: day ${n(t.start, 1)} to day ${n(t.finish, 1)}` : `${r.code} ${p.name}: no objects, no bar`}>
                  <span className="g3-time__code" style={{ paddingLeft: r.depth * 8 }}>{r.code}</span>
                  <span className="g3-time__track">
                    {t && <span className={`g3-time__bar${group ? ' g3-time__bar--sum' : ''}`} style={{ left: `${(t.start / end) * 100}%`, width: `${Math.max(0.8, ((t.finish - t.start) / end) * 100)}%`, ...(group ? {} : { background: p.color }) }} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="g3-time__total">About <b>{n(end, 1)}</b> working days in all</div>
        </>
      )}
    </div>
  );
}

/** Step 2's way into the object order: for the package picked, or for every package. */
function FineTuneButton({ wp }: { wp: WP }) {
  const picked = useG3((s) => s.picked);
  const p = wp.packages.find((x) => x.id === picked);
  const holds = !!p && (wp.contents.objects.get(p.id)?.length ?? 0) > 0;
  const tuned = wp.packages.filter(isFineTuned).length;
  return (
    <>
      <button type="button" className="btn" disabled={!wp.packages.length} onClick={() => useG3.getState().setOrderDialog(holds ? 'picked' : 'all')}
        title="Build a package’s objects one by one in an order you set, typed or taken from another scenario, your sets or an Excel list. The packages keep their order">Fine-tune object order…</button>
      <p className="scn-dim g3-tools__note">{holds ? `For “${p!.name}”, the package picked.` : 'Pick a package for its objects, or set an order for every package.'}{tuned ? ` ${tuned} package${tuned === 1 ? ' has' : 's have'} an object order.` : ''}</p>
    </>
  );
}
