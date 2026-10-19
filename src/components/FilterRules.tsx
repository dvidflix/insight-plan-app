import type { ReactNode } from 'react';
import { FieldPicker, RuleRows, type PickField } from './schedule/FieldRules';
import { InfoTip } from './InfoTip';
import { compileLogic, defaultLogic } from '../viewer/filterLogic';

/** One filter in the summary table: the field and what it asks, in a few words. */
export interface FilterRow {
  id: string;
  field: string;
  summary: string;
  /** Not complete yet (no value picked): shown dim. */
  dim?: boolean;
}

/** The Filters tab of every list, one layout: saved filters, the filters as a Field / Condition table (click one to edit it in the editor
    under the table), how they combine, then every field to add a filter from. Each list gives the rows, the editor and what its fields are. */
export function FilterRules({ presets, quick, rows, onRemove, onReorder, onClearAll, hint, tip, empty = 'No filter: pick a field below.', editingId, onEdit, editor, editorTitle = 'Edit condition', combine, fields, picked, onPick }: {
  presets?: ReactNode;
  /** One-click filters, above the table. */
  quick?: ReactNode;
  rows: FilterRow[];
  onRemove: (id: string) => void;
  /** Rows dragged into a new order (their ids); lists whose filters have no order leave it out. */
  onReorder?: (ids: string[]) => void;
  onClearAll: () => void;
  /** The line under the heading: how many of the rows / objects pass. */
  hint?: ReactNode;
  tip?: ReactNode;
  empty?: string;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  /** The controls of the filter being edited. */
  editor?: ReactNode;
  editorTitle?: string;
  /** How the filters combine (shown when there are several). */
  combine?: ReactNode;
  fields: PickField[];
  picked: ReadonlySet<string>;
  onPick: (field: PickField) => void;
}) {
  const open = (id: string) => onEdit(editingId === id ? null : id);
  return (
    <div className="cols">
      {presets}

      <div className="cols__heading">
        <span>
          Filters <b>{rows.length}</b>{' '}
          {tip && <InfoTip>{tip}</InfoTip>}
        </span>
        {rows.length > 0 && <button type="button" className="cols__link" onClick={onClearAll}>Clear all</button>}
      </div>
      {hint}
      {quick}
      <RuleRows
        grid={{ key: 'filters', columns: [{ label: 'Field' }, { label: 'Condition' }] }}
        rules={rows}
        onChange={(next) => {
          if (next.length < rows.length) { const gone = rows.find((r) => !next.some((n) => n.id === r.id)); if (gone) onRemove(gone.id); } else onReorder?.(next.map((r) => r.id));
        }}
        empty={empty}
      >
        {(r) => (
          <>
            <button type="button" className={`rgrid__cell rgrid__cell--grow rgrid__cell--btn${editingId === r.id ? ' is-on' : ''}`} title={`${r.field} (click to edit this filter)`} onClick={() => open(r.id)}>{r.field}</button>
            <button type="button" className={`rgrid__cell rgrid__cell--grow rgrid__cell--btn${r.dim ? ' is-dim' : ''}`} title="Click to edit this filter" onClick={() => open(r.id)}>{r.summary || 'pick a value'}</button>
          </>
        )}
      </RuleRows>
      {rows.length > 1 && combine}
      {editingId && rows.some((r) => r.id === editingId) && editor && (
        <div className="dtp__edit">
          <div className="dtp__edit-head">
            <span>{editorTitle}</span>
            <button type="button" className="cols__link" onClick={() => onEdit(null)}>Done</button>
          </div>
          {editor}
        </div>
      )}

      <div className="cols__heading"><span>Available fields <b>{fields.length}</b></span></div>
      <FieldPicker catalog={fields} picked={picked} onPick={onPick} />
    </div>
  );
}

/** The last row of the rules: how they combine, written with their numbers, like a spreadsheet formula. Left empty it is "all of them"
    (or "any of them", by the switch): typing a formula such as (1 and 2) or (3 and 4) and 5 takes over. */
export function LogicRow({ count, match, logic, onChange }: { count: number; match: 'all' | 'any'; logic: string; onChange: (p: { match?: 'all' | 'any'; logic?: string }) => void }) {
  const custom = logic.trim() !== '';
  const check = custom ? compileLogic(logic, count) : null;
  const error = check && !check.ok ? check.error : null;
  const unused = check && check.ok ? Array.from({ length: count }, (_, i) => i + 1).filter((n) => !check.uses.has(n)) : [];
  return (
    <div className="dtp__logic">
      <div className="dtp__logic-row">
        <span className="dtp__logic-label" title="How the rules above combine, by their numbers">Logic</span>
        <input
          className={`dtp__logic-input${error ? ' is-bad' : ''}`}
          value={logic}
          spellCheck={false}
          placeholder={defaultLogic(count, match)}
          aria-label="How the rules combine"
          aria-invalid={!!error}
          onChange={(e) => onChange({ logic: e.target.value })}
        />
        <div className="segmented-choice dtp__logic-switch" title={custom ? 'Clear the formula to use all / any of the rules' : 'Without a formula: all the rules, or any of them'}>
          <button type="button" className={!custom && match === 'all' ? 'active' : ''} onClick={() => onChange({ match: 'all', logic: '' })}>All</button>
          <button type="button" className={!custom && match === 'any' ? 'active' : ''} onClick={() => onChange({ match: 'any', logic: '' })}>Any</button>
        </div>
      </div>
      {error && <div className="dtp__logic-msg is-bad">{error}: all the rules are used until it is fixed.</div>}
      {!error && unused.length > 0 && <div className="dtp__logic-msg">Not used: rule{unused.length === 1 ? '' : 's'} {unused.join(', ')}.</div>}
      {!custom && <div className="dtp__logic-msg">Write rule numbers with and, or, not and brackets, e.g. (1 and 2) or (3 and 4) and 5. And binds tighter than or.</div>}
    </div>
  );
}
