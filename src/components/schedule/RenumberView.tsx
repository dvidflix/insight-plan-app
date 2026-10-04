import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { DEFAULT_RENUMBER, planRenumber, parsePourMap, usableEntries, type RenumberOptions } from '../../schedule/renumber';
import { useScheduleStore, useVisibleSchedules } from '../../state/scheduleStore';
import { usePourMapStore } from '../../state/pourMapStore';
import { usePersistedState } from '../../utils/persistedState';
import { downloadCsv } from '../../utils/csv';
import { Section, Tiles } from '../reports/ReportParts';

const PREVIEW_ROWS = 100;

/** Programmes > Renumber: carries the programme over to a new version of the
    model whose Pour IDs differ. The old → new Pour IDs come from the model
    comparison (Models > Compare models) or a file; every Activity ID, name,
    user field and WBS name holding an old Pour ID gets the new one — logic,
    dates and links stay as they are. The edit is kept in the app, with one
    click to undo. */
export function RenumberView({ model }: { model: ScheduleModel }) {
  const visible = useVisibleSchedules();
  const patchActivities = useScheduleStore((s) => s.patchActivities);
  const restoreActivities = useScheduleStore((s) => s.restoreActivities);
  const entries = usePourMapStore((s) => s.entries);
  const setEntries = usePourMapStore((s) => s.setEntries);
  const [opts, setOpts] = usePersistedState<RenumberOptions>('schedule.renumberOptions', DEFAULT_RENUMBER);
  const [undo, setUndo] = useState<Map<string, Activity[]> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const plan = useMemo(() => planRenumber(model.activities, entries, opts), [model.activities, entries, opts]);
  const usable = useMemo(() => usableEntries(entries), [entries]);
  const shownEntries = entries.map((e, i) => ({ e, i })).filter(({ e }) => !filter || `${e.oldPour} ${e.newPour}`.toLowerCase().includes(filter.toLowerCase()));

  /** A row of the (possibly combined) display model back to its programme and own id. */
  const originOf = (displayId: string): { scheduleId: string; id: string } | null => {
    if (visible.length === 1) return { scheduleId: visible[0].id, id: displayId };
    const s = visible.find((v) => displayId.startsWith(`${v.id}:`));
    return s ? { scheduleId: s.id, id: displayId.slice(s.id.length + 1) } : null;
  };

  const apply = () => {
    const bySchedule = new Map<string, Map<string, Partial<Activity>>>();
    for (const c of plan.changes) {
      const o = originOf(c.id);
      if (!o) continue;
      (bySchedule.get(o.scheduleId) ?? bySchedule.set(o.scheduleId, new Map()).get(o.scheduleId)!).set(o.id, c.patch);
    }
    // Remember the activities as they are now, to undo.
    setUndo(new Map([...bySchedule.keys()].map((id) => [id, visible.find((v) => v.id === id)!.activities])));
    patchActivities(bySchedule);
    setMessage(`Renumbered ${plan.changes.length} activities. Undo puts them back.`);
  };
  const revert = () => {
    if (!undo) return;
    restoreActivities(undo);
    setUndo(null);
    setMessage('Back as it was before the renumbering.');
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parsePourMap(await file.text());
    setEntries(parsed);
    setMessage(`Read ${parsed.length} Pour ID pairs from ${file.name}.`);
  };
  const flag = (key: keyof RenumberOptions, label: string) => (
    <label className="cols__check" style={{ margin: 0 }}>
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Renumber to a new model</h2>
            </div>
            <div className="report-header__desc">
              Keeps this programme and gives it the new model's Pour IDs — in Activity IDs, names, user fields and WBS names · edits stay in the app, a programme from the project database is not written back · {model.project.name}
            </div>
          </div>

          <Section title="1. Old → new Pour IDs">
            <div className="report-filters" style={{ alignItems: 'center' }}>
              <span className="report-filters__summary">
                {entries.length === 0
                  ? 'None yet — compare the old and new model in Models › Compare models and choose “Use for the programme”, or load a file.'
                  : `${usable.length} to change${entries.length !== usable.length ? ` (${entries.length - usable.length} blank or unchanged)` : ''}`}
              </span>
              <label className="report-toggle" style={{ cursor: 'pointer' }}>
                Load a CSV…
                <input type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button type="button" className="report-toggle" onClick={() => setEntries([...entries, { oldPour: '', newPour: '' }])}>+ Add pair</button>
              <button type="button" className="report-toggle" disabled={!entries.length} onClick={() => downloadCsv('pour-id-map.csv', ['Old Pour ID', 'New Pour ID'], entries.map((e) => [e.oldPour, e.newPour]))}>Export CSV</button>
              <button type="button" className="report-toggle" disabled={!entries.length} onClick={() => setEntries([])}>Clear</button>
              {entries.length > 12 && <input type="search" placeholder="Filter pairs…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
            </div>
            {entries.length > 0 && (
              <div className="report-table">
                <div className="report-table__scroll" style={{ maxHeight: 260 }}>
                  <table>
                    <thead><tr><th>Old Pour ID</th><th>New Pour ID</th><th style={{ width: 40 }} /></tr></thead>
                    <tbody>
                      {shownEntries.slice(0, 300).map(({ e, i }) => (
                        <tr key={i}>
                          <td><input type="text" value={e.oldPour} onChange={(ev) => setEntries(entries.map((x, k) => (k === i ? { ...x, oldPour: ev.target.value } : x)))} /></td>
                          <td><input type="text" value={e.newPour} onChange={(ev) => setEntries(entries.map((x, k) => (k === i ? { ...x, newPour: ev.target.value } : x)))} /></td>
                          <td><button type="button" className="report-toggle" aria-label="Remove the pair" onClick={() => setEntries(entries.filter((_, k) => k !== i))}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shownEntries.length > 300 && <div className="report-table__footnote">The first 300 of {shownEntries.length} pairs; all of them are used.</div>}
              </div>
            )}
          </Section>

          <Section title="2. What to renumber">
            <div className="report-filters" style={{ alignItems: 'center' }}>
              {flag('code', 'Activity IDs')}
              {flag('name', 'Activity names')}
              {flag('udf', 'User fields')}
              {flag('wbs', 'WBS names')}
            </div>
            <div className="report-table__footnote">Numbers are read as four-digit Pour IDs (16 → 0016) and only whole numbers are replaced, so 0016 is never changed inside 00160. Pours swapping numbers swap correctly.</div>
          </Section>

          <Section title="3. Preview">
            <Tiles tiles={[
              { value: usable.length, label: 'Pour IDs to change' },
              { value: plan.changes.length, label: 'Activities would change', color: plan.changes.length ? 'var(--bar-normal)' : undefined },
              { value: plan.unused.length, label: 'Pour IDs not in this programme', color: plan.unused.length ? 'var(--text-dim)' : undefined },
              { value: plan.duplicates.length, label: 'Duplicate Activity IDs', color: plan.duplicates.length ? 'var(--danger)' : undefined },
            ]} />
            {plan.duplicates.length > 0 && (
              <div className="report-table__footnote" style={{ color: 'var(--danger)' }}>
                These Activity IDs would belong to more than one activity — check the map: {plan.duplicates.slice(0, 8).join(', ')}{plan.duplicates.length > 8 ? '…' : ''}
              </div>
            )}
            {plan.unused.length > 0 && (
              <div className="report-table__footnote" title={plan.unused.join(', ')}>
                Not found in any activity: {plan.unused.slice(0, 12).join(', ')}{plan.unused.length > 12 ? ` … (+${plan.unused.length - 12})` : ''}
              </div>
            )}
            <div className="report-filters" style={{ alignItems: 'center' }}>
              <button type="button" className="report-toggle active" disabled={plan.changes.length === 0} onClick={apply}>Renumber {plan.changes.length} activities</button>
              <button type="button" className="report-toggle" disabled={!undo} onClick={revert}>Undo the last renumbering</button>
              {message && <span className="report-filters__summary">{message}</span>}
            </div>
            <div className="report-table">
              <div className="report-table__scroll">
                <table>
                  <thead><tr><th>Activity</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {plan.changes.slice(0, PREVIEW_ROWS).flatMap((c) =>
                      c.fields.map((f, k) => (
                        <tr key={`${c.id}:${f.field}`}>
                          <td>{k === 0 ? c.code : ''}</td>
                          <td>{f.field}</td>
                          <td><span className="report-clip" title={f.before}>{f.before}</span></td>
                          <td><span className="report-clip" title={f.after}>{f.after}</span></td>
                        </tr>
                      )),
                    )}
                    {plan.changes.length === 0 && <tr><td colSpan={4} className="report-empty">{usable.length ? 'No activity carries these Pour IDs.' : 'Nothing to renumber yet.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              {plan.changes.length > PREVIEW_ROWS && <div className="report-table__footnote">The first {PREVIEW_ROWS} of {plan.changes.length} activities; Renumber changes all of them.</div>}
            </div>
            <div className="report-table__footnote">Pours that only exist in the new model have no activities yet: generate them in Scenarios from the new model.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
