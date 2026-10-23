import { useMemo } from 'react';
import { usePersistedState } from '../../../utils/persistedState';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useWorkItems } from '../useWorkItems';
import { InfoTip } from '../../InfoTip';
import { propertyLabel } from '../../../scenarios/breakdownSource';
import { SET_FOLDER } from '../../../viewer/setFolderValues';
import { LEVEL_ROLES, LEVEL_SORTS, freshLevelId, makesItems, type BreakdownDefinition, type GroupingLevel } from '../../../prs/workBreakdown';
import { IconRemove } from '../../icons';
import { ATTRIBUTES } from '../../../viewer/bimTables';
import { useModelFields } from '../../modelFields';
import { useRuleContext } from './RuleParts';

/** The grouping levels of the work breakdown (prs/workBreakdown.ts), like the Group panel of the N-menu: each level is a property of the objects or a folder
    of search sets, with a role and a sort. The objects are grouped by the levels in order and each group at the end is a work item. Saved with the scenario's
    rules (rules.breakdown). With a level whose role is Work item, Update 4D makes the programme from these work items; with none, from the list above. */

const PREVIEW_ROWS = 200;

export function GroupingLevels() {
  const ctx = useRuleContext();
  const sets = useSearchSetsStore((s) => s.sets);
  const fields = useModelFields();
  const def: BreakdownDefinition = ctx.rules.breakdown ?? { levels: [] };
  const save = (next: BreakdownDefinition) => ctx.change((r) => {
    const { breakdown: _b, ...rest } = r;
    return next.levels.length || next.quantityProperty ? { ...rest, breakdown: next } : rest;
  });
  const setLevel = (i: number, patch: Partial<GroupingLevel>) => save({ ...def, levels: def.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= def.levels.length) return;
    const levels = [...def.levels];
    [levels[i], levels[to]] = [levels[to], levels[i]];
    save({ ...def, levels });
  };
  const add = () => save({ ...def, levels: [...def.levels, { id: freshLevelId(def.levels), name: '', source: { kind: 'property', property: '' }, role: def.levels.some((l) => l.role === 'item') ? 'structure' : 'item', sort: 'natural' }] });

  const folders = useMemo(() => [...new Set(sets.map((s) => s.group ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b)), [sets]);
  // The model's properties, and a "Set" property for each folder of search sets (the name of the set that holds the object).
  const properties = useMemo(() => ['Class', 'Name', ...fields.filter((f) => f.group !== ATTRIBUTES).map((f) => f.id), ...folders.map((f) => SET_FOLDER + f)], [fields, folders]);
  const active = makesItems(def);
  const built = useWorkItems();
  const shownLevels = built?.levels ?? [];

  // Folded until opened (remembered); its title says whether the levels make the programme, so the fold never hides what is in charge.
  const [open, setOpen] = usePersistedState<boolean>('generate.groupingOpen', false);
  const state = active
    ? `in charge: ${(built?.leaves.length ?? 0).toLocaleString()} work item${built?.leaves.length === 1 ? '' : 's'}`
    : def.levels.length ? 'not in charge: no level has the role Work item' : 'none: the list above is in charge';

  return (
    <details className="gen-order__levels gen-order__levelsdef" id="rules-grouping" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="Another way to make the work items: group the objects by properties or folders of search sets">Grouping levels <span className={`gen-presets__now${active ? ' is-on' : ''}`}>{state}</span></summary>
      <div className="rel-bar"><button type="button" className="btn btn--small primary" onClick={add}>+ Level</button><InfoTip label="How grouping levels work">Group the objects into work items by one or more levels, like the Group panel: each level is a property of the objects or a folder of your search sets. Give one level the role Work item: its value is the group a recipe is found by. The other levels order and place the work items (building, level, zone) or only structure them. With a Work item level, Update 4D makes the programme from these work items instead of the list above. An object in several sets of a folder is in the first of them.</InfoTip></div>
      {def.levels.length === 0 ? <div className="scn-dim scn-editor__help">No levels: the programme is made from the list of search sets above.</div> : (
        <table className="xl">
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 150 }} /><col style={{ width: 120 }} /><col style={{ width: 230 }} /><col style={{ width: 130 }} /><col style={{ width: 190 }} /><col style={{ width: 200 }} /><col style={{ width: 90 }} /></colgroup>
          <thead><tr>
            <th className="xl__corner" aria-label="Level" /><th aria-label="On" title="Use this level" />
            <th title="What the level is called">Name</th>
            <th title="Where the value comes from: a property of the objects, or the sets of a folder">Source</th>
            <th title="The property, or the folder of search sets">Property or folder</th>
            <th title="What the value is for">Role</th>
            <th title="The order of the values">Sort</th>
            <th title="The values in the order they are built (sort: as listed), separated by commas">Order</th>
            <th aria-label="Move or delete" />
          </tr></thead>
          <tbody>
            {def.levels.map((l, i) => (
              <tr key={l.id} className={l.enabled === false ? 'is-off' : ''}>
                <th className="xl__row" scope="row">{i + 1}</th>
                <td className="xl__check"><input type="checkbox" checked={l.enabled !== false} aria-label="On" onChange={(e) => setLevel(i, { enabled: e.target.checked ? undefined : false })} /></td>
                <td className="xl__cell"><input value={l.name} spellCheck={false} aria-label="Name" onChange={(e) => setLevel(i, { name: e.target.value })} /></td>
                <td className="xl__cell"><select value={l.source.kind} aria-label="Source" onChange={(e) => setLevel(i, { source: e.target.value === 'sets' ? { kind: 'sets', folder: '' } : { kind: 'property', property: '' }, sort: e.target.value === 'sets' ? 'set' : 'natural' })}><option value="property">Property</option><option value="sets">Search sets</option></select></td>
                <td className="xl__cell">
                  {l.source.kind === 'property'
                    ? <input list="grouping-properties" value={l.source.property} spellCheck={false} placeholder="a property of the objects" aria-label="Property" onChange={(e) => setLevel(i, { source: { kind: 'property', property: e.target.value } })} />
                    : <select value={l.source.folder} aria-label="Folder of search sets" onChange={(e) => setLevel(i, { source: { kind: 'sets', folder: e.target.value } })}><option value="">Choose a folder…</option>{l.source.folder && !folders.includes(l.source.folder) && <option value={l.source.folder}>{l.source.folder} (not found)</option>}{folders.map((f) => <option key={f} value={f}>{f}</option>)}</select>}
                </td>
                <td className="xl__cell"><select value={l.role} aria-label="Role" title={LEVEL_ROLES.find((r) => r.value === l.role)?.tip} onChange={(e) => setLevel(i, { role: e.target.value as GroupingLevel['role'] })}>{LEVEL_ROLES.map((r) => <option key={r.value} value={r.value} title={r.tip}>{r.label}</option>)}</select></td>
                <td className="xl__cell"><select value={l.sort} aria-label="Sort" title={LEVEL_SORTS.find((r) => r.value === l.sort)?.tip} onChange={(e) => setLevel(i, { sort: e.target.value as GroupingLevel['sort'] })}>{LEVEL_SORTS.filter((s) => s.value !== 'set' || l.source.kind === 'sets').map((s) => <option key={s.value} value={s.value} title={s.tip}>{s.label}</option>)}</select></td>
                <td className="xl__cell"><input value={(l.order ?? []).join(', ')} disabled={l.sort !== 'listed'} spellCheck={false} placeholder={l.sort === 'listed' ? 'A, B, C' : ''} aria-label="Order" onChange={(e) => setLevel(i, { order: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></td>
                <td className="xl__check">
                  <button type="button" className="cols__icon" aria-label="Move up" title="Move the level up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="cols__icon" aria-label="Move down" title="Move the level down" disabled={i === def.levels.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className="cols__icon cols__icon--remove" aria-label="Delete" title="Delete the level" onClick={() => save({ ...def, levels: def.levels.filter((_, j) => j !== i) })}><IconRemove /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <datalist id="grouping-properties">{properties.map((p) => <option key={p} value={p} label={propertyLabel(p)} />)}</datalist>
      {def.levels.length > 0 && (
        <div className="rel-bar">
          <label className="scn-dim">Quantity of a work item
            <input className="rel-cell" list="grouping-properties" style={{ width: 240, marginLeft: 6 }} value={def.quantityProperty ?? ''} placeholder="the number of objects" spellCheck={false} onChange={(e) => save({ ...def, quantityProperty: e.target.value || undefined })} title="A numeric property that is added up over the objects of a work item (a volume, a length). Empty: the number of objects" />
          </label>
        </div>
      )}
      {def.levels.length > 0 && !active && <div className="scn-status scn-status--warn seq__warn" role="status">No level has the role Work item (with a property or folder chosen): the programme is still made from the list above.</div>}
      {built && (
        <div className="gen-order__preview">
          <h4 className="gen-sec2">Work items ({built.leaves.length.toLocaleString()}){built.leftOut ? `, ${built.leftOut.toLocaleString()} object${built.leftOut === 1 ? '' : 's'} left out (no value for the Work item level)` : ''}</h4>
          {built.leaves.length === 0 ? <div className="scn-dim scn-editor__help">No work items: load a model, and check that each level names a property the objects have, or a folder with sets.</div> : (
            <table className="xl">
              <thead><tr><th className="xl__corner" aria-label="Order" />{shownLevels.map((l) => <th key={l.id}>{l.name || (l.source.kind === 'property' ? propertyLabel(l.source.property) : l.source.folder)}</th>)}<th title="The objects of the work item">Objects</th><th title="The quantity of the work item">Quantity</th></tr></thead>
              <tbody>
                {built.leaves.slice(0, PREVIEW_ROWS).map((leaf, i) => (
                  <tr key={leaf.item.id}>
                    <th className="xl__row" scope="row">{i + 1}</th>
                    {leaf.values.map((v, k) => <td key={k} className="xl__cell xl__ro">{v || <span className="scn-dim">—</span>}</td>)}
                    <td className="xl__cell xl__num xl__ro">{leaf.keys.length.toLocaleString()}</td>
                    <td className="xl__cell xl__num xl__ro">{leaf.item.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {built.leaves.length > PREVIEW_ROWS && <div className="scn-dim xl__note">and {(built.leaves.length - PREVIEW_ROWS).toLocaleString()} more work items.</div>}
        </div>
      )}
    </details>
  );
}
