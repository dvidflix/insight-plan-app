import { hoursPerDayOf } from '../../schedule/hoursPerDay';
import { useMemo, useState } from 'react';
import type { Activity, Relationship, ScheduleModel } from '../../schedule/types';
import { POSITION_LABEL, reachByContacts, relationDetail, sharedContactIndex, summariseRelation, viaRelation, type ViaRelation } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { drives } from '../../schedule/drivingPath';
import { fmtDate } from '../../schedule/reports';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useClashStore } from '../../state/clashStore';
import { IconDriver, IconRemove } from '../icons';
import { useVisibleSchedules } from '../../state/scheduleStore';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivityOverridesStore } from '../../state/activityOverridesStore';
import { commit } from '../../state/programmeHistory';
import { resetLinkOps, setLinkOp } from '../../state/programmeEdits';
import { reaches } from '../../schedule/linkShortcuts';
import { ResizeHandle, useResizableWidth } from '../ResizeHandle';
import { useCellRange } from '../useCellRange';

const days = (hours: number, perDay = 8) => Math.round((hours / perDay) * 10) / 10;

type Kind = 'predecessor' | 'successor';
const REL_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
type SortKey = 'driving' | 'id' | 'link' | 'lag' | 'name' | 'start' | 'finish' | 'dur' | 'float' | 'relation';
interface Sort { key: SortKey; dir: 1 | -1 }

/** One link as the table shows it: the activity at the other end and what is known about the link. */
interface Row {
  rel: Relationship;
  other: Activity | undefined;
  driving: boolean;
  relationText: string;
  relation: ReturnType<typeof summariseRelation>;
  /** No direct contact, but a chain of touching objects joins the two. */
  via: ViaRelation | null;
}

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'driving', label: '', title: 'Drives the start of the later activity' },
  { key: 'id', label: 'ID' },
  { key: 'link', label: 'Type' },
  { key: 'lag', label: 'Lag (d)', title: "Lag in days of the later activity's calendar (negative: lead)" },
  { key: 'name', label: 'Name' },
  { key: 'start', label: 'Start' },
  { key: 'finish', label: 'Finish' },
  { key: 'dur', label: 'Dur (d)' },
  { key: 'float', label: 'Float (d)' },
  { key: 'relation', label: 'Relation', title: "Where the other activity's objects sit against this activity's, from the Clashes & contacts results" },
];

const time = (d: Date | null | undefined) => d?.getTime() ?? null;
function sortValue(r: Row, key: SortKey): string | number | null {
  switch (key) {
    case 'driving': return r.driving ? 1 : 0;
    case 'id': return r.other?.code ?? '';
    case 'link': return r.rel.type;
    case 'lag': return r.rel.lagHours;
    case 'name': return r.other?.name ?? '';
    case 'start': return time(r.other?.earlyStart ?? r.other?.targetStart);
    case 'finish': return time(r.other?.earlyFinish ?? r.other?.targetFinish);
    case 'dur': return r.other?.durationHours ?? null;
    case 'float': return r.other?.totalFloatHours ?? null;
    case 'relation': return r.relationText;
  }
}

function sortRows(rows: Row[], sort: Sort | null): Row[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === y) return 0;
    if (x === null) return 1; // blanks last either way
    if (y === null) return -1;
    return (typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x < y ? -1 : 1) * sort.dir;
  });
}

/** The selected activity's predecessors (left) and successors (right) in full, under the Gantt / table.
    Click a column to sort; the driver and ID columns stay put when scrolling sideways; drag the divider to resize. */
export function LinksPane({ activity, model, height, kind: only, onSelect }: {
  activity: Activity;
  model: ScheduleModel;
  /** Fixed height (px); absent: fills the panel it is in. */
  height?: number;
  /** Just the predecessors or just the successors (their own panel); absent: both, side by side. */
  kind?: Kind;
  onSelect: (activity: Activity) => void;
}) {
  const split = useResizableWidth('schedule.linksSplit', 820, 320, 2400);

  // ---- Editing the links: the pencil makes the type and lag editable, lets a link be taken out and another added. Edits are
  // kept with the project on top of the programme (imported or generated), matched by Activity ID, so they survive re-importing.
  const visible = useVisibleSchedules();
  const linkEdits = useActivityOverridesStore((s) => s.links);
  const origin = useMemo(() => {
    const own = visible.length === 1 ? visible[0] : visible.find((v) => activity.id.startsWith(`${v.id}:`));
    return own ? programmeKey(own) : null;
  }, [visible, activity.id]);
  // Always editable when the programme is (no edit mode to switch on); a read-only programme shows plain text.
  const editing = origin !== null;
  const [note, setNote] = useState<string | null>(null);
  const [add, setAdd] = useState<Record<Kind, { code: string; type: (typeof REL_TYPES)[number]; lag: string }>>({
    predecessor: { code: '', type: 'FS', lag: '0' },
    successor: { code: '', type: 'FS', lag: '0' },
  });
  const byId = useMemo(() => new Map(model.activities.map((a) => [a.id, a])), [model.activities]);
  const calendarsById = useMemo(() => new Map(model.calendars.map((c) => [c.id, c])), [model.calendars]);
  const perDayOf = (calendarId: string | null) => hoursPerDayOf(calendarId, calendarsById);
  const codeOf = (id: string) => model.activities.find((a) => a.id === id)?.code ?? id;
  const changed = origin !== null && (linkEdits[origin] ?? []).some((o) => o.pred === activity.code.toUpperCase() || o.succ === activity.code.toUpperCase());
  const setLink = (rel: Relationship, patch: { type?: Relationship['type']; lagHours?: number }) => {
    if (origin !== null) commit('Edit link', () => setLinkOp(origin, { op: 'set', pred: codeOf(rel.predId), succ: codeOf(rel.succId), ...patch }), { merge: `link:${rel.predId}>${rel.succId}` });
  };
  const removeLink = (rel: Relationship) => {
    if (origin !== null) commit('Remove link', () => setLinkOp(origin, { op: 'remove', pred: codeOf(rel.predId), succ: codeOf(rel.succId) }));
  };
  const addLink = (kind: Kind) => {
    const d = add[kind];
    const other = model.activities.find((a) => a.code.toLowerCase() === d.code.trim().toLowerCase());
    if (origin === null) return;
    if (!other || other.id === activity.id) return setNote(other ? 'A link needs two different activities.' : `No activity with the ID "${d.code.trim()}".`);
    const pred = kind === 'predecessor' ? other : activity;
    const succ = kind === 'predecessor' ? activity : other;
    if (reaches(model, succ.id, pred.id, [])) return setNote(`${pred.code} → ${succ.code} would make a loop (${succ.code} already leads to ${pred.code}).`);
    const lag = Number(d.lag);
    commit('Add link', () => setLinkOp(origin, { op: 'add', pred: pred.code, succ: succ.code, type: d.type, lagHours: Number.isFinite(lag) ? Math.round(lag * perDayOf(succ.calendarId) * 4) / 4 : 0 }));
    setAdd((s) => ({ ...s, [kind]: { ...s[kind], code: '' } }));
    setNote(`Linked ${pred.code} → ${succ.code} (${d.type}).`);
  };
  const resetLinks = () => {
    if (origin !== null) commit('Reset links', () => resetLinkOps(origin, [activity.code]));
    setNote('The links of this activity are back as in the imported or generated programme.');
  };
  const [sorts, setSorts] = useState<Record<Kind, Sort | null>>({ predecessor: null, successor: null });

  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const clashResults = useClashStore((s) => s.results);
  const { objectsOf } = useMemo(() => sharedActivityObjects(model, loadedModels, groups), [model, loadedModels, groups]);
  const contacts = useMemo(() => sharedContactIndex(clashResults), [clashResults]);
  const hasContacts = contacts.size > 0;

  // What this activity's objects reach through chains of touching objects, for the links that do not touch directly.
  const reach = useMemo(() => {
    const mine = objectsOf.get(activity.id);
    return hasContacts && mine ? reachByContacts(contacts, mine) : null;
  }, [objectsOf, contacts, hasContacts, activity.id]);

  const rowsOf = useMemo(() => {
    const byId = new Map(model.activities.map((a) => [a.id, a]));
    const build = (list: Relationship[], otherOf: (r: Relationship) => string): Row[] =>
      list.map((rel) => {
        const other = byId.get(otherOf(rel));
        const pred = byId.get(rel.predId);
        const succ = byId.get(rel.succId);
        const mine = objectsOf.get(activity.id);
        const theirs = other ? objectsOf.get(other.id) : undefined;
        const relation = hasContacts && mine && theirs ? summariseRelation(contacts, mine, theirs) : null;
        const via = !relation && reach && theirs ? viaRelation(reach, theirs) : null;
        const relationText = !mine || !theirs ? 'not linked'
          : !hasContacts ? ''
          : relation ? `${POSITION_LABEL[relation.dominant]}${relation.mixed ? ' +' : ''}`
          : via ? `${POSITION_LABEL[via.position]} · via ${via.via}`
          : 'no contact';
        return { rel, other, driving: !!pred && !!succ && drives(rel, pred, succ), relationText, relation, via };
      });
    return {
      predecessor: build(model.relationships.filter((r) => r.succId === activity.id), (r) => r.predId),
      successor: build(model.relationships.filter((r) => r.predId === activity.id), (r) => r.succId),
    };
  }, [model, activity.id, objectsOf, contacts, hasContacts, reach]);

  const toggleSort = (kind: Kind, key: SortKey) =>
    setSorts((s) => {
      const cur = s[kind];
      const next: Sort | null = !cur || cur.key !== key ? { key, dir: 1 } : cur.dir === 1 ? { key, dir: -1 } : null;
      return { ...s, [kind]: next };
    });

  // ---- Excel-like editing of the Type and Lag columns: fill down (Ctrl+D, drag the corner square), paste a column, copy a range ----
  const sortedRows: Record<Kind, Row[]> = { predecessor: sortRows(rowsOf.predecessor, sorts.predecessor), successor: sortRows(rowsOf.successor, sorts.successor) };
  const lagDaysOf = (r: Row) => days(r.rel.lagHours, perDayOf(byId.get(r.rel.succId)?.calendarId ?? null));
  /** Sets cells of a column from text, all in one step (one undo); what is already so, or is no use, is left. */
  const setCells = (kind: Kind, col: string, pairs: [number, string][], label: string) => {
    if (origin === null) return;
    const rows = sortedRows[kind];
    let n = 0;
    commit(label, () => {
      for (const [i, value] of pairs) {
        const r = rows[i];
        if (!r) continue;
        const base = { op: 'set' as const, pred: codeOf(r.rel.predId), succ: codeOf(r.rel.succId) };
        if (col === 'type') {
          const t = value.toUpperCase();
          if (!(REL_TYPES as readonly string[]).includes(t) || t === r.rel.type) continue;
          setLinkOp(origin, { ...base, type: t as Relationship['type'] });
        } else {
          const v = Number(value);
          if (value.trim() === '' || !Number.isFinite(v)) continue;
          const hours = Math.round(v * perDayOf(byId.get(r.rel.succId)?.calendarId ?? null) * 4) / 4;
          if (hours === r.rel.lagHours) continue;
          setLinkOp(origin, { ...base, lagHours: hours });
        }
        n++;
      }
    });
    if (n) setNote(`${label}: ${n} ${n === 1 ? 'cell' : 'cells'}.`);
  };
  const cellsOf = (kind: Kind) => ({
    rowCount: sortedRows[kind].length,
    fill: (col: string, srcLo: number, srcHi: number, end: number) => {
      const rows = sortedRows[kind];
      const len = srcHi - srcLo + 1;
      const pairs: [number, string][] = [];
      for (let i = srcHi + 1; i <= end; i++) {
        const from = rows[srcLo + ((i - srcHi - 1) % len)];
        if (from) pairs.push([i, col === 'type' ? from.rel.type : String(lagDaysOf(from))]);
      }
      setCells(kind, col, pairs, 'Filled down');
    },
    paste: (col: string, start: number, values: string[]) => setCells(kind, col, values.map((v, k): [number, string] => [start + k, v]), 'Pasted'),
    read: (col: string, row: number) => { const r = sortedRows[kind][row]; return !r ? '' : col === 'type' ? r.rel.type : String(lagDaysOf(r)); },
  });
  const grids = { predecessor: useCellRange(cellsOf('predecessor')), successor: useCellRange(cellsOf('successor')) };

  const relationCell = (r: Row, kind: Kind) => {
    if (r.relationText === 'not linked') return <span title="One of the two activities has no linked objects (Link Groups)">not linked</span>;
    if (!hasContacts) return <span title="No Clashes & contacts results yet (load the models and let them run)">—</span>;
    if (r.via) {
      return (
        <span className={`ad-relation ad-relation--${r.via.position}`} title={`Not touching directly: ${r.via.hops} touching steps join the two, starting with ${r.via.via}`}>
          {r.relationText}
        </span>
      );
    }
    if (!r.relation) return <span title="Linked objects, but none touch the other activity's objects, directly or through up to 4 touching objects">no contact</span>;
    return <span title={relationDetail(r.relation, kind)} className={`ad-relation ad-relation--${r.relation.dominant}`}>{r.relationText}</span>;
  };

  const half = (kind: Kind, title: string, style?: React.CSSProperties) => {
    const sort = sorts[kind];
    const rows = sortedRows[kind];
    const grid = grids[kind];
    const handle = (col: string, ri: number) => editing && grid.hasHandle(col, ri)
      ? <span className="lp-fill" onMouseDown={grid.startFill} onDoubleClick={grid.fillToEnd} title="Drag down to fill (Ctrl+D). Double-click: to the end." />
      : null;
    return (
      <div className="links-pane__half" style={style}>
        <div className="links-pane__title">
          {title} ({rows.length}) <span className="scn-dim" style={{ fontWeight: 400 }}>· {activity.code}</span>
          {(only ? true : kind === 'successor') && (
            <span style={{ float: 'right', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {note && editing && <span className="scn-dim" style={{ fontWeight: 400 }}>{note}</span>}
              {changed && editing && <button type="button" className="mini-btn" onClick={resetLinks} title="Put this activity's links back as in the imported or generated programme">Reset links</button>}
            </span>
          )}
        </div>
        <div className="links-pane__scroll">
          {(rows.length > 0 || editing) ? (
            <table className="lp-grid" {...(editing ? grid.grid : {})}>
              <thead>
                <tr>
                  <th className="lp-n" aria-label="Row">#</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} title={c.title} className="links-pane__sortable" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => toggleSort(kind, c.key)}>
                      {c.key === 'driving' ? <IconDriver width={13} height={13} /> : c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  const other = r.other;
                  // A lag is counted in the days of the later activity's calendar, as the schedule is calculated.
                  const lagPerDay = perDayOf(byId.get(r.rel.succId)?.calendarId ?? null);
                  const lag = days(r.rel.lagHours, lagPerDay);
                  const perDayOther = other ? perDayOf(other.calendarId) : 8;
                  return (
                    <tr key={`${r.rel.predId}>${r.rel.succId}:${r.rel.type}:${r.rel.lagHours}:${ri}`} data-line={ri}>
                      <td className="lp-n"><span className="lp-n__num">{ri + 1}</span>{editing && <button type="button" className="lp-n__del" onClick={() => removeLink(r.rel)} aria-label="Take this link out" title="Take this link out"><IconRemove /></button>}</td>
                      <td>{r.driving && <span className="ad-driver" title="Driving: its date sets the start of the later activity"><IconDriver width={14} height={14} /></span>}</td>
                      <td>{other ? <button type="button" className="link-btn" onClick={() => onSelect(other)} title={`Go to ${other.code}`}>{other.code}</button> : (kind === 'predecessor' ? r.rel.predId : r.rel.succId)}</td>
                      <td className={`lp-type${grid.inRange('type', ri) ? ' is-sel' : ''}`}>
                        {editing ? (
                          <select className="lp-edit" data-col="type" data-row={ri} value={r.rel.type} onChange={(e) => setLink(r.rel, { type: e.target.value as Relationship['type'] })} aria-label="Link type">
                            {REL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : r.rel.type}
                        {handle('type', ri)}
                      </td>
                      <td className={`num lp-lag${grid.inRange('lag', ri) ? ' is-sel' : ''}`}>
                        {editing ? (
                          <input className="lp-edit lp-edit--lag" data-col="lag" data-row={ri} type="number" step="0.25" defaultValue={lag} key={`${r.rel.lagHours}`} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && Math.round(v * lagPerDay * 4) / 4 !== r.rel.lagHours) setLink(r.rel, { lagHours: Math.round(v * lagPerDay * 4) / 4 }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="Lag in days" title="Lag in days" />
                        ) : (lag || '')}
                        {handle('lag', ri)}
                      </td>
                      <td className="links-pane__name" title={other?.name}>{other?.name ?? ''}</td>
                      <td>{fmtDate(other?.earlyStart ?? other?.targetStart)}</td>
                      <td>{fmtDate(other?.earlyFinish ?? other?.targetFinish)}</td>
                      <td className="num">{other ? days(other.durationHours, perDayOther) : ''}</td>
                      <td className="num">{other?.totalFloatHours != null ? days(other.totalFloatHours, perDayOther) : ''}</td>
                      <td>{relationCell(r, kind)}</td>
                    </tr>
                  );
                })}
                {editing && (() => {
                  const d = add[kind];
                  const typed = model.activities.find((a) => a.code.toLowerCase() === d.code.trim().toLowerCase());
                  return (
                    <tr className="lp-new">
                      <td className="lp-n"><span className="lp-n__num">＋</span></td>
                      <td />
                      <td><input id={`lp-new-${kind}`} className="lp-edit" list="links-pane-codes" placeholder={kind === 'predecessor' ? 'Add predecessor ID…' : 'Add successor ID…'} value={d.code} onChange={(e) => setAdd((x) => ({ ...x, [kind]: { ...x[kind], code: e.target.value } }))} onKeyDown={(e) => { if (e.key === 'Enter') addLink(kind); }} aria-label={`Activity ID to add as a ${kind}`} /></td>
                      <td className="lp-type"><select className="lp-edit" value={d.type} onChange={(e) => setAdd((x) => ({ ...x, [kind]: { ...x[kind], type: e.target.value as (typeof REL_TYPES)[number] } }))} aria-label="Link type">{REL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                      <td className="num lp-lag"><input className="lp-edit lp-edit--lag" type="number" step="0.25" value={d.lag} onChange={(e) => setAdd((x) => ({ ...x, [kind]: { ...x[kind], lag: e.target.value } }))} onKeyDown={(e) => { if (e.key === 'Enter') addLink(kind); }} aria-label="Lag in days" title="Lag in days" /></td>
                      <td className="links-pane__name lp-hint" colSpan={6}>{typed ? typed.name : d.code.trim() ? 'No activity with this ID' : 'Type an ID, press Enter to link'}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          ) : <div className="scn-dim" style={{ padding: 10 }}>None.</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="links-pane" style={height === undefined ? { flex: 1, minHeight: 0, borderTop: 0 } : { height }}>
      <datalist id="links-pane-codes">{editing && model.activities.slice(0, 20000).map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</datalist>
      {only ? half(only, only === 'predecessor' ? 'Predecessors' : 'Successors', { flex: '1 1 0', minWidth: 0 }) : (
        <>
          {half('predecessor', 'Predecessors', { flex: '0 1 auto', width: split.width })}
          <ResizeHandle onMouseDown={split.startDrag(false)} />
          {half('successor', 'Successors', { flex: '1 1 0', minWidth: 200 })}
        </>
      )}
    </div>
  );
}
