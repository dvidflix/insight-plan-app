import { useMemo, useState, type ReactNode } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { ACTIVITY_PHASES, COMPONENT_PHASES, assignmentKey, chainKey, type Assignment, type ChainRow, type CrewTemplate, type RateRow } from '../../../prs/rules';
import {
  assignmentProblems, assignmentsToTsv, chainsToTsv, crewText, parseChainsPaste, crewsToTsv, parseAssignmentsPaste, parseCrewText, parseCrewsPaste, parseRatesPaste, ratesToTsv,
} from '../../../prs/relational';
import { IconTrash } from '../../icons';
import { RuleCard, useTrades, type RuleContext } from './RuleParts';
import type { RuleKind } from './kinds';

/** The relational tables of the rules: Rates (a named duration or rate), Crews (a named list of trades and sizes) and Assignments (the link table:
    a group and a phase get a rate, a crew and a calendar, with a priority). Conditions live in the groups only. Each table is a grid that copies to
    and pastes from a spreadsheet, like the Extra activities table: copy it, edit many rows in Excel, paste it back. */

const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function Cell({ value, onChange, list, width, type = 'text', placeholder, title }: { value: string | number | undefined; onChange: (v: string) => void; list?: string; width?: number; type?: 'text' | 'number'; placeholder?: string; title?: string }) {
  return <input className="rel-cell" type={type} step="any" value={value ?? ''} list={list} placeholder={placeholder} title={title} spellCheck={false} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} />;
}

interface Column<T> {
  label: string;
  tip?: string;
  render: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
}

function GridCard<T extends { id: string; enabled?: boolean }>({
  kind, rows, columns, onRows, toTsv, parse, keyOf, blank, problems, help,
}: {
  kind: RuleKind;
  rows: T[];
  columns: Column<T>[];
  onRows: (rows: T[]) => void;
  toTsv: (rows: T[]) => string;
  parse: (text: string) => T[];
  keyOf: (row: T) => string;
  blank: () => T;
  problems: (row: T) => string[];
  help: ReactNode;
}) {
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const q = filter.trim().toLowerCase();
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || JSON.stringify(r).toLowerCase().includes(q));
  const seen = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setPaste(toTsv(rows)); // no clipboard: the text is shown to copy by hand
    }
  };
  const apply = (replaceAll: boolean) => {
    const incoming = parse(paste ?? '');
    if (incoming.length) {
      const keys = new Set(incoming.map(keyOf));
      onRows(replaceAll ? incoming : [...rows.filter((r) => !keys.has(keyOf(r))), ...incoming]);
    }
    setPaste(null);
  };

  return (
    <RuleCard
      kind={kind}
      id=""
      enabled
      onDelete={() => { if (rows.length === 0 || window.confirm(`Remove all ${rows.length} rows of this table?`)) onRows([]); }}
      summary={`${rows.length} row${rows.length === 1 ? '' : 's'}`}
    >
      <div className="rel-bar">
        <input className="rel-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter the rows" />
        <button type="button" className="btn btn--small" onClick={() => onRows([...rows, blank()])}>+ Row</button>
        <button type="button" className="btn btn--small" onClick={() => void copy()} title="Copy the whole table as text to paste into Excel">{copied ? 'Copied' : 'Copy for Excel'}</button>
        <button type="button" className="btn btn--small" onClick={() => setPaste(paste === null ? '' : null)} title="Paste rows from Excel (columns as in Copy for Excel)">Paste from Excel</button>
      </div>
      {paste !== null && (
        <div className="rel-paste">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder="Paste the rows here (tab or semicolon separated; a first row of headings is skipped)" spellCheck={false} />
          <div className="rel-bar">
            <button type="button" className="btn btn--small primary" onClick={() => apply(false)} title="Rows with the same key are replaced, new ones are added, the others stay">Add / update</button>
            <button type="button" className="btn btn--small" onClick={() => apply(true)} title="The table becomes exactly the pasted rows">Replace the table</button>
            <button type="button" className="btn btn--small" onClick={() => setPaste(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="rel-scroll">
        <table className="rel-table">
          <thead>
            <tr>
              <th aria-label="On" />
              {columns.map((c) => <th key={c.label} title={c.tip}>{c.label}</th>)}
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i }) => {
              const update = (patch: Partial<T>) => onRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const own = [...problems(r), ...((seen.get(keyOf(r)) ?? 0) > 1 ? ['The same key is used twice'] : [])];
              return (
                <tr key={i} className={`${r.enabled === false ? 'is-off' : ''}${own.length ? ' has-problem' : ''}`} title={own.join('\n') || undefined}>
                  <td><input type="checkbox" checked={r.enabled !== false} onChange={(e) => update({ enabled: e.target.checked ? undefined : false } as Partial<T>)} aria-label="Row on" /></td>
                  {columns.map((c) => <td key={c.label}>{c.render(r, update)}</td>)}
                  <td><button type="button" className="mini-btn" onClick={() => onRows(rows.filter((_, j) => j !== i))} aria-label="Delete row"><IconTrash /></button></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={columns.length + 2} className="scn-dim">{rows.length ? 'No row matches.' : 'No rows yet: add one, or paste from Excel.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="scn-dim scn-editor__help">{help}</div>
    </RuleCard>
  );
}

// ---------------------------------------------------------------- Rates

export function RatesTableCard({ ctx }: { ctx: RuleContext }) {
  const rows = ctx.rules.rates;
  const set = (next: RateRow[]) => ctx.change((r) => ({ ...r, rates: next }));
  const P = (r: RateRow) => r.type === 'productivity';
  const columns: Column<RateRow>[] = [
    { label: 'ID', render: (r, u) => <Cell value={r.id} onChange={(id) => u({ id })} width={110} /> },
    { label: 'Type', tip: 'Days: a fixed number of days. Productivity: days worked out from a quantity. Rebar: tonnes of rebar per m³ of concrete.', render: (r, u) => (
      <select className="rel-cell" value={r.type} onChange={(e) => u({ type: e.target.value as RateRow['type'] })}>
        <option value="days">days</option>
        <option value="productivity">productivity</option>
        <option value="rebar">rebar</option>
      </select>
    ) },
    { label: 'Days', render: (r, u) => (r.type === 'days' ? <Cell type="number" value={r.days} onChange={(v) => u({ days: num(v) })} width={64} /> : null) },
    { label: 'Tonnes per m³', render: (r, u) => (r.type === 'rebar' ? <Cell type="number" value={r.tonnesPerM3} onChange={(v) => u({ tonnesPerM3: num(v) })} width={72} /> : null) },
    { label: 'Quantity', tip: 'Productivity: tonnes of rebar, m³ of concrete, or a number the model carries', render: (r, u) => P(r) ? (
      <select className="rel-cell" value={r.basis ?? 'rebar'} onChange={(e) => u({ basis: e.target.value as RateRow['basis'] })}>
        <option value="rebar">rebar t</option>
        <option value="concrete">concrete m³</option>
        <option value="property">model property</option>
      </select>
    ) : null },
    { label: 'Property set', render: (r, u) => (P(r) && r.basis === 'property' ? <Cell value={r.pset} onChange={(pset) => u({ pset: pset || undefined })} width={110} /> : null) },
    { label: 'Property', render: (r, u) => (P(r) && r.basis === 'property' ? <Cell value={r.property} onChange={(property) => u({ property })} width={110} /> : null) },
    { label: 'Multiply by', render: (r, u) => (P(r) && r.basis === 'property' ? <Cell type="number" value={r.factor} onChange={(v) => u({ factor: num(v) })} width={64} /> : null) },
    { label: 'If none', tip: 'What an object without the property uses', render: (r, u) => P(r) && r.basis === 'property' ? (
      <select className="rel-cell" value={r.fallback ?? 'rebar'} onChange={(e) => u({ fallback: e.target.value as RateRow['fallback'] })}>
        <option value="rebar">rebar t</option>
        <option value="concrete">concrete m³</option>
        <option value="none">leave out</option>
      </select>
    ) : null },
    { label: 'Man-hours per unit', render: (r, u) => (P(r) ? <Cell type="number" value={r.manhoursPerUnit} onChange={(v) => u({ manhoursPerUnit: num(v) })} width={72} /> : null) },
    { label: 'People', tip: '0 = the people of the crew assigned with the rate', render: (r, u) => (P(r) ? <Cell type="number" value={r.people} onChange={(v) => u({ people: num(v) })} width={56} /> : null) },
    { label: 'Shifts', render: (r, u) => (P(r) ? <Cell type="number" value={r.shifts} onChange={(v) => u({ shifts: num(v) })} width={52} /> : null) },
    { label: 'Hours per shift', render: (r, u) => (P(r) ? <Cell type="number" value={r.hoursPerShift} onChange={(v) => u({ hoursPerShift: num(v) })} width={64} /> : null) },
    { label: 'Round', render: (r, u) => P(r) ? (
      <select className="rel-cell" value={r.rounding ?? 'ceil'} onChange={(e) => u({ rounding: e.target.value as RateRow['rounding'] })}>
        <option value="ceil">up</option>
        <option value="round">nearest</option>
        <option value="none">none</option>
      </select>
    ) : null },
    { label: 'At least (days)', render: (r, u) => (P(r) ? <Cell type="number" value={r.minDays} onChange={(v) => u({ minDays: num(v) })} width={64} /> : null) },
  ];
  return (
    <GridCard
      kind="rateTable" rows={rows} columns={columns} onRows={set} toTsv={ratesToTsv} parse={parseRatesPaste}
      keyOf={(r) => r.id.trim().toUpperCase()} blank={(): RateRow => ({ id: `RATE-${rows.length + 1}`, type: 'days', days: 1 })}
      problems={(r) => [
        ...(!r.id.trim() ? ['An ID is needed'] : []),
        ...(r.type === 'productivity' && !(r.manhoursPerUnit && r.manhoursPerUnit > 0) ? ['A productivity rate needs man-hours per unit'] : []),
        ...(r.type === 'days' && r.days === undefined ? ['A days rate needs its days'] : []),
        ...(r.type === 'rebar' && !(r.tonnesPerM3 && r.tonnesPerM3 > 0) ? ['A rebar rate needs tonnes per m³'] : []),
      ]}
      help="A rate is defined once and linked to many groups in Assignments. Days: fixed. Productivity: days = quantity × man-hours per unit ÷ (people × shifts × hours per shift), rounded and not under the minimum; people 0 takes the crew assigned with it. Rebar: tonnes per m³ of concrete."
    />
  );
}

// ---------------------------------------------------------------- Crews

function CrewCell({ row, update }: { row: CrewTemplate; update: (p: Partial<CrewTemplate>) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="rel-cell" style={{ width: 200 }} spellCheck={false} placeholder="SF 6, CP 4"
      value={draft ?? crewText(row)} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) update({ trades: parseCrewText(draft) }); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      title="Trade code and people, separated by commas: SF 6, CP 4"
    />
  );
}

export function CrewsTableCard({ ctx }: { ctx: RuleContext }) {
  const rows = ctx.rules.crewTemplates;
  const trades = useTrades();
  const codes = new Set(trades.map((t) => t.code.toUpperCase()));
  const set = (next: CrewTemplate[]) => ctx.change((r) => ({ ...r, crewTemplates: next }));
  return (
    <GridCard
      kind="crewTable" rows={rows} onRows={set} toTsv={crewsToTsv} parse={parseCrewsPaste}
      keyOf={(r) => r.id.trim().toUpperCase()} blank={(): CrewTemplate => ({ id: `CREW-${rows.length + 1}`, trades: [] })}
      columns={[
        { label: 'ID', render: (r, u) => <Cell value={r.id} onChange={(id) => u({ id })} width={150} /> },
        { label: 'Crew', tip: 'Trade code and people per day, separated by commas', render: (r, u) => <CrewCell row={r} update={u} /> },
      ]}
      problems={(r) => [
        ...(!r.id.trim() ? ['An ID is needed'] : []),
        ...(codes.size ? r.trades.filter((t) => !codes.has(t.trade.toUpperCase())).map((t) => `The trade "${t.trade}" is not defined (Trade rules)`) : []),
      ]}
      help="A crew is a list of trades and the people per day of each (SF 6, CP 4; none = no labour), defined once and linked to many groups in Assignments. The trades come from the Trade rules."
    />
  );
}

// ---------------------------------------------------------------- Chains

export function ChainsTableCard({ ctx }: { ctx: RuleContext }) {
  const { rules } = ctx;
  const rows = rules.chains;
  const phases = useScenarioStore((s) => s.crewOptions?.phases ?? []);
  const groups = new Set(rules.groups.map((g) => g.id.toUpperCase()));
  const set = (next: ChainRow[]) => ctx.change((r) => ({ ...r, chains: next.map((c) => ({ ...c, id: chainKey(c) })) }));
  const phaseList = [...new Set([...COMPONENT_PHASES, ...ACTIVITY_PHASES, ...phases])];
  return (
    <>
      <GridCard
        kind="chainTable" rows={rows} onRows={set} toTsv={chainsToTsv} parse={parseChainsPaste}
        keyOf={chainKey} blank={(): ChainRow => ({ id: '|', group: '', order: rows.length + 1, phase: '' })}
        columns={[
          { label: 'Group', tip: 'The group whose pours get this chain; empty = every pour', render: (r, u) => <Cell value={r.group} list="chain-groups" onChange={(group) => u({ group })} width={130} /> },
          { label: 'Order', tip: 'The place of the activity in the chain', render: (r, u) => <Cell type="number" value={r.order} onChange={(v) => u({ order: num(v) ?? 0 })} width={52} /> },
          { label: 'Phase', render: (r, u) => <Cell value={r.phase} list="chain-phases" onChange={(phase) => u({ phase })} width={150} /> },
          { label: 'Suffix', tip: 'The end of the activity ID (-R); empty: the initials of the phase', render: (r, u) => <Cell value={r.suffix} onChange={(suffix) => u({ suffix: suffix || undefined })} width={60} /> },
          { label: 'Name', tip: 'The end of the activity name; empty: the phase', render: (r, u) => <Cell value={r.label} onChange={(label) => u({ label: label || undefined })} width={150} /> },
          { label: 'Material', tip: 'Rebar: the pour\'s rebar tonnes go on this activity. Concrete: its volume.', render: (r, u) => (
            <select className="rel-cell" value={r.material ?? ''} onChange={(e) => u({ material: (e.target.value || undefined) as ChainRow['material'] })}>
              <option value="">none</option>
              <option value="rebar">rebar</option>
              <option value="concrete">concrete</option>
            </select>
          ) },
          { label: 'Follows', tip: 'The phases it waits for: "Decking@80, Under Slab" = 80 % of Decking done (it starts that far into it) and Under Slab finished. Empty: the activity before it, finished.', render: (r, u) => <Cell value={r.follows} list="chain-phases" onChange={(follows) => u({ follows: follows || undefined })} width={190} placeholder="the one before" /> },
          { label: 'Finish after', tip: 'With a share below 100 %: it also cannot finish before what it follows does (finish-to-finish)', render: (r, u) => <input type="checkbox" checked={!!r.finishAfter} onChange={(e) => u({ finishAfter: e.target.checked || undefined })} aria-label="Finish after" /> },
          { label: 'Gates', tip: 'What follows the pour (the objects standing on it, the slab above) waits for this activity, as the contact links and the slab links take it. Empty: the Concrete.', render: (r, u) => <input type="checkbox" checked={!!r.gates} onChange={(e) => u({ gates: e.target.checked || undefined })} aria-label="Gates what follows" /> },
          { label: 'Priority', tip: 'Where a pour is in several groups with a chain, the highest priority decides', render: (r, u) => <Cell type="number" value={r.priority} onChange={(v) => u({ priority: num(v) })} width={60} /> },
        ]}
        problems={(r) => [
          ...(!r.phase.trim() ? ['A phase is needed'] : []),
          ...(r.group.trim() && !groups.has(r.group.trim().toUpperCase()) ? [`The group "${r.group}" does not exist`] : []),
        ]}
        help="The activities of the pours of a group, in order. A pour takes the chain of the group of the highest priority it is in (empty group: every pour); with none, in-situ pours have Rebar, Formwork and Concrete, and precast ones Installation. A phase can follow other phases by a share of their duration (Follows: Decking@80), which is a start-to-start with a lag, and finish after them (finish-to-finish). The days, crew and calendar of each phase are Assignments. The links the generator builds look for Concrete, Stitching, Installation, Decking and Rebar by name."
      />
      <datalist id="chain-groups">{rules.groups.map((g) => <option key={g.id} value={g.id} />)}</datalist>
      <datalist id="chain-phases">{phaseList.map((p) => <option key={p} value={p} />)}</datalist>
    </>
  );
}

// ---------------------------------------------------------------- Assignments

export function AssignmentsTableCard({ ctx }: { ctx: RuleContext }) {
  const { rules } = ctx;
  const rows = rules.assignments;
  const phases = useScenarioStore((s) => s.crewOptions?.phases ?? []);
  const known = useMemo(() => ({
    groups: new Set(rules.groups.map((g) => g.id.toUpperCase())),
    rates: new Set(rules.rates.map((r) => r.id.toUpperCase())),
    crews: new Set(rules.crewTemplates.map((r) => r.id.toUpperCase())),
    calendars: new Set(rules.calendars.map((r) => r.id.toUpperCase())),
  }), [rules.groups, rules.rates, rules.crewTemplates, rules.calendars]);
  const set = (next: Assignment[]) => ctx.change((r) => ({ ...r, assignments: next.map((a) => ({ ...a, id: assignmentKey(a) })) }));
  const phaseList = [...new Set([...COMPONENT_PHASES, ...ACTIVITY_PHASES, ...phases])];
  return (
    <>
      <GridCard
        kind="assignmentTable" rows={rows} onRows={set} toTsv={assignmentsToTsv} parse={parseAssignmentsPaste}
        keyOf={assignmentKey} blank={(): Assignment => ({ id: '|', group: '', phase: '' })}
        columns={[
          { label: 'Group', tip: 'A group of the Groups rules; empty = every object', render: (r, u) => <Cell value={r.group} list="rel-groups" onChange={(group) => u({ group })} width={130} /> },
          { label: 'Phase', tip: 'The activity: Rebar, Formwork, Concrete, Curing ...', render: (r, u) => <Cell value={r.phase} list="rel-phases" onChange={(phase) => u({ phase })} width={120} /> },
          { label: 'Rate', render: (r, u) => <Cell value={r.rate} list="rel-rates" onChange={(rate) => u({ rate: rate || undefined })} width={120} /> },
          { label: 'Rebar rate', tip: 'A Rebar rate (tonnes per m³ of concrete) for the objects of the group: the rebar tonnes productivity rates work from', render: (r, u) => <Cell value={r.density} list="rel-rates" onChange={(density) => u({ density: density || undefined })} width={110} /> },
          { label: 'Days', tip: 'A fixed number of days without a named rate', render: (r, u) => <Cell type="number" value={r.days} onChange={(v) => u({ days: num(v) })} width={60} /> },
          { label: 'Crew', render: (r, u) => <Cell value={r.crew} list="rel-crews" onChange={(crew) => u({ crew: crew || undefined })} width={120} /> },
          { label: 'Calendar', render: (r, u) => <Cell value={r.calendar} list="rel-calendars" onChange={(calendar) => u({ calendar: calendar || undefined })} width={100} /> },
          { label: 'Priority', tip: 'A higher number wins when an object is in several groups; a tie goes to the earlier row', render: (r, u) => <Cell type="number" value={r.priority} onChange={(v) => u({ priority: num(v) })} width={60} /> },
        ]}
        problems={(r) => assignmentProblems(r, known)}
        help="One row for a group and a phase: the rate (or fixed days), crew and calendar its objects get. All the conditions are in the groups. Where an object is in several groups, the higher priority wins, then the earlier row."
      />
      <datalist id="rel-groups">{rules.groups.map((g) => <option key={g.id} value={g.id} />)}</datalist>
      <datalist id="rel-phases">{phaseList.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="rel-rates">{rules.rates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      <datalist id="rel-crews">{rules.crewTemplates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      <datalist id="rel-calendars">{rules.calendars.map((r) => <option key={r.id} value={r.id} />)}</datalist>
    </>
  );
}
