import { useScenarioStore } from '../../../state/scenarioStore';
import {
  ACTIVITY_PHASES, COMPONENT_PHASES, PRODUCTIVITY_PHASES, freshId, whenText,
  type CrewRule, type DurationRow, type ProductivityRow, type RebarRow, type When,
} from '../../../prs/rules';
import { Field, Fits, NumberInput, RuleCard, WhenEditor, useTrades, type RuleContext } from './RuleParts';

/** Rule types Duration, Productivity, Rebar rate and Crew rule (rows of the Rules list). A rule applies to the objects its conditions fit;
    the rule with the most conditions wins and a tie goes to the earlier one. The generator's own numbers (the "defaults" tables) are used
    for everything no rule fits. */

const num = (v: number) => (Number.isFinite(v) ? v : 0);

function PhaseDays({ row, onChange, defaults }: { row: DurationRow; onChange: (phases: Record<string, number>) => void; defaults: Record<string, number> }) {
  const used = Object.keys(row.phases);
  const free = [...COMPONENT_PHASES, ...ACTIVITY_PHASES].filter((p) => !used.includes(p));
  return (
    <div className="rule-phases">
      {used.map((p) => (
        <span key={p} className="rule-phase" title={(COMPONENT_PHASES as readonly string[]).includes(p) ? `${p} is a component of the duration table${p === 'Formwork' || p === 'Embedments' ? ' (the Formwork activity is Embedments + Formwork)' : ''}` : `Days of the ${p} activity`}>
          <span className="rule-phase__name">{p}</span>
          <NumberInput value={row.phases[p]} step={0.5} ariaLabel={`${p} days`} onChange={(v) => onChange({ ...row.phases, [p]: num(v) })} />
          <span className="scn-dim">d</span>
          <button type="button" className="mini-btn" onClick={() => { const next = { ...row.phases }; delete next[p]; onChange(next); }} aria-label={`Remove ${p}`}>×</button>
        </span>
      ))}
      <select className="rule-when__add" value="" onChange={(e) => e.target.value && onChange({ ...row.phases, [e.target.value]: defaults[e.target.value] ?? 1 })} aria-label="Add a phase">
        <option value="">+ phase</option>
        <optgroup label="Components">
          {free.filter((p) => (COMPONENT_PHASES as readonly string[]).includes(p)).map((p) => <option key={p} value={p}>{p}</option>)}
        </optgroup>
        <optgroup label="Activities">
          {free.filter((p) => !(COMPONENT_PHASES as readonly string[]).includes(p)).map((p) => <option key={p} value={p}>{p}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

export function addDuration(ctx: RuleContext, when: When = {}, phases: Record<string, number> = { Rebar: 7 }) {
  ctx.change((r) => ({ ...r, durations: [...r.durations, { id: freshId('DUR', r.durations.map((d) => d.id)), when, phases }] }));
}

export function DurationRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const d = rules.durations[i];
  const update = (patch: Partial<DurationRow>) => change((r) => ({ ...r, durations: r.durations.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <RuleCard
      kind="duration"
      id={d.id}
      onId={(id) => update({ id })}
      enabled={d.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onCopy={() => change((r) => ({ ...r, durations: [...r.durations.slice(0, i + 1), { ...d, id: freshId(d.id, r.durations.map((x) => x.id)), phases: { ...d.phases } }, ...r.durations.slice(i + 1)] }))}
      onDelete={() => change((r) => ({ ...r, durations: r.durations.filter((_, j) => j !== i) }))}
      summary={`${whenText(d.when)} · ${Object.entries(d.phases).map(([p, v]) => `${p} ${v} d`).join(', ') || 'no phase'}`}
      note={<Fits ctx={ctx} when={d.when} />}
    >
      <WhenEditor ctx={ctx} value={d.when} onChange={(when) => update({ when })} />
      <PhaseDays row={d} onChange={(phases) => update({ phases })} defaults={{}} />
    </RuleCard>
  );
}

export function addProductivity(ctx: RuleContext) {
  ctx.change((r) => ({
    ...r,
    productivity: [...r.productivity, { id: freshId('PROD', r.productivity.map((d) => d.id)), when: {}, phase: 'Rebar', basis: 'rebar', manhoursPerUnit: 75, crew: 0, shifts: 1, hoursPerShift: 8, rounding: 'ceil', minDays: 1 }],
  }));
}

export function ProductivityRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const p = rules.productivity[i];
  const pourColumns = useScenarioStore((s) => s.loaded?.headers ?? []);
  const update = (patch: Partial<ProductivityRow>) => change((r) => ({ ...r, productivity: r.productivity.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  return (
    <RuleCard
      kind="productivity"
      id={p.id}
      onId={(id) => update({ id })}
      enabled={p.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, productivity: r.productivity.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, productivity: [...r.productivity.slice(0, i + 1), { ...p, id: freshId(p.id, r.productivity.map((x) => x.id)) }, ...r.productivity.slice(i + 1)] }))}
      summary={`${whenText(p.when)} · ${p.phase}: ${p.manhoursPerUnit} Mh per ${p.basis === 'rebar' ? 't of rebar' : p.basis === 'concrete' ? 'm³' : `unit of ${p.property || 'a model property'}`}`}
      note={<Fits ctx={ctx} when={p.when} />}
    >
      <WhenEditor ctx={ctx} value={p.when} onChange={(when) => update({ when })} />
      <div className="rule-grid">
        <Field label="Phase">
          <select value={p.phase} onChange={(e) => update({ phase: e.target.value })}>
            {PRODUCTIVITY_PHASES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Quantity from" wide help="Where the quantity the duration follows is read from">
          <select value={p.basis} onChange={(e) => update({ basis: e.target.value as ProductivityRow['basis'] })}>
            <option value="rebar">Rebar tonnes (concrete volume × rebar rate)</option>
            <option value="concrete">Concrete volume, m³</option>
            <option value="property">A property of the model…</option>
          </select>
        </Field>
        {p.basis === 'property' && (
          <>
            <Field label="Property set" help="The property set or quantity set that holds it, e.g. CWA Pour or Qto_SlabBaseQuantities. Empty = any set.">
              <input value={p.pset ?? ''} onChange={(e) => update({ pset: e.target.value || undefined })} placeholder="CWA Pour" spellCheck={false} list="rule-object-columns-sets" />
            </Field>
            <Field label="Property" help="The property's or quantity's name, as the model has it (case does not matter)">
              <input value={p.property ?? ''} onChange={(e) => update({ property: e.target.value })} placeholder="Rebar Weight" spellCheck={false} list="rule-object-columns" />
            </Field>
            <Field label="Multiply by" help="To turn the model's unit into the row's: 0.001 for kg to t. Empty = 1."><NumberInput value={p.factor ?? ''} min={-1e9} step={0.001} placeholder="1" onChange={(v) => update({ factor: Number.isFinite(v) ? v : undefined })} /></Field>
            <Field label="If the object has none" help="What a object that lacks the property uses instead">
              <select value={p.fallback ?? 'rebar'} onChange={(e) => update({ fallback: e.target.value as ProductivityRow['fallback'] })}>
                <option value="rebar">the rebar tonnes</option>
                <option value="concrete">the concrete volume</option>
                <option value="none">leave the row out (fixed days apply)</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Man-hours per unit"><NumberInput value={p.manhoursPerUnit} step={0.5} onChange={(v) => update({ manhoursPerUnit: num(v) })} /></Field>
        <Field label="People" help="0 = the phase's default crew"><NumberInput value={p.crew} onChange={(v) => update({ crew: num(v) })} /></Field>
        <Field label="Shifts"><NumberInput value={p.shifts} min={1} onChange={(v) => update({ shifts: num(v) || 1 })} /></Field>
        <Field label="Hours per shift"><NumberInput value={p.hoursPerShift} step={0.25} onChange={(v) => update({ hoursPerShift: num(v) || 8 })} /></Field>
        <Field label="Round">
          <select value={p.rounding} onChange={(e) => update({ rounding: e.target.value as ProductivityRow['rounding'] })}>
            <option value="ceil">up to whole days</option>
            <option value="round">to nearest day</option>
            <option value="none">not rounded</option>
          </select>
        </Field>
        <Field label="At least (days)"><NumberInput value={p.minDays} step={0.5} onChange={(v) => update({ minDays: num(v) })} /></Field>
      </div>
      <datalist id="rule-object-columns">{pourColumns.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="rule-object-columns-sets"><option value="CWA Pour" /></datalist>
      <div className="scn-dim scn-editor__help">Days = quantity × man-hours per unit ÷ (people × shifts × hours per shift). It replaces the days of that phase. People = 0 takes the phase's default crew.</div>
    </RuleCard>
  );
}

export function addRebar(ctx: RuleContext, when: When = {}, value = 0.25) {
  ctx.change((r) => ({ ...r, rebar: [...r.rebar, { id: freshId('REBAR', r.rebar.map((d) => d.id)), when, tonnesPerM3: value }] }));
}

export function RebarRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const b = rules.rebar[i];
  const update = (patch: Partial<RebarRow>) => change((r) => ({ ...r, rebar: r.rebar.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  return (
    <RuleCard
      kind="rebar"
      id={b.id}
      onId={(id) => update({ id })}
      enabled={b.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, rebar: r.rebar.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, rebar: [...r.rebar.slice(0, i + 1), { ...b, id: freshId(b.id, r.rebar.map((x) => x.id)) }, ...r.rebar.slice(i + 1)] }))}
      summary={`${whenText(b.when)} · ${b.tonnesPerM3} t/m³`}
      note={<Fits ctx={ctx} when={b.when} />}
    >
      <WhenEditor ctx={ctx} value={b.when} onChange={(when) => update({ when })} />
      <div className="rule-grid">
        <Field label="Tonnes per m³"><NumberInput value={b.tonnesPerM3} step={0.01} onChange={(v) => update({ tonnesPerM3: num(v) })} /></Field>
      </div>
    </RuleCard>
  );
}

export function addCrewRule(ctx: RuleContext, phase: string, trade: string) {
  ctx.change((r) => ({ ...r, crews: [...r.crews, { id: freshId('CREW', r.crews.map((d) => d.id)), when: {}, phase: phase || 'Rebar', trades: [{ trade: trade || 'SF', size: 6 }] }] }));
}

/** A crew for a phase of the objects a rule fits (by group, level range, type ...), on top of the Crew overrides. */
export function CrewRuleRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const options = useScenarioStore((s) => s.crewOptions);
  const trades = useTrades();
  const phases = options?.phases ?? [];
  const c = rules.crews[i];
  const update = (patch: Partial<CrewRule>) => change((r) => ({ ...r, crews: r.crews.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  return (
    <RuleCard
      kind="crew"
      id={c.id}
      onId={(id) => update({ id })}
      enabled={c.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, crews: r.crews.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, crews: [...r.crews.slice(0, i + 1), { ...c, id: freshId(c.id, r.crews.map((x) => x.id)), trades: c.trades.map((t) => ({ ...t })) }, ...r.crews.slice(i + 1)] }))}
      summary={`${whenText(c.when)} · ${c.phase}: ${c.trades.map((t) => `${t.trade} ${t.size}`).join(', ') || 'no labour'}`}
      note={<Fits ctx={ctx} when={c.when} />}
    >
      <WhenEditor ctx={ctx} value={c.when} onChange={(when) => update({ when })} />
      <div className="rule-grid">
        <Field label="Phase">
          <select value={c.phase} onChange={(e) => update({ phase: e.target.value })}>
            {!phases.includes(c.phase) && <option value={c.phase}>{c.phase || '—'}</option>}
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div className="rule-phases">
        {c.trades.map((t, k) => (
          <span key={k} className="rule-phase">
            <select value={t.trade} onChange={(e) => update({ trades: c.trades.map((x, j) => (j === k ? { ...x, trade: e.target.value } : x)) })} aria-label="Trade">
              {!trades.some((x) => x.code === t.trade) && <option value={t.trade}>{t.trade}</option>}
              {trades.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}
            </select>
            <NumberInput value={t.size} ariaLabel="People" onChange={(v) => update({ trades: c.trades.map((x, j) => (j === k ? { ...x, size: num(v) } : x)) })} />
            <span className="scn-dim">people</span>
            <button type="button" className="mini-btn" onClick={() => update({ trades: c.trades.filter((_, j) => j !== k) })} aria-label="Remove trade">×</button>
          </span>
        ))}
        <button type="button" className="mini-btn" onClick={() => update({ trades: [...c.trades, { trade: trades[0]?.code ?? 'SF', size: 1 }] })}>+ trade</button>
      </div>
      <div className="scn-dim scn-editor__help">Replaces all of the phase's default crew for these objects; 0 people drops a trade. Wins over the crew overrides.</div>
    </RuleCard>
  );
}
