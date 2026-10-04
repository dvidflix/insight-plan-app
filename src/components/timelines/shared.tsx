import { addDays, initials, type Person, type TimelineRow } from '../../state/timelinesStore';

/** A planner's avatar: their initials in their colour. */
export function Avatar({ person, size = 26 }: { person: Person | undefined; size?: number }) {
  if (!person) return <span className="tl-avatar tl-avatar--none" style={{ width: size, height: size }} title="No planner allocated">?</span>;
  return (
    <span className="tl-avatar" style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }} title={`${person.name}${person.role ? ` · ${person.role}` : ''}`}>
      {initials(person.name)}
    </span>
  );
}

/** One date of a stage on a row, edited: a first date makes a two-week span,
    clearing the start takes the stage off the row, and the finish never goes
    before the start. */
export function editSpan(r: TimelineRow, stageId: string, part: 'start' | 'end', value: string): TimelineRow {
  const cur = r.spans[stageId];
  if (!value) {
    if (part === 'end' && cur) return r;
    const { [stageId]: _gone, ...rest } = r.spans;
    return { ...r, spans: rest };
  }
  if (!cur) {
    const start = part === 'start' ? value : addDays(value, -13);
    const end = part === 'end' ? value : addDays(value, 13);
    return { ...r, spans: { ...r.spans, [stageId]: { start, end } } };
  }
  const next = { ...cur, [part]: value } as typeof cur;
  if (next.end < next.start) next[part === 'start' ? 'end' : 'start'] = value;
  return { ...r, spans: { ...r.spans, [stageId]: next } };
}
