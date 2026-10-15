import { useMemo, useState } from 'react';
import { COLUMN_GROUPS, COLUMN_PRESETS, type ColumnDef } from '../../schedule/columns';
import { PresetBar, type PresetItem } from './PresetBar';
import { removeUserPreset, saveUserPreset, useUserPresetsStore } from '../../state/userPresetsStore';
import { IconRemove, IconSectionChevron, IconPencil } from '../icons';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { CalcColumnsEditor } from './CalcColumnsEditor';
import { queryMatcher } from '../../schedule/search';
import { useColumnLabelsStore } from '../../state/columnLabelsStore';

export interface ColumnView {
  id: string;
  label: string;
  /** Visible column ids, in display order. */
  selected: string[];
  defaults: string[];
  onChange: (ids: string[]) => void;
}

/** What the picker needs of a column (the schedule's ColumnDef, or the
    Models data table's properties). */
type PickColumn = Pick<ColumnDef, 'id' | 'label' | 'group'> & { baseLabel?: string };

interface ColumnsPanelProps {
  catalog: PickColumn[];
  views: ColumnView[];
  /** One-click column sets (default: the schedule's). */
  presets?: { id: string; label: string; ids: string[] }[];
  /** Groups listed first, in this order (default: the schedule's). */
  groupOrder?: readonly string[];
  /** Groups that start closed. */
  closedGroups?: string[];
  /** Offer "Calculated columns" (formulas over the activity columns). */
  calculated?: boolean;
  /** Saving the shown columns as a named preset (listed in `presets`). */
  onSavePreset?: (name: string, ids: string[]) => void;
  onDeletePreset?: (id: string) => void;
  /** The rows of the "Available" list, when they are not every catalog entry
      (the catalog still names every column that can be shown). */
  listed?: PickColumn[];
  /** Twin layout: each listed property gets two checkboxes, the main model's
      (left) and the twin model's (right, its column id from `twinOf`). */
  twin?: {
    titles: [string, string];
    /** Tooltips of the two titles (the models' names). */
    hints?: [string, string];
    twinOf: (id: string) => string | null;
    /** Whether the main model has the property. */
    hasOwn: (id: string) => boolean;
  };
}

/** Column picker for the Configuration pane: a reorderable "Shown" list on
    top, then every available column grouped the way P6 groups them. */
export function ColumnsPanel({ catalog, views, presets = COLUMN_PRESETS, groupOrder = COLUMN_GROUPS, closedGroups = ['Relationships', 'Resources & Cost', 'Constraints'], onSavePreset, onDeletePreset, listed, twin, calculated }: ColumnsPanelProps) {
  const savedPresets = useUserPresetsStore((st) => st.presets);
  const [viewId, setViewId] = useState(views[0]?.id);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set(closedGroups));
  const [dragId, setDragId] = useState<string | null>(null);
  // The programme's columns can be given short names of your own (and reset to their own).
  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = useColumnLabelsStore((s) => s.rename);
  const resetLabel = useColumnLabelsStore((s) => s.reset);

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const shown = useMemo(() => (view ? view.selected.filter((id) => byId.has(id)) : []), [view, byId]);
  const shownSet = useMemo(() => new Set(shown), [shown]);
  const q = search.trim().toLowerCase();
  const hit = queryMatcher(search);

  const groups = useMemo(() => {
    const map = new Map<string, PickColumn[]>();
    for (const c of listed ?? catalog) (map.get(c.group) ?? map.set(c.group, []).get(c.group)!).push(c);
    const order: string[] = [...groupOrder, ...[...map.keys()].filter((g) => !groupOrder.includes(g))];
    return order.filter((g) => map.has(g)).map((g) => ({ name: g, columns: map.get(g)! }));
  }, [catalog, listed, groupOrder]);

  if (!view) return null;
  const set = (ids: string[]) => view.onChange(ids);
  const columnKind = `columns:${view.id}`;
  const savedColumns = savedPresets.filter((p) => p.kind === columnKind);
  const columnPresets: PresetItem[] = [
    { id: 'default', label: 'Default' },
    ...presets.map((p) => ({ id: p.id, label: p.label, user: !!onSavePreset })),
    ...(onSavePreset ? [] : savedColumns.map((p) => ({ id: p.id, label: p.name, user: true }))),
  ];
  const toggle = (id: string) => set(shownSet.has(id) ? shown.filter((x) => x !== id) : [...shown, id]);
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = shown.filter((x) => x !== dragId);
    next.splice(next.indexOf(targetId) + (shown.indexOf(dragId) < shown.indexOf(targetId) ? 1 : 0), 0, dragId);
    set(next);
  };
  const toggleGroup = (name: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  /** The column ids a listed property stands for: its own and, in the twin layout, its twin's. */
  const idsOf = (c: PickColumn) => {
    if (!twin) return [c.id];
    const t = twin.twinOf(c.id);
    return [...(twin.hasOwn(c.id) ? [c.id] : []), ...(t ? [t] : [])];
  };
  const setGroup = (cols: PickColumn[], on: boolean) => {
    const all = cols.flatMap(idsOf);
    const ids = new Set(all);
    set(on ? [...shown, ...all.filter((id) => !shownSet.has(id))] : shown.filter((id) => !ids.has(id)));
  };

  return (
    <div className="cols">
      {views.length > 1 && (
        <div className="cols__views" role="tablist">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === view.id} className={v.id === view.id ? 'active' : ''} onClick={() => setViewId(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      )}

      <PresetBar
        noun="column preset"
        items={columnPresets}
        saveDisabled={shown.length === 0}
        onApply={(id) => {
          if (id === 'default') return set(view.defaults.filter((c) => byId.has(c)));
          const ids = presets.find((p) => p.id === id)?.ids ?? (savedColumns.find((p) => p.id === id)?.data as string[] | undefined);
          if (ids) set(ids.filter((c) => byId.has(c)));
        }}
        onSave={(name) => (onSavePreset ? onSavePreset(name, shown) : saveUserPreset(columnKind, name, shown))}
        onDelete={(id) => (onDeletePreset ? onDeletePreset(id) : removeUserPreset(id))}
      />

      <div className="cols__heading">
        <span>Shown <b>{shown.length}</b></span>
        {shown.length > 0 && <button type="button" className="cols__link" onClick={() => set([])}>Clear all</button>}
      </div>
      {shown.length === 0 && <div className="cols__shown"><div className="cols__empty">No columns shown — add some below.</div></div>}
      {shown.length > 0 && (
        <div className="rgrid" role="table" style={{ '--rg-cols': 'minmax(0, 1fr) 52px' } as React.CSSProperties}>
          {shown.map((id, i) => (
            <div
              key={id}
              role="row"
              className={`rgrid__row${dragId === id ? ' dragging' : ''}`}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); drop(id); setDragId(null); }}
              onDragEnd={() => setDragId(null)}
            >
              <span className="rgrid__n" title="Drag the row to reorder it">
                <span className="rgrid__num">{i + 1}</span>
                <button type="button" className="rgrid__del" onClick={() => toggle(id)} aria-label={`Hide ${byId.get(id)!.label}`} title="Hide column"><IconRemove /></button>
              </span>
              <div className="rgrid__body">
                {calculated && renaming === id ? (
                  <input
                    className="rgrid__cell"
                    autoFocus
                    defaultValue={byId.get(id)!.label}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => { rename(id, e.target.value, byId.get(id)!.baseLabel ?? byId.get(id)!.label); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                    aria-label="Column name"
                  />
                ) : (
                  <span className={`rgrid__cell${byId.get(id)!.baseLabel ? ' is-renamed' : ''}`} title={byId.get(id)!.baseLabel ? `${byId.get(id)!.label} (was “${byId.get(id)!.baseLabel}”)` : byId.get(id)!.label} onDoubleClick={() => calculated && setRenaming(id)}>{byId.get(id)!.label}</span>
                )}
                <span className="rgrid__cell rgrid__cell--act">
                  {calculated && byId.get(id)!.baseLabel && <button type="button" className="rgrid__ib" onClick={() => resetLabel(id)} aria-label={`Reset the name to “${byId.get(id)!.baseLabel}”`} title={`Reset the name to “${byId.get(id)!.baseLabel}”`}>↺</button>}
                  {calculated && renaming !== id && <button type="button" className="rgrid__ib" onClick={() => setRenaming(id)} aria-label={`Rename ${byId.get(id)!.label}`} title="Give the column a short name of your own (double-click the name too)"><IconPencil width={14} height={14} /></button>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {calculated && <CalcColumnsEditor catalog={catalog as unknown as ColumnDef[]} />}
      <div className="cols__heading"><span>Available columns <b>{(listed ?? catalog).length}</b></span></div>
      <div className="cols__searchrow">
        <input className="cols__search" type="search" placeholder="Search columns…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ExpandCollapseToggle
          className="btn btn--small"
          collapsed={groups.length > 0 && groups.every((g) => closed.has(g.name))}
          onCollapse={() => setClosed(new Set(groups.map((g) => g.name)))}
          onExpand={() => setClosed(new Set())}
        />
      </div>
      {groups.map((g) => {
        const matches = q ? g.columns.filter((c) => hit(c.label)) : g.columns;
        if (matches.length === 0) return null;
        const open = q ? true : !closed.has(g.name);
        const slots = g.columns.flatMap(idsOf);
        const on = slots.filter((id) => shownSet.has(id)).length;
        return (
          <div className={`cols__group${on > 0 ? ' is-active' : ''}`} key={g.name}>
            <div className="cols__group-head">
              <button type="button" className="cols__group-toggle" onClick={() => toggleGroup(g.name)} aria-expanded={open}>
                <IconSectionChevron className="section-chevron" />
                <span className="cols__group-name">{g.name}</span>
                <span className="cols__count">{on}/{slots.length}</span>
              </button>
              <button type="button" className="cols__link" onClick={() => setGroup(g.columns, true)}>All</button>
              <button type="button" className="cols__link" onClick={() => setGroup(g.columns, false)}>None</button>
            </div>
            {open && twin && (
              <div className="cols__group-body">
                <div className="cols__pair cols__pair--head">
                  <span title={twin.hints?.[0]}>{twin.titles[0]}</span>
                  <span title={twin.hints?.[1]}>{twin.titles[1]}</span>
                </div>
                {matches.map((c) => {
                  const other = twin.twinOf(c.id);
                  const own = twin.hasOwn(c.id);
                  return (
                    <div className="cols__pair" key={c.id}>
                      <label className={`cols__check${own ? '' : ' is-off'}`}>
                        <input type="checkbox" disabled={!own} checked={own && shownSet.has(c.id)} onChange={() => toggle(c.id)} />
                        <span title={c.label}>{c.label}</span>
                      </label>
                      <label className={`cols__pair-twin${other ? '' : ' is-off'}`} title={other ? `${c.label} of the twin model` : 'The twin model does not have this property'}>
                        <input type="checkbox" disabled={!other} checked={!!other && shownSet.has(other)} onChange={() => other && toggle(other)} />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
            {open && !twin && (
              <div className="cols__group-body">
                {matches.map((c) => (
                  <label className="cols__check" key={c.id}>
                    <input type="checkbox" checked={shownSet.has(c.id)} onChange={() => toggle(c.id)} />
                    <span title={c.label}>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
