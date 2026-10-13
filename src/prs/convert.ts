import {
  assignmentKey, selectToFilters, whenTerms, whenText,
  type Assignment, type CrewTemplate, type RateRow, type RuleGroup, type ScenarioRules, type When,
} from './rules';

/** Rules written the old way (a Duration, Productivity, Rebar rate, Crew rule or Calendar rule row, each with conditions of its own) as the
    relational tables: Groups (what the objects are), Rates, Crews and Assignments (which group gets which rate, crew and calendar in which phase,
    with a priority that stands for how specific the old conditions were). The rows it converts are taken out; a row that cannot be written as a group
    (a rule group together with other conditions) stays as it was. Nothing changes in what the generator makes. */

export interface Conversion {
  rules: ScenarioRules;
  /** How many old rows became tables, and how many were left. */
  converted: number;
  kept: number;
  /** What was made. */
  groups: number;
  rates: number;
  crews: number;
  assignments: number;
}

const slug = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'GROUP';

/** The fix for "no rebar rate": a Rebar rate of `tonnes` t per m³ (REBAR-<t>) in the Rates, and in the Rebar rate column of the assignment of every object's
    Rebar phase (a row is made when there is none). */
export function addRebarRate(rules: ScenarioRules, tonnes = 0.25): ScenarioRules {
  const id = `REBAR-${tonnes}`;
  const rates = rules.rates.some((r) => r.id.toUpperCase() === id.toUpperCase()) ? rules.rates : [...rules.rates, { id, type: 'rebar' as const, tonnesPerM3: tonnes }];
  const at = rules.assignments.findIndex((a) => a.group === '' && a.phase.toUpperCase() === 'REBAR' && a.enabled !== false);
  const assignments = at >= 0
    ? rules.assignments.map((a, i) => (i === at ? { ...a, density: id } : a))
    : [...rules.assignments, { id: assignmentKey({ group: '', phase: 'Rebar' }), group: '', phase: 'Rebar', density: id, priority: 0 }];
  return { ...rules, rates, assignments };
}

export const legacyCount = (r: ScenarioRules) => r.durations.length + r.productivity.length + r.rebar.length + r.crews.length + r.calendarRules.length;

export function convertLegacyRules(rules: ScenarioRules): Conversion {
  const groups: RuleGroup[] = [...rules.groups];
  const rates: RateRow[] = [...rules.rates];
  const crews: CrewTemplate[] = [...rules.crewTemplates];
  const assignments: Assignment[] = [...rules.assignments];
  const made = { groups: 0, rates: 0, crews: 0, assignments: 0 };
  let converted = 0;

  const byFilters = new Map<string, string>();
  const takenGroups = new Set(groups.map((g) => g.id.toUpperCase()));
  /** The group id for a `when` ('' = every object), or null when it cannot be one. */
  const groupFor = (when: When): string | null => {
    const w = { ...when };
    const named = (w.group ?? '').trim();
    delete w.group;
    const others = whenTerms(w);
    if (named && !others) return named.includes('|') ? null : named;
    if (!others && !named) return '';
    // A group and other conditions ("group SLABS, building 1HDAB, level L1"): one group whose conditions are the group's own, then the others.
    let filters = selectToFilters(w);
    let label = whenText(w);
    if (named) {
      const base = groups.find((g) => g.id.toUpperCase() === named.toUpperCase());
      const own = (base?.filters ?? []).filter((f) => !f.ignore);
      // (only a group of plain "and" conditions, with no groups inside it, can have the others added)
      if (!base || named.includes('|') || (base.include ?? []).length || !own.length || own.some((f, i) => i > 0 && f.conj === 'or')) return null;
      filters = [...own, ...filters].map((f, i) => ({ ...f, id: `c${i + 1}`, conj: 'and' as const }));
      label = `${base.id} · ${label}`;
    }
    const key = JSON.stringify(filters.map((f) => [f.field, f.op, f.value]));
    const have = byFilters.get(key);
    if (have) return have;
    let id = `G-${slug(label)}`;
    for (let n = 2; takenGroups.has(id.toUpperCase()); n++) id = `G-${slug(label)}-${n}`;
    takenGroups.add(id.toUpperCase());
    byFilters.set(key, id);
    groups.push({ id, name: label, forEach: [], filters });
    made.groups++;
    return id;
  };

  const priorityOf = (when: When) => whenTerms(when) * 10;
  const keyOf = (group: string, phase: string, enabled: boolean) => `${assignmentKey({ group, phase })}${enabled ? '' : '|OFF'}`;
  const index = new Map(assignments.map((a, i) => [keyOf(a.group, a.phase, a.enabled !== false), i]));
  /** One row per group, phase and switch: what several old rows give the same group and phase is joined. */
  const give = (group: string, phase: string, enabled: boolean, priority: number, patch: Partial<Assignment>, note?: string) => {
    const key = keyOf(group, phase, enabled);
    const at = index.get(key);
    if (at !== undefined) {
      const had = assignments[at];
      assignments[at] = { ...patch, ...Object.fromEntries(Object.entries(had).filter(([, v]) => v !== undefined)) } as Assignment; // the earlier row wins, as before
      return;
    }
    index.set(key, assignments.length);
    made.assignments++;
    assignments.push({ id: assignmentKey({ group, phase }), group, phase, ...patch, priority, ...(enabled ? {} : { enabled: false }), ...(note ? { note } : {}) });
  };
  const freshId = (list: { id: string }[], base: string) => {
    const used = new Set(list.map((x) => x.id.toUpperCase()));
    let id = base;
    for (let n = 2; used.has(id.toUpperCase()); n++) id = `${base}-${n}`;
    return id;
  };

  const rest = { durations: [] as typeof rules.durations, productivity: [] as typeof rules.productivity, rebar: [] as typeof rules.rebar, crews: [] as typeof rules.crews, calendarRules: [] as typeof rules.calendarRules };

  for (const row of rules.durations) {
    const group = groupFor(row.when);
    if (group === null) { rest.durations.push(row); continue; }
    converted++;
    for (const [phase, days] of Object.entries(row.phases)) give(group, phase, row.enabled !== false, priorityOf(row.when), { days }, row.note);
  }

  for (const row of rules.productivity) {
    const group = groupFor(row.when);
    if (group === null) { rest.productivity.push(row); continue; }
    converted++;
    const same = rates.find((r) => r.type === 'productivity' && r.basis === row.basis && (r.pset ?? '') === (row.pset ?? '') && (r.property ?? '') === (row.property ?? '') && r.factor === row.factor && r.fallback === row.fallback
      && r.manhoursPerUnit === row.manhoursPerUnit && r.people === row.crew && r.shifts === row.shifts && r.hoursPerShift === row.hoursPerShift && r.rounding === row.rounding && r.minDays === row.minDays);
    let id = same?.id;
    if (!id) {
      id = freshId(rates, `${slug(row.phase)}-${row.manhoursPerUnit}-MH`);
      rates.push({ id, type: 'productivity', basis: row.basis, ...(row.pset ? { pset: row.pset } : {}), ...(row.property ? { property: row.property } : {}), ...(row.factor !== undefined ? { factor: row.factor } : {}),
        ...(row.fallback ? { fallback: row.fallback } : {}), manhoursPerUnit: row.manhoursPerUnit, people: row.crew, shifts: row.shifts, hoursPerShift: row.hoursPerShift, rounding: row.rounding, minDays: row.minDays });
      made.rates++;
    }
    give(group, row.phase, row.enabled !== false, priorityOf(row.when), { rate: id }, row.note);
  }

  for (const row of rules.rebar) {
    const group = groupFor(row.when);
    if (group === null) { rest.rebar.push(row); continue; }
    converted++;
    let id = rates.find((r) => r.type === 'rebar' && r.tonnesPerM3 === row.tonnesPerM3)?.id;
    if (!id) {
      id = freshId(rates, `REBAR-${row.tonnesPerM3}`);
      rates.push({ id, type: 'rebar', tonnesPerM3: row.tonnesPerM3 });
      made.rates++;
    }
    give(group, 'Rebar', row.enabled !== false, priorityOf(row.when), { density: id }, row.note);
  }

  for (const row of rules.crews) {
    const group = groupFor(row.when);
    if (group === null) { rest.crews.push(row); continue; }
    converted++;
    const sig = row.trades.map((t) => `${t.trade.toUpperCase()} ${t.size}`).join(', ');
    let id = crews.find((c) => c.trades.map((t) => `${t.trade.toUpperCase()} ${t.size}`).join(', ') === sig)?.id;
    if (!id) {
      id = freshId(crews, sig ? slug(sig.replace(/ /g, '-')) : 'NO-LABOUR');
      crews.push({ id, trades: row.trades.map((t) => ({ trade: t.trade.toUpperCase(), size: t.size })) });
      made.crews++;
    }
    give(group, row.phase, row.enabled !== false, priorityOf(row.when), { crew: id }, row.note);
  }

  for (const row of rules.calendarRules) {
    const group = groupFor(row.when);
    if (group === null) { rest.calendarRules.push(row); continue; }
    converted++;
    give(group, row.phase ?? '', row.enabled !== false, priorityOf(row.when), { calendar: row.calendar }, row.note);
  }

  const kept = rest.durations.length + rest.productivity.length + rest.rebar.length + rest.crews.length + rest.calendarRules.length;
  return {
    rules: { ...rules, groups, rates, crewTemplates: crews, assignments, ...rest },
    converted, kept, ...made,
  };
}
