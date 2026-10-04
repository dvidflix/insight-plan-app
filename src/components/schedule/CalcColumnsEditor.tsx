import { useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '../../schedule/columns';
import { buildColumnContext } from '../../schedule/columns';
import { calcColumnDefs, compileFormula, numericColumns, useCalcColumnsStore, type CalcColumn } from '../../schedule/calculatedColumns';
import { useActiveSchedule } from '../../state/scheduleStore';
import { IconPencil } from '../icons';
import { InfoTip } from '../InfoTip';

const EXAMPLE: Omit<CalcColumn, 'id'> = { name: 'Rebar t/h', formula: '[Rebar (t) (units)] / [Original Duration (h)]', unit: 't/h', decimals: 2 };

const newId = () => Math.random().toString(36).slice(2, 8);

/** Columns › Calculated columns: define a column from a formula over the numeric columns
    (rebar tonnes ÷ duration hours, quantity per day …). Once saved it is listed under
    "Calculated" in the column picker: tick it to show it. */
export function CalcColumnsEditor({ catalog }: { catalog: ColumnDef[] }) {
  const columns = useCalcColumnsStore((s) => s.columns);
  const save = useCalcColumnsStore((s) => s.save);
  const remove = useCalcColumnsStore((s) => s.remove);
  const model = useActiveSchedule();
  const [draft, setDraft] = useState<CalcColumn | null>(null);
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const base = useMemo(() => catalog.filter((c) => !c.id.startsWith('calc:')), [catalog]);
  const numeric = useMemo(() => [...numericColumns(base).values()].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)), [base]);
  const ctx = useMemo(() => (model ? buildColumnContext(model) : null), [model]);

  const compiled = useMemo(() => (draft ? compileFormula(draft.formula, base) : null), [draft, base]);
  const preview = useMemo(() => {
    if (!draft || !compiled?.ok || !model || !ctx) return null;
    const col = calcColumnDefs([{ ...draft, id: 'preview' }], base)[0];
    for (const a of model.activities.slice(0, 5000)) {
      const v = col.value!(a, ctx);
      if (v !== null) return { text: col.text(a, ctx), name: a.name };
    }
    return { text: '', name: '' };
  }, [draft, compiled, model, ctx, base]);

  const insert = (label: string) => {
    if (!draft) return;
    const el = area.current;
    const at = el?.selectionStart ?? draft.formula.length;
    const end = el?.selectionEnd ?? at;
    const text = `[${label}]`;
    setDraft({ ...draft, formula: draft.formula.slice(0, at) + text + draft.formula.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  return (
    <div className="calc-cols">
      <div className="cols__heading">
        <button type="button" className="calc-cols__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          Calculated columns <b>{columns.length}</b>
        </button>
        <InfoTip>A column worked out from a formula over the numeric columns, for example <code>[Rebar (t) (units)] / [Original Duration (h)]</code> for tonnes per hour. Use [Column name] as in the list below, numbers, + - * / ^, brackets, and ABS, ROUND, MIN, MAX. Rows where a used column is empty show nothing. Once saved, tick it under “Calculated” in the list below.</InfoTip>
        <button type="button" className="cols__link" onClick={() => { setOpen(true); setDraft({ id: newId(), ...EXAMPLE }); }}>+ New</button>
      </div>
      {open && (
        <>
          {columns.map((c) => (
            <div className="calc-cols__row" key={c.id}>
              <div className="calc-cols__text">
                <b>{c.name}</b>
                <code title={c.formula}>{c.formula}</code>
              </div>
              <button type="button" className="cols__icon" onClick={() => setDraft(c)} aria-label={`Edit ${c.name}`} title="Edit"><IconPencil width={14} height={14} /></button>
              <button
                type="button"
                className="cols__icon cols__icon--remove"
                onClick={() => { if (window.confirm(`Delete the calculated column “${c.name}”?`)) remove(c.id); }}
                aria-label={`Delete ${c.name}`}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
          {columns.length === 0 && !draft && <div className="flt__hint">None yet. “+ New” starts from tonnes per hour.</div>}
          {draft && (
            <div className="calc-cols__form">
              <input className="cols__search" placeholder="Column name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <textarea
                ref={area}
                className="calc-cols__formula"
                rows={2}
                spellCheck={false}
                placeholder="[Rebar (t) (units)] / [Original Duration (h)]"
                value={draft.formula}
                onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
              />
              <div className="calc-cols__line">
                <select value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }} title="Put a column's name into the formula">
                  <option value="">Insert column…</option>
                  {numeric.map((c) => <option key={c.id} value={c.label}>{c.group}: {c.label}</option>)}
                </select>
                <input className="calc-cols__unit" placeholder="Unit" value={draft.unit ?? ''} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} title="Shown after the number, e.g. t/h" />
                <select value={draft.decimals ?? 2} onChange={(e) => setDraft({ ...draft, decimals: Number(e.target.value) })} title="Decimal places">
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} dp</option>)}
                </select>
              </div>
              {compiled && !compiled.ok && <div className="calc-cols__error">{compiled.error}</div>}
              {compiled?.ok && preview && (
                <div className="calc-cols__preview" title={preview.name}>
                  {preview.text ? <>Preview: <b>{preview.text}</b> on “{preview.name.slice(0, 48)}”</> : 'Valid. No activity has values for these columns yet.'}
                </div>
              )}
              <div className="calc-cols__line">
                <button
                  type="button"
                  className="btn btn--small primary"
                  disabled={!draft.name.trim() || !compiled?.ok}
                  onClick={() => { save({ ...draft, name: draft.name.trim(), formula: draft.formula.trim() }); setDraft(null); }}
                >
                  Save
                </button>
                <button type="button" className="btn btn--small" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
