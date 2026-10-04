import { useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { DEFAULT_ANONYMISE, anonymise, type AnonymiseOptions } from '../../schedule/anonymise';
import { exportScheduleXlsx } from '../../schedule/exportXlsx';
import { useScheduleStore } from '../../state/scheduleStore';
import { usePersistedState } from '../../utils/persistedState';
import { Section, Tiles } from '../reports/ReportParts';

const CHOICES: { key: keyof Omit<AnonymiseOptions, 'shiftDays'>; label: string; hint: string }[] = [
  { key: 'activities', label: 'Activity IDs and names', hint: 'A00010, A00020… and "Activity 0001…" — equal names stay equal.' },
  { key: 'wbs', label: 'WBS names and codes', hint: 'The tree keeps its shape; every name becomes "WBS 001…".' },
  { key: 'resources', label: 'Resource names', hint: '"Resource 01…" in assignments and the resource list.' },
  { key: 'codes', label: 'Activity code values and text fields', hint: 'Code values become "Type 01…"; text user fields "Text 001…". Numbers and dates stay.' },
  { key: 'calendars', label: 'Calendar names', hint: 'The working weeks and holidays themselves are kept.' },
  { key: 'project', label: 'Project and file name', hint: 'Both become neutral labels.' },
];

/** Programmes > Anonymise: a copy of the programme with the identifying text
    masked, to share outside the company. Add it to the app to look it over, or
    download it as an Excel workbook (activities with their predecessors, WBS,
    relationships). The programme you have loaded is not changed. */
export function AnonymiseView({ model }: { model: ScheduleModel }) {
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const [options, setOptions] = usePersistedState<AnonymiseOptions>('schedule.anonymise', DEFAULT_ANONYMISE);
  const [added, setAdded] = useState(false);
  const result = useMemo(() => anonymise(model, options), [model, options]);
  const sample = model.activities.slice(0, 8).map((a, i) => ({ before: a, after: result.model.activities[i] }));
  const set = (patch: Partial<AnonymiseOptions>) => {
    setAdded(false);
    setOptions({ ...options, ...patch });
  };

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Anonymise a programme</h2>
              <button type="button" className="checks-export-btn report-header__export" onClick={() => exportScheduleXlsx(result.model, 'anonymised-programme.xlsx')}>Download Excel</button>
              <button
                type="button"
                className="checks-export-btn report-header__export"
                disabled={added}
                onClick={() => {
                  addSchedule(result.model);
                  setAdded(true);
                }}
                title="Load the anonymised copy as another programme (hide the original in Inputs before sharing screenshots)"
              >
                {added ? 'Added to the app' : 'Add as a new programme'}
              </button>
            </div>
            <div className="report-header__desc">A masked copy of {model.project.name} for sharing outside the company · the loaded programme is not changed</div>
          </div>

          <Section title="What to mask">
            <div className="disp">
              {CHOICES.map((c) => (
                <div className="disp__row" key={c.key} title={c.hint}>
                  <span>{c.label}</span>
                  <button type="button" role="switch" aria-checked={options[c.key]} className={`switch${options[c.key] ? ' on' : ''}`} onClick={() => set({ [c.key]: !options[c.key] })}>
                    <span className="switch__thumb" />
                  </button>
                </div>
              ))}
              <div className="disp__row" title="Moves every date (including the data date and calendar holidays) by this many days, so real dates are not revealed. The logic and durations are unchanged.">
                <span>Shift all dates by (days)</span>
                <input type="number" value={options.shiftDays} style={{ width: 90 }} onChange={(e) => set({ shiftDays: Math.round(Number(e.target.value) || 0) })} />
              </div>
            </div>
          </Section>

          <Section title="Result">
            <Tiles tiles={[
              { value: result.counts.activities, label: 'Activities relabelled' },
              { value: result.counts.wbs, label: 'WBS nodes' },
              { value: result.counts.resources, label: 'Resources' },
              { value: result.counts.codeValues, label: 'Code values' },
              { value: result.counts.calendars, label: 'Calendars' },
            ]} />
            <div className="report-table">
              <div className="report-table__scroll">
                <table>
                  <thead>
                    <tr><th>Before: ID</th><th>Before: name</th><th>After: ID</th><th>After: name</th></tr>
                  </thead>
                  <tbody>
                    {sample.map(({ before, after }) => (
                      <tr key={before.id}>
                        <td>{before.code}</td>
                        <td><span className="report-clip" title={before.name}>{before.name}</span></td>
                        <td>{after.code}</td>
                        <td>{after.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="report-table__footnote">The first rows of the programme, before and after. Check what is left before you share: free text inside dates, notes and other fields is not touched, and the activity relationships keep the original logic.</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
