import { useRef, useState } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { WEEKDAYS, freshId, whenText, type CalendarRow, type CalendarRule } from '../../../prs/rules';
import { calendarsFromP6 } from '../../../prs/calendarsImport';
import { Field, Fits, NumberInput, RuleCard, WhenEditor, type RuleContext } from './RuleParts';

/** Rule types Calendar and Calendar rule. A calendar is a working week (days, start, hours a day); a calendar rule says which activities run on
    which calendar: the objects its conditions fit (a group, a family, a level range ...), optionally one phase of them (Curing on a 7-day week).
    With no calendar here the generator keeps its own two (Mon-Fri 09:00-17:00, and every day for Curing). */

const DEFAULT_WEEK = [0, 1, 2, 3, 4];

export function addCalendar(ctx: RuleContext, row?: Partial<CalendarRow>) {
  ctx.change((r) => ({
    ...r,
    calendars: [...r.calendars, { id: freshId(row?.id ?? 'CAL', r.calendars.map((d) => d.id)), name: '', workDays: DEFAULT_WEEK, start: '09:00', hoursPerDay: 8, default: r.calendars.length === 0 || undefined, ...row }],
  }));
}

export function addCalendarRule(ctx: RuleContext) {
  ctx.change((r) => ({ ...r, calendarRules: [...r.calendarRules, { id: freshId('CALRULE', r.calendarRules.map((d) => d.id)), when: {}, calendar: r.calendars[0]?.id ?? '' }] }));
}

const weekText = (days: number[]) => {
  const d = [...days].sort();
  if (!d.length) return 'no working days';
  if (d.length === 7) return 'every day';
  const run = d.every((x, k) => k === 0 || x === d[k - 1] + 1);
  return run && d.length > 2 ? `${WEEKDAYS[d[0]]}–${WEEKDAYS[d[d.length - 1]]}` : d.map((x) => WEEKDAYS[x]).join(', ');
};
const finishOf = (start: string, hours: number) => {
  const [h, m] = start.split(':').map(Number);
  const t = Math.min(24 * 60, (h || 0) * 60 + (m || 0) + Math.round(hours * 60));
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function CalendarRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const c = rules.calendars[i];
  const update = (patch: Partial<CalendarRow>) => change((r) => ({ ...r, calendars: r.calendars.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const setDefault = (on: boolean) => change((r) => ({ ...r, calendars: r.calendars.map((d, j) => ({ ...d, default: j === i ? on || undefined : on ? undefined : d.default })) }));
  const toggle = (d: number) => update({ workDays: c.workDays.includes(d) ? c.workDays.filter((x) => x !== d) : [...c.workDays, d].sort() });
  const used = rules.calendarRules.filter((r) => r.calendar.toUpperCase() === c.id.toUpperCase()).length;
  return (
    <RuleCard
      kind="calendar"
      id={c.id}
      onId={(id) => update({ id })}
      enabled={c.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, calendars: r.calendars.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, calendars: [...r.calendars.slice(0, i + 1), { ...c, id: freshId(c.id, r.calendars.map((x) => x.id)), default: undefined }, ...r.calendars.slice(i + 1)] }))}
      summary={`${c.name || 'unnamed'} · ${weekText(c.workDays)} · ${c.start}–${finishOf(c.start, c.hoursPerDay)} · ${c.hoursPerDay * c.workDays.length} h/week${c.default ? ' · default' : ''}`}
      note={used ? `${used} rule${used === 1 ? '' : 's'}` : undefined}
    >
      <div className="rule-grid">
        <Field label="Name" help="The name P6 shows"><input value={c.name} onChange={(e) => update({ name: e.target.value })} placeholder="6-day week" spellCheck={false} /></Field>
        <Field label="Starts at"><input type="time" value={c.start} onChange={(e) => update({ start: e.target.value || '09:00' })} /></Field>
        <Field label="Hours per day" help="Whole-day durations become this many hours per day in P6">
          <NumberInput value={c.hoursPerDay} min={1} step={0.5} onChange={(v) => update({ hoursPerDay: Number.isFinite(v) && v > 0 ? Math.min(v, 24) : 8 })} />
        </Field>
        <Field label="Default" help="The calendar of every activity no calendar rule fits"><input type="checkbox" checked={!!c.default} onChange={(e) => setDefault(e.target.checked)} /></Field>
      </div>
      <div className="rule-phases" role="group" aria-label="Working days">
        {WEEKDAYS.map((name, d) => (
          <button key={name} type="button" className={`rule-kind-chip${c.workDays.includes(d) ? ' is-on' : ''}`} aria-pressed={c.workDays.includes(d)} onClick={() => toggle(d)}>{name}</button>
        ))}
      </div>
      <div className="scn-dim scn-editor__help">One window on every working day. Holidays are not modelled.</div>
    </RuleCard>
  );
}

export function CalendarRuleRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const phases = useScenarioStore((s) => s.crewOptions?.phases ?? []);
  const r0 = rules.calendarRules[i];
  const update = (patch: Partial<CalendarRule>) => change((r) => ({ ...r, calendarRules: r.calendarRules.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const target = rules.calendars.find((c) => c.id.toUpperCase() === r0.calendar.toUpperCase());
  return (
    <RuleCard
      kind="calendarRule"
      id={r0.id}
      onId={(id) => update({ id })}
      enabled={r0.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, calendarRules: r.calendarRules.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, calendarRules: [...r.calendarRules.slice(0, i + 1), { ...r0, id: freshId(r0.id, r.calendarRules.map((x) => x.id)) }, ...r.calendarRules.slice(i + 1)] }))}
      problem={target ? null : `The calendar "${r0.calendar || '—'}" is not defined`}
      summary={`${whenText(r0.when)}${r0.phase ? ` · ${r0.phase}` : ''} → ${target?.name || r0.calendar || '—'}`}
      note={<Fits ctx={ctx} when={r0.when} />}
    >
      <WhenEditor ctx={ctx} value={r0.when} onChange={(when) => update({ when })} />
      <div className="rule-grid">
        <Field label="Phase" help="Only this activity of the pour (empty: every activity the conditions fit)">
          <input value={r0.phase ?? ''} list="rule-calendar-phases" onChange={(e) => update({ phase: e.target.value || undefined })} placeholder="any phase" spellCheck={false} />
        </Field>
        <Field label="Calendar">
          <select value={r0.calendar} onChange={(e) => update({ calendar: e.target.value })}>
            {!target && <option value={r0.calendar}>{r0.calendar || '—'}</option>}
            {rules.calendars.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
        </Field>
      </div>
      <datalist id="rule-calendar-phases">{phases.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="scn-dim scn-editor__help">The rule with the most conditions (a phase counts as one) wins; a tie goes to the earlier rule. An activity no rule fits runs on the default calendar.</div>
    </RuleCard>
  );
}

/** "import from a schedule": adds the calendars of a P6 XML file (a calendar with the same id is replaced). */
export function CalendarImport({ ctx, onDone }: { ctx: RuleContext; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const read = async (f: File) => {
    try {
      const doc = new DOMParser().parseFromString(await f.text(), 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('This is not a readable XML file.');
      const found = calendarsFromP6(doc);
      if (!found.length) throw new Error('No calendar with a standard work week was found (P6 XML: <Calendar> with <StandardWorkWeek>).');
      ctx.change((r) => {
        const ids = new Set(found.map((c) => c.id.toUpperCase()));
        const kept = r.calendars.filter((c) => !ids.has(c.id.toUpperCase()));
        const next = found.map((c, k) => ({ ...c, ...(!kept.some((x) => x.default) && k === 0 ? { default: true } : {}) }));
        return { ...r, calendars: [...kept, ...next] };
      });
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <button type="button" className="mini-btn" onClick={() => file.current?.click()} title="Add the working calendars of a Primavera P6 XML schedule">import from a schedule (P6 XML)</button>
      <input ref={file} type="file" accept=".xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      {message && <span className="rule-card__problem" role="alert">{message}</span>}
    </>
  );
}
