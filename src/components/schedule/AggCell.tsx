import type { ColumnDef } from '../../schedule/columns';
import { aggOptions, type AggKind } from '../../schedule/aggregates';

/** A totals-row cell: the column's summary and a small picker for how it is
    summarised (sum / average / min / max / count; earliest / latest / span
    for dates). */
export function AggCell({ column, kind, value, onKind }: { column: ColumnDef; kind: AggKind; value: string; onKind: (k: AggKind) => void }) {
  const options = aggOptions(column);
  if (!options.length) return null;
  const current = options.find((o) => o.id === kind) ?? options[0];
  return (
    <span className="agg-cell">
      {value && <span className="agg-cell__value" title={`${current.label}: ${value}`}>{value}</span>}
      <select
        className={`agg-cell__pick${kind === 'none' ? ' is-none' : ''}`}
        value={kind}
        onChange={(e) => onKind(e.target.value as AggKind)}
        onClick={(e) => e.stopPropagation()}
        title={`Summarise ${column.label}: ${current.label}`}
        aria-label={`Summarise ${column.label}`}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </span>
  );
}
