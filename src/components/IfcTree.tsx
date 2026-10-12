import { useEffect, useMemo, useRef, useState } from 'react';
import type * as OBC from '@thatopen/components';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { usePersistedState } from '../utils/persistedState';
import { useModelsStore } from '../state/modelsStore';
import { useSelectionStore } from '../state/selectionStore';
import { prettyClass } from '../viewer/bimTables';
import type { ModelIndex } from '../viewer/ViewerEngine';
import type { ModelTreeNode } from '../viewer/types';
import { queryMatcher } from '../schedule/search';
import { IconEye, IconEyeOff } from './icons';

type Mode = 'structure' | 'types' | 'layers';
type Kind = 'model' | 'spatial' | 'group' | 'element';

interface TNode {
  key: string;
  kind: Kind;
  modelId: string;
  category: string;
  type: string;
  name: string;
  desc: string;
  /** Drawn elements at or below this node. */
  ids: number[];
  children: TNode[];
}

const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCFACILITY', 'IFCFACILITYPART']);
const byName = (a: TNode, b: TNode) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** "Building Element Proxy" -> "Building Element Proxies", as BIMvision groups them. */
function plural(s: string) {
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(s)) return `${s}es`;
  return `${s}s`;
}

function buildTree(mode: Mode, indexes: ReadonlyMap<string, ModelIndex>): TNode[] {
  const roots: TNode[] = [];
  const multi = indexes.size > 1;
  for (const [modelId, index] of indexes) {
    const el = (id: number): TNode => {
      const e = index.elements.get(id);
      const category = e?.category ?? '';
      return { key: `${modelId}:${id}`, kind: 'element', modelId, category, type: prettyClass(category), name: index.names.get(id) || e?.name || String(id), desc: e?.description ?? '', ids: index.elements.has(id) ? [id] : [], children: [] };
    };
    const group = (parentKey: string, category: string, members: TNode[], label?: string): TNode => ({
      key: `${parentKey}/${category}`,
      kind: 'group',
      modelId,
      category,
      type: label ?? plural(prettyClass(category)),
      name: '',
      desc: '',
      ids: members.flatMap((m) => m.ids),
      children: members.sort(byName),
    });

    let top: TNode[] = [];
    if (mode === 'structure') {
      // The fragments tree alternates category nodes (no id) with item nodes.
      const itemsUnder = (node: ModelTreeNode, parentKey: string): TNode[] => {
        const out: TNode[] = [];
        for (const catNode of node.children) {
          if (catNode.localId !== null) {
            // An item directly under a class node takes that node's class.
            out.push(item(catNode, node.localId === null ? node.category : catNode.category));
            continue;
          }
          const items = catNode.children.filter((c) => c.localId !== null).map((c) => item(c, catNode.category));
          if (SPATIAL.has(catNode.category) || !parentKey.includes(':')) out.push(...items);
          else if (items.length) out.push(group(parentKey, catNode.category, items));
        }
        return out;
      };
      const item = (node: ModelTreeNode, category: string): TNode => {
        const key = `${modelId}:${node.localId}`;
        const spatial = SPATIAL.has(category);
        const children = itemsUnder(node, key);
        const own = node.localId !== null && index.elements.has(node.localId) ? [node.localId] : [];
        return {
          key,
          kind: spatial ? 'spatial' : 'element',
          modelId,
          category,
          type: prettyClass(category),
          name: (node.localId !== null ? index.names.get(node.localId) : '') || '',
          desc: node.localId !== null ? index.elements.get(node.localId)?.description ?? '' : '',
          ids: [...own, ...children.flatMap((c) => c.ids)],
          children: spatial ? children : children.sort(byName),
        };
      };
      // The root is either the Project item itself or a category node above it.
      top = index.tree.localId !== null ? [item(index.tree, index.tree.category)] : itemsUnder(index.tree, modelId);
    } else if (mode === 'types') {
      const byCat = new Map<string, number[]>();
      for (const e of index.elements.values()) (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(e.localId);
      top = [...byCat.entries()].map(([cat, ids]) => group(modelId, cat, ids.map((id) => el(id)))).sort((a, b) => a.type.localeCompare(b.type));
    } else {
      top = [...index.layers.entries()].map(([layer, ids]) => group(modelId, `layer:${layer}`, ids.map((id) => el(id)), layer)).sort((a, b) => a.type.localeCompare(b.type));
    }
    if (multi) roots.push({ key: modelId, kind: 'model', modelId, category: 'MODEL', type: 'Model', name: index.name, desc: '', ids: top.flatMap((t) => t.ids), children: top });
    else roots.push(...top);
  }
  return roots;
}

// Small glyphs per IFC family, in the spirit of BIMvision's tree icons.
function iconFor(n: TNode): { d: string; color: string } {
  const c = n.category;
  if (n.kind === 'model') return { d: 'M3 3h18v18H3z M3 9h18 M9 21V9', color: '#5b6770' };
  if (n.kind === 'group') return { d: 'M3 6h7l2 2h9v11H3z', color: '#c9a227' };
  if (c === 'IFCPROJECT') return { d: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5', color: '#3b6ea8' };
  if (c === 'IFCSITE') return { d: 'M2 20l7-10 4 6 3-4 6 8z', color: '#4b8a3c' };
  if (c === 'IFCBUILDING') return { d: 'M5 21V5l7-3 7 3v16z M9 9h2 M13 9h2 M9 13h2 M13 13h2 M10 21v-4h4v4', color: '#8a5a3c' };
  if (c === 'IFCBUILDINGSTOREY') return { d: 'M3 8l9-4 9 4-9 4z M3 13l9 4 9-4 M3 18l9 4 9-4', color: '#5a6fb0' };
  if (c.includes('SLAB') || c.includes('FOOTING') || c.includes('ROOF')) return { d: 'M2 10l10-4 10 4-10 4z M2 10v4l10 4 10-4v-4', color: '#8c8c8c' };
  if (c.includes('WALL')) return { d: 'M3 6h18v12H3z M3 12h18 M9 6v6 M15 12v6', color: '#b0643c' };
  if (c.includes('COLUMN') || c.includes('PILE')) return { d: 'M9 3h6v18H9z', color: '#7a7a7a' };
  if (c.includes('BEAM') || c.includes('MEMBER')) return { d: 'M2 10h20v4H2z', color: '#7a7a7a' };
  if (c.includes('STAIR') || c.includes('RAMP')) return { d: 'M3 20h5v-5h5v-5h5V5h3', color: '#7a7a7a' };
  if (c.includes('PROXY')) return { d: 'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10', color: '#6f8f9f' };
  return { d: 'M4 7l8-4 8 4v10l-8 4-8-4z', color: '#8c8c8c' };
}

const toMap = (n: TNode): OBC.ModelIdMap => (n.ids.length ? { [n.modelId]: new Set(n.ids) } : {});

/** IFC structure tree in the style of BIMvision: Type / Name / Description,
    dotted tree lines with +/- boxes, elements grouped by class under each
    storey. Click selects the row's object(s) in the 3D view (Ctrl/Shift
    adds; Isolate / Ghost follow the selection), keeps the row highlighted
    and opens it one level; double-click zooms to the object(s); a pick in
    3D highlights and reveals its row. */
export function IfcTree() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const byModel = useSelectionStore((s) => s.byModel);
  const [mode, setMode] = useState<Mode>('structure');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // The row last clicked (a storey or class group stays highlighted while
  // its objects are the selection), and when — a selection made here must
  // not re-open the tree down to its first object.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const treePickAt = useRef(0);
  // The rows picked here (click, Ctrl+click toggles, Shift+click / Shift+arrows a range): their objects are the selection in 3D,
  // and Space or an eye hides / shows them together, as in Sets.
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
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
  const bodyRef = useRef<HTMLDivElement>(null);
  // Name / Description widths; Type takes the rest. Drag a header divider.
  const [cols, setCols] = usePersistedState<[number, number]>('ifcTree.cols', [64, 84]);
  const gridCols = { gridTemplateColumns: `minmax(0, 1fr) ${cols[0]}px ${cols[1]}px 28px` };
  const startResize = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const start = cols;
    const move = (ev: PointerEvent) => {
      // Dragging a divider left widens the column to its right.
      const next: [number, number] = [...start];
      next[which] = Math.max(40, Math.min(400, start[which] - (ev.clientX - x0)));
      setCols(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const roots = useMemo(
    () => buildTree(mode, engine.getIndexes()),
    // models: the indexes change whenever a model is added or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, models, engine],
  );

  const { parentOf, byKey } = useMemo(() => {
    const parentOf = new Map<string, string>();
    const byKey = new Map<string, TNode>();
    const walk = (n: TNode, parent: string | null) => {
      byKey.set(n.key, n);
      if (parent) parentOf.set(n.key, parent);
      n.children.forEach((c) => walk(c, n.key));
    };
    roots.forEach((r) => walk(r, null));
    return { parentOf, byKey };
  }, [roots]);

  // Every tree (Structure, Types, Layers) opens fully collapsed.
  useEffect(() => {
    setExpanded(new Set());
  }, [roots, mode]);

  const selected = useMemo(() => {
    const s = new Set<string>();
    for (const [modelId, ids] of Object.entries(byModel)) for (const id of ids) s.add(`${modelId}:${id}`);
    return s;
  }, [byModel]);

  // A pick in the 3D view: reveal the (first) picked element's row.
  useEffect(() => {
    if (performance.now() - treePickAt.current < 1000) return;
    setPicks(new Set());
    const first = [...selected].find((k) => byKey.has(k));
    if (!first) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let p = parentOf.get(first); p; p = parentOf.get(p)) next.add(p);
      return next;
    });
    setFocusKey(first);
  }, [selected, byKey, parentOf]);
  useEffect(() => {
    if (!focusKey) return;
    const el = bodyRef.current?.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusKey, expanded]);

  // Visible rows, flattened, with what the tree lines need.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = queryMatcher(query);
    const matches = (n: TNode) => !q || hit(`${n.type} ${n.name} ${n.desc}`);
    const keep = new Map<string, boolean>();
    const mark = (n: TNode): boolean => {
      const any = n.children.map(mark).some(Boolean) || matches(n);
      keep.set(n.key, any);
      return any;
    };
    if (q) roots.forEach(mark);
    const out: { n: TNode; guides: boolean[]; last: boolean; open: boolean }[] = [];
    const walk = (list: TNode[], guides: boolean[]) => {
      const shown = q ? list.filter((n) => keep.get(n.key)) : list;
      shown.forEach((n, i) => {
        const last = i === shown.length - 1;
        const open = n.children.length > 0 && (q ? true : expanded.has(n.key));
        out.push({ n, guides, last, open });
        if (open) walk(n.children, [...guides, !last]);
      });
    };
    walk(roots, []);
    return out;
  }, [roots, expanded, query]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Picks a row: alone, or (Ctrl) toggled in the picks, or (Shift) with every row between the last pick and it. */
  const select = (n: TNode, additive: boolean, range = false) => {
    setFocusKey(n.key);
    let next: Set<string>;
    const from = anchor.current ? rows.findIndex((r) => r.n.key === anchor.current) : -1;
    const to = rows.findIndex((r) => r.n.key === n.key);
    if (range && from >= 0 && to >= 0) {
      next = new Set(rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.n.key));
    } else {
      next = additive ? new Set(picks) : new Set<string>();
      if (additive && next.has(n.key)) next.delete(n.key);
      else next.add(n.key);
      anchor.current = n.key;
    }
    setPicks(next);
    setPickedKey(n.key);
    treePickAt.current = performance.now();
    const map: Record<string, Set<number>> = {};
    for (const key of next) {
      const node = byKey.get(key);
      if (node) for (const id of node.ids) (map[node.modelId] ??= new Set()).add(id);
    }
    if (Object.keys(map).length) void engine.highlighter.highlightByID('select', map, true, false);
    else void engine.highlighter.clear('select');
  };
  const hiddenOf = (n: TNode) => {
    let hidden = 0;
    for (const id of n.ids) if (engine.isUserHidden(n.modelId, id)) hidden++;
    return hidden;
  };
  /** Hides the objects of these rows, or shows them when any is hidden (as Sets and Colour do). */
  const flip = async (nodes: TNode[]) => {
    const map: Record<string, Set<number>> = {};
    let hidden = 0;
    let total = 0;
    for (const node of nodes) for (const id of node.ids) {
      (map[node.modelId] ??= new Set()).add(id);
      total++;
      if (engine.isUserHidden(node.modelId, id)) hidden++;
    }
    if (total === 0) return;
    await engine.hider.set(hidden > 0, map);
    engine.onExternalVisibilityChange.trigger();
  };
  const pickedNodes = () => [...picks].map((k) => byKey.get(k)).filter((n): n is TNode => !!n);
  /** Arrow keys, as in a file explorer: Up / Down move (and select),
      Right opens a row or steps into it, Left closes it or goes to its
      parent; Home / End jump to the first / last row. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = Math.max(0, rows.findIndex((r) => r.n.key === (focusKey ?? pickedKey)));
    const { n, open } = rows[at];
    const go = (i: number) => select(rows[Math.min(rows.length - 1, Math.max(0, i))].n, false, e.shiftKey);
    switch (e.key) {
      case 'ArrowDown': go(focusKey || pickedKey ? at + 1 : 0); break;
      case 'ArrowUp': go(at - 1); break;
      case ' ': {
        const nodes = picks.size ? pickedNodes() : [n];
        void flip(nodes);
        break;
      }
      case 'Home': go(0); break;
      case 'End': go(rows.length - 1); break;
      case 'ArrowRight':
        if (!n.children.length) break;
        if (open) go(at + 1);
        else setExpanded((prev) => new Set(prev).add(n.key));
        break;
      case 'ArrowLeft': {
        if (open) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(n.key);
            return next;
          });
          break;
        }
        const parent = parentOf.get(n.key);
        const p = parent ? rows.findIndex((r) => r.n.key === parent) : -1;
        if (p >= 0) go(p);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };
  const zoom = (n: TNode) => {
    const map = toMap(n);
    if (Object.keys(map).length) void engine.fit(map);
  };

  return (
    <div className="ifct">
      <div className="ifct__bar">
        <div className="segmented-choice ifct__modes">
          {(['structure', 'types', 'layers'] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'structure' ? 'Structure' : m === 'types' ? 'Types' : 'Layers'}
            </button>
          ))}
        </div>
        <input className="ifct__search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
      </div>
      <div className="ifct__head" style={gridCols}>
        <span>Type</span>
        <span>
          <i className="ifct__resize" onPointerDown={startResize(0)} />
          Name
        </span>
        <span>
          <i className="ifct__resize" onPointerDown={startResize(1)} />
          Description
        </span>
        <span />
      </div>
      <div className="ifct__body" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Selection tree: arrow keys move, Right / Left open and close, Space hides or shows the picked rows">
        {rows.length === 0 && <div className="ifct__empty">{models.length === 0 ? 'No models loaded.' : mode === 'layers' ? 'This model has no layers.' : 'Nothing matches.'}</div>}
        {rows.map(({ n, guides, last, open }) => {
          const icon = iconFor(n);
          const isSel = picks.has(n.key) || (n.kind === 'element' && selected.has(n.key));
          const hiddenN = hiddenOf(n);
          const shut = n.ids.length > 0 && hiddenN === n.ids.length;
          const part = hiddenN > 0 && !shut;
          return (
            <div
              key={n.key}
              data-key={n.key}
              className={`ifct__row${isSel ? ' is-selected' : ''}${n.kind === 'group' ? ' is-group' : ''}`}
              style={gridCols}
              onClick={(e) => select(n, e.ctrlKey || e.metaKey, e.shiftKey)}
              onDoubleClick={() => (n.children.length ? toggle(n.key) : zoom(n))}
              title={n.ids.length ? `${n.ids.length} object${n.ids.length === 1 ? '' : 's'} — click to select, double-click to ${n.children.length ? 'expand' : 'zoom'}` : undefined}
            >
              <span className="ifct__type">
                {guides.map((g, i) => (
                  <span key={i} className={`ifct__guide${g ? ' is-line' : ''}`} />
                ))}
                <span className={`ifct__elbow${last ? ' is-last' : ''}`}>
                  {n.children.length > 0 && (
                    <button
                      type="button"
                      className="ifct__box"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(n.key);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      aria-label={open ? 'Collapse' : 'Expand'}
                    >
                      {open ? '−' : '+'}
                    </button>
                  )}
                </span>
                <svg className="ifct__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={icon.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                  <path d={icon.d} />
                </svg>
                <span className="ifct__label">{n.type}</span>
                {n.kind === 'group' && <span className="ifct__count">{n.children.length}</span>}
              </span>
              <span className="ifct__cell">{n.name}</span>
              <span className="ifct__cell">{n.desc}</span>
              <span className="ifct__eyecell">
                {n.ids.length > 0 && (
                  <button
                    type="button"
                    className={`ifct__eye${shut ? ' is-off' : part ? ' is-part' : ''}`}
                    onClick={(e) => { e.stopPropagation(); void flip(picks.has(n.key) && picks.size > 1 ? pickedNodes() : [n]); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={shut ? 'Show these objects' : part ? 'Some are hidden: click to show them all' : picks.has(n.key) && picks.size > 1 ? 'Hide the picked rows' : 'Hide these objects'}
                    aria-label={shut ? 'Show' : 'Hide'}
                  >
                    {shut ? <IconEyeOff width={15} height={15} /> : <IconEye width={15} height={15} />}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
