import { useRecipeStore } from '../state/recipeStore';
import { useScenarioStore } from '../state/scenarioStore';
import { FOLDER_SEP, folderKey, folderParts, folderPaths, isShown, moveFolder, setsInside, walkFolder } from '../viewer/setTree';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExpandCollapseToggle } from './ExpandCollapseToggle';
import { DockToolbar } from './Dock';
import { ListConfig } from './ListConfig';
import { configFocusProps } from '../state/listConfigStore';
import { useListQuery } from '../state/tableSearchStore';
import type * as OBC from '@thatopen/components';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { useSelectionStore } from '../state/selectionStore';
import { setIdsOf, useTagsStore } from '../state/tagsStore';
import {
  SEARCH_OPS, conditionProblem, conditionsFromObjects, conversionResult, countIds, suggestFields, isSelectionSet, itemsOf, mergeItems, opInput, resolveItems, runSearchSet, upgradeLegacyItems,
  type SearchCondition, type SearchOp, type SearchSet, type SetItem,
} from '../viewer/searchSets';
import { FieldPicker, RuleRows, newRuleId, type PickField } from './schedule/FieldRules';
import { useFieldValues, useIndexTick, useModelFields } from './modelFields';
import { IconEye, IconEyeOff, IconSelectionSet, IconSectionChevron, IconTagOutline, IconTextInputShort, IconUpload, IconRemove, IconPencil } from './icons';
import { RowButtonsChooser, useRowButtons } from './RowButtonsChooser';
import { InfoTip } from './InfoTip';
import { queryMatcher } from '../schedule/search';
import { usePersistedState } from '../utils/persistedState';
import { FolderPlayerBar, useFolderPlayer } from './FolderPlayer';
import { buildSpoolSets, inFolderTree, type SpoolOptions } from '../viewer/spoolSets';
import { STEPS_GROUP, buildStepSets, cleanHeader, guessColumns, guessField, parseTable, stepsFromRows } from '../viewer/importSteps';

const MAX_VALUES = 300;

const toMap = (ids: Record<string, number[]>): OBC.ModelIdMap => Object.fromEntries(Object.entries(ids).map(([m, l]) => [m, new Set(l)]));

/** Every loaded object, for "N of M". */
function useTotal() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  return useMemo(() => {
    let n = 0;
    for (const index of engine.getIndexes().values()) n += index.elements.size;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick]);
}

/** Selects the objects a set finds; the viewer's mode (Select / Isolate / Ghost) and Pin apply as for any selection. */
function useSetActions() {
  const engine = useViewerEngine();
  return {
    select: (ids: Record<string, number[]>) => void engine.selectElements(ids, false),
    isolate: async (ids: Record<string, number[]>) => {
      await engine.hider.isolate(toMap(ids));
      engine.onExternalVisibilityChange.trigger();
    },
  };
}

/** The app's selection now, as set items (by model name and GlobalId). */
function useSelectionItems(): SetItem[] {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  return useMemo(() => itemsOf(engine.getIndexes(), byModel), [engine, byModel]);
}

/** Models > Search sets: named sets of objects, of two kinds —
    · search sets: conditions (field, operator, value) matched all or any,
      kept as rules, so they run again on whatever models are loaded;
    · selection sets: a saved selection, kept by model name and GlobalId,
      so it survives reloading or re-converting the model.
    Built like the Programme's Filter and Columns tabs: a live result count,
    grouped fields to add, and each condition's values with their counts. */
export function SearchSetsPanel({ player = false }: { /** Show the folder player (Models only). */ player?: boolean } = {}) {
  const sets = useSearchSetsStore((s) => s.sets);
  const [draft, setDraft] = useState<SearchSet | null>(null);
  if (draft) {
    const isNew = !sets.some((s) => s.id === draft.id);
    return isSelectionSet(draft)
      ? <SelectionSetEditor key={draft.id} initial={draft} isNew={isNew} onClose={() => setDraft(null)} onConvert={setDraft} />
      : <SearchSetEditor key={draft.id} initial={draft} isNew={isNew} onClose={() => setDraft(null)} />;
  }
  return <SearchSetList onEdit={setDraft} player={player} />;
}

/** The buttons on each row that can be hidden (like Blender's restriction toggles). */
const ROW_BUTTONS = [
  { id: 'count', glyph: '123', label: 'Object count' },
  { id: 'eye', glyph: '👁', label: 'Show / hide in 3D' },
  { id: 'tag', glyph: <IconTagOutline width={14} height={14} />, label: 'Show / hide its tags' },
  { id: 'edit', glyph: <IconPencil width={14} height={14} />, label: 'Edit' },
  { id: 'dup', glyph: '⧉', label: 'Duplicate' },
  { id: 'del', glyph: '⊖', label: 'Delete' },
] as const;
type RowButton = (typeof ROW_BUTTONS)[number]['id'];

/** A set's tags button: lit while it has tags showing; the first click makes a tag that names each object (edit it in the Tags panel). */
function TagButton({ set }: { set: SearchSet }) {
  const on = useTagsStore((s) => s.shown && s.tags.some((t) => t.source?.kind === 'set' && !t.hidden && setIdsOf(t).includes(set.id)));
  return (
    <button type="button" className={`cols__icon${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => useTagsStore.getState().toggleSetTags(set.id, set.name)}
      title={on ? 'Hide its tags (Shift+Space)' : 'Show its tags (Shift+Space). They use the “Set tags” tag: change its label in the Tags panel'} aria-label={`Tags of ${set.name}`} style={{ opacity: on ? 1 : 0.55 }}>
      <IconTagOutline width={14} height={14} />
    </button>
  );
}

function SearchSetList({ onEdit, player: withPlayer }: { onEdit: (s: SearchSet) => void; player: boolean }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { sets, save, remove, move, lastGroup } = useSearchSetsStore();
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  // What the open scenario hangs on a set or a folder (its recipes, the extra activities attached to it): a small badge, so the tree shows where the recipes and extras are.
  const recipeGroups = useRecipeStore((st) => st.recipes);
  const extraTags = useScenarioStore((st) => st.rules.extraTags);
  const usesOf = (name: string): string => {
    const key = folderKey(name).toUpperCase();
    const r = recipeGroups.filter((x) => folderKey(x.group).toUpperCase() === key && x.enabled !== false).length;
    const e = Object.values(extraTags ?? {}).filter((t) => t.attach?.target && folderKey(t.attach.target).toUpperCase() === key).length;
    return [r ? `${r} recipe${r === 1 ? '' : 's'}` : '', e ? `${e} extra activit${e === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(', ');
  };
  const total = useTotal();
  const actions = useSetActions();
  const selection = useSelectionItems();

  // Selection sets from the old Sets tab: their local ids become GlobalIds
  // as soon as their model is loaded.
  useEffect(() => {
    for (const set of sets) {
      const upgraded = upgradeLegacyItems(engine.getIndexes(), set);
      if (upgraded) save(upgraded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick]);
  // The words come from the search box of the main header ("Search on Sets").
  const query = useListQuery('sets');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [spooling, setSpooling] = useState(false);
  const anyTagsOn = useTagsStore((s) => s.shown && s.tags.some((t) => !t.hidden && (t.source?.kind === 'selection' || (t.source?.kind === 'set' && setIdsOf(t).length > 0))));
  const [converting, setConverting] = useState<string[] | null>(null);
  // Order of the sets in their folders: as dragged, or alphabetical.
  const [alpha, setAlpha] = usePersistedState('searchSets.alpha', false);
  // Which row buttons show (the popover beside the toolbar); remembered.
  const rb = useRowButtons<RowButton>('searchSets.hiddenButtons');
  const shownBtn = rb.shown;

  const results = useMemo(
    () => new Map(sets.map((s) => [s.id, runSearchSet(engine.getIndexes(), s)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, sets, models, tick],
  );
  // Eyes (like Blender's collections): a set's eye shows / hides its objects in the 3D view;
  // a folder's eye does the same for all its sets. Hiding goes through the viewer's Hide, so
  // the 4D timeline keeps them hidden and Show all brings them back (the eyes follow).
  const [, setVisTick] = useState(0);
  useEffect(() => {
    const bump = () => setVisTick((t) => t + 1);
    engine.onVisibilityChange.add(bump);
    engine.onExternalVisibilityChange.add(bump);
    return () => {
      engine.onVisibilityChange.remove(bump);
      engine.onExternalVisibilityChange.remove(bump);
    };
  }, [engine]);
  /** How many of these objects the user has hidden (Hide, Isolate, an eye). */
  const hiddenCount = (ids: Record<string, number[]>) => {
    let hidden = 0;
    let total = 0;
    for (const [modelId, list] of Object.entries(ids)) for (const id of list) { total++; if (engine.isUserHidden(modelId, id)) hidden++; }
    return { hidden, total };
  };
  const setShown = async (ids: Record<string, number[]>, visible: boolean) => {
    if (countIds(ids) === 0) return;
    await engine.hider.set(visible, toMap(ids));
    engine.onExternalVisibilityChange.trigger();
  };
  const mergeIds = (list: Record<string, number[]>[]) => {
    const out: Record<string, Set<number>> = {};
    for (const ids of list) for (const [m, l] of Object.entries(ids)) for (const id of l) (out[m] ??= new Set()).add(id);
    return Object.fromEntries(Object.entries(out).map(([m, set]) => [m, [...set]]));
  };
  /** Hides these objects, or shows them all again when any is hidden. */
  const flipShown = (ids: Record<string, number[]>) => {
    const { hidden, total } = hiddenCount(ids);
    if (total > 0) void setShown(ids, hidden > 0);
  };
  /** An eye for some objects: open (all shown), dimmed-open (some hidden) or shut (all hidden). */
  const eye = (ids: Record<string, number[]>, label: string) => {
    const { hidden, total } = hiddenCount(ids);
    const shut = total > 0 && hidden === total;
    const part = hidden > 0 && !shut;
    return (
      <button
        type="button"
        className={`ss__eye${shut ? ' is-off' : ''}${part ? ' is-part' : ''}`}
        disabled={total === 0}
        onClick={(e) => { e.stopPropagation(); flipShown(ids); }}
        title={shut ? `Show ${label}` : part ? `${label}: some objects hidden — click to show them all` : `Hide ${label}`}
        aria-label={shut ? `Show ${label}` : `Hide ${label}`}
      >
        {shut ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
      </button>
    );
  };

  const q = query.trim().toLowerCase();
  const hit = queryMatcher(query);
  const shown = q ? sets.filter((s) => hit(`${s.group} ${s.name}`)) : sets;
  // The folders are a tree: a path is written "Top / Next". Every folder above a set is listed (even one that holds no set itself), in tree order.
  const groups = [...(shown.some((s) => folderParts(s.group ?? '').length === 0) ? [''] : []), ...folderPaths(shown)];
  const sameFolder = (a: string, b: string) => folderKey(a).toUpperCase() === folderKey(b).toUpperCase();
  const toggleGroup = (g: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (!next.delete(g)) next.add(g);
    return next;
  });
  // The sets as listed (folders in order, closed ones skipped): Up / Down arrows step through them.
  const inGroupOf = (g: string) => {
    const list = shown.filter((s) => sameFolder(s.group ?? '', g));
    if (alpha) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return list;
  };
  // Play a folder like phasing (Models only): its sets, in the order listed, are the steps.
  const folderSteps = (g: string) => (alpha ? sets.filter((x) => sameFolder(x.group ?? '', g)) : walkFolder(sets, g)).sort(alpha ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : () => 0).map((x) => results.get(x.id) ?? {}).filter((ids) => countIds(ids) > 0);
  const folderPlayer = useFolderPlayer({
    steps: folderSteps,
    setShown,
    shownCount: (g) => {
      let n = 0;
      for (const ids of folderSteps(g)) { const h = hiddenCount(ids); if (h.hidden > 0) break; n++; }
      return n;
    },
  });
  const listed = groups.flatMap((g) => (q || (isShown(g, closed) && !closed.has(g)) ? inGroupOf(g) : []));
  // The current set (arrows move it, Space toggles it) and the selected ones: click one,
  // Shift+click (or Shift+arrows) to reach down to another, Ctrl+click to add or remove one.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());
  // When the selection last came from a row of this list (Record leaves those alone).
  const listPickAt = useRef(0);
  const selectSets = (ids: Set<string>) => {
    listPickAt.current = Date.now();
    setSelectedSets(ids);
    actions.select(mergeIds([...ids].map((id) => results.get(id) ?? {})));
  };
  const pick = (s: SearchSet, mod: { shift?: boolean; ctrl?: boolean } = {}) => {
    setActiveId(s.id);
    const from = listed.findIndex((x) => x.id === anchorId);
    const to = listed.findIndex((x) => x.id === s.id);
    if (mod.shift && from >= 0 && to >= 0) {
      const range = listed.slice(Math.min(from, to), Math.max(from, to) + 1).map((x) => x.id);
      selectSets(new Set(mod.ctrl ? [...selectedSets, ...range] : range));
      return;
    }
    setAnchorId(s.id);
    if (mod.ctrl) {
      const next = new Set(selectedSets);
      if (!next.delete(s.id)) next.add(s.id);
      selectSets(next);
    } else selectSets(new Set([s.id]));
  };
  /** The ids of the objects of the selected sets (the current one when none is selected). */
  const selectedIdsMap = () => mergeIds([...(selectedSets.size ? selectedSets : new Set(activeId ? [activeId] : []))].map((id) => results.get(id) ?? {}));
  /** Delete: removes the selected sets (the current one when none is selected), after asking. */
  const deleteSelected = () => {
    const ids = [...(selectedSets.size ? selectedSets : new Set(activeId ? [activeId] : []))].filter((id) => sets.some((x) => x.id === id));
    if (ids.length === 0) return;
    const names = ids.map((id) => sets.find((x) => x.id === id)!.name);
    const what = ids.length === 1 ? `the set “${names[0]}”` : `${ids.length} sets (${names.slice(0, 3).map((n) => `“${n}”`).join(', ')}${ids.length > 3 ? '…' : ''})`;
    if (!window.confirm(`Delete ${what}?`)) return;
    ids.forEach(remove);
    setSelectedSets(new Set());
    setActiveId(null);
    setAnchorId(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' && !e.altKey && !e.ctrlKey && !e.metaKey && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    e.preventDefault();
    // Space: the selected sets' eye (their objects on / off in the 3D view). Shift+Space: their tags on / off.
    if (e.key === ' ') {
      if (e.shiftKey) {
        const picked = [...(selectedSets.size ? selectedSets : new Set(activeId ? [activeId] : []))].map((id) => sets.find((x) => x.id === id)).filter((x): x is SearchSet => !!x);
        for (const x of picked) useTagsStore.getState().toggleSetTags(x.id, x.name);
      } else flipShown(selectedIdsMap());
      return;
    }
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const found = (s: SearchSet) => countIds(results.get(s.id) ?? {}) > 0;
    let i = listed.findIndex((s) => s.id === activeId);
    // Steps over sets that find nothing; with no current one, Down starts at the top and Up at the bottom.
    for (let n = 0; n < listed.length; n++) {
      i = i < 0 ? (dir > 0 ? 0 : listed.length - 1) : i + dir;
      if (i < 0 || i >= listed.length) return;
      if (found(listed[i])) {
        pick(listed[i], { shift: e.shiftKey });
        document.getElementById(`ss-row-${listed[i].id}`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  };
  // Record: every object (or group of objects, built up with Ctrl+click) picked in 3D is saved as a selection set named with
  // the next number of the folder last used, so the pours can be clicked in construction order. A selection that is already
  // a set (a click on a row of this list) is left alone.
  const [recording, setRecording] = useState(false);
  const lastRec = useRef<{ id: string; keys: Set<string> } | null>(null);
  useEffect(() => {
    if (!recording) lastRec.current = null;
  }, [recording]);
  /** Saves objects as a selection set named with the next number of the folder last used (the highest leading number + 1). */
  const saveNumbered = (items: SetItem[]) => {
    const st = useSearchSetsStore.getState();
    const group = st.lastGroup;
    const taken = st.sets.filter((x) => x.group === group).map((x) => Number(/^\s*(\d+)/.exec(x.name)?.[1] ?? 0));
    const id = newRuleId('ss');
    st.save({ id, name: String(Math.max(0, ...taken) + 1), group, kind: 'selection', match: 'all', conditions: [], items });
    return id;
  };
  // Ctrl+S: saves the current selection the same way (without recording or hiding), whatever is selected: a group of objects as one set.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault(); // not the browser's "Save page"
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
      const items = selectionRef.current;
      if (items.length === 0) return;
      const key = (i: SetItem) => `${i.model}|${i.guid}`;
      const keys = new Set(items.map(key));
      const same = useSearchSetsStore.getState().sets.some((x) => x.items && x.items.length === keys.size && x.items.every((i) => keys.has(key(i))));
      if (!same) saveNumbered(items);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Once recorded, the objects are hidden (like the sequence's steps), so the next pour is the one left to click.
  const hidePicked = () => {
    const picked = Object.fromEntries(Object.entries(useSelectionStore.getState().byModel).map(([m, l]) => [m, [...l]]));
    void setShown(picked, false);
  };
  useEffect(() => {
    if (!recording || selection.length === 0) return;
    const timer = window.setTimeout(() => {
      const st = useSearchSetsStore.getState();
      const key = (i: SetItem) => `${i.model}|${i.guid}`;
      const keys = new Set(selection.map(key));
      // A click on a row of this list selects that set's objects: not a pick in 3D, nothing to record. (A pick in 3D of
      // objects that are already a set is recorded again: the sequence is being redone.)
      if (Date.now() - listPickAt.current < 1500) return;
      const prev = lastRec.current;
      const prevSet = prev ? st.sets.find((x) => x.id === prev.id) : undefined;
      if (prev && prevSet && [...prev.keys].every((k) => keys.has(k))) {
        st.save({ ...prevSet, items: selection });
        lastRec.current = { id: prevSet.id, keys };
        hidePicked();
        return;
      }
      const id = saveNumbered(selection);
      lastRec.current = { id, keys };
      hidePicked();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [recording, selection]);
  /** Gives a folder another name (its sets move with it; a name that is already a folder joins the two). */
  const renameFolder = (g: string) => {
    const next = folderKey(window.prompt(`Rename the folder “${g}”, or move it by giving the whole path (“Top${FOLDER_SEP}Next”):`, g) ?? '');
    if (!next || sameFolder(next, g)) return;
    const moved = moveFolder(sets, g, next);
    if (moved.length === 0) { window.alert('A folder cannot go inside itself.'); return; }
    if (sets.some((x) => sameFolder(x.group ?? '', next)) && !window.confirm(`A folder “${next}” exists already: the sets of “${g}” join it?`)) return;
    for (const x of moved) useSearchSetsStore.getState().save(x);
  };
  /** A folder inside this one: the next new set goes there (a folder exists while it holds a set). */
  const addSubfolder = (g: string) => {
    const name = folderKey(window.prompt(`Name of the folder inside “${g || 'the list'}”:`) ?? '');
    if (!name) return;
    const path = g ? `${g}${FOLDER_SEP}${name}` : name;
    useSearchSetsStore.getState().setLastGroup(path);
    onEdit({ id: newRuleId('ss'), name: `Search set ${sets.length + 1}`, group: path, kind: 'search', match: 'all', conditions: [] });
  };
  /** Drops a set or a folder on a folder: it goes inside. */
  const dropOnFolder = (g: string) => {
    if (dragId) {
      const x = sets.find((y) => y.id === dragId);
      if (x && !sameFolder(x.group ?? '', g)) save({ ...x, group: g });
    } else if (dragFolder && !sameFolder(dragFolder, g)) {
      const name = folderParts(dragFolder).slice(-1)[0];
      const moved = moveFolder(sets, dragFolder, g ? `${g}${FOLDER_SEP}${name}` : name);
      for (const x of moved) save(x);
    }
    setDragId(null);
    setDragFolder(null);
  };

  /** Renumbers a folder's sets 1, 2, 3… in the order they are kept (the manual order): the leading number of each name is
      replaced (or added), the rest of the name stays — "7 Stitch" becomes "3 Stitch". */
  const renumber = (g: string) => {
    const list = sets.filter((x) => sameFolder(x.group ?? '', g));
    if (list.length === 0 || !window.confirm(`Renumber the ${list.length} set${list.length === 1 ? '' : 's'} of “${g}” 1 to ${list.length}, in the order listed?`)) return;
    list.forEach((x, i) => {
      const rest = x.name.replace(/^\s*\d+\s*/, '');
      save({ ...x, name: rest ? `${i + 1} ${rest}` : String(i + 1) });
    });
  };
  const create = () => onEdit({ id: newRuleId('ss'), name: `Search set ${sets.length + 1}`, group: lastGroup, kind: 'search', match: 'all', conditions: [] });
  const saveSelection = () => onEdit({ id: newRuleId('ss'), name: `Selection set ${sets.filter(isSelectionSet).length + 1}`, group: lastGroup, kind: 'selection', match: 'all', conditions: [], items: selection });
  const duplicate = (s: SearchSet) => onEdit({ ...s, id: newRuleId('ss'), name: `${s.name} (copy)`, conditions: s.conditions.map((c) => ({ ...c, id: newRuleId('c') })), items: s.items ? [...s.items] : undefined });

  return (
    // (A button would also "click" on the key's release: kept from doing so for Space.)
    <div className="flt ss" {...configFocusProps('sets')} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === ' ' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault(); }}>
      <ListConfig id="sets" label="Sets" searchable panels={{}} />
      <div className="ss__sticky">
      <div className="ss__top">
        <button type="button" className="btn ss__tool" onClick={create} title="New search set: finds objects by their properties" aria-label="New search set">
          <IconTextInputShort width={16} height={16} /><span className="ss__tool-plus">+</span><span className="ss__tool-text">Search</span>
        </button>
        <button type="button" className="btn ss__tool" onClick={saveSelection} disabled={selection.length === 0} aria-label="New selection set" title={selection.length ? `Save the ${selection.length} selected object${selection.length === 1 ? '' : 's'} as a set` : 'Select objects first, then save them as a set'}>
          <IconSelectionSet width={16} height={16} /><span className="ss__tool-plus">+</span><span className="ss__tool-text">Selection</span>{selection.length ? <span className="ss__tool-n">{selection.length}</span> : null}
        </button>
        <button type="button" className={`btn ss__tool${recording ? ' primary' : ''}`} onClick={() => { if (!recording && engine.getInteractionMode() !== 'select') void engine.setInteractionMode('select'); setRecording((v) => !v); }} aria-pressed={recording} title={recording ? `Recording: each pick in 3D is saved as the next numbered set in ${lastGroup ? `“${lastGroup}”` : 'the list (no folder)'} and hidden. Click to stop.` : 'Record picks: save each object picked in 3D as a numbered set in the folder last used, and hide it (Ctrl+click adds to the current one). Ctrl+S saves the current selection as the next numbered set without recording'}>
          {recording ? 'Recording' : 'Record'}
        </button>
        <button type="button" className="btn ss__tool" onClick={() => setAlpha((v) => !v)} aria-pressed={alpha} title={alpha ? 'Sorted A–Z: click to order by dragging' : 'Your own order (drag a row to move it): click to sort A–Z'}>{alpha ? 'A–Z' : 'Manual'}</button>
        <button type="button" className="btn ss__tool" disabled={![...(selectedSets.size ? selectedSets : new Set(activeId ? [activeId] : []))].some((id) => sets.some((x) => x.id === id && isSelectionSet(x)))} onClick={() => setConverting([...(selectedSets.size ? selectedSets : new Set(activeId ? [activeId] : []))])} aria-label="Convert selected sets to search sets" title="Convert the selected selection sets to search sets, by property (select them in the list first: Shift+click for a range)">Convert</button>
        <button type="button" className="btn ss__tool" disabled={!anyTagsOn} onClick={() => useTagsStore.getState().hideObjectTags()} aria-label="Hide all tags" title={anyTagsOn ? 'Hide all the tags on sets and on the selection (they are kept: a set\'s tag button brings its back)' : 'No set or selection tags are showing'}>
          <IconTagOutline width={16} height={16} /><span className="ss__tool-text">Tags off</span>
        </button>
        <button type="button" className="btn ss__tool" onClick={() => setSpooling((v) => !v)} aria-expanded={spooling} aria-label="Spool sets" title="Spool: make a set for every value of a property in one go, sorted into folders">
          <span className="ss__tool-text">Spool</span>
        </button>
        <button type="button" className="btn ss__tool" onClick={() => setImporting((v) => !v)} aria-expanded={importing} aria-label="Import steps" title="Import steps: make a set per step from a CSV / TXT file of GlobalIds and task names">
          <IconUpload width={16} height={16} /><span className="ss__tool-text">Import</span>
        </button>
        <RowButtonsChooser buttons={ROW_BUTTONS} rb={rb} title="Choose which buttons show on each set" />
        <InfoTip>
          <p><b>Import steps:</b> reads a CSV / TXT file with a column of values that identify objects (GlobalId, or any model property such as a Pour ID Number) and a task-name column, in construction order (e.g. a Navisworks TimeLiner export). Consecutive rows with the same task become one search set (property is any of …) in the “Steps” folder, numbered 1, 2, … Rows without a task name are left out.</p>
          <p><b>Search set:</b> finds objects by their properties — add conditions (a property, how to compare, the value) and match all or any. Kept as rules, so it finds the right objects in whatever models are loaded.</p>
          <p><b>Selection set:</b> the objects selected when it was saved (add or remove objects later). Kept by model name and GlobalId, so it still works after reloading or re-converting the model.</p>
          <p>Click a name to select its objects, then use the Up / Down arrow keys to step through the sets (Shift+click or Shift+arrows to select several, Ctrl+click to add one) and the space bar to turn the selected ones on or off (their eye) — the viewer's mode (Select, Isolate or Ghost) and Pin in the toolbar apply as usual.</p>
        </InfoTip>
      </div>
      {importing && <ImportSteps onDone={() => setImporting(false)} />}
      {spooling && <SpoolSets onDone={() => setSpooling(false)} />}
      {converting && <BulkConvert ids={converting} onDone={() => setConverting(null)} />}
      {sets.length > 0 && groups.some((g) => g !== '') && (
        <DockToolbar id="search">
          {/* (the same header cell as the Properties panel's: an empty title, then the button) */}
          <div className="props-grid__head">
            <span className="props-grid__title" />
            <ExpandCollapseToggle
              className="btn btn--small"
              collapsed={groups.filter((g) => g !== '').every((g) => closed.has(g))}
              onCollapse={() => setClosed(new Set(groups.filter((g) => g !== '')))}
              onExpand={() => setClosed(new Set())}
            />
          </div>
        </DockToolbar>
      )}
      </div>
      {sets.length === 0 && <div className="cols__shown"><div className="cols__empty">No sets yet. Make a search set to find objects by their properties, or select objects and save them as a selection set.</div></div>}
      {sets.length > 0 && shown.length === 0 && <div className="flt__hint">No set matches “{query}”.</div>}

      {groups.map((g) => {
        if (!q && !isShown(g, closed)) return null;
        const inGroup = inGroupOf(g);
        const inside = setsInside(sets, g);
        const depth = Math.max(0, folderParts(g).length - 1);
        const open = q ? true : !closed.has(g);
        return (
          <div className="cols__group" key={g || '(none)'}>
            {g !== '' && (
              <div className="cols__group-head" style={{ paddingLeft: 10 + depth * 14 }} draggable onDragStart={(e) => { setDragFolder(g); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragFolder(null)}
                onDragOver={(e) => { if (dragId || dragFolder) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnFolder(g); }}>
                <button type="button" className="cols__group-toggle" onClick={() => toggleGroup(g)} aria-expanded={open} title={g}>
                  <IconSectionChevron className="section-chevron" />
                  <span className="cols__group-name">{folderParts(g).slice(-1)[0]}</span>
                  {usesOf(g) && <span className="cols__count" title={`In this scenario: ${usesOf(g)} for this folder (its sets inherit the recipes)`} style={{ color: 'var(--accent-strong)' }}>◆</span>}
                  <span className="cols__count" title={inGroup.length === inside.length ? undefined : `${inGroup.length} here, ${inside.length} with the folders inside`}>{inside.length}</span>
                </button>
                <button type="button" className="cols__icon" onClick={() => addSubfolder(g)} title="Add a folder inside this one (with a new set in it). Drag a folder or a set onto a folder to move it in" aria-label={`Add a folder inside ${g}`}>+</button>
                <button
                  type="button"
                  className="cols__icon"
                  disabled={alpha}
                  onClick={() => renumber(g)}
                  title={alpha ? 'Switch to Manual order to renumber' : 'Renumber the sets 1, 2, 3… in the order listed (manual order)'}
                  aria-label={`Renumber the sets of ${g}`}
                >#</button>
                {shownBtn('eye') && eye(mergeIds(inside.map((x) => results.get(x.id) ?? {})), `the ${inside.length} sets of “${g}”`)}
                {shownBtn('edit') && (
                  <button type="button" className="cols__icon" onClick={() => renameFolder(g)} title="Rename this folder" aria-label={`Rename folder ${g}`}><IconPencil width={14} height={14} /></button>
                )}
                {shownBtn('del') && (
                  <button
                    type="button"
                    className="cols__icon cols__icon--remove"
                    onClick={() => {
                      const n = inside.length;
                      if (window.confirm(`Delete the folder “${g}” and its ${n} set${n === 1 ? '' : 's'}${inside.length > inGroup.length ? ' (the folders inside it too)' : ''}?`)) inside.forEach((x) => remove(x.id));
                    }}
                    title="Delete this folder and its sets"
                    aria-label={`Delete folder ${g}`}
                  ><IconRemove /></button>
                )}
              </div>
            )}
            {open && (
              <div className="ss__table" style={depth ? { marginLeft: depth * 14 } : undefined}>
                {inGroup.map((s) => {
                  const ids = results.get(s.id) ?? {};
                  const n = countIds(ids);
                  const problems = s.conditions.filter((c) => conditionProblem(c)).length;
                  const saved = isSelectionSet(s);
                  const stored = (s.items?.length ?? 0) + Object.values(s.legacy ?? {}).reduce((k, l) => k + l.length, 0);
                  return (
                    <div
                      key={s.id}
                      id={`ss-row-${s.id}`}
                      className={`ss__row${dragId === s.id ? ' dragging' : ''}${selectedSets.has(s.id) ? ' is-active' : ''}${activeId === s.id ? ' is-current' : ''}`}
                      draggable={!alpha}
                      onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { if (!alpha || dragFolder) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId && !alpha) { const x = sets.find((y) => y.id === dragId); if (x && !sameFolder(x.group ?? '', s.group ?? '')) save({ ...x, group: s.group }); move(dragId, s.id); } else if (dragFolder) dropOnFolder(s.group ?? ''); setDragId(null); }}
                      onDragEnd={() => setDragId(null)}
                    >
                      <span className={`ss__kind${saved ? ' is-selection' : ''}`} title={saved ? 'Selection set: fixed objects' : 'Search set: conditions'}>{saved ? <IconSelectionSet width={14} height={14} /> : <IconTextInputShort width={14} height={14} />}</span>
                      <button
                        type="button"
                        className="ss__name"
                        onClick={(e) => pick(s, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
                        disabled={n === 0}
                        title={saved
                          ? `${s.name} — ${stored.toLocaleString()} object${stored === 1 ? '' : 's'} saved${stored > n ? `, ${(stored - n).toLocaleString()} not in the loaded models` : ''}`
                          : `${s.name} — ${s.conditions.length} condition${s.conditions.length === 1 ? '' : 's'}${s.conditions.length > 1 ? ` (${s.match === 'all' ? 'all' : 'any'})` : ''}${problems ? `, ${problems} incomplete` : ''}${n ? '' : ' — finds nothing in the loaded models'}`}
                      >
                        <span className="ss__label">{s.name}</span>
                        {usesOf(s.name) && <span className="cols__count" title={`In this scenario: ${usesOf(s.name)}`} style={{ color: 'var(--accent-strong)', marginLeft: 4 }}>◆</span>}
                      </button>
                      {shownBtn('count') && <span className={`ss__count${n === 0 ? ' is-zero' : ''}${saved && stored > n ? ' is-partial' : ''}`} title={`${n} of ${total} objects${saved && stored > n ? ` · ${stored - n} saved objects not in the loaded models` : ''}`}>{n.toLocaleString()}</span>}
                      {shownBtn('eye') && eye(ids, `“${s.name}”`)}
                      {shownBtn('tag') && <TagButton set={s} />}
                      {shownBtn('edit') && <button type="button" className="cols__icon" onClick={() => onEdit(s)} title="Edit" aria-label={`Edit ${s.name}`}><IconPencil width={14} height={14} /></button>}
                      {shownBtn('dup') && <button type="button" className="cols__icon" onClick={() => duplicate(s)} title="Duplicate" aria-label={`Duplicate ${s.name}`}>⧉</button>}
                      {shownBtn('del') && <button type="button" className="cols__icon cols__icon--remove" onClick={() => { if (window.confirm(`Delete the ${saved ? 'selection' : 'search'} set “${s.name}”?`)) remove(s.id); }} title="Delete" aria-label={`Delete ${s.name}`}><IconRemove /></button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {withPlayer && <FolderPlayerBar player={folderPlayer} folders={folderPaths(sets)} />}
    </div>
  );
}

function SearchSetEditor({ initial, isNew, onClose }: { initial: SearchSet; isNew: boolean; onClose: () => void }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { sets, save, remove, setLastGroup } = useSearchSetsStore();
  const fields = useModelFields();
  const total = useTotal();
  const actions = useSetActions();
  const [set, setSet] = useState<SearchSet>(initial);
  const patch = (p: Partial<SearchSet>) => setSet((s) => ({ ...s, ...p }));
  const setConditions = (conditions: SearchCondition[]) => patch({ conditions });
  const patchCondition = (id: string, p: Partial<SearchCondition>) => setSet((s) => ({ ...s, conditions: s.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  const ids = useMemo(
    () => runSearchSet(engine.getIndexes(), set),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, set, models, tick],
  );
  const n = countIds(ids);
  const pct = total ? (n / total) * 100 : 0;
  const groupNames = [...new Set(sets.map((s) => s.group).filter(Boolean))];
  const nameTaken = sets.some((s) => s.id !== set.id && s.name.trim().toLowerCase() === set.name.trim().toLowerCase());
  const canSave = set.name.trim() !== '' && !nameTaken;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const addCondition = (f: PickField) => setConditions([...set.conditions, { id: newRuleId('c'), field: f.id, op: 'anyOf', value: '', values: [] }]);

  return (
    <div className="flt ss">
      <div className="ss__editor-head">
        <b>{isNew ? 'New search set' : 'Edit search set'}</b>
      </div>
      <label className="disp__row">
        <span>Name</span>
        <input className="ss__input" value={set.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
      </label>
      {nameTaken && <div className="flt__hint ss__warn">Another search set has this name.</div>}
      <label className="disp__row">
        <span>
          Folder <InfoTip>Optional: sets with the same folder are listed together.</InfoTip>
        </span>
        <input className="ss__input" list="ss-groups" value={set.group} placeholder="None" onChange={(e) => patch({ group: e.target.value })} />
        <datalist id="ss-groups">{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
      </label>
      <div className="disp__row">
        <span>Find objects matching</span>
        <div className="segmented-choice">
          <button type="button" className={set.match === 'all' ? 'active' : ''} onClick={() => patch({ match: 'all' })}>All conditions</button>
          <button type="button" className={set.match === 'any' ? 'active' : ''} onClick={() => patch({ match: 'any' })}>Any condition</button>
        </div>
      </div>

      <div className="flt__result">
        <div className="flt__result-text">
          <b>{n.toLocaleString()}</b> of {total.toLocaleString()} objects
          {set.conditions.length > 0 && n === 0 && <span className="flt__none"> — no matches</span>}
        </div>
        <span className="ss__result-actions">
          <button type="button" className="cols__link" disabled={n === 0} onClick={() => actions.select(ids)}>Select</button>
          <button type="button" className="cols__link" disabled={n === 0} onClick={() => void actions.isolate(ids)}>Isolate</button>
        </span>
        <div className="flt__bar"><span style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="cols__heading"><span>Conditions <b>{set.conditions.length}</b></span></div>
      <RuleRows rules={set.conditions} onChange={setConditions} empty="Add a condition from the properties below.">
        {(c) => <ConditionEditor condition={c} field={byId.get(c.field)} fields={fields} onChange={(p) => patchCondition(c.id, p)} />}
      </RuleRows>

      <div className="cols__heading"><span>Add a condition</span></div>
      <FieldPicker catalog={fields} picked={new Set(set.conditions.map((c) => c.field))} onPick={addCondition} placeholder="Search properties…" />

      <div className="ss__footer">
        {!isNew && (
          <button type="button" className="btn ss__delete" onClick={() => { if (window.confirm(`Delete the search set “${initial.name}”?`)) { remove(set.id); onClose(); } }}>Delete</button>
        )}
        <button
          type="button"
          className="btn"
          disabled={n === 0}
          title="Keep the objects found now as a selection set (it won't change when properties or models do)"
          onClick={() => { save({ id: newRuleId('ss'), name: `${set.name.trim() || 'Search'} (objects)`, group: set.group.trim(), kind: 'selection', match: 'all', conditions: [], items: itemsOf(engine.getIndexes(), ids) }); }}
        >
          Save matches as selection set
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={!canSave} onClick={() => { save({ ...set, name: set.name.trim(), group: set.group.trim() }); setLastGroup(set.group.trim()); onClose(); }}>Save</button>
      </div>
    </div>
  );
}

/** A selection set: its name and folder, what it holds per model, and the
    current selection added, removed or put in its place. */
function SelectionSetEditor({ initial, isNew, onClose, onConvert }: { initial: SearchSet; isNew: boolean; onClose: () => void; onConvert: (search: SearchSet) => void }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { sets, save, remove, setLastGroup } = useSearchSetsStore();
  const actions = useSetActions();
  const selection = useSelectionItems();
  const [set, setSet] = useState<SearchSet>(initial);
  const items = set.items ?? [];
  const patch = (p: Partial<SearchSet>) => setSet((s) => ({ ...s, ...p }));

  const { ids, missing } = useMemo(
    () => resolveItems(engine.getIndexes(), items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, items, models, tick],
  );
  const perModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.model, (m.get(i.model) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const loadedNames = new Set(models.map((m) => m.name));
  const legacyCount = Object.values(set.legacy ?? {}).reduce((k, l) => k + l.length, 0);
  const inSet = useMemo(() => {
    const keys = new Set(items.map((i) => `${i.model}|${i.guid}`));
    return selection.filter((i) => keys.has(`${i.model}|${i.guid}`)).length;
  }, [items, selection]);
  const groupNames = [...new Set(sets.map((s) => s.group).filter(Boolean))];
  const nameTaken = sets.some((s) => s.id !== set.id && s.name.trim().toLowerCase() === set.name.trim().toLowerCase());
  const canSave = set.name.trim() !== '' && !nameTaken;
  const n = countIds(ids);

  // Convert to a search set: by which properties the set's objects are found again.
  const allFields = useModelFields();
  const [convFields, setConvFields] = useState<string[]>([]);
  const [convOpen, setConvOpen] = useState(false);
  const conv = useMemo(
    () => conversionResult(engine.getIndexes(), ids, convFields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, ids, convFields, tick],
  );
  const fieldLabel = (id: string) => { const f = allFields.find((x) => x.id === id); return f ? `${f.group ? `${f.group} › ` : ''}${f.label}` : id; };
  const fieldGroups = useMemo(() => {
    const map = new Map<string, PickField[]>();
    for (const f of allFields) (map.get(f.group ?? '') ?? map.set(f.group ?? '', []).get(f.group ?? '')!).push(f);
    return [...map];
  }, [allFields]);
  const convert = () => onConvert({
    id: newRuleId('ss'),
    name: `${set.name.trim() || 'Selection'} (search)`,
    group: set.group.trim(),
    kind: 'search',
    match: 'all',
    conditions: conditionsFromObjects(engine.getIndexes(), ids, convFields),
  });

  return (
    <div className="flt ss">
      <div className="ss__editor-head">
        <b>{isNew ? 'New selection set' : 'Edit selection set'}</b>
      </div>
      <label className="disp__row">
        <span>Name</span>
        <input className="ss__input" value={set.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
      </label>
      {nameTaken && <div className="flt__hint ss__warn">Another set has this name.</div>}
      <label className="disp__row">
        <span>
          Folder <InfoTip>Optional: sets with the same folder are listed together.</InfoTip>
        </span>
        <input className="ss__input" list="ss-groups" value={set.group} placeholder="None" onChange={(e) => patch({ group: e.target.value })} />
        <datalist id="ss-groups">{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
      </label>

      <div className="flt__result">
        <div className="flt__result-text">
          <b>{items.length.toLocaleString()}</b> object{items.length === 1 ? '' : 's'}
          {missing > 0 && <span className="ss__warn"> · {missing.toLocaleString()} not in the loaded models</span>}
        </div>
        <span className="ss__result-actions">
          <button type="button" className="cols__link" disabled={n === 0} onClick={() => actions.select(ids)}>Select</button>
          <button type="button" className="cols__link" disabled={n === 0} onClick={() => void actions.isolate(ids)}>Isolate</button>
        </span>
      </div>
      {legacyCount > 0 && <div className="flt__hint">{legacyCount.toLocaleString()} more saved by an older version: they are added once their model is loaded.</div>}

      <div className="cols__heading">
        <span>
          Current selection <b>{selection.length}</b>{' '}
          <InfoTip>Select objects in the 3D view, the tree, the data table or with a search set, then add them to this set, remove them from it, or make them its only objects.</InfoTip>
        </span>
        {selection.length > 0 && <span className="cols__hint">{inSet} already in the set</span>}
      </div>
      <div className="ss__sel-actions">
        <button type="button" className="btn btn--small" disabled={selection.length === 0 || inSet === selection.length} onClick={() => patch({ items: mergeItems(items, selection) })}>Add</button>
        <button type="button" className="btn btn--small" disabled={inSet === 0} onClick={() => patch({ items: mergeItems(items, selection, true) })}>Remove</button>
        <button type="button" className="btn btn--small" disabled={selection.length === 0} onClick={() => patch({ items: selection, legacy: undefined })}>Replace</button>
      </div>

      <div className="cols__heading"><span>By model <b>{perModel.length}</b></span></div>
      <div className="cols__shown">
        {perModel.length === 0 && <div className="cols__empty">Empty: select objects and Add them.</div>}
        {perModel.map(([name, count]) => (
          <div className="cols__row" key={name}>
            <span className="cols__label" title={name}>{name}</span>
            {!loadedNames.has(name) && <span className="cols__hint">not loaded</span>}
            <span className="ss__count">{count.toLocaleString()}</span>
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => patch({ items: items.filter((i) => i.model !== name) })} title={`Remove this model's ${count} objects from the set`} aria-label={`Remove ${name}`}><IconRemove /></button>
          </div>
        ))}
      </div>

      <div className="cols__heading">
        <button type="button" className="cols__group-toggle" onClick={() => setConvOpen((v) => !v)} aria-expanded={convOpen}>
          <span>Convert to a search set{' '}
            <InfoTip>Finds these objects again by property values (for instance the Pour ID) instead of by object, so the search follows the model when it is re-converted or changes. Choose the properties, check how many objects it finds, then create it.</InfoTip>
          </span>
        </button>
      </div>
      {convOpen && (
        <div className="ss__convert">
          <div className="ss__sel-actions">
            <select className="ss__field" value="" onChange={(e) => { if (e.target.value && !convFields.includes(e.target.value)) setConvFields([...convFields, e.target.value]); }} aria-label="Add a property">
              <option value="">Add a property…</option>
              {fieldGroups.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" className="btn btn--small" disabled={n === 0} onClick={() => setConvFields(suggestFields(engine.getIndexes(), ids, allFields.map((f) => f.id)))} title="Picks the fewest properties that find these objects and the fewest others">Suggest</button>
          </div>
          <div className="cols__shown">
            {convFields.length === 0 && <div className="cols__empty">No property yet: add one, or Suggest.</div>}
            {convFields.map((f) => (
              <div className="cols__row" key={f}>
                <span className="cols__label" title={f}>{fieldLabel(f)}</span>
                <button type="button" className="cols__icon cols__icon--remove" onClick={() => setConvFields(convFields.filter((x) => x !== f))} title="Remove this property" aria-label={`Remove ${fieldLabel(f)}`}><IconRemove /></button>
              </div>
            ))}
          </div>
          {convFields.length > 0 && (
            <div className={`flt__hint${conv.found !== conv.total || conv.inSet !== conv.total ? ' ss__warn' : ''}`}>
              Finds <b>{conv.found.toLocaleString()}</b> object{conv.found === 1 ? '' : 's'}: {conv.inSet.toLocaleString()} of this set’s {conv.total.toLocaleString()}
              {conv.found > conv.inSet ? `, and ${(conv.found - conv.inSet).toLocaleString()} more` : ''}.
            </div>
          )}
          <button type="button" className="btn btn--small" disabled={convFields.length === 0 || conv.found === 0} onClick={convert}>Create search set…</button>
        </div>
      )}

      <div className="ss__footer">
        {!isNew && (
          <button type="button" className="btn ss__delete" onClick={() => { if (window.confirm(`Delete the selection set “${initial.name}”?`)) { remove(set.id); onClose(); } }}>Delete</button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={!canSave} onClick={() => { save({ ...set, name: set.name.trim(), group: set.group.trim() }); setLastGroup(set.group.trim()); onClose(); }}>Save</button>
      </div>
    </div>
  );
}

export function ConditionEditor({ condition: c, field, fields, onChange }: { condition: SearchCondition; field?: PickField; fields: PickField[]; onChange: (p: Partial<SearchCondition>) => void }) {
  const input = opInput(c.op);
  const problem = conditionProblem(c);
  const groups = useMemo(() => {
    const map = new Map<string, PickField[]>();
    for (const f of fields) (map.get(f.group ?? '') ?? map.set(f.group ?? '', []).get(f.group ?? '')!).push(f);
    return [...map];
  }, [fields]);
  return (
    <div className="ss__cond">
      <div className="ss__cond-line">
        <select className="ss__field" value={c.field} onChange={(e) => onChange({ field: e.target.value, values: [] })} title={field ? `${field.group} › ${field.label}` : c.field}>
          {!field && <option value={c.field}>{c.field} (not in the loaded models)</option>}
          {groups.map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </optgroup>
          ))}
        </select>
        <select className="ss__op" value={c.op} onChange={(e) => onChange({ op: e.target.value as SearchOp })}>
          {SEARCH_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </div>
      {input === 'values' && <ValuesPicker condition={c} onChange={onChange} />}
      {input === 'text' && (
        <input className="cols__search ss__value" placeholder={c.op === 'regex' ? 'Regular expression, e.g. ^L0[1-4]$' : c.op === 'equals' || c.op === 'notEquals' ? 'Value (empty: no value)' : 'Value'} value={c.value} onChange={(e) => onChange({ value: e.target.value })} />
      )}
      {input === 'number' && <input className="cols__search ss__value" type="number" step="any" placeholder="Number" value={c.value} onChange={(e) => onChange({ value: e.target.value })} />}
      {input === 'range' && (
        <div className="flt__range">
          <label><span>Min</span><input type="number" step="any" value={c.value} onChange={(e) => onChange({ value: e.target.value })} /></label>
          <label><span>Max</span><input type="number" step="any" value={c.value2 ?? ''} onChange={(e) => onChange({ value2: e.target.value })} /></label>
        </div>
      )}
      {problem && <div className="flt__hint ss__warn">{problem} — left out until then.</div>}
    </div>
  );
}

/** "is any of" / "is none of": the field's values with how many objects
    have each, as the Filter tab lists them. */
function ValuesPicker({ condition: c, onChange }: { condition: SearchCondition; onChange: (p: Partial<SearchCondition>) => void }) {
  const values = useFieldValues(c.field);
  const [search, setSearch] = useState('');
  const sel = new Set(c.values ?? []);
  const q = search.trim().toLowerCase();
  const hit = queryMatcher(search);
  const list = (q ? values.filter((v) => hit(v.value)) : values).slice(0, MAX_VALUES);
  const setSel = (next: Set<string>) => onChange({ values: [...next] });
  const toggle = (v: string) => {
    const next = new Set(sel);
    if (!next.delete(v)) next.add(v);
    setSel(next);
  };
  return (
    <div className="ss__values">
      {values.length > 8 && <input className="cols__search" type="search" placeholder={`Search ${values.length} values…`} value={search} onChange={(e) => setSearch(e.target.value)} />}
      <div className="flt__bulk">
        <button type="button" className="cols__link" onClick={() => setSel(new Set([...sel, ...list.map((v) => v.value)]))}>Select {q ? 'shown' : 'all'}</button>
        <button type="button" className="cols__link" onClick={() => setSel(new Set([...sel].filter((v) => !list.some((x) => x.value === v))))}>None</button>
        {sel.size > 0 && <span className="flt__n">{sel.size} picked</span>}
      </div>
      <div className="flt__values">
        {list.map((v) => (
          <label className="cols__check" key={v.value}>
            <input type="checkbox" checked={sel.has(v.value)} onChange={() => toggle(v.value)} />
            <span title={v.value}>{v.value}</span>
            <span className="flt__n">{v.count}</span>
          </label>
        ))}
        {list.length === 0 && <div className="flt__hint">No matching values.</div>}
        {!q && values.length > MAX_VALUES && <div className="flt__hint">Showing the {MAX_VALUES} most common of {values.length}; search to find others.</div>}
      </div>
    </div>
  );
}

/** Import steps: pick a CSV / TXT file, check which columns hold the
    GlobalId and the task name, then make one selection set per step. */
/** Bulk "Convert to search sets": the selected selection sets become search sets by the same properties, each from the
    values its own objects have. Shows, per set, how many objects the search finds against how many the set holds. */
function BulkConvert({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { sets, save } = useSearchSetsStore();
  const allFields = useModelFields();
  const [fields, setFields] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [exactOnly, setExactOnly] = useState(true);
  const targets = useMemo(() => sets.filter((x) => ids.includes(x.id) && isSelectionSet(x)), [sets, ids]);
  const objects = useMemo(
    () => targets.map((t) => ({ set: t, ids: resolveItems(engine.getIndexes(), t.items ?? []).ids })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, targets, models, tick],
  );
  const rows = useMemo(
    () => objects.map((o) => ({ ...o, res: conversionResult(engine.getIndexes(), o.ids, fields) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, objects, fields],
  );
  const fieldGroups = useMemo(() => {
    const map = new Map<string, PickField[]>();
    for (const f of allFields) (map.get(f.group ?? '') ?? map.set(f.group ?? '', []).get(f.group ?? '')!).push(f);
    return [...map];
  }, [allFields]);
  const label = (id: string) => { const f = allFields.find((x) => x.id === id); return f ? `${f.group ? `${f.group} › ` : ''}${f.label}` : id; };
  const exact = (r: (typeof rows)[number]) => r.res.total > 0 && r.res.found === r.res.total && r.res.inSet === r.res.total;
  const convertible = rows.filter((r) => r.res.total > 0 && fields.length > 0 && (!exactOnly || exact(r)));

  // The combination of properties that suits most of the sets.
  const suggest = () => {
    const votes = new Map<string, { n: number; fields: string[] }>();
    for (const o of objects) {
      const f = suggestFields(engine.getIndexes(), o.ids, allFields.map((x) => x.id));
      if (f.length === 0) continue;
      const k = f.join('|');
      votes.set(k, { n: (votes.get(k)?.n ?? 0) + 1, fields: f });
    }
    const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    if (best) setFields(best.fields);
  };
  const apply = () => {
    if (convertible.length === 0) return;
    if (replace && !window.confirm(`Replace ${convertible.length} selection set${convertible.length === 1 ? '' : 's'} with search sets? The objects they hold are no longer kept: the search finds them again from their properties.`)) return;
    for (const r of convertible) {
      const conditions = conditionsFromObjects(engine.getIndexes(), r.ids, fields);
      if (replace) save({ ...r.set, kind: 'search', match: 'all', conditions, items: undefined, legacy: undefined });
      else save({ id: newRuleId('ss'), name: r.set.name, group: r.set.group ? `${r.set.group} (search)` : 'Search sets', kind: 'search', match: 'all', conditions });
    }
    onDone();
  };

  return (
    <div className="ss__convert" style={{ marginBottom: 8 }}>
      <div className="ss__editor-head"><b>Convert {targets.length} selection set{targets.length === 1 ? '' : 's'} to search sets</b></div>
      {targets.length === 0 && <div className="flt__hint">Select selection sets in the list first (Shift+click for a range, Ctrl+click to add).</div>}
      <div className="ss__sel-actions">
        <select className="ss__field" value="" onChange={(e) => { if (e.target.value && !fields.includes(e.target.value)) setFields([...fields, e.target.value]); }} aria-label="Add a property">
          <option value="">Add a property…</option>
          {fieldGroups.map(([g, list]) => (
            <optgroup key={g} label={g}>{list.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>
          ))}
        </select>
        <button type="button" className="btn btn--small" disabled={targets.length === 0} onClick={suggest} title="The fewest properties that find most of these sets' objects and few others">Suggest</button>
      </div>
      <div className="cols__shown">
        {fields.length === 0 && <div className="cols__empty">No property yet: add one (for instance the Pour ID), or Suggest.</div>}
        {fields.map((f) => (
          <div className="cols__row" key={f}>
            <span className="cols__label" title={f}>{label(f)}</span>
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => setFields(fields.filter((x) => x !== f))} aria-label={`Remove ${label(f)}`}><IconRemove /></button>
          </div>
        ))}
      </div>
      {fields.length > 0 && (
        <>
          <div className="flt__hint">
            <b>{rows.filter(exact).length}</b> of {rows.length} find exactly their own objects{rows.some((r) => r.res.total === 0) ? ` · ${rows.filter((r) => r.res.total === 0).length} not in the loaded models` : ''}.
          </div>
          <div className="cols__shown" style={{ maxHeight: 180, overflowY: 'auto' }}>
            {rows.filter((r) => !exact(r)).map((r) => (
              <div className="cols__row" key={r.set.id}>
                <span className="cols__label" title={r.set.name}>{r.set.name}</span>
                <span className="ss__count ss__warn">{r.res.total === 0 ? 'not loaded' : `finds ${r.res.found} / ${r.res.total}`}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <label className="disp__row"><span>Only the exact ones <InfoTip>Leave out the sets whose search would find more or fewer objects than the set holds.</InfoTip></span><input type="checkbox" checked={exactOnly} onChange={(e) => setExactOnly(e.target.checked)} /></label>
      <label className="disp__row"><span>Replace the selection sets <InfoTip>Off: the search sets are added in a folder named after the sets’ folder plus “(search)”, and the selection sets are kept.</InfoTip></span><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /></label>
      <div className="ss__footer">
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={convertible.length === 0} onClick={apply}>Convert {convertible.length}</button>
      </div>
    </div>
  );
}

/** Spool: makes a set for every value of a property (or every combination of several) in one go, sorted into folders by splitting the
    value. Like the "Spool search sets" tool of other BIM add-ins. */
function SpoolSets({ onDone }: { onDone: () => void }) {
  const engine = useViewerEngine();
  const fields = useModelFields();
  const tick = useIndexTick();
  const selected = useSelectionStore((s) => s.byModel);
  const selectedCount = countIds(selected);
  const [props, setProps] = useState<string[]>(['']);
  const [folder, setFolder] = useState('');
  const [output, setOutput] = useState<'search' | 'selection'>('search');
  const [useSelection, setUseSelection] = useState(false);
  const [deleteExisting, setDeleteExisting] = useState(true);
  const [delimiter, setDelimiter] = useState('-');
  const [primaryOn, setPrimaryOn] = useState(false);
  const [primary, setPrimary] = useState(2);
  const [secondaryOn, setSecondaryOn] = useState(false);
  const [secondary, setSecondary] = useState(3);
  const [message, setMessage] = useState('');
  const labelOf = (id: string) => fields.find((f) => f.id === id)?.label ?? id;
  const chosen = props.filter(Boolean);
  const folderName = folder.trim() || (chosen.length ? chosen.map(labelOf).join(' + ') : '');

  const opts = useMemo((): SpoolOptions => ({
    fields: chosen,
    folder: folderName,
    output,
    restrictTo: useSelection && selectedCount ? selected : undefined,
    split: primaryOn || secondaryOn ? { delimiter, primary: primaryOn ? primary : undefined, secondary: secondaryOn ? secondary : undefined } : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [chosen.join('|'), folderName, output, useSelection, selected, selectedCount, delimiter, primaryOn, primary, secondaryOn, secondary]);
  const preview = useMemo(
    () => (chosen.length ? buildSpoolSets(engine.getIndexes(), opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, opts, tick],
  );
  const folders = preview ? new Set(preview.sets.map((s) => s.group)).size : 0;

  const run = () => {
    if (!preview || !preview.sets.length) return;
    const store = useSearchSetsStore.getState();
    const old = store.sets.filter((s) => inFolderTree(s.group, folderName));
    if (deleteExisting && old.length && !window.confirm(`Replace the ${old.length} set${old.length === 1 ? '' : 's'} in “${folderName}” (and the folders inside it)?`)) return;
    useSearchSetsStore.setState((s) => ({
      sets: [...(deleteExisting ? s.sets.filter((x) => !inFolderTree(x.group, folderName)) : s.sets), ...preview.sets],
    }));
    setMessage(`Made ${preview.sets.length.toLocaleString()} ${output} sets in ${folders} folder${folders === 1 ? '' : 's'}.`);
    onDone();
  };

  const num = (value: number, set: (n: number) => void, enabled: boolean) => (
    <input type="number" min={1} max={20} value={value} disabled={!enabled} onChange={(e) => set(Math.max(1, Math.round(Number(e.target.value)) || 1))} style={{ width: 52 }} aria-label="Part number" />
  );
  const fieldSelect = (value: string, i: number) => (
    <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select value={value} onChange={(e) => setProps((p) => p.map((x, j) => (j === i ? e.target.value : x)))} aria-label="Property" style={{ flex: 1, minWidth: 0 }}>
        <option value="">Choose a property…</option>
        {[...new Set(fields.map((f) => f.group))].map((g) => (
          <optgroup key={g} label={g}>
            {fields.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      {props.length > 1 && <button type="button" className="cols__icon cols__icon--remove" onClick={() => setProps((p) => p.filter((_, j) => j !== i))} title="Remove this property" aria-label="Remove this property"><IconRemove /></button>}
    </div>
  );
  return (
    <div className="flt__hint ss__import" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="segmented-choice" title="What each set is">
        <button type="button" className={output === 'search' ? 'active' : ''} onClick={() => setOutput('search')} title="Rules that find the value again, in whatever models are loaded">Search sets</button>
        <button type="button" className={output === 'selection' ? 'active' : ''} onClick={() => setOutput('selection')} title="The objects as they are now, fixed">Selection sets</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Property{props.length > 1 ? ' (one set per combination)' : ''}</div>
      {props.map(fieldSelect)}
      <button type="button" className="btn btn--small" style={{ alignSelf: 'flex-start' }} onClick={() => setProps((p) => [...p, ''])} title="Make a set for every combination of the values of several properties">+ Another property</button>
      <input value={folder} placeholder={folderName || 'Folder name'} onChange={(e) => setFolder(e.target.value)} aria-label="Folder name" />
      <label><input type="checkbox" checked={useSelection} disabled={selectedCount === 0} onChange={(e) => setUseSelection(e.target.checked)} /> Only the selected objects{selectedCount ? ` (${selectedCount.toLocaleString()})` : ' (select some first)'}</label>
      <label><input type="checkbox" checked={deleteExisting} onChange={(e) => setDeleteExisting(e.target.checked)} /> Replace what is in this folder already</label>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Sort into folders by splitting the name</div>
      <label>Split on <input value={delimiter} onChange={(e) => setDelimiter(e.target.value)} style={{ width: 44 }} aria-label="Delimiter" /></label>
      <label><input type="checkbox" checked={primaryOn} onChange={(e) => setPrimaryOn(e.target.checked)} /> Folder from part {num(primary, setPrimary, primaryOn)}</label>
      <label><input type="checkbox" checked={secondaryOn} onChange={(e) => setSecondaryOn(e.target.checked)} /> Then a folder from part {num(secondary, setSecondary, secondaryOn)}</label>
      {preview && (
        <div className="ss__map-note">
          {preview.sets.length ? <>Makes <b>{preview.sets.length.toLocaleString()}</b> sets in <b>{folders}</b> folder{folders === 1 ? '' : 's'} ({preview.objects.toLocaleString()} objects){preview.empty ? `; ${preview.empty.toLocaleString()} objects have no value and are left out` : ''}.</> : 'No object has a value for that property.'}
          {preview.truncated && ' Only the first 2,000 are made: narrow it with a selection.'}
          {preview.sets[0] && <> First: <i>{preview.sets[0].group} / {preview.sets[0].name}</i>.</>}
        </div>
      )}
      {message && <div className="ss__map-note">{message}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn--primary" disabled={!preview || preview.sets.length === 0} onClick={run}>Make sets</button>
        <button type="button" className="btn" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

function ImportSteps({ onDone }: { onDone: () => void }) {
  const engine = useViewerEngine();
  const { sets, replaceGroup } = useSearchSetsStore();
  const [table, setTable] = useState<{ file: string; headers: string[]; rows: string[][] } | null>(null);
  const [guidCol, setGuidCol] = useState(0);
  const [nameCol, setNameCol] = useState(1);
  const [orderCol, setOrderCol] = useState(-1);
  const [field, setField] = useState('Attributes.GlobalId');
  const [message, setMessage] = useState('');
  const fields = useModelFields();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const all = parseTable(await file.text());
    if (all.length < 2) { setTable(null); setMessage('That file has no rows.'); return; }
    const guess = guessColumns(all[0]);
    setGuidCol(guess.guid);
    setNameCol(guess.name);
    setField(guessField(all[0][guess.guid], fields.map((f) => f.id)));
    setTable({ file: file.name, headers: all[0].map(cleanHeader), rows: all.slice(1) });
    setMessage('');
  };
  const parsed = useMemo(() => (table ? stepsFromRows(table.rows, guidCol, nameCol, orderCol) : null), [table, guidCol, nameCol, orderCol]);
  const existing = sets.filter((s) => s.group === STEPS_GROUP).length;

  const run = () => {
    if (!parsed) return;
    if (existing && !window.confirm(`Replace the ${existing} set${existing === 1 ? '' : 's'} in the “${STEPS_GROUP}” folder?`)) return;
    const { sets: made, missing } = buildStepSets(parsed.steps, engine.getIndexes(), field, () => crypto.randomUUID());
    replaceGroup(STEPS_GROUP, made);
    const objects = made.reduce((n, s) => n + s.conditions[0].values!.length, 0);
    setMessage(`Made ${made.length} search sets (${objects.toLocaleString()} objects).${missing ? ` ${missing.toLocaleString()} values are not in the loaded models (load their model and the sets will find them).` : ''}`);
    setTable(null);
    if (!missing) onDone();
  };

  const columnSelect = (value: number, set: (n: number) => void, none?: string) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} aria-label="CSV column">
      {none && <option value={-1}>{none}</option>}
      {table!.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );
  return (
    <div className="flt__hint ss__import">
      <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={(e) => void pick(e.target.files?.[0])} />
      {table && parsed && (
        <>
          <table className="ss__map">
            <thead>
              <tr>
                <th />
                <th>From the CSV</th>
                <th>In the model</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Match on</th>
                <td>{columnSelect(guidCol, setGuidCol)}</td>
                <td>
                  <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Model property">
                    {[...new Set(fields.map((f) => f.group))].map((g) => (
                      <optgroup key={g} label={g}>
                        {fields.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <th scope="row">Step name</th>
                <td>{columnSelect(nameCol, setNameCol)}</td>
                <td className="ss__map-note">Names each step (a search set)</td>
              </tr>
              <tr>
                <th scope="row">Order by</th>
                <td>{columnSelect(orderCol, setOrderCol, '(none: file order)')}</td>
                <td className="ss__map-note">Date column puts the steps in order</td>
              </tr>
            </tbody>
          </table>
          <div>{parsed.steps.length} step{parsed.steps.length === 1 ? '' : 's'} from {table.rows.length - parsed.skipped} rows · {parsed.skipped} without a task name left out</div>
          <button type="button" className="btn primary" disabled={parsed.steps.length === 0} onClick={run}>Make {parsed.steps.length} steps</button>
        </>
      )}
      {message && <div>{message}</div>}
    </div>
  );
}
