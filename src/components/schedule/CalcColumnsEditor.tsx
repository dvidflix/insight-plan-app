import { useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '../../schedule/columns';
import { buildColumnContext } from '../../schedule/columns';
import { COMPUTED_DURATION, calcColumnDefs, compileFormula, numericColumns, useCalcColumnsStore, type CalcColumn } from '../../schedule/calculatedColumns';
import { useActiveSchedule } from '../../state/scheduleStore';
import { IconPencil, IconRemove } from '../icons';
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
        <InfoTip>A column worked out from a formula over the numeric columns, for example <code>[Rebar (t) (units)] / [Original Duration (h)]</code> for tonnes per hour. Use [Column name] as in the list below, numbers, + - * / ^, brackets, and ABS, ROUND, CEIL (round up to the next multiple: <code>CEIL(x, 1)</code>), MIN, MAX. Rows where a used column is empty show nothing. Once saved, tick it under “Calculated” in the list below.</InfoTip>
        <button type="button" className="cols__link" onClick={() => { setOpen(true); setDraft({ id: newId(), ...EXAMPLE }); }}>+ New</button>
        <button type="button" className="cols__link" title="Duration in days from the rebar quantity (SF-003): quantity × 75 Mh/t ÷ (12 men × 2 shifts × 9.17 h). Edit the resource name and crew in the formula to suit, then Save." onClick={() => { setOpen(true); setDraft(columns.find((c) => c.id === COMPUTED_DURATION.id) ?? COMPUTED_DURATION); }}>+ Computed duration</button>
      </div>
      {open && (
        <>
          {columns.length > 0 && (
            <div className="rgrid" role="table" style={{ '--rg-cols': '38% minmax(0, 1fr) 30px' } as React.CSSProperties}>
              <div className="rgrid__head" role="row">
                <span className="rgrid__n rgrid__n--head" />
                <div className="rgrid__body">
                  <span className="rgrid__th" role="columnheader">Name</span>
                  <span className="rgrid__th" role="columnheader">Formula</span>
                  <span className="rgrid__th" />
                </div>
              </div>
              {columns.map((c, i) => (
                <div className="rgrid__row" role="row" key={c.id}>
                  <span className="rgrid__n">
                    <span className="rgrid__num">{i + 1}</span>
                    <button
                      type="button"
                      className="rgrid__del"
                      onClick={() => { if (window.confirm(`Delete the calculated column “${c.name}”?`)) remove(c.id); }}
                      aria-label={`Delete ${c.name}`}
                      title="Delete"
                    >
                      <IconRemove />
                    </button>
                  </span>
                  <div className="rgrid__body">
                    <span className="rgrid__cell rgrid__cell--name" title={c.name}>{c.name}</span>
                    <code className="rgrid__cell rgrid__cell--code" title={c.formula}>{c.formula}</code>
                    <span className="rgrid__cell rgrid__cell--act">
                      <button type="button" className="rgrid__ib" onClick={() => setDraft(c)} aria-label={`Edit ${c.name}`} title="Edit"><IconPencil width={14} height={14} /></button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
