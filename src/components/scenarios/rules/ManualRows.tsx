import { useMemo, useState } from 'react';
import { setCrews, setExtras, setRelations, useScenarioStore } from '../../../state/scenarioStore';
import type { ScenarioCrew, ScenarioExtra, ScenarioRelation } from '../../../scenarios/api';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import type { ExtraTag } from '../../../prs/rules';
import { EXTRA_KINDS, extrasToTsv, parseExtrasPaste, patchTags, type ExtraKind } from '../../../prs/extrasTable';
import { IconCopy, IconTrash } from '../../icons';
import { Field, RuleCard, useTrades, type RuleContext } from './RuleParts';

/** Rule types Extra activity, Manual link and Crew override: the parts of a scenario that are saved in their own tables
    (ip_scenario_extra, ip_scenario_link, ip_scenario_crew) rather than in the rules document. */

const REL_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
const REL_LABEL: Record<string, string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };
const dateOk = (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The generator names types upper case with underscores (config.py). */
const normType = (v: string) => v.trim().replace(/ /g, '_').toUpperCase();

// ---------------------------------------------------------------- extra activities

export const addExtra = () => {
  const extras = useScenarioStore.getState().extras;
  setExtras([...extras, { TaskID: `HLP-${String(extras.length + 1).padStart(4, '0')}`, Name: '', DurationDays: 0, BaselineStart: '', BaselineFinish: '' }]);
};

/** The WBS choices of a row, and what a bulk change to them sets. */
const WBS_OPTIONS = [
  { value: 'default', label: 'Extra activities folder' },
  { value: 'level', label: 'On its level' },
  { value: 'slabs', label: "In its level's Slabs" },
  { value: 'path', label: 'A folder of its own…' },
];
const wbsChoice = (wbs: string | undefined) => (!wbs ? 'default' : wbs === 'level' || wbs === 'slabs' ? wbs : 'path');
const wbsFromChoice = (choice: string) => (choice === 'default' ? '' : choice === 'path' ? 'path:' : choice);

/** All the extra activities as one table, to edit them together: tick rows and change a field for all of them at once, paste a block from a
    spreadsheet (or copy the table to one), add rows. What each one is (task, milestone, WBS summary ...), where it goes in the WBS and which
    level task it is tied to are kept in the rules, by its ID. */
export function ExtrasTableCard({ ctx, byCode }: { ctx: RuleContext; byCode: Map<string, string> }) {
  const extras = useScenarioStore((s) => s.extras);
  const tags = ctx.rules.extraTags;
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [days, setDays] = useState('');
  const seen = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of extras) m.set(e.TaskID.trim().toUpperCase(), (m.get(e.TaskID.trim().toUpperCase()) ?? 0) + 1);
    return m;
  }, [extras]);

  const q = filter.trim().toLowerCase();
  const shown = extras.map((e, i) => ({ e, i })).filter(({ e }) => !q || `${e.TaskID} ${e.Name} ${tags[e.TaskID]?.building ?? ''} ${tags[e.TaskID]?.level ?? ''}`.toLowerCase().includes(q));
  const ids = (list: number[]) => list.map((i) => extras[i]?.TaskID).filter(Boolean) as string[];
  const chosen = [...picked].filter((i) => i < extras.length);
  const allShown = shown.length > 0 && shown.every(({ i }) => picked.has(i));

  const setTags = (idList: string[], patch: Partial<ExtraTag>) => ctx.change((r) => ({ ...r, extraTags: patchTags(r.extraTags, idList, patch) }));
  const editRow = (i: number, patch: Partial<ScenarioExtra>) => {
    const was = extras[i].TaskID;
    setExtras(extras.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    if (patch.TaskID !== undefined && patch.TaskID !== was && tags[was]) {
      ctx.change((r) => {
        const next = { ...r.extraTags, [patch.TaskID as string]: r.extraTags[was] };
        delete next[was];
        return { ...r, extraTags: next };
      });
    }
  };
  const remove = (list: number[]) => {
    const gone = new Set(list);
    const goneIds = ids(list);
    setExtras(extras.filter((_, j) => !gone.has(j)));
    ctx.change((r) => {
      const next = { ...r.extraTags };
      for (const id of goneIds) delete next[id];
      return { ...r, extraTags: next };
    });
    setPicked(new Set());
  };
  const duplicate = (list: number[]) => {
    const copies = list.map((i) => ({ ...extras[i], TaskID: `${extras[i].TaskID}-2` }));
    setExtras([...extras, ...copies]);
    ctx.change((r) => {
      const next = { ...r.extraTags };
      for (const c of copies) {
        const original = c.TaskID.slice(0, -2);
        if (r.extraTags[original]) next[c.TaskID] = { ...r.extraTags[original] };
      }
      return { ...r, extraTags: next };
    });
  };
  const importPaste = () => {
    const parsed = parseExtrasPaste(paste ?? '');
    if (parsed.extras.length) {
      const incoming = new Set(parsed.extras.map((r) => r.TaskID.toUpperCase()));
      setExtras([...extras.filter((e) => !incoming.has(e.TaskID.toUpperCase())), ...parsed.extras]);
      ctx.change((r) => {
        let next = r.extraTags;
        for (const [id, tag] of Object.entries(parsed.tags)) next = patchTags(next, [id], tag);
        return { ...r, extraTags: next };
      });
    }
    setPaste(null);
  };
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(extrasToTsv(extras, tags));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setPaste(extrasToTsv(extras, tags)); // no clipboard: show the text to copy by hand
    }
  };
  const problem = (e: ScenarioExtra): string | null => {
    const id = e.TaskID.trim();
    if (!id) return 'An ID is needed';
    if ((seen.get(id.toUpperCase()) ?? 0) > 1) return 'This ID is used twice';
    // (after a generation the programme holds the extras themselves, with the same names)
    if (byCode.has(id) && byCode.get(id) !== e.Name) return 'The generated programme already has an activity with this ID and another name; the extra is skipped';
    if (!dateOk(e.BaselineStart) || !dateOk(e.BaselineFinish)) return 'Dates are year-month-day';
    return null;
  };
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const tasks = ctx.rules.levelTasks;
  const bulkIds = ids(chosen);
  const bulk = (patch: Partial<ExtraTag>) => setTags(bulkIds, patch);
  const selectStyle = { minWidth: 0 } as const;

  return (
    <RuleCard
      kind="extra"
      id=""
      enabled
      onDelete={() => { if (!extras.length || window.confirm(`Delete all ${extras.length} extra activities?`)) remove(extras.map((_, i) => i)); }}
      summary={`${extras.length} activit${extras.length === 1 ? 'y' : 'ies'}${extras.filter((e) => tags[e.TaskID]?.wbs).length ? `, ${extras.filter((e) => tags[e.TaskID]?.wbs).length} placed in the WBS` : ''}`}
    >
      <datalist id="rule-extra-buildings">{ctx.buildings.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="rule-extra-levels">{ctx.levels.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="rule-extras__bar">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label="Filter the extra activities" />
        <button type="button" className="btn btn--small" onClick={() => { addExtra(); }}>+ Add</button>
        <button type="button" className="btn btn--small" onClick={() => setPaste(paste === null ? '' : null)} title="Paste rows from a spreadsheet: ID, Name, Days, Baseline start, Baseline finish, and optionally Type, Building, Level, WBS, Level task">Paste from Excel…</button>
        <button type="button" className="btn btn--small" onClick={() => void copyAll()} title="Copy the table to paste it into a spreadsheet, change it there and paste it back (rows with the same ID are replaced)">{copied ? 'Copied' : 'Copy for Excel'}</button>
      </div>
      {paste !== null && (
        <div className="scn-extras__paste">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={'SZC-1HDAB-C-L1-W50\t1HDAB - L1 - Walls\t152.5\t13 Jul 2029\t19 Dec 2029\tSummary\t1HDAB\tL1\tlevel'} aria-label="Rows pasted from a spreadsheet" />
          <div className="scn-row">
            <button type="button" className="btn primary" disabled={!paste.trim()} onClick={importPaste}>Add these rows</button>
            <button type="button" className="btn" onClick={() => setPaste(null)}>Cancel</button>
            <span className="scn-dim">Columns: ID, Name, Days, Baseline start, Baseline finish, then Type, Building, Level, WBS (level, slabs or a folder), Level task. Dates as 6 Apr 2029, 29/06/2029 or 2029-06-29. A row with an ID already here replaces it.</span>
          </div>
        </div>
      )}
      {chosen.length > 0 && (
        <div className="rule-extras__bulk" role="group" aria-label="Change the ticked rows">
          <strong>{chosen.length} ticked</strong>
          <select style={selectStyle} value="" onChange={(e) => e.target.value !== '' && bulk({ kind: (e.target.value === 'auto' ? '' : e.target.value) as ExtraKind | '' })} aria-label="Set the type of the ticked rows">
            <option value="">Type…</option>
            {EXTRA_KINDS.map((k) => <option key={k.value || 'auto'} value={k.value || 'auto'} title={k.tip}>{k.label}</option>)}
          </select>
          <select style={selectStyle} value="" onChange={(e) => e.target.value && bulk({ wbs: wbsFromChoice(e.target.value) })} aria-label="Set the WBS of the ticked rows">
            <option value="">WBS…</option>
            {WBS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select style={selectStyle} value="" onChange={(e) => e.target.value && bulk({ task: e.target.value === 'none' ? '' : e.target.value })} aria-label="Set the level task of the ticked rows">
            <option value="">Level task…</option>
            <option value="none">none (every task the link names)</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
          <input className="rule-num" type="number" min={0} step="any" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" aria-label="Days for the ticked rows" />
          <button type="button" className="btn btn--small" disabled={days === ''} onClick={() => { const d = Math.max(0, Number(days) || 0); setExtras(extras.map((x, j) => (picked.has(j) ? { ...x, DurationDays: d } : x))); setDays(''); }}>Set days</button>
          <button type="button" className="btn btn--small" onClick={() => duplicate(chosen)}>Duplicate</button>
          <button type="button" className="btn btn--small danger" onClick={() => remove(chosen)}>Delete</button>
          <button type="button" className="cols__link" onClick={() => setPicked(new Set())}>None</button>
        </div>
      )}
      {extras.length === 0 && <div className="scn-dim">No extra activities. Add one, or paste a table from a spreadsheet.</div>}
      {extras.length > 0 && (
        <div className="rule-extras__scroll">
          <table className="scn-crews rule-extras">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allShown} onChange={() => setPicked(allShown ? new Set() : new Set(shown.map(({ i }) => i)))} aria-label="Tick all" /></th>
                <th>ID</th><th>Name</th><th>Type</th><th className="scn-num">Days</th><th>Building</th><th>Level</th><th>WBS</th><th>Level task</th><th>Baseline start</th><th>Baseline finish</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ e, i }) => {
                const t = tags[e.TaskID] ?? {};
                const bad = problem(e);
                const choice = wbsChoice(t.wbs);
                return (
                  <tr key={i} className={`${picked.has(i) ? 'is-picked' : ''}${bad ? ' is-overridden' : ''}`} title={bad ?? undefined}>
                    <td><input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} aria-label={`Tick ${e.TaskID}`} /></td>
                    <td><input className={`rule-extras__id${bad ? ' is-unknown' : ''}`} value={e.TaskID} onChange={(ev) => editRow(i, { TaskID: ev.target.value })} aria-label="ID" spellCheck={false} /></td>
                    <td><input value={e.Name} onChange={(ev) => editRow(i, { Name: ev.target.value })} aria-label="Name" /></td>
                    <td>
                      <select value={t.kind ?? ''} onChange={(ev) => setTags([e.TaskID], { kind: ev.target.value as ExtraKind | '' })} aria-label="Type">
                        {EXTRA_KINDS.map((k) => <option key={k.value || 'auto'} value={k.value} title={k.tip}>{k.label}</option>)}
                      </select>
                    </td>
                    <td className="scn-num"><input type="number" min={0} step="any" value={e.DurationDays} onChange={(ev) => editRow(i, { DurationDays: Math.max(0, Number(ev.target.value) || 0) })} aria-label="Days" /></td>
                    <td><input list="rule-extra-buildings" value={t.building ?? ''} onChange={(ev) => setTags([e.TaskID], { building: ev.target.value.trim() })} aria-label="Building" placeholder="—" /></td>
                    <td><input list="rule-extra-levels" value={t.level ?? ''} onChange={(ev) => setTags([e.TaskID], { level: ev.target.value.trim().toUpperCase() })} aria-label="Level" placeholder="—" /></td>
                    <td>
                      <select value={choice} onChange={(ev) => setTags([e.TaskID], { wbs: wbsFromChoice(ev.target.value) })} aria-label="WBS">
                        {WBS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {choice === 'path' && <input value={(t.wbs ?? '').slice(5)} onChange={(ev) => setTags([e.TaskID], { wbs: `path:${ev.target.value}` })} placeholder="Folder / Subfolder" aria-label="WBS folder" spellCheck={false} />}
                    </td>
                    <td>
                      <select value={t.task ?? ''} onChange={(ev) => setTags([e.TaskID], { task: ev.target.value })} aria-label="Level task">
                        <option value="">all the link names</option>
                        {tasks.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                      </select>
                    </td>
                    <td><input type="date" value={e.BaselineStart} onChange={(ev) => editRow(i, { BaselineStart: ev.target.value })} aria-label="Baseline start" /></td>
                    <td><input type="date" value={e.BaselineFinish} onChange={(ev) => editRow(i, { BaselineFinish: ev.target.value })} aria-label="Baseline finish" /></td>
                    <td className="rule-card__tools">
                      <button type="button" onClick={() => duplicate([i])} title="Duplicate" aria-label="Duplicate"><IconCopy /></button>
                      <button type="button" className="rule-card__del" onClick={() => remove([i])} title="Delete" aria-label="Delete"><IconTrash /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="scn-dim scn-editor__help">
        Extra activities come from a high-level programme; the baseline dates become their target dates and the activity is dated from its links. <strong>Type</strong>: automatic is a task, or a finish milestone with no days; a WBS summary spans what is under its WBS node. <strong>WBS</strong>: on its level suits walls (beside the External and Internal Walls groups); the level's Slabs for slabs. <strong>Level task</strong>: the one a Level link ties it to.
      </div>
    </RuleCard>
  );
}

// ---------------------------------------------------------------- manual links

export const addLink = () => setRelations([...useScenarioStore.getState().relations, { ActivityID1: '', ActivityID2: '', Relation: 'FS', Lag: 0 }]);

export function LinkRowCard({ i, byCode }: { i: number; byCode: Map<string, string> }) {
  const relations = useScenarioStore((s) => s.relations);
  const r = relations[i];
  const update = (patch: Partial<ScenarioRelation>) => setRelations(relations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // An end written as a selector (select:{...}) is resolved by the generator, so it is not checked here.
  const unknown = (code: string) => !!code && !/^select:/i.test(code) && byCode.size > 0 && !byCode.has(code);
  const bad = [r.ActivityID1, r.ActivityID2].filter(unknown);
  return (
    <RuleCard
      kind="link"
      id={`LINK-${String(i + 1).padStart(2, '0')}`}
      enabled
      onDelete={() => setRelations(relations.filter((_, j) => j !== i))}
      onCopy={() => setRelations([...relations.slice(0, i + 1), { ...r }, ...relations.slice(i + 1)])}
      summary={`${r.ActivityID1 || '?'} → ${r.ActivityID2 || '?'} · ${r.Relation}${r.Lag ? ` ${r.Lag > 0 ? '+' : ''}${r.Lag} h` : ''}`}
      problem={bad.length ? `Not in the generated programme: ${bad.join(', ')}` : null}
    >
      <div className="scn-link__row">
        <input className={unknown(r.ActivityID1) ? 'is-unknown' : undefined} list="scn-activity-codes" value={r.ActivityID1} onChange={(e) => update({ ActivityID1: e.target.value.trim() })} placeholder="Predecessor ID" title={byCode.get(r.ActivityID1) ?? 'Predecessor activity ID'} />
        <select value={REL_TYPES.includes(r.Relation as (typeof REL_TYPES)[number]) ? r.Relation : 'FS'} onChange={(e) => update({ Relation: e.target.value })} title={REL_LABEL[r.Relation]}>
          {REL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={unknown(r.ActivityID2) ? 'is-unknown' : undefined} list="scn-activity-codes" value={r.ActivityID2} onChange={(e) => update({ ActivityID2: e.target.value.trim() })} placeholder="Successor ID" title={byCode.get(r.ActivityID2) ?? 'Successor activity ID'} />
        <input className="scn-link__lag" type="number" step="1" value={r.Lag} onChange={(e) => update({ Lag: Number(e.target.value) || 0 })} title="Lag, working hours (negative = lead)" aria-label="Lag (hours)" />
      </div>
      {(byCode.has(r.ActivityID1) || byCode.has(r.ActivityID2)) && <div className="scn-link__names scn-dim">{byCode.get(r.ActivityID1) ?? '?'} → {byCode.get(r.ActivityID2) ?? '?'}</div>}
      <div className="scn-dim scn-editor__help">
        A link replaces the generated links into its successor. An end is an activity ID, or what the activities are: <code>{'select:{building=1HDAB; level=L1; type=SLAB; phase=Concrete; last}'}</code> (each / first / last). Lag is in working hours (8 h = 1 day).
      </div>
    </RuleCard>
  );
}

// ---------------------------------------------------------------- crew overrides

export function addCrewOverride() {
  const { crews, crewOptions } = useScenarioStore.getState();
  setCrews([...crews, { Phase: crewOptions?.phases[0] ?? '', PourType: '', Trade: crewOptions?.trades[0]?.code ?? '', Crew: '1' }]);
}

export function CrewOverrideRowCard({ i }: { i: number }) {
  const crews = useScenarioStore((s) => s.crews);
  const options = useScenarioStore((s) => s.crewOptions);
  const { loaded, rows } = useScenarioView();
  const trades = useTrades();
  const phases = options?.phases ?? [];
  const pourTypes = useMemo(() => {
    const col = loaded ? loaded.headers.indexOf('Pour Type') : -1;
    return col < 0 ? [] : [...new Set(rows.map((r) => normType(r.cells[col] ?? '')).filter(Boolean))].sort();
  }, [loaded, rows]);
  const c = crews[i];
  const update = (patch: Partial<ScenarioCrew>) => setCrews(crews.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const defaults = new Map((options?.defaultCrews ?? []).map((d) => [d.key, d.crews]));
  const pt = normType(c.PourType);
  const def = defaults.get(pt ? `${c.Phase}|${pt}` : c.Phase) ?? defaults.get(c.Phase);
  const defText = def?.length ? def.map(([t, n]) => `${t} ${n}`).join(', ') : 'no labour';
  return (
    <RuleCard
      kind="crewOverride"
      id={`CREW-${String(i + 1).padStart(2, '0')}`}
      enabled
      onDelete={() => setCrews(crews.filter((_, j) => j !== i))}
      onCopy={() => setCrews([...crews.slice(0, i + 1), { ...c }, ...crews.slice(i + 1)])}
      summary={`${c.Phase || '—'}${pt ? ` · ${pt}` : ''}: ${c.Trade || '—'} ${c.Crew}`}
    >
      <div className="rule-grid">
        <Field label="Phase">
          <select value={c.Phase} onChange={(e) => update({ Phase: e.target.value })}>
            {!phases.includes(c.Phase) && <option value={c.Phase}>{c.Phase || '—'}</option>}
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={pt} onChange={(e) => update({ PourType: e.target.value })}>
            <option value="">All</option>
            {pt && !pourTypes.includes(pt) && <option value={pt}>{pt}</option>}
            {pourTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Trade">
          <select value={c.Trade} onChange={(e) => update({ Trade: e.target.value })}>
            {!trades.some((t) => t.code === c.Trade) && <option value={c.Trade}>{c.Trade || '—'}</option>}
            {trades.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.name}</option>)}
          </select>
        </Field>
        <Field label="People"><input className="rule-num" type="number" min={0} step={1} value={c.Crew} onChange={(e) => update({ Crew: e.target.value })} aria-label="People" /></Field>
      </div>
      <div className="scn-dim scn-editor__help">The rows of a phase (and type) replace all of its default crews; 0 people = none of that trade. Default: {defText}.</div>
    </RuleCard>
  );
}

/** The generator's default crews, each with a button that copies them into the scenario to change them. */
export function CrewDefaults() {
  const crews = useScenarioStore((s) => s.crews);
  const options = useScenarioStore((s) => s.crewOptions);
  const trades = useTrades();
  if (!options) return null;
  const defaults = new Map(options.defaultCrews.map((d) => [d.key, d.crews]));
  const overridden = new Set(crews.map((c) => (normType(c.PourType) ? `${c.Phase}|${normType(c.PourType)}` : c.Phase)));
  const crewText = (list: [string, number][] | undefined) => (list?.length ? list.map(([t, n]) => `${t} ${n}`).join(', ') : 'no labour');
  const customise = (key: string) => {
    const [phase, pourType = ''] = key.split('|');
    const list = defaults.get(key) ?? [];
    const rest = crews.filter((c) => !(c.Phase === phase && normType(c.PourType) === pourType));
    setCrews([...rest, ...(list.length ? list.map(([t, n]) => ({ Phase: phase, PourType: pourType, Trade: t, Crew: String(n) })) : [{ Phase: phase, PourType: pourType, Trade: trades[0]?.code ?? '', Crew: '0' }])]);
  };
  return (
    <>
      <div className="rule-sub">Generator's default crews</div>
      <table className="scn-crews scn-crews--defaults">
        <tbody>
          {[...defaults.entries()].map(([key, list]) => (
            <tr key={key} className={overridden.has(key) ? 'is-overridden' : undefined}>
              <td>{key.replace('|', ' · ')}</td>
              <td>{crewText(list)}</td>
              <td>{overridden.has(key) ? <span className="scn-chip">overridden</span> : <button type="button" className="mini-btn" onClick={() => customise(key)}>Customise</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > 0 && <div className="scn-dim scn-editor__help">Trades: {trades.map((t) => `${t.code} ${t.name}${t.capacity ? ` (${t.capacity}/day on site)` : ''}`).join(' · ')}</div>}
    </>
  );
}
