import { useEffect, useMemo, useState } from 'react';
import { useSelectionStore } from '../../../state/selectionStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { FOLDER_SEP } from '../../../viewer/setTree';
import type { SearchSet } from '../../../viewer/searchSets';
import { CLASS_FIELD, STOREY_FIELD, appendPackages, spoolPackages, spoolTree, whereParts, type PackagePart, type SpoolNode, type WorkPackage } from '../../../prs/workPackages';
import { useModelFields } from '../../modelFields';
import { IconClose } from '../../icons';
import { packageColors, useG3, type useWorkPackages } from './useWorkPackages';

/** "Spool from properties" (Generate 3, step 1): a package for each value of one property (level 0), holding a package for each value of a second
    property (level 1) among its objects, so the breakdown is built in one go. It can also make the matching search sets: a folder for each level 0
    value with a set for each level 1 value, in a folder named after the two properties (existing sets are never changed or deleted). The objects in
    scope are every object of the loaded models, or those picked in 3D. */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const STOREY_LABEL = 'Storey (from the model’s structure)';

export function SpoolDialog({ wp, onClose }: { wp: WP; onClose: () => void }) {
  const fields = useModelFields();
  const choices = useMemo(() => [
    { id: STOREY_FIELD, label: STOREY_LABEL, group: 'From the model' },
    { id: CLASS_FIELD, label: 'Type (IFC class)', group: 'From the model' },
    ...fields.filter((f) => !f.id.startsWith('Attributes.')).map((f) => ({ id: f.id, label: f.label, group: f.group ?? 'Other' })),
  ], [fields]);
  const groups = [...new Set(choices.map((c) => c.group))];
  const labelOf = (id: string) => (id === STOREY_FIELD ? 'Storey' : choices.find((c) => c.id === id)?.label ?? id);
  const [top, setTop] = useState('');
  const [sub, setSub] = useState('');
  const [makeSets, setMakeSets] = useState(true);
  const [replace, setReplace] = useState(false);
  const byModel = useSelectionStore((s) => s.byModel);
  const pickedKeys = useMemo(() => new Set(Object.entries(byModel).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`))), [byModel]);
  const [onlyPicked, setOnlyPicked] = useState(pickedKeys.size > 0);
  const scope = useMemo(() => (onlyPicked && pickedKeys.size ? wp.objects.filter((o) => pickedKeys.has(o.key)) : wp.objects), [onlyPicked, pickedKeys, wp.objects]);
  const { tree, missing } = useMemo(() => (top && sub && top !== sub ? spoolTree(scope, top, sub) : { tree: [] as SpoolNode[], missing: 0 }), [scope, top, sub]);
  const children = tree.reduce((k, t) => k + t.children.length, 0);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const create = () => {
    // The search sets first (when asked for), so the packages can be made of them.
    const setNames = new Map<string, string>();
    if (makeSets) {
      const store = useSearchSetsStore.getState();
      const taken = new Set(store.sets.map((s) => s.name.trim().toUpperCase()));
      const clean = (s: string) => s.split(FOLDER_SEP).join(' - ').trim() || 'No value';
      const root = clean(`${labelOf(top)} and ${labelOf(sub)}`);
      // A storey is not a property a search can test, and a scope of picked objects is not one either: those sets hold their objects.
      const fixed = top === STOREY_FIELD || sub === STOREY_FIELD || (onlyPicked && pickedKeys.size > 0);
      for (const t of tree) for (const s of t.children) {
        let name = `${clean(t.label)} ${clean(s.label)}`;
        for (let k = 2; taken.has(name.toUpperCase()); k++) name = `${clean(t.label)} ${clean(s.label)} (${k})`;
        taken.add(name.toUpperCase());
        const set: SearchSet = fixed
          ? { id: crypto.randomUUID(), name, group: `${root}${FOLDER_SEP}${clean(t.label)}`, kind: 'selection', match: 'all', conditions: [], items: s.objects.map((o) => ({ model: '', guid: o.guid })).filter((x) => x.guid) }
          : { id: crypto.randomUUID(), name, group: `${root}${FOLDER_SEP}${clean(t.label)}`, kind: 'search', match: 'all', conditions: [{ id: crypto.randomUUID(), field: top, op: 'equals', value: t.value }, { id: crypto.randomUUID(), field: sub, op: 'equals', value: s.value }] };
        store.save(set);
        setNames.set(`${t.value}\u0001${s.value}`, name);
      }
    }
    const part = (t: SpoolNode, s: SpoolNode['children'][number]): PackagePart => {
      const set = setNames.get(`${t.value}\u0001${s.value}`);
      if (set) return { set };
      if (onlyPicked && pickedKeys.size) return { guids: s.objects.map((o) => o.guid).filter(Boolean) };
      return whereParts(top, t.value, sub, s.value);
    };
    const base: WorkPackage[] = replace ? [] : wp.packages;
    const made = spoolPackages(tree, base, (k) => packageColors(base.length + k).slice(base.length), part);
    wp.save(replace ? made : appendPackages(base, made));
    useG3.getState().pick(null);
    onClose();
  };

  const pickField = (value: string, set: (v: string) => void, label: string, other: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      <option value="">Choose a property…</option>
      {groups.map((g) => <optgroup key={g} label={g}>{choices.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id} disabled={c.id === other}>{c.label}</option>)}</optgroup>)}
    </select>
  );

  return (
    <div className="project-picker__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="g3-dlg" role="dialog" aria-modal="true" aria-labelledby="g3-spool-title">
        <div className="g3-dlg__head">
          <h3 id="g3-spool-title">Spool from properties</h3>
          <button type="button" className="g3-dlg__close" onClick={onClose} aria-label="Close" title="Close without making packages (Esc)"><IconClose /></button>
        </div>
        <div className="g3-dlg__body">
          <p className="scn-dim hint">Pick two properties of the objects. Each value of the first becomes a package; inside it, each value of the second becomes a package of its own.</p>
          <div className="g3-form">
            <label className="g3-form__row"><span>Level 0 property</span>{pickField(top, setTop, 'Level 0 property', sub)}<small className="scn-dim">The top packages: one for each of its values.</small></label>
            <label className="g3-form__row"><span>Level 1 property</span>{pickField(sub, setSub, 'Level 1 property', top)}<small className="scn-dim">Inside each top package: one package for each of its values there.</small></label>
            <label className="g3-form__check"><input type="checkbox" checked={makeSets} onChange={(e) => setMakeSets(e.target.checked)} /><span>Also create search sets<small className="scn-dim">A folder for each top package with a set for each package inside, in a folder named after the two properties. Your other sets are not changed.</small></span></label>
            {pickedKeys.size > 0 && <label className="g3-form__check"><input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} /><span>Only the {n(pickedKeys.size)} objects picked in 3D<small className="scn-dim">Otherwise every object of the loaded models.</small></span></label>}
            {wp.packages.length > 0 && <label className="g3-form__check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span>Replace the {wp.packages.length} packages I have<small className="scn-dim">Otherwise the new packages go after them (objects already in a package stay there).</small></span></label>}
          </div>
          <div className="g3-spool">
            <div className="g3-spool__head">Preview{tree.length ? ` · ${tree.length} top package${tree.length === 1 ? '' : 's'}, ${children} inside` : ''}</div>
            {!top || !sub ? <div className="scn-dim g3-spool__none">Pick both properties to see the packages that will be made.</div>
              : tree.length === 0 ? <div className="scn-dim g3-spool__none">No object in scope has a value of both properties.</div>
              : (
                <ul className="g3-spool__list">
                  {tree.map((t) => (
                    <li key={t.value}>
                      <div className="g3-spool__top"><b>{t.label}</b><span className="scn-dim">{n(t.count)} objects{t.volume > 0 ? ` · ${n(t.volume)} m³` : ''}</span></div>
                      <ul>{t.children.map((s) => <li key={s.value}><span>{t.label} → {s.label}</span><span className="scn-dim">{n(s.objects.length)} objects{s.volume > 0 ? ` · ${n(s.volume, s.volume < 10 ? 1 : 0)} m³` : ''}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            {missing > 0 && <div className="scn-dim g3-spool__none">{n(missing)} object{missing === 1 ? ' has' : 's have'} no value of one of the two properties and {missing === 1 ? 'is' : 'are'} left out.</div>}
          </div>
        </div>
        <div className="g3-dlg__foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!tree.length} onClick={create}>Create work packages</button>
        </div>
      </div>
    </div>
  );
}
