import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { buildLoading } from '../../schedule/resourceLoading';
import { applyVirtualResources, virtualCatalog } from '../../schedule/virtualResources';
import { usePersistedState } from '../../utils/persistedState';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { IconArrowDown, IconArrowUp } from '../icons';
import { ToolbarSlot } from './ToolbarSlot';
import { useScheduleStore } from '../../state/scheduleStore';
import { inUnloadedWbs, programmeKey, useUnloadedWbsStore } from '../../state/unloadedWbsStore';
import { ResourceWbsTable, WBS_NAME_COL, wbsColumns, type WbsTableHandle, type WbsTableState } from './ResourceWbsTable';

const NONE: string[] = [];

interface WbsViewProps {
  model: ScheduleModel;
  /** The activities left by the page's filters. */
  activities: Activity[];
  wbsPalette: string;
}

/** Programmes > WBS: the WBS tree in the Table View's style and colours with
    each level's counts, dates and resource totals (the app-only resources
    included, as in Resources). Columns can be resized and chosen; the
    selected row moves among its siblings with the arrows. */
export function WbsView({ model, activities, wbsPalette }: WbsViewProps) {
  const ref = useRef<WbsTableHandle>(null);
  const [state, setState] = useState<WbsTableState>({ canUp: false, canDown: false, hasOrder: false });
  const [hidden, setHidden] = usePersistedState<string[]>('schedule.wbsColumnsHidden', []);
  const [widths, setWidths] = usePersistedState<Record<string, number>>('schedule.wbsColumnWidths', {});
  const [level, setLevel] = usePersistedState<string>('schedule.wbsLevel', '');
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLSpanElement>(null);
  // WBS branches unloaded from the programme (see unloadedWbsStore): still listed here, greyed, so they can be loaded again.
  const key = programmeKey(model);
  const unloaded = useUnloadedWbsStore((s) => s.byProgramme[key]) ?? NONE;
  const toggleUnloaded = useUnloadedWbsStore((s) => s.toggle);
  const clearUnloaded = useUnloadedWbsStore((s) => s.clear);
  const full = useScheduleStore((s) => s.schedules.find((m) => m.id === model.id));
  const shown = useMemo(
    () => (unloaded.length && full ? [...activities, ...full.activities.filter((a) => inUnloadedWbs(unloaded, a.wbsPath))] : activities),
    [activities, full, unloaded],
  );
  const withVirtual = useMemo(() => applyVirtualResources(shown), [shown]);
  const loading = useMemo(
    () => buildLoading(withVirtual, [...(model.resourceCatalog ?? []), ...virtualCatalog], model.calendars, 'current'),
    [withVirtual, model.resourceCatalog, model.calendars],
  );
  const resources = useMemo(() => [...loading.resources.filter((r) => r.type === 'labor'), ...loading.resources.filter((r) => r.type !== 'labor')], [loading.resources]);
  const optional = useMemo(() => wbsColumns(resources).filter((c) => c.id !== WBS_NAME_COL), [resources]);

  // A remembered level is applied when the tree is first built.
  useEffect(() => {
    if (level !== '') ref.current?.setLevel(Number(level));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities.length]);

  useEffect(() => {
    if (!pickerOpen) return;
    const away = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [pickerOpen]);

  return (
    <div className="wbs-view">
      <ToolbarSlot>
        <input
          className="filterbar__search"
          type="search"
          placeholder="Search WBS…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title="Show only the WBS levels whose name matches (with their parents and children). Separate several terms with commas."
        />
        <div className="rv-seg" role="group" aria-label="Move the selected WBS row">
          <button type="button" className="rv-iconbtn" onClick={() => ref.current?.move(-1)} disabled={!state.canUp} title="Move the selected row up" aria-label="Move up"><IconArrowUp /></button>
          <button type="button" className="rv-iconbtn" onClick={() => ref.current?.move(1)} disabled={!state.canDown} title="Move the selected row down" aria-label="Move down"><IconArrowDown /></button>
        </div>
        <ExpandCollapseToggle className="btn btn--small" onCollapse={() => { setLevel(''); ref.current?.collapseAll(); }} onExpand={() => { setLevel(''); ref.current?.expandAll(); }} />
        {state.hasOrder && <button type="button" className="btn btn--small" onClick={() => ref.current?.resetOrder()} title="Back to the programme's WBS order">Reset order</button>}
        <span className="rv-filter" ref={pickerRef}>
          <button type="button" className="btn btn--small" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)} title="Choose the columns shown">
            Columns{hidden.length ? ` (${optional.length - hidden.filter((h) => optional.some((c) => c.id === h)).length}/${optional.length})` : ''} ▾
          </button>
          {pickerOpen && (
            <div className="rv-filter__pop rv-filter__pop--left" role="dialog" aria-label="Columns">
              <div className="rv-filter__list">
                {optional.map((c) => (
                  <label key={c.id} className="rv-filter__item">
                    <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => setHidden(hidden.includes(c.id) ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])} />
                    <span className="rv-filter__label" title={c.label}>{c.label}</span>
                  </label>
                ))}
              </div>
              <div className="rv-result__actions">
                <button type="button" className="mini-btn" onClick={() => setHidden([])}>Show all</button>
                <button type="button" className="mini-btn" onClick={() => setHidden(optional.map((c) => c.id))}>WBS only</button>
                <button type="button" className="mini-btn" onClick={() => setWidths({})}>Reset widths</button>
              </div>
            </div>
          )}
        </span>
        <div className="groupby-panel">
          <span className="groupby-panel__title">Level:</span>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              ref.current?.setLevel(e.target.value === '' ? null : Number(e.target.value));
            }}
            title="Open the WBS down to this level (All: everything open)"
          >
            <option value="">All</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </div>
        {unloaded.length > 0 && (
          <button type="button" className="btn btn--small" onClick={() => clearUnloaded(key)} title={`${unloaded.length} WBS unloaded from this programme (their activities are out of every view). Click to load them all again.`}>
            {unloaded.length} unloaded · Load all
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn--small" onClick={() => ref.current?.exportCsv()}>Export CSV</button>
      </ToolbarSlot>
      <ResourceWbsTable
        ref={ref}
        activities={shown}
        unloaded={unloaded}
        onToggleUnloaded={(path) => toggleUnloaded(key, path)}
        spans={loading.spans}
        resources={resources}
        wbsPalette={wbsPalette}
        hidden={hidden}
        widths={widths}
        query={query}
        onWidth={(id, w) => setWidths((prev) => ({ ...prev, [id]: w }))}
        onState={setState}
      />
    </div>
  );
}
