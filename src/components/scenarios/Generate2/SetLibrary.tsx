import { useMemo, useState } from 'react';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useSelectionStore } from '../../../state/selectionStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { comparePaths, folderKey } from '../../../viewer/setTree';
import { conditionsFromObjects, conversionResult, isSelectionSet, suggestFields, type SearchSet } from '../../../viewer/searchSets';
import { guidsOfSet } from '../../../scenarios/stepPours';
import { useIndexTick, useModelFields } from '../../modelFields';
import { newRuleId } from '../../schedule/FieldRules';
import { IconPlus } from '../../icons';

/** Generate 2's library: the search sets of Models › Search sets, by folder, each with the number of objects it finds in the loaded models. Drag one into
    the tree (or double-click it, or its +) to make it a work item. A set already in the tree is ticked and can only be moved there. Selection sets hold
    fixed objects the generator cannot test, so they are not offered. "New from selection" makes a search set of the objects picked in 3D. */

const norm = (s: string) => s.trim().toUpperCase();

/** What is being dragged in Generate 2: a set from the library or the tree, or a node of the tree. Kept here because a drag's data cannot be read until the drop. */
export const wbsDrag: { current: { kind: 'set'; group: string } | { kind: 'node'; id: string } | null } = { current: null };

/** How many objects of the loaded models each search set finds, by set name (sets of the same name count once). */
export function useSetCounts(): Map<string, number> {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  return useMemo(() => {
    const indexes = engine.getIndexes();
    const by = new Map<string, Set<string>>();
    if (indexes.size === 0) return new Map();
    for (const set of sets) {
      if (isSelectionSet(set)) continue;
      const k = norm(set.name);
      const into = by.get(k) ?? by.set(k, new Set()).get(k)!;
      for (const g of guidsOfSet(indexes, set)) into.add(g);
    }
    return new Map([...by].map(([k, v]) => [k, v.size]));
  }, [engine, sets, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function SetLibrary({ inTree, onAdd }: { /** Upper-case names of the sets in the tree. */ inTree: ReadonlySet<string>; /** Adds a set to the tree at the chosen node. */ onAdd: (group: string) => void }) {
  const sets = useSearchSetsStore((s) => s.sets);
  const counts = useSetCounts();
  const [find, setFind] = useState('');
  const searchSets = sets.filter((s) => !isSelectionSet(s));
  const selectionSets = sets.length - searchSets.length;
  const folders = useMemo(() => {
    const by = new Map<string, SearchSet[]>();
    const q = find.trim().toUpperCase();
    for (const s of searchSets) {
      if (q && !s.name.toUpperCase().includes(q) && !folderKey(s.group ?? '').toUpperCase().includes(q)) continue;
      const f = folderKey(s.group ?? '');
      by.set(f, [...(by.get(f) ?? []), s]);
    }
    return [...by].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : comparePaths(a, b)));
  }, [searchSets, find]);
  const names = new Set<string>();

  return (
    <div className="g2-lib">
      <div className="g2-lib__bar">
        <b className="g2-lib__title">Search sets</b>
        <span className="scn-dim g2-lib__count">{searchSets.length}</span>
        <NewFromSelection onMade={onAdd} />
      </div>
      <div className="g2-lib__find"><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search sets…" aria-label="Search the search sets" spellCheck={false} /></div>
      <div className="g2-lib__list" role="list">
        {searchSets.length === 0 && <div className="scn-dim scn-editor__help">No search sets yet. Make them in Models › Search sets, or pick objects in 3D and press New from selection.</div>}
        {searchSets.length > 0 && folders.length === 0 && <div className="scn-dim g2-lib__none">No set or folder has “{find}” in its name.</div>}
        {folders.map(([folder, list]) => (
          <div key={folder || '(none)'} role="group" aria-label={folder || 'No folder'}>
            <div className="g2-lib__folder" title={folder ? `Folder ${folder} (Models › Search sets)` : 'Sets in no folder'}>{folder || 'No folder'}</div>
            {list.map((s) => {
              const k = norm(s.name);
              // A recipe, a step and the generator find a set by its name: a second set of the same name is the same group, so it is offered once.
              const twin = names.has(k);
              names.add(k);
              const used = inTree.has(k);
              const n = counts.get(k);
              return (
                <div key={s.id} role="listitem" className={`g2-lib__row${used ? ' is-used' : ''}${twin ? ' is-twin' : ''}`} draggable={!twin}
                  title={twin ? `Another set is called “${s.name}”: the generator takes them as one group, so this one is not offered. Rename one in Models › Search sets` : used ? `“${s.name}” is in the tree. Drag it there to move it` : `Drag “${s.name}” into the tree, or double-click it to add it to the chosen node`}
                  onDragStart={(e) => { wbsDrag.current = { kind: 'set', group: s.name }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.name); }}
                  onDragEnd={() => { wbsDrag.current = null; }}
                  onDoubleClick={() => { if (!used && !twin) onAdd(s.name); }}>
                  <span className="g2-lib__name">{s.name}</span>
                  <span className="g2-lib__n" title={n === 0 ? 'The set finds no object in the loaded models' : 'Objects the set finds in the loaded models'}>{n === undefined ? '' : n.toLocaleString()}</span>
                  {used ? <span className="g2-lib__tick" aria-label="In the tree">✓</span> : (
                    <button type="button" className="cols__icon" disabled={twin} aria-label={`Add ${s.name} to the tree`} title="Add to the chosen node of the tree (or the bottom of the tree)" onClick={() => onAdd(s.name)}><IconPlus /></button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {selectionSets > 0 && <div className="scn-dim g2-lib__none">{selectionSets} selection set{selectionSets === 1 ? ' is' : 's are'} not listed: a selection set holds fixed objects, which the generator cannot find again. Convert {selectionSets === 1 ? 'it' : 'them'} to search sets in Models › Search sets.</div>}
      </div>
    </div>
  );
}

/** Makes a search set of the objects picked in 3D: the fewest properties that find them (as Models › Search sets › Convert suggests), saved in the
    folder new sets go to, and added to the tree. Says how many other objects it also finds. */
function NewFromSelection({ onMade }: { onMade: (group: string) => void }) {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  const fields = useModelFields();
  const picked = Object.values(byModel).reduce((n, ids) => n + ids.length, 0);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const make = () => {
    const store = useSearchSetsStore.getState();
    const indexes = engine.getIndexes();
    // Only properties of a property set: the generator cannot test the attributes (name, class, GlobalId).
    const usable = fields.map((f) => f.id).filter((id) => !id.startsWith('Attributes.') && id.includes('.'));
    const chosen = suggestFields(indexes, byModel, usable);
    if (chosen.length === 0) { setNote({ ok: false, text: 'These objects share no property that finds them and few others. Make the set by hand in Models › Search sets.' }); return; }
    const taken = new Set(store.sets.map((s) => norm(s.name)));
    let n = 1;
    while (taken.has(norm(`Selection ${n}`))) n++;
    const name = window.prompt('Name for the new search set:', `Selection ${n}`)?.trim();
    if (!name) return;
    if (taken.has(norm(name))) { setNote({ ok: false, text: `A set called “${name}” exists already: the generator would take the two as one. Choose another name.` }); return; }
    const conditions = conditionsFromObjects(indexes, byModel, chosen);
    const res = conversionResult(indexes, byModel, chosen);
    store.save({ id: newRuleId('ss'), name, group: store.lastGroup, kind: 'search', match: 'all', conditions });
    onMade(name);
    const extra = res.found - res.inSet;
    setNote({ ok: extra === 0 && res.inSet === res.total, text: `Made “${name}”${store.lastGroup ? ` in ${store.lastGroup}` : ''}: it finds ${res.found.toLocaleString()} object${res.found === 1 ? '' : 's'}${extra > 0 ? `, ${extra.toLocaleString()} of them not picked` : ''}${res.inSet < res.total ? `, and misses ${(res.total - res.inSet).toLocaleString()} picked` : ''}. Change its conditions in Models › Search sets.` });
  };
  return (
    <>
      <button type="button" className="btn btn--small" disabled={picked === 0} onClick={make} title={picked === 0 ? 'Pick objects in 3D first: they become a new search set' : `Make a search set of the ${picked} object${picked === 1 ? '' : 's'} picked in 3D, and add it to the tree`}>New from selection</button>
      {note && <div className={`scn-rules__note g2-lib__note${note.ok ? '' : ' is-error'}`} role="status" onClick={() => setNote(null)} title="Click to close">{note.text}</div>}
    </>
  );
}
