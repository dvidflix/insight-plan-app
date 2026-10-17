import { useEffect, useMemo, useState } from 'react';
import { BUILT_IN_GROUPS, NO_VALUE, passesFilters, useInputDetailsStore, valuesOfFile } from '../state/inputDetailsStore';
import { FEATURES } from '../features';
import { experimentalOn } from '../state/appPrefsStore';
import { pushFiles, type PushFile } from '../seatable/filesClient';
import { queryMatcher } from '../schedule/search';
import { IconRemove, IconChevronDown, IconChevronRight, IconExpander } from './icons';
import { SearchRow } from './SearchRow';
import { useHomeSelection } from '../state/homeSelection';
import { useModelsStore } from '../state/modelsStore';
import { useScheduleStore } from '../state/scheduleStore';
import { useContextMeshStore } from '../state/contextMeshStore';

/** Inputs page: group, filter and sort the list by a detail of the file (filled in on
    SeaTable's "Insight Plan Files" table). The setup is in the side pane's tabs;
    the page shows only a summary line (InputsSummaryBar). */

/** What typed-in details of the earlier, local version of this feature were (field -> values), to seed new SeaTable rows. */
function legacyDetails(): Record<string, Record<string, string[]>> {
  try {
    const raw = JSON.parse(localStorage.getItem('models.inputDetails') ?? 'null')?.state?.values as Record<string, Record<string, string>> | undefined;
    if (!raw) return {};
    return Object.fromEntries(Object.entries(raw).map(([item, v]) => [item, Object.fromEntries(Object.entries(v).map(([k, val]) => [k, [val]]))]));
  } catch {
    return {};
  }
}

const labelOf = (v: string) => (v === NO_VALUE ? '(none)' : v);

/** The Inputs page's status bar: how many files pass the filters, how many are open (loaded and not hidden) and what they are grouped by. */
export function InputsStatusBar() {
  const groupRules = useInputDetailsStore((s) => s.groupRules);
  const filters = useInputDetailsStore((s) => s.filters);
  const files = useInputDetailsStore((s) => s.files);
  const details = useInputDetailsStore((s) => s.values);
  const clearFilters = useInputDetailsStore((s) => s.clearFilters);
  const active = Object.keys(filters).length;
  const total = files.length;
  const shown = useMemo(() => files.filter((f) => passesFilters(f, filters, details)).length, [files, filters, details]);
  const models = useModelsStore((s) => s.models);
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const schedules = useScheduleStore((s) => s.schedules);
  const hiddenScheduleIds = useScheduleStore((s) => s.hiddenScheduleIds);
  const meshes = useContextMeshStore((s) => s.meshes);
  const open = models.filter((m) => !hiddenModelIds.has(m.modelId)).length + schedules.filter((x) => !hiddenScheduleIds.has(x.id)).length + meshes.filter((m) => !m.hidden).length;

  // Read the details when the page opens (quietly: the last read is kept when SeaTable is off).
  useEffect(() => {
    if (FEATURES.seatable && experimentalOn('seatableFiles')) void useInputDetailsStore.getState().read();
  }, []);

  const labelFor = (id: string) => BUILT_IN_GROUPS.find((g) => g.id === id)?.label ?? id;
  const groupLabel = groupRules.length ? groupRules.map((r) => labelFor(r.field)).join('  |  ') : 'nothing';
  return (
    <footer className="app-statusbar">
      <span>
        <strong>{shown}</strong>{shown !== total ? ` of ${total}` : ''} file{total === 1 ? '' : 's'} · <strong>{open}</strong> open · grouped by <strong>{groupLabel}</strong>
        {active > 0 && <> · {active} filter{active === 1 ? '' : 's'} on</>}
      </span>
      {active > 0 && <button type="button" className="cols__link" onClick={clearFilters}>Clear filters</button>}
    </footer>
  );
}

/** Inputs side pane › Filters: keep only the files with chosen values of any field (all values listed, with
    counts), with quick presets for each type and file format. */
export function InputsFilters() {
  const fields = useInputDetailsStore((s) => s.fields);
  const ownFilters = useInputDetailsStore((s) => s.filters);
  // A scene chosen on Home (not the one you are in) shows the filters it was saved with.
  const filters = useHomeSelection((s) => s.filters) ?? ownFilters;
  const files = useInputDetailsStore((s) => s.files);
  const details = useInputDetailsStore((s) => s.values);
  const { setFilter, clearFilters } = useInputDetailsStore.getState();
  const [open, setOpen] = useState<Set<string>>(new Set(['type']));
  const [search, setSearch] = useState('');

  const keys = useMemo(() => [...BUILT_IN_GROUPS.filter((g) => g.id !== 'none'), ...fields.map((f) => ({ id: f, label: f }))], [fields]);
  const matched = useMemo(() => files.filter((f) => passesFilters(f, filters, details)).length, [files, filters, details]);
  const activeKeys = keys.filter((k) => (filters[k.id]?.length ?? 0) > 0);
  const hit = queryMatcher(search);

  // Every value of a key (even those no file has after the other filters) with how many files each would leave.
  const valuesOf = (key: string) => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const all = valuesOfFile(key, f, details).filter(Boolean);
      const own = all.length ? all : [NO_VALUE];
      const pass = passesFilters(f, filters, details, key);
      for (const v of own) counts.set(v, (counts.get(v) ?? 0) + (pass ? 1 : 0));
    }
    for (const v of filters[key] ?? []) if (!counts.has(v)) counts.set(v, 0);
    return [...counts].sort(([a], [b]) => (a === NO_VALUE ? 1 : b === NO_VALUE ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  };

  // One-click filters: each type and file format on the page.
  const presets = useMemo(() => [
    ...[...new Set(files.map((f) => f.type))].sort().map((v) => ({ key: 'type', value: v, label: v })),
    ...[...new Set(files.map((f) => f.format).filter(Boolean))].sort().map((v) => ({ key: 'format', value: v, label: v })),
  ], [files]);
  const presetOn = (p: { key: string; value: string }) => filters[p.key]?.length === 1 && filters[p.key][0] === p.value;

  return (
    <div className="flt flt--inputs">
      <div className="flt__result">
        <div className="flt__result-text">
          <b>{matched.toLocaleString()}</b> of {files.length.toLocaleString()} files
          {files.length > 0 && matched === 0 && <span className="flt__none"> — no matches</span>}
        </div>
        <button type="button" className="cols__link" disabled={activeKeys.length === 0} onClick={clearFilters}>Clear all</button>
        <div className="flt__bar"><span style={{ width: `${files.length ? (matched / files.length) * 100 : 100}%` }} /></div>
      </div>

      {presets.length > 0 && (
        <div className="cols__presets">
          <span className="cols__hint">Quick</span>
          {presets.map((p) => (
            <button key={`${p.key}:${p.value}`} type="button" className={presetOn(p) ? 'on' : ''} aria-pressed={presetOn(p)} onClick={() => setFilter(p.key, presetOn(p) ? [] : [p.value])}>{p.label}</button>
          ))}
        </div>
      )}

      {activeKeys.length > 0 && (
        <>
          <div className="cols__heading"><span>Active <b>{activeKeys.length}</b></span></div>
          <div className="flt__active">
            {activeKeys.map((k) => (
              <span className="flt__chip" key={k.id}>
                <span className="flt__chip-label">{k.label}:</span> {filters[k.id].map(labelOf).join(', ')}
                <button type="button" onClick={() => setFilter(k.id, [])} aria-label={`Clear ${k.label} filter`} title="Remove filter"><IconRemove /></button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="cols__heading"><span>Fields <b>{keys.length}</b></span></div>
      <SearchRow collapsed={open.size === 0} onCollapse={() => setOpen(new Set())} onExpand={() => setOpen(new Set(keys.filter((k) => hit(k.label)).map((k) => k.id)))}>
        <input className="cols__search" type="search" placeholder="Search fields…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </SearchRow>
      {keys.filter((k) => hit(k.label)).map((k) => {
        const kept = filters[k.id] ?? [];
        const isOpen = open.has(k.id) || !!search.trim();
        const list = isOpen ? valuesOf(k.id) : [];
        const toggle = (v: string) => setFilter(k.id, kept.includes(v) ? kept.filter((x) => x !== v) : [...kept, v]);
        return (
          <div key={k.id} className={`flt__field${kept.length ? ' active' : ''}`}>
            <div className="flt__field-head">
              <button type="button" className="flt__field-toggle" aria-expanded={isOpen} onClick={() => setOpen((prev) => { const n = new Set(prev); if (!n.delete(k.id)) n.add(k.id); return n; })}>
                <span className="flt__caret"><IconExpander open={isOpen} /></span>
                <span className="flt__field-label">{k.label}</span>
                {kept.length > 0 && <span className="flt__field-sum">{kept.length <= 2 ? kept.map(labelOf).join(', ') : `${kept.length} values`}</span>}
              </button>
              {isOpen && (
                <span className="flt__bulk flt__bulk--inline">
                  <button type="button" className="cols__link" onClick={() => setFilter(k.id, list.map(([v]) => v))}>Select all</button>
                  <button type="button" className="cols__link" onClick={() => setFilter(k.id, [])}>None</button>
                </span>
              )}
              {kept.length > 0 && <button type="button" className="cols__icon cols__icon--remove" onClick={() => setFilter(k.id, [])} aria-label={`Clear ${k.label}`} title="Clear"><IconRemove /></button>}
            </div>
            {isOpen && (
              <div className="flt__field-body">
                <div className="flt__values">
                  {list.map(([v, n]) => (
                    <label key={v} className={`cols__check${n === 0 && !kept.includes(v) ? ' flt__zero' : ''}`}>
                      <input type="checkbox" checked={kept.includes(v)} onChange={() => toggle(v)} />
                      <span title={labelOf(v)}>{labelOf(v)}</span>
                      <span className="flt__n">{n}</span>
                    </label>
                  ))}
                  {list.length === 0 && <div className="flt__hint">No files.</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {fields.length === 0 && <div className="flt__hint">No details yet. In Settings, push the files to SeaTable, fill in the table there, then Read.</div>}
    </div>
  );
}

/** Sends the files to SeaTable's "Insight Plan Files" table and reads the details back; the outcome goes to the store's pushNote. */
export async function pushToSeaTable(files: PushFile[], auto = false): Promise<{ ok: boolean; text: string }> {
  let note: { ok: boolean; text: string };
  try {
    const old = legacyDetails();
    const r = await pushFiles(files.map((f) => ({ ...f, details: old[f.name] })));
    const back = await useInputDetailsStore.getState().read();
    note = { ok: back.ok, text: `${auto ? 'Sent automatically' : 'Sent'} ${files.length} file${files.length === 1 ? '' : 's'}: ${r.added} added, ${r.updated} updated. ${back.ok ? 'Fill in the details in SeaTable, then Read.' : back.message}` };
  } catch (e) {
    note = { ok: false, text: `${auto ? 'Automatic push failed: ' : ''}${e instanceof Error ? e.message : String(e)}` };
  }
  useInputDetailsStore.getState().setPushNote(note);
  return note;
}

/** Settings (Inputs): the details of each file live in SeaTable's "Insight Plan Files" table. Push the files there, read the details back. */
export function FileDetailsSync() {
  const files = useInputDetailsStore((s) => s.files);
  const readAt = useInputDetailsStore((s) => s.readAt);
  const [busy, setBusy] = useState(false);
  const message = useInputDetailsStore((s) => s.pushNote);
  const setMessage = useInputDetailsStore((s) => s.setPushNote);
  const autoPush = useInputDetailsStore((s) => s.autoPush);
  const setAutoPush = useInputDetailsStore((s) => s.setAutoPush);

  const doRead = async () => {
    setBusy(true);
    const r = await useInputDetailsStore.getState().read();
    setMessage({ ok: r.ok, text: r.message });
    setBusy(false);
  };
  const doPush = async () => {
    setBusy(true);
    await pushToSeaTable(files);
    setBusy(false);
  };

  return (
    <div className="file-details">
      <div className="inputs-details-pop__actions">
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => void doPush()}>Push {files.length} files</button>
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => void doRead()}>Read details</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0', fontSize: 12 }} title="When a file is uploaded on the Inputs page, the files are pushed to SeaTable right away">
          <input type="checkbox" checked={autoPush} onChange={(e) => setAutoPush(e.target.checked)} />
          Push automatically when a file is uploaded
        </label>
        {message && <div className={`inputs-details-pop__msg${message.ok ? '' : ' is-bad'}`}>{message.text}</div>}
        {!message && readAt && <div className="inputs-details-pop__msg">Last read {new Date(readAt).toLocaleString()}.</div>}
    </div>
  );
}

/** A group's header row in the list: collapse / expand, its name and how many files. */
export function GroupHeaderRow({ collapseKey: key, group, level, count, colSpan, allSelected, onSelect }: { collapseKey: string; group: string; level: number; count: number; colSpan: number; allSelected?: boolean; onSelect?: () => void }) {
  const collapsed = useInputDetailsStore((s) => s.collapsed.includes(key));
  const toggle = useInputDetailsStore((s) => s.toggleCollapsed);
  return (
    <tr className="inputs-folder">
      <td colSpan={colSpan}>
        <div className="inputs-folder__bar" style={level ? { paddingLeft: level * 18 } : undefined}>
          <button type="button" className="inputs-folder__toggle" onClick={() => toggle(key)} aria-expanded={!collapsed}>
            {collapsed ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
            <b>{group === NO_VALUE ? '(none)' : group}</b>
            <span className="inputs-folder__count">{count}</span>
          </button>
          {onSelect && (
            <span className="inputs-folder__actions">
              <button type="button" className={`mdt__mini${allSelected ? ' is-on' : ''}`} onClick={onSelect} title={allSelected ? 'Deselect the files of this group (the rest of the selection stays)' : `Select the ${count} file${count === 1 ? '' : 's'} of this group (added to the selection)`}>
                {allSelected ? 'Deselect' : 'Select'}
              </button>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/** One file's values for one detail field, read only (a file in several buildings shows each). */
export function DetailValue({ item, field }: { item: string; field: string }) {
  const values = useInputDetailsStore((s) => s.values[item]?.[field]);
  if (!values?.length) return <span className="inputs-detail__none">—</span>;
  return (
    <span className="inputs-detail__chips">
      {values.map((v) => <span key={v} className="inputs-detail__chip">{v}</span>)}
    </span>
  );
}

const COLUMN_WIDTH: Record<string, number> = { type: 44, items: 70, bounds: 160, size: 90, uploaded: 130, version: 70 };
const DETAIL_WIDTH = 100;
const ACTION_WIDTH = 120;
/** The leading column: open and hide / show. */
const SHOW_WIDTH = 64;
const NAME_MIN = 220;
export const MIN_COLUMN_WIDTH = 44;

const widthOf = (col: string, widths: Record<string, number>) => widths[col] ?? COLUMN_WIDTH[col] ?? DETAIL_WIDTH;

/** The table is as wide as its box. Every column but Name has its own width, so dragging one changes only that column;
    Name takes what is left (it gives way, or grows, as the others change). When the fixed columns leave Name less than
    NAME_MIN the table scrolls sideways instead. */
export function useInputsTableStyle(columns: string[]): React.CSSProperties {
  const widths = useInputDetailsStore((s) => s.widths);
  return { width: '100%', minWidth: columns.reduce((sum, c) => sum + (c === 'name' ? NAME_MIN : widthOf(c, widths)), ACTION_WIDTH + SHOW_WIDTH) };
}

/** Column widths of the Inputs page's list; drag a heading's right edge to change one (Name is the flexible one). */
export function InputsColgroup({ columns }: { columns: string[] }) {
  const widths = useInputDetailsStore((s) => s.widths);
  return (
    <colgroup>
      <col style={{ width: SHOW_WIDTH }} />
      {columns.map((c) => <col key={c} style={c === 'name' ? undefined : { width: widthOf(c, widths) }} />)}
      <col style={{ width: ACTION_WIDTH }} />
    </colgroup>
  );
}

/** The drag handle at the right edge of a column heading (double-click: back to the default width). */
export function ColumnResizer({ col }: { col: string }) {
  const start = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement as HTMLElement;
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => useInputDetailsStore.getState().setWidth(col, Math.max(MIN_COLUMN_WIDTH, w0 + ev.clientX - x0));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const reset = (e: React.MouseEvent) => {
    e.stopPropagation();
    const { widths } = useInputDetailsStore.getState();
    const next = { ...widths };
    delete next[col];
    useInputDetailsStore.setState({ widths: next });
  };
  return <span className="inputs-table__resize" onMouseDown={start} onDoubleClick={reset} onClick={(e) => e.stopPropagation()} title="Drag to resize (double-click: default)" />;
}
