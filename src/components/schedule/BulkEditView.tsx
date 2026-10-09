import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { buildColumnContext } from '../../schedule/columns';
import { useColumnCatalog } from '../../schedule/calculatedColumns';
import { CONSTRAINT_TYPES, RULE_OPS, planBulkEdit, type BulkAction, type BulkRule, type RuleOp } from '../../schedule/bulkEdit';
import { exportScheduleXlsx } from '../../schedule/exportXlsx';
import { useVisibleSchedules } from '../../state/scheduleStore';
import { programmeKey } from '../../state/unloadedWbsStore';
import { overrideCount, useActivityOverridesStore } from '../../state/activityOverridesStore';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { newId } from '../../schedule/linkGroups';
import { Section, Tiles } from '../reports/ReportParts';

type Kind = BulkAction['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'setField', label: 'Set a user field' },
  { value: 'replace', label: 'Find and replace in the name' },
  { value: 'shift', label: 'Shift dates' },
  { value: 'duration', label: 'Change durations' },
  { value: 'durationFrom', label: 'Original duration from a column' },
  { value: 'constraint', label: 'Set a constraint' },
  { value: 'calendar', label: 'Set the calendar' },
];
const PREVIEW_ROWS = 100;

/** Programmes > Bulk edit: pick activities (with rules, or the ones selected in the table), choose one change, check the
    preview, then apply it to all of them. Edits are kept with the project on top of the programme, imported or generated,
    so re-importing or regenerating it does not lose them; dates and float are calculated again from the links. Undo the
    last edit with one click, reset them all, or download the result as Excel. */
export function BulkEditView({ model }: { model: ScheduleModel }) {
  const visible = useVisibleSchedules();
  const overrides = useActivityOverridesStore((s) => s.byProgramme);
  const selectedIds = useActivitySelectionStore((s) => s.ids);

  const catalog = useColumnCatalog(model);
  const ctx = useMemo(() => buildColumnContext(model), [model]);
  const columnById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const calendarName = (id: string | null) => (id ? ctx.calendarNameById[id] ?? id : '');

  const [rules, setRules] = useState<BulkRule[]>([{ id: newId(), field: 'name', op: 'contains', value: '' }]);
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [source, setSource] = useState<'rules' | 'selected'>('rules');
  const [fromColumn, setFromColumn] = useState('calc:computed-duration-up');
  const [kind, setKind] = useState<Kind>('setField');
  const [field, setField] = useState('CWA-Methods Break Down');
  const [template, setTemplate] = useState('{wbsName}');
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [days, setDays] = useState(7);
  const [includeActuals, setIncludeActuals] = useState(false);
  const [durMode, setDurMode] = useState<'set' | 'scale'>('scale');
  const [durValue, setDurValue] = useState(110);
  const [conType, setConType] = useState('CS_MSOA');
  const [conDate, setConDate] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [undo, setUndo] = useState<ReturnType<typeof useActivityOverridesStore.getState>['byProgramme'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const action: BulkAction =
    kind === 'setField' ? { kind, field, template }
    : kind === 'replace' ? { kind, find, replaceWith, matchCase }
    : kind === 'shift' ? { kind, days, includeActuals }
    : kind === 'duration' ? { kind, mode: durMode, value: durValue }
    : kind === 'durationFrom' ? { kind, column: fromColumn }
    : kind === 'constraint' ? { kind, type: conType, date: conDate }
    : { kind, calendarId };

  const plan = useMemo(
    () => planBulkEdit(model.activities, rules, match, action, (a, id) => columnById.get(id)?.text(a, ctx) ?? '', calendarName, (a, id) => columnById.get(id)?.value?.(a, ctx) ?? null, source === 'selected' ? selectedIds : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, rules, match, source, selectedIds, fromColumn, kind, field, template, find, replaceWith, matchCase, days, includeActuals, durMode, durValue, conType, conDate, calendarId, columnById, ctx],
  );

  /** A row of the (possibly combined) display model back to its programme and own id. */
  const originOf = (displayId: string): { scheduleId: string; id: string } | null => {
    if (visible.length === 1) return { scheduleId: visible[0].id, id: displayId };
    const s = visible.find((v) => displayId.startsWith(`${v.id}:`));
    return s ? { scheduleId: s.id, id: displayId.slice(s.id.length + 1) } : null;
  };

  const apply = () => {
    // Per programme: Activity ID -> the fields changed.
    const bySchedule = new Map<string, Map<string, Partial<Activity>>>();
    for (const c of plan.changes) {
      const o = originOf(c.id);
      const m = o && visible.find((v) => v.id === o.scheduleId);
      if (!m) continue;
      const key = programmeKey(m);
      (bySchedule.get(key) ?? bySchedule.set(key, new Map()).get(key)!).set(c.code, c.patch);
    }
    // Remember the edits as they are now, to undo.
    setUndo(useActivityOverridesStore.getState().byProgramme);
    for (const [key, edits] of bySchedule) useActivityOverridesStore.getState().set(key, edits);
    setMessage(`Changed ${plan.changes.length} activities, kept with the project. Undo puts them back; Reset all edits clears every edit of this programme.`);
  };

  const revert = () => {
    if (!undo) return;
    useActivityOverridesStore.setState({ byProgramme: undo });
    setUndo(null);
    setMessage('Back as it was before the last bulk edit.');
  };

  const editCount = visible.reduce((n, m) => n + overrideCount(overrides, programmeKey(m)), 0);
  const resetAll = () => {
    if (!window.confirm(`Remove all ${editCount} edited activities of ${visible.length === 1 ? 'this programme' : 'these programmes'}? Their original values come back.`)) return;
    setUndo(useActivityOverridesStore.getState().byProgramme);
    for (const m of visible) useActivityOverridesStore.getState().reset(programmeKey(m));
    setMessage('All edits removed: the programme is as it was imported or generated.');
  };

  const setRule = (id: string, patch: Partial<BulkRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const fieldOptions = catalog.filter((c) => c.group !== 'Resource Units');

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Bulk edit</h2>
              <button type="button" className="checks-export-btn report-header__export" onClick={() => exportScheduleXlsx(model, 'programme-edited.xlsx')}>Download Excel</button>
            </div>
            <div className="report-header__desc">Edits are kept with the project on top of the programme (they survive re-importing or regenerating it) · {model.project.name} · {editCount} edited {editCount === 1 ? 'activity' : 'activities'}</div>
          </div>

          <Section title="1. Which activities">
            <div className="report-filters" style={{ alignItems: 'center' }}>
              <label className="report-filter">
                <span>Pick by</span>
                <select value={source} onChange={(e) => setSource(e.target.value as 'rules' | 'selected')}>
                  <option value="rules">rules</option>
                  <option value="selected">the activities selected in the table / Gantt ({selectedIds.size})</option>
                </select>
              </label>
            </div>
            {source === 'selected' && <div className="report-table__footnote">Click rows in the Table or Gantt (Ctrl+click to add, Shift+click for a range) and come back here: the change applies only to them.</div>}
            {source === 'rules' && <><div className="report-filters" style={{ alignItems: 'center' }}>
              <label className="report-filter">
                <span>Match</span>
                <select value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')}>
                  <option value="all">all of the rules</option>
                  <option value="any">any of the rules</option>
                </select>
              </label>
              <button type="button" className="report-toggle" onClick={() => setRules((rs) => [...rs, { id: newId(), field: 'name', op: 'contains', value: '' }])}>+ Add rule</button>
            </div>
            {rules.map((r) => (
              <div className="report-filters" key={r.id} style={{ alignItems: 'center' }}>
                <select value={r.field} onChange={(e) => setRule(r.id, { field: e.target.value })}>
                  {fieldOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select value={r.op} onChange={(e) => setRule(r.id, { op: e.target.value as RuleOp })}>
                  {RULE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {RULE_OPS.find((o) => o.op === r.op)?.needsValue && (
                  <input type="text" value={r.value} placeholder="value" onChange={(e) => setRule(r.id, { value: e.target.value })} />
                )}
                {rules.length > 1 && <button type="button" className="report-toggle" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))} aria-label="Remove the rule">✕</button>}
              </div>
            ))}</>}
          </Section>

          <Section title="2. What to change">
            <div className="report-filters" style={{ alignItems: 'center' }}>
              <label className="report-filter">
                <span>Change</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              {kind === 'setField' && (
                <>
                  <label className="report-filter"><span>User field</span><input type="text" value={field} onChange={(e) => setField(e.target.value)} /></label>
                  <label className="report-filter" title="Tokens: {code} {name} {wbs} {wbsName} {start} {finish} {udf:Field} {code:Activity code type}">
                    <span>Value</span>
                    <input type="text" value={template} onChange={(e) => setTemplate(e.target.value)} />
                  </label>
                </>
              )}
              {kind === 'replace' && (
                <>
                  <label className="report-filter"><span>Find</span><input type="text" value={find} onChange={(e) => setFind(e.target.value)} /></label>
                  <label className="report-filter"><span>Replace with</span><input type="text" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} /></label>
                  <button type="button" className={`report-toggle${matchCase ? ' active' : ''}`} onClick={() => setMatchCase(!matchCase)}>Match case</button>
                </>
              )}
              {kind === 'shift' && (
                <>
                  <label className="report-filter"><span>Days (+ later, − earlier)</span><input type="number" value={days} onChange={(e) => setDays(Math.round(Number(e.target.value) || 0))} /></label>
                  <button type="button" className={`report-toggle${includeActuals ? ' active' : ''}`} onClick={() => setIncludeActuals(!includeActuals)}>Include actual dates</button>
                </>
              )}
              {kind === 'duration' && (
                <>
                  <label className="report-filter">
                    <span>How</span>
                    <select value={durMode} onChange={(e) => setDurMode(e.target.value as 'set' | 'scale')}>
                      <option value="scale">Scale (% of current)</option>
                      <option value="set">Set to (days)</option>
                    </select>
                  </label>
                  <label className="report-filter"><span>{durMode === 'scale' ? '%' : 'Days'}</span><input type="number" value={durValue} onChange={(e) => setDurValue(Number(e.target.value) || 0)} /></label>
                </>
              )}
              {kind === 'constraint' && (
                <>
                  <label className="report-filter">
                    <span>Constraint</span>
                    <select value={conType} onChange={(e) => setConType(e.target.value)}>
                      {CONSTRAINT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="report-filter"><span>Date</span><input type="date" value={conDate} onChange={(e) => setConDate(e.target.value)} /></label>
                </>
              )}
              {kind === 'calendar' && (
                <label className="report-filter">
                  <span>Calendar</span>
                  <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                    <option value="">—</option>
                    {model.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {kind === 'durationFrom' && (
              <div className="report-filters" style={{ alignItems: 'center' }}>
                <label className="report-filter">
                  <span>Column (in days)</span>
                  <select value={fromColumn} onChange={(e) => setFromColumn(e.target.value)}>
                    {catalog.filter((c) => c.value).sort((a, b) => Number(b.group === 'Calculated') - Number(a.group === 'Calculated')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              </div>
            )}
            {(kind === 'duration' || kind === 'durationFrom') && <div className="report-table__footnote">Only activities not started yet change; started and finished ones keep their durations.</div>}
          </Section>

          <Section title="3. Preview">
            <Tiles tiles={[
              { value: plan.picked, label: 'Activities picked' },
              { value: plan.changes.length, label: 'Would change', color: plan.changes.length ? 'var(--bar-normal)' : undefined },
            ]} />
            <div className="report-filters" style={{ alignItems: 'center' }}>
              <button type="button" className="report-toggle active" disabled={plan.changes.length === 0} onClick={apply}>Apply to {plan.changes.length} activities</button>
              <button type="button" className="report-toggle" disabled={!undo} onClick={revert}>Undo the last edit</button>
              <button type="button" className="report-toggle" disabled={editCount === 0} onClick={resetAll}>Reset all edits ({editCount})</button>
              {message && <span className="report-filters__summary">{message}</span>}
            </div>
            <div className="report-table">
              <div className="report-table__scroll">
                <table>
                  <thead><tr><th>Activity ID</th><th>Activity Name</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {plan.changes.slice(0, PREVIEW_ROWS).map((c) => (
                      <tr key={c.id}>
                        <td>{c.code}</td>
                        <td><span className="report-clip" title={c.name}>{c.name}</span></td>
                        <td>{c.what}</td>
                        <td><span className="report-clip" title={c.before}>{c.before || '—'}</span></td>
                        <td><span className="report-clip" title={c.after}>{c.after || '—'}</span></td>
                      </tr>
                    ))}
                    {plan.changes.length === 0 && <tr><td colSpan={5} className="report-empty">Nothing would change.</td></tr>}
                  </tbody>
                </table>
              </div>
              {plan.changes.length > PREVIEW_ROWS && <div className="report-table__footnote">The first {PREVIEW_ROWS} of {plan.changes.length} changes; Apply changes all of them.</div>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
