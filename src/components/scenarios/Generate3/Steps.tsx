import { Fragment, useMemo, useState } from 'react';
import { useScenarioStore, isDirty } from '../../../state/scenarioStore';
import { useSelectionStore } from '../../../state/selectionStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { walkFolder } from '../../../viewer/setTree';
import { isSelectionSet } from '../../../viewer/searchSets';
import { STANDARD_METHODS } from '../../../prs/standardMethods';
import {
  codeOf, freshId, groupBySets, groupByStoreyAndClass, groupByStoreyAndProperty, mergePackages, orderBottomUp, quantities, splitPackage,
  type PackageLink, type WorkPackage,
} from '../../../prs/workPackages';
import { useModelFields } from '../../modelFields';
import { OverflowMenu } from '../../TablePopovers';
import { IconChevronDown, IconChevronRight, IconDragVert } from '../../icons';
import { packageColors, useG3, useWorkPackages, type G3Step } from './useWorkPackages';

/** Generate 3, the guided way from a model to a programme, in three steps that are the header's tabs: 1 make work packages of the model's objects,
    2 put them in build order with simple "starts after" links, 3 check the method each is built with, and Generate. The page (pages/Generate3Page.tsx)
    shows the model on the left with the step's tools under it, the packages in the middle and a rough timeline on the right. */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const sizeText = (q: { count: number; volume: number }) => `${n(q.count)} object${q.count === 1 ? '' : 's'}${q.volume > 0 ? ` · ${n(q.volume, q.volume < 10 ? 1 : 0)} m³` : ''}`;

export const STEPS: { id: G3Step; label: string; tip: string }[] = [
  { id: 1, label: '1 - Work packages', tip: 'Group the model’s objects into work packages: automatically, or from your search sets' },
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

/** Search sets in the order of the folders (selection sets hold fixed objects and are left out). */
const useSetNames = (wp: WP) => useMemo(() => walkFolder(wp.sets.filter((s) => !isSelectionSet(s)), '').map((s) => s.name), [wp.sets]);

function MakeTools({ wp }: { wp: WP }) {
  const fields = useModelFields();
  const props = fields.filter((f) => !f.id.startsWith('Attributes.'));
  const [field, setField] = useState('');
  const setNames = useSetNames(wp);
  const byModel = useSelectionStore((s) => s.byModel);
  const pickedKeys = useMemo(() => new Set(Object.entries(byModel).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`))), [byModel]);
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
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Make work packages</h3>
      <p className="scn-dim hint">A work package is a group of objects built together. Start with one click, then rename, split or merge.</p>
      <button type="button" className="btn primary g3-tools__main" disabled={!wp.objects.length} onClick={() => replace(groupByStoreyAndClass(wp.objects, packageColors), 'by storey and type')} title="One package for each kind of object on each storey (the IFC class: walls, slabs, columns…), bottom storey first">Auto-group by storey and type</button>
      {setNames.length > 0 && (
        <button type="button" className="btn" onClick={() => replace(groupBySets(setNames, (s) => wp.objects.filter((o) => wp.finds(s, o.key)).length, packageColors), 'from your search sets')} title="One package for each of your search sets (Models › Search sets), in their folders’ order">One package per search set ({setNames.length})</button>
      )}
      <div className="g3-tools__row">
        <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Property" title="A property of the objects: one package for each of its values on each storey">
          <option value="">By storey and a property…</option>
          {props.map((f) => <option key={f.id} value={f.id}>{f.group ? `${f.group} › ` : ''}{f.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={!field} onClick={() => replace(groupByStoreyAndProperty(wp.objects, field, packageColors), `by storey and ${field}`)}>Group</button>
      </div>
      <button type="button" className="btn" disabled={pickedKeys.size === 0} onClick={fromSelection} title={pickedKeys.size ? `A new package of the ${pickedKeys.size} objects picked in 3D` : 'Pick objects in the 3D view first'}>New package from the 3D selection{pickedKeys.size ? ` (${pickedKeys.size})` : ''}</button>
      {setNames.length > 0 && (
        <>
          <div className="g3-tools__sub">Your search sets: drag one onto a package to add it</div>
          <ul className="g3-sets">{setNames.map((s) => <li key={s} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-ip-set', s); e.dataTransfer.effectAllowed = 'copy'; }} title={`Drag “${s}” onto a package to add its objects, or onto the empty space under the list for a new package`}>{s}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function OrderTools({ wp }: { wp: WP }) {
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Build order</h3>
      <p className="scn-dim hint">Top is built first. Drag a package to move it. Between two packages, choose whether the lower one starts after the upper one finishes, or together with it.</p>
      <button type="button" className="btn primary g3-tools__main" disabled={wp.packages.length < 2} onClick={() => wp.save(orderBottomUp(wp.packages, wp.contents))} title="Lowest storey first; on a storey, the usual order of the kinds of work">Auto-order bottom up</button>
      <button type="button" className="btn" disabled={wp.packages.length < 2} onClick={() => wp.save(wp.packages.map((p) => ({ ...p, link: undefined, lagDays: undefined })))} title="Every package starts when the one above it has finished, with no gap">Each after the one above</button>
    </div>
  );
}

function MethodTools({ wp }: { wp: WP }) {
  const counts = new Map<string, number>();
  for (const p of wp.packages) { const m = wp.methods.get(p.id); if (m) counts.set(m.name, (counts.get(m.name) ?? 0) + 1); }
  return (
    <div className="g3-tools">
      <h3 className="g3-tools__title">Methods</h3>
      <p className="scn-dim hint">Each package already has a method, chosen from what its objects are. Change one in its row if it is wrong. The days come from rough standard rates: type your own in a package’s row.</p>
      <ul className="g3-counts">{[...counts].map(([name, c]) => <li key={name}><b>{c}</b> {name}</li>)}</ul>
    </div>
  );
}

/** The packages, one row each; what a row shows depends on the step. */
export function PackageList({ wp }: { wp: WP }) {
  const step = useG3((s) => s.step);
  const picked = useG3((s) => s.picked);
  const pick = useG3((s) => s.pick);
  const recipes = useRecipeStore((s) => s.recipes);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [setOver, setSetOver] = useState<string | null>(null);
  const move = (to: number) => {
    if (!drag || drag.from === to || drag.from + 1 === to) return setDrag(null);
    const next = [...wp.packages];
    const [m] = next.splice(drag.from, 1);
    next.splice(to > drag.from ? to - 1 : to, 0, m);
    wp.save(next);
    setDrag(null);
  };
  const addSet = (set: string, into: string | null) => {
    if (into) wp.save(wp.packages.map((p) => (p.id === into ? { ...p, parts: [...p.parts, { set }] } : p)));
    else wp.save([...wp.packages, { id: freshId(wp.packages), name: set, color: packageColors(wp.packages.length + 1)[wp.packages.length], parts: [{ set }] }]);
  };
  const title = step === 1 ? 'Work packages' : step === 2 ? 'Build order' : 'Methods';
  return (
    <div className="g3-list" onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-ip-set')) e.preventDefault(); }} onDrop={(e) => { const s = e.dataTransfer.getData('application/x-ip-set'); if (s) { e.preventDefault(); addSet(s, null); } }}>
      <div className="g3-list__head"><h3>{title}</h3><span className="scn-dim">{wp.packages.length ? `${wp.packages.length} package${wp.packages.length === 1 ? '' : 's'}` : ''}{step === 2 && wp.packages.length > 1 ? ' · drag to reorder' : ''}</span></div>
      {wp.packages.length === 0 ? (
        <div className="g3-empty">
          <b>No work packages yet</b>
          <span>Press <i>Auto-group by storey and type</i> on the left: every kind of object on every storey becomes a package, bottom up. Or drag one of your search sets here.</span>
          <button type="button" className="btn primary" disabled={!wp.objects.length} onClick={() => wp.save(groupByStoreyAndClass(wp.objects, packageColors))}>Auto-group by storey and type</button>
        </div>
      ) : wp.packages.map((p, i) => {
        const objs = wp.contents.objects.get(p.id) ?? [];
        const q = quantities(objs);
        const m = wp.methods.get(p.id);
        const taken = wp.contents.taken.get(p.id) ?? 0;
        const isPicked = picked === p.id;
        return (
          <Fragment key={p.id}>
            {step === 2 && i > 0 && <LinkRow p={p} onChange={(link, lagDays) => wp.patch(p.id, { link, lagDays })} />}
            <div className={`g3-pkg${isPicked ? ' is-picked' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}${setOver === p.id ? ' is-drop-in' : ''}${objs.length === 0 ? ' is-empty' : ''}`}
              onClick={() => pick(isPicked ? null : p.id)}
              draggable={step === 2}
              onDragStart={(e) => { if (step !== 2) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); setDrag({ from: i, over: null }); }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); return; }
                if (e.dataTransfer.types.includes('application/x-ip-set')) { e.preventDefault(); e.stopPropagation(); setSetOver(p.id); }
              }}
              onDragLeave={() => setSetOver(null)}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setSetOver(null); if (drag) return move(i); const s = e.dataTransfer.getData('application/x-ip-set'); if (s) addSet(s, p.id); }}>
              {step === 2 && <span className="g3-pkg__grip" aria-hidden="true"><IconDragVert /></span>}
              <span className="g3-pkg__strip" style={{ background: p.color }} aria-hidden="true" />
              <div className="g3-pkg__main">
                <div className="g3-pkg__line">
                  <span className="g3-pkg__code">{codeOf(i)}</span>
                  {step === 1
                    ? <input className="g3-pkg__name" value={p.name} aria-label="Package name" spellCheck={false} onClick={(e) => e.stopPropagation()} onChange={(e) => wp.patch(p.id, { name: e.target.value })} />
                    : <span className="g3-pkg__title">{p.name || 'Package'}</span>}
                  <span className="g3-pkg__size">{sizeText(q)}</span>
                </div>
                {step !== 3 && <div className="g3-pkg__sub scn-dim">{m ? `${m.name} · about ${n(m.days)} day${m.days === 1 ? '' : 's'}` : ''}{taken > 0 ? ` · ${n(taken)} more objects are in an earlier package` : ''}{objs.length === 0 ? 'No objects of the loaded model: add a search set, or delete it' : ''}</div>}
                {step === 3 && m && (
                  <div className="g3-pkg__method" onClick={(e) => e.stopPropagation()}>
                    <select value={p.method ?? ''} aria-label="Method" title={m.chosen ? 'Chosen by you' : `Chosen because ${m.why}`} onChange={(e) => wp.patch(p.id, { method: e.target.value || undefined, days: undefined })}>
                      <option value="">{p.method ? 'Back to the automatic choice' : `${m.name} (automatic)`}</option>
                      <optgroup label="Standard methods">{STANDARD_METHODS.map((s) => <option key={s.id} value={`std:${s.id}`}>{s.name}</option>)}</optgroup>
                      {chains.length > 0 && <optgroup label="This project’s recipes">{chains.map((r) => <option key={r.id} value={`recipe:${r.id}`}>{r.name?.trim() || r.id}</option>)}</optgroup>}
                    </select>
                    <span className="g3-pkg__chain" title={m.chosen ? 'Chosen by you' : `Chosen automatically: ${m.why}`}>{m.activities.map((a) => a.name).join(' → ') || 'one activity'}{m.crew ? ` · ${m.crew}` : ''} · about <b>{n(m.days)}</b> day{m.days === 1 ? '' : 's'}</span>
                    <button type="button" className="cols__icon" aria-expanded={open === p.id} aria-label="Change the days" title="See and change the days of each activity" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? <IconChevronDown /> : <IconChevronRight />}</button>
                  </div>
                )}
                {step === 3 && m && open === p.id && (
                  <div className="g3-days" onClick={(e) => e.stopPropagation()}>
                    {m.activities.map((a) => (
                      <label key={a.phase} className="g3-days__row" title={a.how}>
                        <span>{a.name}</span>
                        <input type="text" inputMode="decimal" value={p.days?.[a.phase] ?? ''} placeholder={String(a.days)} aria-label={`Days of ${a.name}`}
                          onChange={(e) => { const v = e.target.value.trim(); const d = Number(v.replace(',', '.')); const days = { ...p.days }; if (v === '' || !Number.isFinite(d) || d < 0) delete days[a.phase]; else days[a.phase] = d; wp.patch(p.id, { days: Object.keys(days).length ? days : undefined }); }} />
                        <span className="scn-dim">days · {a.fixed ? 'set here' : a.how}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {step === 1 && (
                <span onClick={(e) => e.stopPropagation()}>
                  <OverflowMenu items={[
                    { label: 'Split by storey', onClick: () => wp.save(splitPackage(wp.packages, p.id, 'storey', objs, packageColors)), disabled: new Set(objs.map((o) => o.storey)).size < 2, title: 'One package for each storey its objects are on' },
                    { label: 'Split by type', onClick: () => wp.save(splitPackage(wp.packages, p.id, 'cls', objs, packageColors)), disabled: new Set(objs.map((o) => o.cls)).size < 2, title: 'One package for each kind of object (IFC class) in it' },
                    { label: 'Merge with the one below', onClick: () => wp.save(mergePackages(wp.packages, p.id, wp.packages[i + 1].id)), disabled: i === wp.packages.length - 1 },
                    { separator: true, label: '', onClick: () => {} },
                    { label: 'Delete the package', onClick: () => { wp.save(wp.packages.filter((x) => x.id !== p.id)); if (isPicked) pick(null); }, title: 'Its objects are not in the schedule unless another package holds them' },
                  ]} />
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
      {wp.packages.length > 0 && step === 1 && <div className="g3-list__drop scn-dim">Drop a search set here for a new package</div>}
    </div>
  );
}

/** Between two packages in the Sequence step: how the lower one follows the upper one. */
function LinkRow({ p, onChange }: { p: WorkPackage; onChange: (link: PackageLink | undefined, lag: number | undefined) => void }) {
  const link = p.link ?? 'after';
  return (
    <div className="g3-link">
      <span className="g3-link__arrow" aria-hidden="true">↓</span>
      <select value={link} aria-label="How it follows the package above" onChange={(e) => onChange(e.target.value === 'with' ? 'with' : undefined, p.lagDays)}>
        <option value="after">starts after the one above finishes</option>
        <option value="with">starts together with the one above</option>
      </select>
      <label className="scn-dim">+ <input type="text" inputMode="decimal" value={p.lagDays ?? ''} placeholder="0" aria-label="Lag in working days" onChange={(e) => { const d = Number(e.target.value.replace(',', '.')); onChange(p.link, e.target.value.trim() === '' || !Number.isFinite(d) || d <= 0 ? undefined : d); }} /> days</label>
    </div>
  );
}

/** A rough timeline of the packages before Generate: one bar each, from the days of its method and how it follows the one above. */
export function Timeline({ wp }: { wp: WP }) {
  const picked = useG3((s) => s.picked);
  const pick = useG3((s) => s.pick);
  const end = Math.max(1, ...wp.timeline.map((t) => t.finish));
  const step = end <= 20 ? 5 : end <= 60 ? 10 : end <= 200 ? 25 : 50;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  return (
    <div className="g3-time">
      <div className="g3-list__head"><h3>Timeline preview</h3><span className="scn-dim" title="Working days from the start, from each package’s method and its link to the one above. Generate works out the real dates, crews and limits">rough, before Generate</span></div>
      {wp.packages.length === 0 ? <div className="scn-dim g3-time__none">The packages show here as bars once you have made them.</div> : (
        <>
          <div className="g3-time__axis">{ticks.map((t) => <span key={t} style={{ left: `${(t / end) * 100}%` }}>Day {t}</span>)}</div>
          <div className="g3-time__rows">
            {wp.packages.map((p, i) => {
              const t = wp.timeline[i];
              return (
                <button type="button" key={p.id} className={`g3-time__row${picked === p.id ? ' is-picked' : ''}`} onClick={() => pick(picked === p.id ? null : p.id)} title={`${codeOf(i)} ${p.name}: day ${n(t.start)} to day ${n(t.finish)}`}>
                  <span className="g3-time__code">{codeOf(i)}</span>
                  <span className="g3-time__track"><span className="g3-time__bar" style={{ left: `${(t.start / end) * 100}%`, width: `${Math.max(0.8, ((t.finish - t.start) / end) * 100)}%`, background: p.color }} /></span>
                </button>
              );
            })}
          </div>
          <div className="g3-time__total">About <b>{n(end)}</b> working days in all</div>
        </>
      )}
    </div>
  );
}
