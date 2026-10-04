import { useMemo, useState } from 'react';
import type { Activity, Relationship, ScheduleModel } from '../../schedule/types';
import { POSITION_LABEL, reachByContacts, relationDetail, sharedContactIndex, summariseRelation, viaRelation, type ViaRelation } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { drives } from '../../schedule/drivingPath';
import { fmtDate } from '../../schedule/reports';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useClashStore } from '../../state/clashStore';
import { IconDriver } from '../icons';
import { ResizeHandle, useResizableWidth } from '../ResizeHandle';

const days = (hours: number) => Math.round((hours / 8) * 10) / 10;

type Kind = 'predecessor' | 'successor';
type SortKey = 'driving' | 'id' | 'link' | 'name' | 'start' | 'finish' | 'dur' | 'float' | 'relation';
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
  { key: 'link', label: 'Link' },
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
    case 'link': return `${r.rel.type} ${r.rel.lagHours}`;
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
export function LinksPane({ activity, model, height, onSelect }: {
  activity: Activity;
  model: ScheduleModel;
  height: number;
  onSelect: (activity: Activity) => void;
}) {
  const split = useResizableWidth('schedule.linksSplit', 820, 320, 2400);
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
    const rows = sortRows(rowsOf[kind], sort);
    return (
      <div className="links-pane__half" style={style}>
        <div className="links-pane__title">{title} ({rows.length}) <span className="scn-dim" style={{ fontWeight: 400 }}>· {activity.code}</span></div>
        <div className="links-pane__scroll">
          {rows.length ? (
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} title={c.title} className="links-pane__sortable" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => toggleSort(kind, c.key)}>
                      {c.key === 'driving' ? <IconDriver width={13} height={13} /> : c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  const lag = days(r.rel.lagHours);
                  const other = r.other;
                  return (
                    <tr key={`${r.rel.predId}>${r.rel.succId}:${r.rel.type}:${r.rel.lagHours}:${ri}`}>
                      <td>{r.driving && <span className="ad-driver" title="Driving: its date sets the start of the later activity"><IconDriver width={14} height={14} /></span>}</td>
                      <td>{other ? <button type="button" className="link-btn" onClick={() => onSelect(other)} title={`Go to ${other.code}`}>{other.code}</button> : (kind === 'predecessor' ? r.rel.predId : r.rel.succId)}</td>
                      <td>{r.rel.type}{lag ? ` ${lag > 0 ? '+' : ''}${lag}d` : ''}</td>
                      <td className="links-pane__name" title={other?.name}>{other?.name ?? ''}</td>
                      <td>{fmtDate(other?.earlyStart ?? other?.targetStart)}</td>
                      <td>{fmtDate(other?.earlyFinish ?? other?.targetFinish)}</td>
                      <td className="num">{other ? days(other.durationHours) : ''}</td>
                      <td className="num">{other?.totalFloatHours != null ? days(other.totalFloatHours) : ''}</td>
                      <td>{relationCell(r, kind)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div className="scn-dim" style={{ padding: 10 }}>None.</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="links-pane" style={{ height }}>
      {half('predecessor', 'Predecessors', { flex: '0 1 auto', width: split.width })}
      <ResizeHandle onMouseDown={split.startDrag(false)} />
      {half('successor', 'Successors', { flex: '1 1 0', minWidth: 200 })}
    </div>
  );
}
