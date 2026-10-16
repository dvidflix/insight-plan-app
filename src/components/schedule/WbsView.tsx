import { useEffect, useMemo, useRef, useState } from 'react';
import { LevelStepper } from './LevelStepper';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { buildLoading } from '../../schedule/resourceLoading';
import { applyVirtualResources, virtualCatalog } from '../../schedule/virtualResources';
import { usePersistedState } from '../../utils/persistedState';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { IconArrowDown, IconArrowUp, IconDownload } from '../icons';
import { ToolbarLeftSlot, ToolbarSlot } from './ToolbarSlot';
import { OverflowMenu, ToolPopover } from '../TablePopovers';
import { ColumnsPanel } from './ColumnsPanel';
import { IconColumns } from '../icons';
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
  // WBS branches unloaded from the programme (see unloadedWbsStore): still listed here, greyed, so they can be loaded again.
  const key = programmeKey(model);
  const unloaded = useUnloadedWbsStore((s) => s.byProgramme[key]) ?? NONE;
  const toggleUnloaded = useUnloadedWbsStore((s) => s.toggle);
  const setManyUnloaded = useUnloadedWbsStore((s) => s.setMany);
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

  // A remembered level is applied when the tree is first built (not again when unloading a WBS changes the activity count).
  const levelApplied = useRef(false);
  useEffect(() => {
    if (levelApplied.current || activities.length === 0) return;
    levelApplied.current = true;
    if (level !== '') ref.current?.setLevel(Number(level));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities.length]);

  return (
    <div className="wbs-view">
      <ToolbarLeftSlot>
        <LevelStepper
          value={level}
          onChange={(v) => {
            setLevel(v);
            ref.current?.setLevel(v === '' ? null : Number(v));
          }}
        />
      </ToolbarLeftSlot>
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
        <span className="tp-row">
          <ToolPopover icon={<IconColumns width={16} height={16} />} label="Columns" width={380}>
            <ColumnsPanel
              catalog={optional.map((c) => ({ id: c.id, label: c.label, group: 'WBS columns' }))}
              views={[{ id: 'wbs', label: 'WBS', selected: optional.filter((c) => !hidden.includes(c.id)).map((c) => c.id), defaults: optional.map((c) => c.id), onChange: (ids) => setHidden(optional.filter((c) => !ids.includes(c.id)).map((c) => c.id)) }]}
              presets={[
                { id: 'all', label: 'All', ids: optional.map((c) => c.id) },
                { id: 'wbs', label: 'WBS only', ids: [] },
              ]}
              groupOrder={['WBS columns']}
              closedGroups={[]}
            />
          </ToolPopover>
        </span>
        {unloaded.length > 0 && (
          <button type="button" className="btn btn--small" onClick={() => clearUnloaded(key)} title={`${unloaded.length} WBS unloaded from this programme (their activities are out of every view). Click to load them all again.`}>
            {unloaded.length} unloaded · Load all
          </button>
        )}
        <span style={{ flex: 1 }} />
        <OverflowMenu items={[{ label: 'Export to Excel', icon: <IconDownload width={16} height={16} />, onClick: () => ref.current?.exportXlsx(), title: 'Export to Excel as shown: the WBS tree with its columns and order, grouped (outline levels), collapsed levels folded' }]} />
      </ToolbarSlot>
      <ResourceWbsTable
        ref={ref}
        activities={shown}
        unloaded={unloaded}
        onToggleUnloaded={(path) => toggleUnloaded(key, path)}
        onSetUnloaded={(paths, out) => setManyUnloaded(key, paths, out)}
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
