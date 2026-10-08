import { useMemo, useState } from 'react';
import { setCrews, setRelations, useScenarioStore } from '../../state/scenarioStore';
import { useScheduleStore } from '../../state/scheduleStore';
import { scenarioFileName, type ScenarioCrew, type ScenarioRelation } from '../../scenarios/api';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { queryMatcher } from '../../schedule/search';
import { SuggestedGroups } from './SuggestedGroups';

/** Scenario panel > Links and Crews: the scenario's manual links and crew
    overrides, saved with it (Save / Update 4D) in the project database
    (ip_scenario_link, ip_scenario_crew). */

const REL_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
const REL_LABEL: Record<string, string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };

/** The generator names pour types upper case with underscores (config.py). */
const normType = (v: string) => v.trim().replace(/ /g, '_').toUpperCase();

/** Activities of the scenario's programme in the app (else of any programme
    for the building): what manual links can name. */
function useScenarioActivities() {
  const schedules = useScheduleStore((s) => s.schedules);
  const { scenario, stem } = useScenarioView();
  return useMemo(() => {
    if (!scenario || !stem) return { source: null, byCode: new Map<string, string>() };
    const name = scenarioFileName(stem, scenario);
    const own = schedules.find((s) => s.sourceFileName === name || s.sourceFileName === `${name}.xml`);
    const source = own ?? schedules.find((s) => s.sourceFileName.startsWith(stem)) ?? null;
    return { source, byCode: new Map((source?.activities ?? []).filter((a) => a.type !== 'wbs-summary').map((a) => [a.code, a.name])) };
  }, [schedules, scenario, stem]);
}

export function ScenarioLinksEditor() {
  const relations = useScenarioStore((s) => s.relations);
  const savedRelations = useScenarioStore((s) => s.savedRelations);
  const { source, byCode } = useScenarioActivities();
  const [filter, setFilter] = useState('');
  const codes = useMemo(() => [...byCode.keys()].sort(), [byCode]);

  const update = (i: number, patch: Partial<ScenarioRelation>) => setRelations(relations.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRelations(relations.filter((_, j) => j !== i));
  const add = () => setRelations([...relations, { ActivityID1: '', ActivityID2: '', Relation: 'FS', Lag: 0 }]);
  const q = filter.trim().toLowerCase();
  const hit = queryMatcher(filter);
  const shown = relations
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || hit(`${r.ActivityID1} ${r.ActivityID2} ${byCode.get(r.ActivityID1) ?? ''} ${byCode.get(r.ActivityID2) ?? ''}`));
  const unknown = (code: string) => !!code && byCode.size > 0 && !byCode.has(code);

  return (
    <div className="scn-editor">
      <SuggestedGroups source={source} />
      <section className="scn-card">
        <div className="scn-card__title">
          Manual links
          {relations !== savedRelations && <span className="scn-chip scn-chip--warn">unsaved</span>}
        </div>
        <p className="scn-dim scn-editor__help">
          A link replaces the generated links into its successor. Activities are named by their ID in the generated programme; lag is in working hours (8 h = 1 day).
          {source ? ` IDs are checked against "${source.sourceFileName}".` : ' Update 4D once to check the IDs against the generated programme.'}
        </p>
        {relations.length > 6 && <input className="scn-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter links…" />}
        <datalist id="scn-activity-codes">
          {codes.map((c) => (
            <option key={c} value={c}>{byCode.get(c)}</option>
          ))}
        </datalist>
        {relations.length === 0 && <div className="scn-dim">No manual links — the generator's own logic applies throughout.</div>}
        {shown.map(({ r, i }) => (
          <div key={i} className="scn-link">
            <div className="scn-link__row">
              <input
                className={unknown(r.ActivityID1) ? 'is-unknown' : undefined}
                list="scn-activity-codes"
                value={r.ActivityID1}
                onChange={(e) => update(i, { ActivityID1: e.target.value.trim() })}
                placeholder="Predecessor ID"
                title={byCode.get(r.ActivityID1) ?? (unknown(r.ActivityID1) ? 'Not in the generated programme' : 'Predecessor activity ID')}
              />
              <select value={REL_TYPES.includes(r.Relation as (typeof REL_TYPES)[number]) ? r.Relation : 'FS'} onChange={(e) => update(i, { Relation: e.target.value })} title={REL_LABEL[r.Relation]}>
                {REL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                className={unknown(r.ActivityID2) ? 'is-unknown' : undefined}
                list="scn-activity-codes"
                value={r.ActivityID2}
                onChange={(e) => update(i, { ActivityID2: e.target.value.trim() })}
                placeholder="Successor ID"
                title={byCode.get(r.ActivityID2) ?? (unknown(r.ActivityID2) ? 'Not in the generated programme' : 'Successor activity ID')}
              />
              <input
                className="scn-link__lag"
                type="number"
                step="1"
                value={r.Lag}
                onChange={(e) => update(i, { Lag: Number(e.target.value) || 0 })}
                title="Lag, working hours (negative = lead)"
                aria-label="Lag (hours)"
              />
              <button type="button" className="mini-btn danger" onClick={() => remove(i)} title="Delete this link" aria-label="Delete link">✕</button>
            </div>
            {(byCode.has(r.ActivityID1) || byCode.has(r.ActivityID2)) && (
              <div className="scn-link__names scn-dim">
                {byCode.get(r.ActivityID1) ?? '?'} → {byCode.get(r.ActivityID2) ?? '?'}
              </div>
            )}
          </div>
        ))}
        <div className="scn-row">
          <button type="button" className="btn" onClick={add}>Add link</button>
        </div>
      </section>
    </div>
  );
}

export function ScenarioCrewsEditor() {
  const crews = useScenarioStore((s) => s.crews);
  const savedCrews = useScenarioStore((s) => s.savedCrews);
  const options = useScenarioStore((s) => s.crewOptions);
  const { loaded, rows } = useScenarioView();
  const trades = options?.trades ?? [];
  const phases = options?.phases ?? [];
  const tradeName = useMemo(() => new Map(trades.map((t) => [t.code, t.name])), [trades]);
  const defaults = useMemo(() => new Map((options?.defaultCrews ?? []).map((d) => [d.key, d.crews])), [options]);
  const pourTypes = useMemo(() => {
    const col = loaded ? loaded.headers.indexOf('Pour Type') : -1;
    return col < 0 ? [] : [...new Set(rows.map((r) => normType(r.cells[col] ?? '')).filter(Boolean))].sort();
  }, [loaded, rows]);

  const crewText = (list: [string, number][] | undefined) => (list?.length ? list.map(([t, n]) => `${t} ${n}`).join(', ') : 'no labour');
  const defaultFor = (phase: string, pourType: string) => {
    const pt = normType(pourType);
    return defaults.get(pt ? `${phase}|${pt}` : phase) ?? defaults.get(phase);
  };
  const update = (i: number, patch: Partial<ScenarioCrew>) => setCrews(crews.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => setCrews(crews.filter((_, j) => j !== i));
  const add = () => setCrews([...crews, { Phase: phases[0] ?? '', PourType: '', Trade: trades[0]?.code ?? '', Crew: '1' }]);
  /** Starts an override from the defaults for that phase / pour type. */
  const customise = (key: string) => {
    const [phase, pourType = ''] = key.split('|');
    const list = defaults.get(key) ?? [];
    const rest = crews.filter((c) => !(c.Phase === phase && normType(c.PourType) === pourType));
    setCrews([...rest, ...(list.length ? list.map(([t, n]) => ({ Phase: phase, PourType: pourType, Trade: t, Crew: String(n) })) : [{ Phase: phase, PourType: pourType, Trade: trades[0]?.code ?? '', Crew: '0' }])]);
  };

  // Which keys the scenario overrides (every row of a key replaces all its defaults).
  const overridden = new Set(crews.map((c) => (normType(c.PourType) ? `${c.Phase}|${normType(c.PourType)}` : c.Phase)));

  return (
    <div className="scn-editor">
      <section className="scn-card">
        <div className="scn-card__title">
          Crews
          {crews !== savedCrews && <span className="scn-chip scn-chip--warn">unsaved</span>}
        </div>
        <p className="scn-dim scn-editor__help">
          People per day on each activity of a phase. The rows for a phase (or a phase and pour type) replace all of its default crews; 0 people = none of that trade.
        </p>
        {!options && <div className="scn-dim">Load a scenario to edit its crews.</div>}
        {crews.length === 0 && options && <div className="scn-dim">No overrides — every phase uses its default crew (below).</div>}
        {crews.length > 0 && (
          <table className="scn-crews">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Type</th>
                <th>Trade</th>
                <th className="scn-num">People</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {crews.map((c, i) => (
                <tr key={i} title={`Default: ${crewText(defaultFor(c.Phase, c.PourType))}`}>
                  <td>
                    <select value={c.Phase} onChange={(e) => update(i, { Phase: e.target.value })}>
                      {!phases.includes(c.Phase) && <option value={c.Phase}>{c.Phase || '—'}</option>}
                      {phases.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={normType(c.PourType)} onChange={(e) => update(i, { PourType: e.target.value })}>
                      <option value="">All</option>
                      {normType(c.PourType) && !pourTypes.includes(normType(c.PourType)) && <option value={normType(c.PourType)}>{normType(c.PourType)}</option>}
                      {pourTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={c.Trade} onChange={(e) => update(i, { Trade: e.target.value })}>
                      {!tradeName.has(c.Trade) && <option value={c.Trade}>{c.Trade || '—'}</option>}
                      {trades.map((t) => (
                        <option key={t.code} value={t.code}>{t.code} — {t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="scn-num">
                    <input type="number" min={0} step={1} value={c.Crew} onChange={(e) => update(i, { Crew: e.target.value })} aria-label="People" />
                  </td>
                  <td>
                    <button type="button" className="mini-btn danger" onClick={() => remove(i)} title="Delete this row" aria-label="Delete crew row">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="scn-row">
          <button type="button" className="btn" disabled={!options} onClick={add}>Add crew row</button>
        </div>
      </section>

      {options && (
        <section className="scn-card">
          <div className="scn-card__title">Default crews</div>
          <p className="scn-dim scn-editor__help">From the generator (scenario-engine/config.py). Customise copies a phase's defaults into the scenario to change them.</p>
          <table className="scn-crews scn-crews--defaults">
            <tbody>
              {[...defaults.entries()].map(([key, list]) => (
                <tr key={key} className={overridden.has(key) ? 'is-overridden' : undefined}>
                  <td>{key.replace('|', ' · ')}</td>
                  <td>{crewText(list)}</td>
                  <td>
                    {overridden.has(key) ? (
                      <span className="scn-chip">customised</span>
                    ) : (
                      <button type="button" className="mini-btn" onClick={() => customise(key)}>Customise</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.length > 0 && (
            <div className="scn-dim scn-editor__help">
              Trades: {trades.map((t) => `${t.code} ${t.name}${t.capacity ? ` (${t.capacity}/day on site)` : ''}`).join(' · ')}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
