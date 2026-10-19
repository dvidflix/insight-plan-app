import { FEATURES } from '../features';
import { useExternalTable, pseudoObjects, parseScope, scopeOf } from '../datasources/externalRows';
import { useDataSourcesStore, tableOf } from '../datasources/store';
import { chooseDataFiles, addDroppedFiles, dragHasFiles } from '../datasources/addFiles';
import { computeLinks, objectsForRows, rowsForObjects, type GroupLinks } from '../datasources/matchGroups';
import { DockToolbar } from './Dock';
import { configFocusProps } from '../state/listConfigStore';
import { DataTableListConfig } from './DataTablePanel';
import { OverflowMenu } from './TablePopovers';
import { useTableCountStore } from '../state/tableCountStore';
import { useRowPx } from '../state/tableStyleStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as OBC from '@thatopen/components';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useSettingsPaneStore } from '../state/settingsPaneStore';
import { COL_CLASS, COL_GUID, COL_MODEL, COL_NAME, TWIN_PREFIX, useDataTableStore, type DataAgg, type DataTableScope } from '../state/dataTableStore';
import type { ElementSummary } from '../viewer/types';
import { NO_VALUE, elementValue } from '../viewer/bimTables';
import { conditionTest } from '../viewer/searchSets';
import { matchColorRules } from './schedule/ColorPanel';
import { newRuleId } from './schedule/FieldRules';
import { queryMatcher } from '../schedule/search';
import { useListLevel, useListQuery, useTableSearchStore } from '../state/tableSearchStore';
import { SEVERAL } from '../viewer/twinMatch';
import { downloadCsv } from '../utils/csv';
import { useTwin } from './useTwin';
import { useIndexTick } from './modelFields';
import { combineTests } from '../viewer/filterLogic';
import { LINK_GROUP_FIELD, useVirtualFields } from './useVirtualFields';
import { SET_FOLDER, setFolderOf } from '../viewer/setFolderValues';
import { withUnit } from '../viewer/units';
import { ExpandCollapseToggle } from './ExpandCollapseToggle';
import { useDockStore } from '../state/dockStore';
import { IconCheckboxChecked, IconChevronLeft, IconChevronRight, IconDownloadFile, IconExpandMore, IconPin, IconTotals, IconTune } from './icons';

const BASE_ROW_H = 24;
const ADD_DATA = '__add-data';
const OVERSCAN = 10;
const DEFAULT_W = 170;
const MIN_W = 60;
const BUILTIN: { id: string; label: string; width: number }[] = [
  { id: COL_NAME, label: 'Name', width: 240 },
  { id: COL_CLASS, label: 'Class', width: 170 },
  { id: COL_MODEL, label: 'Model', width: 200 },
  { id: COL_GUID, label: 'GUID', width: 220 },
];

interface Row {
  key: string;
  /** An external table's row: its place in the table. */
  ext?: number;
  modelId: string;
  modelName: string;
  el: ElementSummary;
  /** Twin table: the object's twin in the twin model ('several' when the pairing is not clear). */
  twin?: ElementSummary | 'several' | null;
}

type Item =
  | { kind: 'group'; key: string; label: string; level: number; rows: Row[]; collapsed: boolean }
  | { kind: 'row'; row: Row; depth: number };

/** A column's header: the built-in's name, or the property's (its set in the tooltip). */
const labelOf = (col: string): string =>
  col === LINK_GROUP_FIELD
    ? 'Link group'
    : col.startsWith(SET_FOLDER)
    ? `Set › ${setFolderOf(col) || '(no folder)'}`
    : col.startsWith(TWIN_PREFIX)
    ? `Twin · ${labelOf(col.slice(TWIN_PREFIX.length))}`
    : BUILTIN.find((b) => b.id === col)?.label ?? (col.includes('.') ? col.slice(col.indexOf('.') + 1) : col);

/** A cell's text: the property as the Properties table shows it, blank when the object has none. */
function cell(row: Row, col: string): string {
  if (col.startsWith(TWIN_PREFIX)) {
    const key = col.slice(TWIN_PREFIX.length);
    if (row.twin === 'several') return key === COL_GUID ? '(several)' : '';
    if (!row.twin) return '';
    if (key === COL_MODEL) return row.twin.fileName;
    const v = elementValue(row.twin, key);
    return v === NO_VALUE ? '' : v;
  }
  if (col === COL_MODEL) return row.modelName;
  const v = elementValue(row.el, col);
  return v === NO_VALUE ? '' : v;
}

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const toNumber = (v: string) => {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const AGG_SHORT: Record<DataAgg, string> = { none: '', sum: 'Σ', avg: 'avg', min: 'min', max: 'max', count: '#' };
const AGG_LABELS: Record<DataAgg, string> = { none: 'None', sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count' };
const NUMBER_AGGS: DataAgg[] = ['sum', 'avg', 'min', 'max', 'count', 'none'];
const TEXT_AGGS: DataAgg[] = ['count', 'none'];

const formatNumber = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** A column's summary over `rows` (count: rows with a value). */
function aggregate(rows: Row[], col: string, kind: DataAgg): string {
  if (kind === 'none' || rows.length === 0) return '';
  if (kind === 'count') return rows.reduce((n, r) => n + (cell(r, col) ? 1 : 0), 0).toLocaleString();
  let sum = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const n = toNumber(cell(r, col));
    if (n === null) continue;
    sum += n;
    count++;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (!count) return '';
  return formatNumber(kind === 'sum' ? sum : kind === 'avg' ? sum / count : kind === 'min' ? min : max);
}

/** A selection as one text, to tell the selection the table made itself from a new one of the user's. */
const sigOf = (m: Record<string, Iterable<number>>) => JSON.stringify(Object.entries(m).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]).sort());

function toIdMap(rows: Row[]): OBC.ModelIdMap {
  const map: OBC.ModelIdMap = {};
  for (const r of rows) (map[r.modelId] ??= new Set<number>()).add(r.el.localId);
  return map;
}

/** Trimble Connect–style data table under the 3D view: one row per element of
    the loaded models, with any property as a column, search, per-column
    filters, grouping and two-way selection with the 3D view. Rows are
    virtualised, so a whole model (100k+ elements) stays responsive. */
export function ModelDataTable() {
  const ROW_H = useRowPx(BASE_ROW_H);
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const { open, columns, widths, filters: conditions, filterMatch, filterLogic, groupRules, sortRules, colorRules, totals, aggs, scope, setScope, pinnedKeys, setPinned, setWidth, setColumns, patch, configure, presets, applyPreset } = useDataTableStore();
  // What the set and Link Group fields read from (their values change with the sets, the groups and the models).
  const virtualVersion = useVirtualFields();
  // An external table (CSV, Excel, SQLite) instead of the model's objects: its rows are pseudo-objects, one property per column.
  const ext = useExternalTable(scope);
  const lab = (c: string) => (ext ? c : labelOf(c));
  const sources = useDataSourcesStore((s) => s.sources);
  // A source that was removed while its table showed: back to the model's objects.
  useEffect(() => {
    const p = parseScope(scope);
    if (p && !sources.some((x) => x.id === p.sourceId)) setScope('all');
  }, [scope, sources, setScope]);
  const sourceTables = useDataSourcesStore((s) => s.data);
  const triggers = useDataSourcesStore((s) => s.triggers);
  // The sources the browser still lets us read are read again once.
  useEffect(() => { if (FEATURES.dataSources) void useDataSourcesStore.getState().restore(); }, []);
  // A table with no columns chosen yet (or none left after the file changed) shows all of them.
  useEffect(() => {
    if (ext && !ext.table.columns.some((c) => columns.includes(c))) setColumns(ext.table.columns);
  }, [ext, columns, setColumns]);
  /** What the 3D view selects narrows an external table (when the trigger is on); null: every row. */
  const [extFilter, setExtFilter] = useState<Set<number> | null>(null);
  const extScopeKey = ext ? `${ext.source.id}|${ext.name}` : '';
  useEffect(() => { setExtFilter(null); }, [extScopeKey]);
  // What the match groups couple (rows ↔ objects), for the triggers.
  const indexTick = useIndexTick();
  const links = useMemo<GroupLinks[]>(() => (ext ? computeLinks(ext.table, engine.getIndexes(), ext.groups) : []), [ext?.table, ext?.groups, engine, indexTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const extRef = useRef({ ext, triggers, links });
  extRef.current = { ext, triggers, links };
  const extEcho = useRef('');

  // The words come from the main header's search box (it works on the list that is active).
  const search = useListQuery('datatable');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groupLevel = useListLevel('datatable');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  // The totals row's "how to sum up" menu, opened by clicking a total.
  const [aggMenu, setAggMenu] = useState<{ col: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!aggMenu) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.mdt__aggmenu')) setAggMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAggMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [aggMenu]);
  const [viewH, setViewH] = useState(200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const lastFromTable = useRef<string>('');

  // ---- data --------------------------------------------------------------
  // Twin table: the primary model's objects only, each with its twin.
  const twin = useTwin();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (ext) {
      return pseudoObjects(ext.table, ext.source.name).map((el) => ({ key: `ext:${el.localId}`, modelId: '', modelName: ext.source.name, el, ext: el.localId }));
    }
    if (twin.active) {
      const bElements = engine.getIndexes().get(twin.b!.modelId)?.elements;
      for (const el of twin.a!.elements) {
        const t = twin.map?.get(el.localId);
        out.push({ key: `${twin.a!.modelId}:${el.localId}`, modelId: twin.a!.modelId, modelName: twin.a!.name, el, twin: t === undefined ? null : t === SEVERAL ? 'several' : bElements?.get(t) ?? null });
      }
      return out;
    }
    for (const m of models) {
      if (hiddenModelIds.has(m.modelId)) continue;
      for (const el of m.elements) out.push({ key: `${m.modelId}:${el.localId}`, modelId: m.modelId, modelName: m.name, el });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, hiddenModelIds, twin.active, twin.a, twin.b, twin.map, ext?.table, ext?.source.name]);

  // Show: visible objects — what the 3D view shows now, re-read after each
  // Hide / Isolate / Show all (and 4D / storey slide changes).
  const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (scope !== 'visible') return;
    let cancelled = false;
    let timer = 0;
    const read = async () => {
      const keys = new Set<string>();
      for (const m of models) {
        if (hiddenModelIds.has(m.modelId)) continue;
        for (const id of await engine.visibleOf(m.modelId, m.elements.map((e) => e.localId))) keys.add(`${m.modelId}:${id}`);
      }
      if (!cancelled) setVisibleKeys(keys);
    };
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void read(), 150);
    };
    void engine.ready.then(read);
    engine.onVisibilityChange.add(later);
    engine.onExternalVisibilityChange.add(later);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      engine.onVisibilityChange.remove(later);
      engine.onExternalVisibilityChange.remove(later);
    };
  }, [engine, scope, models, hiddenModelIds]);

  // Show: selected objects — the 3D selection. A pick made in the table
  // itself leaves the list as it is (it would otherwise shrink to that row).
  const [scopeSelected, setScopeSelected] = useState<Set<string>>(new Set());

  const scoped = useMemo(() => {
    if (pinnedKeys) return rows.filter((r) => pinnedKeys.has(r.key));
    if (ext) return extFilter && triggers.toGrid ? rows.filter((r) => extFilter.has(r.ext!)) : rows;
    if (scope === 'visible') return visibleKeys ? rows.filter((r) => visibleKeys.has(r.key)) : rows;
    if (scope === 'selected') return rows.filter((r) => scopeSelected.has(r.key));
    return rows;
  }, [rows, scope, visibleKeys, scopeSelected, pinnedKeys, ext, extFilter, triggers.toGrid]);

  // Search, then the Filters tab's conditions, then the sort keys.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hit = queryMatcher(search);
    let list = scoped;
    if (q) list = list.filter((r) => columns.some((c) => hit(cell(r, c))));
    // A condition on a twin column tests the row's twin (no twin: no match).
    const tests = conditions.map((c) => {
      if (c.field.startsWith(TWIN_PREFIX)) {
        const t = conditionTest({ ...c, field: c.field.slice(TWIN_PREFIX.length) });
        return t && ((r: Row) => typeof r.twin === 'object' && r.twin !== null && t(r.twin));
      }
      const t = conditionTest(c);
      return t && ((r: Row) => t(r.el));
    });
    // The rules combine as the formula says ("(1 and 2) or 3"), else all / any of them.
    const keep = combineTests(tests, filterMatch, filterLogic);
    if (keep) list = list.filter(keep);
    if (sortRules.length) {
      list = [...list].sort((a, b) => {
        for (const rule of sortRules) {
          const d = compare(cell(a, rule.field), cell(b, rule.field));
          if (d) return rule.direction === 'up' ? d : -d;
        }
        return 0;
      });
    }
    return list;
  }, [scoped, search, columns, conditions, filterMatch, filterLogic, sortRules, virtualVersion]);

  // Nested groups, one level per Group rule (outermost first).
  const items = useMemo<Item[]>(() => {
    if (!groupRules.length) return shown.map((row) => ({ kind: 'row', row, depth: 0 }));
    const out: Item[] = [];
    const walk = (list: Row[], level: number, path: string) => {
      const rule = groupRules[level];
      if (!rule) {
        for (const row of list) out.push({ kind: 'row', row, depth: level });
        return;
      }
      const groups = new Map<string, Row[]>();
      for (const r of list) {
        const k = cell(r, rule.field) || '(none)';
        const g = groups.get(k);
        if (g) g.push(r); else groups.set(k, [r]);
      }
      const labels = [...groups.keys()].sort((a, b) => (rule.direction === 'up' ? compare(a, b) : compare(b, a)));
      for (const label of labels) {
        const key = `${path}/${label}`;
        const gr = groups.get(label)!;
        const isCollapsed = collapsed.has(key);
        out.push({ kind: 'group', key, label, level, rows: gr, collapsed: isCollapsed });
        if (!isCollapsed) walk(gr, level + 1, key);
      }
    };
    walk(shown, 0, '');
    return out;
  }, [shown, groupRules, collapsed, virtualVersion]);

  // Number columns: every value (of the first 2,000 that have one) is a number.
  const numeric = useMemo(() => {
    const out = new Set<string>();
    for (const c of columns) {
      let seen = 0;
      let ok = true;
      for (const r of rows) {
        const v = cell(r, c);
        if (!v) continue;
        if (toNumber(v) === null) { ok = false; break; }
        if (++seen >= 2000) break;
      }
      if (ok && seen > 0) out.add(c);
    }
    return out;
  }, [rows, columns, virtualVersion]);
  const aggOf = (c: string): DataAgg => {
    const k = aggs[c];
    if (k && (numeric.has(c) || TEXT_AGGS.includes(k))) return k;
    return numeric.has(c) ? 'sum' : 'none';
  };
  const summarised = totals && columns.some((c) => aggOf(c) !== 'none');

  /** Header click: sort by that column A→Z, then Z→A, then not at all. */
  const sortByHeader = (col: string) => {
    const first = sortRules[0];
    if (first?.field === col && sortRules.length === 1) patch({ sortRules: first.direction === 'up' ? [{ ...first, direction: 'down' }] : [] });
    else patch({ sortRules: [{ id: newRuleId('sort'), field: col, direction: 'up' }] });
  };
  const sortOf = (col: string) => sortRules.findIndex((r) => r.field === col);

  // Collapse / Expand all from the Group tab.
  const groupCommand = useDataTableStore((s) => s.groupCommand);
  useEffect(() => {
    if (!groupCommand) return;
    useTableSearchStore.getState().setListLevel('datatable', '');
    setCollapsed(groupCommand.kind === 'expand' ? new Set() : groupKeys());
  }, [groupCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every group key at every level (collapsed ones hide their children from `items`); with `only`, just that level's. */
  function groupKeys(only?: number) {
    const keys = new Set<string>();
    const walk = (list: Row[], level: number, path: string) => {
      const rule = groupRules[level];
      if (!rule) return;
      const groups = new Map<string, Row[]>();
      for (const r of list) {
        const k = cell(r, rule.field) || '(none)';
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
      }
      for (const [label, gr] of groups) {
        if (only === undefined || only === level) keys.add(`${path}/${label}`);
        if (only === undefined || level < only) walk(gr, level + 1, `${path}/${label}`);
      }
    };
    walk(shown, 0, '');
    return keys;
  }
  // The header's ‹ 2 › stepper: show the groups down to that level, the ones at it closed ('' = All open).
  const levelSeen = useRef('');
  useEffect(() => {
    if (groupLevel === levelSeen.current) return;
    levelSeen.current = groupLevel;
    setCollapsed(groupLevel === '' ? new Set() : groupKeys(Number(groupLevel)));
  }, [groupLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowItemIndexes = useMemo(() => items.flatMap((it, i) => (it.kind === 'row' ? [i] : [])), [items]);

  // ---- selection sync with the 3D view -----------------------------------
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void engine.ready.then(() => {
      if (cancelled) return;
      const ev = engine.highlighter.events.select;
      const toKeys = (map: OBC.ModelIdMap) => {
        const keys = new Set<string>();
        for (const [modelId, ids] of Object.entries(map)) for (const id of ids) keys.add(`${modelId}:${id}`);
        return keys;
      };
      const fromTable = (keys: Set<string>) => [...keys].sort().join('|') === lastFromTable.current;
      const onHighlight = (map: OBC.ModelIdMap) => {
        const { ext: x, triggers: t, links: lk } = extRef.current;
        if (x) {
          // An external table: the objects picked in 3D narrow it to their rows (the ID Match says which), unless this is the
          // selection the table just made itself.
          if (sigOf(map) === extEcho.current || !t.toGrid) return;
          const objectKeys: string[] = [];
          for (const [modelId, ids] of Object.entries(map)) for (const id of ids) objectKeys.push(`${modelId}:${id}`);
          if (!objectKeys.length) { setExtFilter(null); return; }
          const hit = rowsForObjects(lk, objectKeys);
          setExtFilter(hit);
          if (t.selectInGrid) setSelected(new Set([...hit].map((i) => `ext:${i}`)));
          return;
        }
        const keys = toKeys(map);
        setSelected(keys);
        if (fromTable(keys)) return;
        setScopeSelected(keys);
        // A 3D pick: whatever clears it next came from the 3D view too.
        lastFromTable.current = '(3d)';
      };
      const onClear = () => {
        if (extRef.current.ext) { extEcho.current = ''; setExtFilter(null); setSelected(new Set()); return; }
        setSelected(new Set());
        if (lastFromTable.current !== '') setScopeSelected(new Set());
      };
      ev.onHighlight.add(onHighlight);
      ev.onClear.add(onClear);
      setSelected(toKeys(engine.highlighter.selection.select));
      setScopeSelected(toKeys(engine.highlighter.selection.select));
      dispose = () => {
        ev.onHighlight.remove(onHighlight);
        ev.onClear.remove(onClear);
      };
    });
    return () => { cancelled = true; dispose?.(); };
  }, [engine]);

  // A selection made in the 3D view scrolls the table to its first row.
  useEffect(() => {
    if (!open || selected.size === 0) return;
    const signature = [...selected].sort().join('|');
    if (signature === lastFromTable.current) return;
    const first = items.findIndex((it) => it.kind === 'row' && selected.has(it.row.key));
    if (first < 0 || !scrollRef.current) return;
    const top = first * ROW_H;
    const el = scrollRef.current;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H * 3) el.scrollTop = Math.max(0, top - ROW_H * 2);
  }, [selected, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySelection = useCallback(async (keys: Set<string>) => {
    lastFromTable.current = [...keys].sort().join('|');
    setSelected(keys);
    if (keys.size === 0) { await engine.highlighter.clear('select'); return; }
    const { ext: x, triggers: t, links: lk } = extRef.current;
    if (x) {
      // An external table: the rows picked select the objects the match groups couple them to (when the trigger is on).
      if (!t.toModel) return;
      const picked = [...keys].map((k) => Number(k.slice(4))).filter((i) => Number.isFinite(i));
      const ids = objectsForRows(lk, picked);
      if (!Object.keys(ids).length) return;
      extEcho.current = sigOf(ids);
      if (t.isolate) await engine.isolateElements(ids, t.reframe);
      else await engine.selectElements(ids, t.reframe);
      return;
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const picked: Row[] = [];
    for (const k of keys) { const r = byKey.get(k); if (r) picked.push(r); }
    await engine.highlighter.highlightByID('select', toIdMap(picked), true, false);
  }, [engine, rows]);

  const clickRow = (e: React.MouseEvent, itemIndex: number, row: Row) => {
    const pos = rowItemIndexes.indexOf(itemIndex);
    if (e.shiftKey && anchorRef.current !== null) {
      const a = Math.min(anchorRef.current, pos);
      const b = Math.max(anchorRef.current, pos);
      const next = new Set(e.ctrlKey || e.metaKey ? selected : []);
      for (let i = a; i <= b; i++) next.add((items[rowItemIndexes[i]] as { row: Row }).row.key);
      void applySelection(next);
      return;
    }
    anchorRef.current = pos;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      void applySelection(next);
    } else {
      void applySelection(new Set([row.key]));
    }
  };

  // ---- actions -----------------------------------------------------------
  const selectShown = () => { void applySelection(new Set(shown.map((r) => r.key))); };
  /** The table as it is shown (search, filters and sorting applied; groups flattened): one CSV row per object, the shown columns. */
  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `data-table-${date}.csv`,
      columns.map((c) => lab(c)),
      shown.map((r) => columns.map((c) => cell(r, c))),
    );
  };

  // ---- layout ------------------------------------------------------------
  const colW = (c: string) => widths[c] ?? BUILTIN.find((b) => b.id === c)?.width ?? DEFAULT_W;
  const totalW = columns.reduce((n, c) => n + colW(c), 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [open]);

  const startResizeCol = (col: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colW(col);
    const move = (m: MouseEvent) => setWidth(col, Math.max(MIN_W, startW + m.clientX - startX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const activeFilters = conditions.filter((c) => conditionTest(c)).length;
  const summary = [
    activeFilters && `${activeFilters} filter${activeFilters === 1 ? '' : 's'}`,
    groupRules.length && `grouped ×${groupRules.length}`,
    sortRules.length > 1 && `sorted ×${sortRules.length}`,
    colorRules.length && `${colorRules.length} colour rule${colorRules.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  // ---- render ------------------------------------------------------------
  // Off (the Data table tab's switch, or ▼ here): nothing under the 3D view.

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = items.slice(first, last);
  const selectedShown = shown.reduce((n, r) => n + (selected.has(r.key) ? 1 : 0), 0);

  // The count of rows goes to the status bar.
  const noun = ext ? 'rows' : 'elements';
  const countText = (shown.length === scoped.length ? `${scoped.length.toLocaleString()} ${noun}` : `${shown.length.toLocaleString()} of ${scoped.length.toLocaleString()} ${noun}`) + (selectedShown > 0 ? ` · ${selectedShown.toLocaleString()} selected` : '');
  useEffect(() => {
    useTableCountStore.getState().set(countText);
    return () => useTableCountStore.getState().set(null);
  }, [countText]);

  if (!open) return null;

  return (
    <div
      className="mdt mdt--docked"
      {...configFocusProps('datatable')}
      onDragOver={FEATURES.dataSources ? (e) => { if (dragHasFiles(e)) e.preventDefault(); } : undefined}
      onDrop={FEATURES.dataSources ? (e) => { if (dragHasFiles(e)) { e.preventDefault(); void addDroppedFiles(e.dataTransfer.items); } } : undefined}
    >
      <DataTableListConfig />
      <DockToolbar id="datatable">
      <div className="mdt__bar">
        <select
          className="mdt__scope"
          value={scope}
          disabled={!!pinnedKeys}
          onChange={(e) => { if (e.target.value === ADD_DATA) void chooseDataFiles(); else setScope(e.target.value as DataTableScope); }}
          title="What the table lists: the model's objects, or the rows of external data (CSV, Excel, SQLite)"
          aria-label="What the table lists"
        >
          <option value="all">All objects</option>
          <option value="visible">Visible objects</option>
          <option value="selected">Selected objects</option>
          {FEATURES.dataSources && (
            <optgroup label="External data">
              {sources.map((src) => {
                const names = Object.keys(sourceTables[src.id] ?? {});
                if (!names.length) return <option key={src.id} value={scopeOf(src.id, tableOf(src, undefined)?.name ?? '')} disabled>{src.name} (not read)</option>;
                return names.map((n) => <option key={`${src.id}|${n}`} value={scopeOf(src.id, n)}>{names.length > 1 ? `${src.name} › ${n}` : src.name}</option>);
              })}
              <option value={ADD_DATA}>＋ Add data file…</option>
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className={`vtb-btn${pinnedKeys ? ' is-on' : ''}`}
          aria-pressed={!!pinnedKeys}
          aria-label="Pin"
          disabled={!pinnedKeys && shown.length === 0}
          onClick={() => setPinned(pinnedKeys ? null : new Set(shown.map((r) => r.key)))}
          title={pinnedKeys ? `Unpin: the table lists the ${pinnedKeys.size.toLocaleString()} pinned rows whatever the 3D view shows or selects` : 'Pin: keep the rows shown now (after search and filters) in the table, whatever the 3D view shows or selects'}
        >
          <IconPin width={18} height={18} />
        </button>
        {presets.length > 0 && (
          <select className="mdt__scope" value="" onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }} title="Switch the table to a saved list (columns, filters, grouping, sorting, colours); Save as… in Configure keeps the current one" aria-label="Saved lists">
            <option value="">List…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {groupRules.length > 0 && (
          <span className="mdt__group-actions">
            <ExpandCollapseToggle
              className="btn btn--small"
              collapsed={items.some((x) => x.kind === 'group') && items.every((x) => x.kind !== 'row')}
              onCollapse={() => useDataTableStore.getState().setGroupsCollapsed(true)}
              onExpand={() => { setCollapsed(new Set()); useTableSearchStore.getState().setListLevel('datatable', ''); }}
            />
          </span>
        )}
        <button type="button" className="mdt__fold" onClick={() => useDockStore.getState().setFolded('bottom', true)} title="Fold these panels away" aria-label="Fold away"><IconChevronLeft style={{ transform: 'rotate(-90deg)' }} /></button>
        <div className="mdt__actions">
          <span className="panels-btn mdt__more">
            <OverflowMenu
              items={[
                { label: 'Select all rows', icon: <IconCheckboxChecked width={16} height={16} />, disabled: shown.length === 0, onClick: selectShown, title: 'Select every row currently shown' },
                { label: 'Export CSV', icon: <IconDownloadFile width={16} height={16} />, disabled: shown.length === 0 || columns.length === 0, onClick: exportCsv, title: 'Export the ' + shown.length.toLocaleString() + ' rows shown, with the shown columns, to a CSV file (search and filters applied)' },
                { label: 'Totals', icon: <IconTotals width={16} height={16} />, checked: totals, onClick: () => patch({ totals: !totals }), title: 'A totals row under the table and a subtotal on each group row; click a total to pick sum, average, min, max, count or none for that column' },
                { label: '-1', separator: true, onClick: () => {} },
                { label: 'Saved lists and twin models…', icon: <IconTune width={16} height={16} />, onClick: () => { useSettingsPaneStore.getState().setTarget('datatable'); configure(); }, title: summary ? 'Now: ' + summary : 'Set up the table' },
              ]}
            />
          </span>
        </div>
      </div>
      </DockToolbar>

      <div className="mdt__scroll" ref={scrollRef} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
        <div style={{ width: Math.max(totalW, 1), minWidth: '100%' }}>
          <div className="mdt__head">
            <div className="mdt__row mdt__row--head">
              {columns.map((c) => (
                <div key={c} className="mdt__th" style={{ width: colW(c) }} onClick={() => sortByHeader(c)} title={`${c} — click to sort`}>
                  <span className="mdt__th-label">
                    {lab(c)}
                    {sortOf(c) >= 0 && `${sortRules[sortOf(c)].direction === 'up' ? ' ▲' : ' ▼'}${sortRules.length > 1 ? sortOf(c) + 1 : ''}`}
                  </span>
                  <span className="mdt__resize" onMouseDown={startResizeCol(c)} onClick={(e) => e.stopPropagation()} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: items.length * ROW_H, position: 'relative' }}>
            {visible.map((it, i) => {
              const index = first + i;
              const style = { position: 'absolute' as const, top: index * ROW_H, height: ROW_H, left: 0, right: 0 };
              if (it.kind === 'group') {
                const inGroup = it.rows.reduce((n, r) => n + (selected.has(r.key) ? 1 : 0), 0);
                const allIn = inGroup === it.rows.length;
                const toggle = () => setCollapsed((s) => { const n = new Set(s); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; });
                const head = (
                  <>
                    <span className="mdt__chev">{it.collapsed ? <IconChevronRight width={14} height={14} /> : <IconExpandMore width={14} height={14} />}</span>
                    <span className="mdt__group-field">{lab(groupRules[it.level]?.field ?? '')}</span>
                    <b className="mdt__group-label" title={it.label}>{it.label}</b>
                    <span className="mdt__group-count">{it.rows.length.toLocaleString()}</span>
                    {inGroup > 0 && !allIn && <span className="mdt__group-sel">{inGroup.toLocaleString()} selected</span>}
                  </>
                );
                // Pinned to the visible right edge, however the table is scrolled.
                const select = (
                  <span className="mdt__group-select">
                    <button
                      type="button"
                      className={`mdt__mini${allIn ? ' is-on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Added to (or taken from) the selection, so several groups can be picked one after the other.
                        const next = new Set(selected);
                        for (const r of it.rows) { if (allIn) next.delete(r.key); else next.add(r.key); }
                        void applySelection(next);
                      }}
                      title={allIn ? 'Deselect this group (the rest of the selection stays)' : `Select the ${it.rows.length.toLocaleString()} objects in this group (added to the selection)`}
                    >
                      {allIn ? 'Deselect' : 'Select'}
                    </button>
                  </span>
                );
                const cls = `mdt__row mdt__group-row mdt__group-row--l${Math.min(it.level, 3)}`;
                if (!summarised) {
                  return (
                    <div key={`g:${it.key}`} className={cls} style={style} onClick={toggle}>
                      <span className="mdt__group-head" style={{ paddingLeft: 8 + it.level * 16 }}>{head}</span>
                      {select}
                    </div>
                  );
                }
                // Subtotals under their columns. The group's name spreads over the
                // first column and every one after it with no subtotal, so it
                // isn't cut off by the next column.
                const subtotals = columns.map((c) => aggregate(it.rows, c, aggOf(c)));
                let span = 1;
                while (span < columns.length && !subtotals[span]) span++;
                const headW = columns.slice(0, span).reduce((w, c) => w + colW(c), 0);
                return (
                  <div key={`g:${it.key}`} className={`${cls} mdt__group-row--cells`} style={style} onClick={toggle} title={`${it.label}: ${it.rows.length} objects`}>
                    <div className="mdt__td mdt__group-head" style={{ width: headW, paddingLeft: 8 + it.level * 16 }}>{head}</div>
                    {columns.slice(span).map((c, i) => (
                      <div key={c} className={`mdt__td mdt__subtotal${numeric.has(c) ? ' is-num' : ''}`} style={{ width: colW(c) }}>{subtotals[span + i]}</div>
                    ))}
                    {select}
                  </div>
                );
              }
              const isSel = selected.has(it.row.key);
              const row = it.row;
              const tint = colorRules.length ? matchColorRules(colorRules, (f) => cell(row, f)) : null;
              return (
                <div key={it.row.key} className={`mdt__row mdt__data-row${isSel ? ' selected' : ''}`} style={tint && !isSel ? { ...style, background: tint } : style} onClick={(e) => clickRow(e, index, it.row)}>
                  {columns.map((c, ci) => {
                    const raw = cell(it.row, c);
                    const v = withUnit(c, raw);
                    // Under groups, the first cell is indented to sit inside its group.
                    const indent = ci === 0 && it.depth ? { paddingLeft: 8 + it.depth * 16 + 14 } : null;
                    return <div key={c} className={`mdt__td${numeric.has(c) ? ' is-num' : ''}`} style={{ width: colW(c), ...indent }} title={v}>{v}</div>;
                  })}
                </div>
              );
            })}
          </div>
          {items.length === 0 && (
            <div className="mdt__empty">{rows.length === 0 ? (ext ? 'This table has no rows.' : 'Load a model from the Inputs tab to see its elements here.') : ext ? 'No rows match the search or filters.' : 'No elements match the search or filters.'}</div>
          )}
          {totals && shown.length > 0 && (
            <div className="mdt__row mdt__totals" title="Totals of the rows shown (search and filters applied). Click a total to change how that column is summed up.">
              {columns.map((c, ci) => {
                const kind = aggOf(c);
                const value = aggregate(shown, c, kind);
                return (
                  <div key={c} className={`mdt__td${numeric.has(c) ? ' is-num' : ''}`} style={{ width: colW(c) }}>
                    <span className="agg-cell">
                      {ci === 0 && <span className="mdt__totals-label">Total ({shown.length.toLocaleString()})</span>}
                      <button
                        type="button"
                        className={`agg-cell__btn${kind === 'none' ? ' is-none' : ''}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setAggMenu({ col: c, x: r.left, y: r.top });
                        }}
                        title={kind === 'none' ? `Sum up ${lab(c)}…` : `${AGG_LABELS[kind]} of ${lab(c)}: ${value} (click to change)`}
                        aria-label={`Sum up ${lab(c)}`}
                      >
                        {kind === 'none' ? <span className="agg-cell__add">＋</span> : <><span className="agg-cell__kind">{AGG_SHORT[kind]}</span><span className="agg-cell__value">{value}</span></>}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {aggMenu && (
        <div className="mdt__aggmenu" style={{ left: aggMenu.x, bottom: window.innerHeight - aggMenu.y + 4 }} role="menu">
          {(numeric.has(aggMenu.col) ? NUMBER_AGGS : TEXT_AGGS).map((o) => (
            <button
              key={o}
              type="button"
              role="menuitemradio"
              aria-checked={aggOf(aggMenu.col) === o}
              className={aggOf(aggMenu.col) === o ? 'is-on' : ''}
              onClick={() => { patch({ aggs: { ...aggs, [aggMenu.col]: o } }); setAggMenu(null); }}
            >
              <span className="mdt__aggmenu-tick">{aggOf(aggMenu.col) === o ? '✓' : ''}</span>{AGG_LABELS[o]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
