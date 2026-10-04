import { useEffect, useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { TYPE_LABEL } from '../../schedule/filterFields';
import { runChecks, scoreChecks, type CheckBand, type CheckResult, type CheckSettings, type CheckSettingsMap } from '../../schedule/checks';
import { IconDownload, IconGear } from '../icons';
import { downloadCsv } from '../../utils/csv';
import { usePersistedState } from '../../utils/persistedState';
import { IconExpander } from '../icons';

interface ChecksViewProps {
  model: ScheduleModel;
  onSelectActivity: (activityId: string) => void;
}

const ROW_CAP = 100;

const BAND_BADGE: Record<CheckBand, string> = { green: 'PASS', amber: 'WARN', red: 'FAIL', info: 'INFO' };

const fmtPct = (n: number) => (n === 0 ? '0.0%' : n < 0.1 ? '<0.1%' : `${n.toFixed(1)}%`);

/** Only keep the values that differ from a check's defaults, so upgrading a
    default later still reaches checks the user never touched. */
function diffFromDefaults(next: CheckSettings, defaults: CheckSettings): Partial<CheckSettings> {
  const out: Partial<CheckSettings> = {};
  for (const k of Object.keys(defaults) as (keyof CheckSettings)[]) {
    if (next[k] !== defaults[k]) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

export function ChecksView({ model, onSelectActivity }: ChecksViewProps) {
  const [overrides, setOverrides] = usePersistedState<CheckSettingsMap>('schedule.checkSettings', {});
  const results = useMemo(() => runChecks(model, overrides), [model, overrides]);
  const [dcmaExpanded, setDcmaExpanded] = useState(true);
  const [additionalExpanded, setAdditionalExpanded] = useState(true);
  const [settingsFor, setSettingsFor] = useState<{ id: string; top: number } | null>(null);

  const all = useMemo(() => [...results.dcma, ...results.additional], [results]);
  const score = useMemo(() => scoreChecks(all), [all]);
  const editing = settingsFor ? all.find((r) => r.id === settingsFor.id) ?? null : null;

  const patch = (id: string, next: Partial<CheckSettings>) =>
    setOverrides((prev) => {
      const merged = { ...prev, [id]: next };
      if (Object.keys(next).length === 0) delete merged[id];
      return merged;
    });

  const handleExportAll = () => {
    downloadCsv(
      'quality-checks.csv',
      ['Category', 'Check', 'Result', 'Points', 'Count', 'Total', 'Activity ID', 'Name', 'Type'],
      all.flatMap((r) => {
        const result = !r.settings.enabled ? 'off' : r.info ? 'info' : `${BAND_BADGE[r.band]} ${fmtPct(r.pct ?? 0)}`;
        const head = [r.category, r.name, result, r.info ? '' : `${r.points}/${r.maxPoints}`, r.count ?? '', r.total ?? ''];
        if (r.activities.length === 0) return [[...head, '', '', '']];
        return r.activities.map((a) => [...head, a.code || a.id, a.name, TYPE_LABEL[a.type]]);
      }),
    );
  };

  const renderRows = (list: CheckResult[]) =>
    list.map((r) => (
      <CheckRow
        key={r.id}
        result={r}
        onSelectActivity={onSelectActivity}
        onToggle={() => patch(r.id, diffFromDefaults({ ...r.settings, enabled: !r.settings.enabled }, r.defaults))}
        onOpenSettings={(top) => setSettingsFor({ id: r.id, top })}
      />
    ));

  return (
    <div className="checks-view">
      <div className="checks-view__summary">
        <div className="checks-view__score">
          <span className="checks-view__score-value">{score.points}</span>
          <span className="checks-view__score-max"> / {score.maxPoints} pts</span>
          <span className="checks-view__score-pct">{score.pct.toFixed(0)}%</span>
        </div>
        <div className="checks-view__chips">
          <span className="check-badge check-badge--green">{score.green} PASS</span>
          <span className="check-badge check-badge--amber">{score.amber} WARN</span>
          <span className="check-badge check-badge--red">{score.red} FAIL</span>
        </div>
        <div className="checks-view__actions">
          {Object.keys(overrides).length > 0 && (
            <button className="btn btn--small" type="button" onClick={() => setOverrides({})}>Reset all settings</button>
          )}
          <button className="checks-export-btn" type="button" onClick={handleExportAll}>
            <IconDownload />
            Export all (CSV)
          </button>
        </div>
      </div>

      <div className="checks-view__body">
        <SectionHeader title="DCMA 14-Point Assessment" expanded={dcmaExpanded} onToggle={() => setDcmaExpanded((v) => !v)} />
        {dcmaExpanded && renderRows(results.dcma)}
        <SectionHeader title="Additional Checks" expanded={additionalExpanded} onToggle={() => setAdditionalExpanded((v) => !v)} />
        {additionalExpanded && renderRows(results.additional)}
      </div>

      {editing && settingsFor && (
        <SettingsPopover
          key={editing.id}
          result={editing}
          top={settingsFor.top}
          onClose={() => setSettingsFor(null)}
          onApply={(next) => {
            patch(editing.id, diffFromDefaults(next, editing.defaults));
            setSettingsFor(null);
          }}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div
      className="checks-section__header"
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span>{title}</span>
      <span className="check-item__toggle"><IconExpander open={expanded} /></span>
    </div>
  );
}

function Ring({ pct, band, off }: { pct: number | null; band: CheckBand; off: boolean }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const shown = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className={`check-ring check-ring--${off ? 'info' : band}`}>
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="check-ring__track" />
        {pct !== null && !off && (
          <circle
            cx="18" cy="18" r={r} className="check-ring__value"
            strokeDasharray={`${Math.max((shown / 100) * c, band === 'green' ? 0 : 2)} ${c}`}
            transform="rotate(-90 18 18)"
          />
        )}
      </svg>
      <span className="check-ring__label">{pct === null || off ? '—' : fmtPct(pct)}</span>
    </div>
  );
}

interface CheckRowProps {
  result: CheckResult;
  onSelectActivity: (id: string) => void;
  onToggle: () => void;
  onOpenSettings: (top: number) => void;
}

function CheckRow({ result: r, onSelectActivity, onToggle, onOpenSettings }: CheckRowProps) {
  const [expanded, setExpanded] = useState(false);
  const off = !r.settings.enabled;
  const showDetail = expanded && !off;
  const shown = r.activities.slice(0, ROW_CAP);
  const toggleExpanded = () => { if (!off) setExpanded((v) => !v); };

  return (
    <div className={`check-item check-item--${off ? 'off' : r.band}${showDetail ? ' is-expanded' : ''}`}>
      <div
        className="check-item__row"
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <span className="check-item__idx">{r.num ?? '+'}</span>
        <Ring pct={r.pct} band={r.band} off={off} />
        <div className="check-item__main">
          <div className="check-item__title">
            <span className="check-item__toggle"><IconExpander open={showDetail} /></span>
            {r.name}
          </div>
          {!off && !r.info && r.band !== 'green' && (
            <div className="check-item__lines">
              <span className="check-item__risk" title={r.risk}>⚠ {r.risk}</span>
              <span className="check-item__action" title={r.action}>→ {r.action}</span>
            </div>
          )}
          {!off && r.info && <div className="check-item__lines"><span className="check-item__action">{r.description}</span></div>}
          {off && <div className="check-item__lines"><span className="check-item__action">Check switched off — not scored.</span></div>}
        </div>
        <span className="check-item__num check-item__num--total">{r.total ?? '—'}</span>
        <span className={`check-item__num check-item__num--flagged check-item__num--${r.band}`}>{r.count ?? '—'}</span>
        <span className={`check-badge check-badge--${off ? 'info' : r.band}`}>{off ? 'OFF' : BAND_BADGE[r.band]}</span>
        <span className="check-item__points">{off || r.info ? 'N/A' : `${r.points}/${r.maxPoints}`}</span>
        <label className="check-switch" onClick={(e) => e.stopPropagation()} title={off ? 'Switch check on' : 'Switch check off'}>
          <input type="checkbox" checked={!off} onChange={onToggle} aria-label={`Enable ${r.name}`} />
          <span className="check-switch__track" />
        </label>
        <button
          className="icon-btn check-item__gear"
          type="button"
          title="Check settings"
          aria-label={`Settings for ${r.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings(e.currentTarget.getBoundingClientRect().top);
          }}
        >
          <IconGear />
        </button>
      </div>

      {showDetail && (
        <div className="check-item__detail">
          <div className="check-item__description">{r.description}</div>
          {r.activities.length > 0 && (
            <>
              <div className="check-item__showing">
                Showing {shown.length} of {r.activities.length} items
              </div>
              <div className="check-item__table-wrap">
                <table className="check-item__table">
                  <thead>
                    <tr>
                      <th>Activity ID</th>
                      <th>Activity Name</th>
                      <th>Activity Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => (
                      <tr key={a.id} onClick={() => onSelectActivity(a.id)} title="Show in Table View">
                        <td>{a.code || a.id}</td>
                        <td>{a.name}</td>
                        <td>{TYPE_LABEL[a.type]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!r.info && r.band !== 'green' && (
            <div className="check-item__callout">
              <div className="check-item__callout-label check-item__callout-label--risk">⚠ Risk</div>
              <div>{r.risk}</div>
              <div className="check-item__callout-label check-item__callout-label--action">→ Recommended action</div>
              <div>{r.action}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`check-onoff${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}>
      {on ? 'On' : 'Off'}
    </button>
  );
}

const num = (v: string, fallback: number) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function SettingsPopover({ result: r, top, onClose, onApply }: { result: CheckResult; top: number; onClose: () => void; onApply: (s: CheckSettings) => void }) {
  const [draft, setDraft] = useState<CheckSettings>(r.settings);
  const set = <K extends keyof CheckSettings>(k: K, v: CheckSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canScore = !r.baseline;
  return (
    <>
      <div className="check-pop-backdrop" onClick={onClose} />
      <div className="check-pop" style={{ top: Math.max(8, Math.min(top - 8, window.innerHeight - 560)) }} role="dialog" aria-label={`Check ${r.num ?? r.id} settings`}>
        <div className="check-pop__header">
          <span>{r.num !== null ? `Check ${r.num}` : r.name} — Settings</span>
          <button className="icon-btn" type="button" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="check-pop__body">
          {r.scoped && (
            <>
              <div className="check-pop__section">Filters <small>task scope</small></div>
              <div className="check-pop__row"><span>Include Level of Effort tasks</span><Toggle on={draft.includeLoe} onChange={(v) => set('includeLoe', v)} /></div>
              <div className="check-pop__row"><span>Include WBS Summary tasks</span><Toggle on={draft.includeSummary} onChange={(v) => set('includeSummary', v)} /></div>
              <div className="check-pop__row"><span>Include Milestone tasks</span><Toggle on={draft.includeMilestones} onChange={(v) => set('includeMilestones', v)} /></div>
              <div className="check-pop__row"><span>Exclude Completed Tasks</span><Toggle on={draft.excludeCompleted} onChange={(v) => set('excludeCompleted', v)} /></div>
              <div className="check-pop__row">
                <span>Exclude by Activity Name</span>
                <input className="check-pop__text" placeholder="text to exclude" value={draft.excludeName} onChange={(e) => set('excludeName', e.target.value)} />
              </div>
            </>
          )}
          {canScore && (
            <>
              <div className="check-pop__section">Thresholds <small>% flagged</small></div>
              <div className="check-pop__row">
                <span><i className="check-dot check-dot--green" />Green if % &lt;</span>
                <span className="check-pop__num"><input type="number" min={0} step="any" value={draft.greenBelowPct} onChange={(e) => set('greenBelowPct', num(e.target.value, draft.greenBelowPct))} />%</span>
              </div>
              <div className="check-pop__row">
                <span><i className="check-dot check-dot--amber" />Amber if % &lt;</span>
                <span className="check-pop__num"><input type="number" min={0} step="any" value={draft.amberBelowPct} onChange={(e) => set('amberBelowPct', num(e.target.value, draft.amberBelowPct))} />%</span>
              </div>
              <div className="check-pop__hint"><i className="check-dot check-dot--red" />Red: ≥ amber threshold (auto)</div>
              <div className="check-pop__section">Scoring <small>points awarded</small></div>
              <div className="check-pop__row">
                <span><i className="check-dot check-dot--green" />Green</span>
                <span className="check-pop__num"><input type="number" min={0} step="any" value={draft.greenPts} onChange={(e) => set('greenPts', num(e.target.value, draft.greenPts))} />pts</span>
              </div>
              <div className="check-pop__row">
                <span><i className="check-dot check-dot--amber" />Amber</span>
                <span className="check-pop__num"><input type="number" min={0} step="any" value={draft.amberPts} onChange={(e) => set('amberPts', num(e.target.value, draft.amberPts))} />pts</span>
              </div>
              <div className="check-pop__hint"><i className="check-dot check-dot--red" />Red: always 0 pts</div>
            </>
          )}
          {!canScore && <div className="check-pop__hint">This check needs a baseline schedule and has no settings.</div>}
        </div>
        <div className="check-pop__footer">
          <button className="btn btn--small" type="button" onClick={() => setDraft({ ...r.defaults, enabled: draft.enabled })}>Reset to defaults</button>
          <button className="check-pop__apply" type="button" onClick={() => onApply(draft)}>Apply</button>
        </div>
      </div>
    </>
  );
}
