import type { PourRow } from '../scenarios/pourOrder';
import { assignmentKey, chainKey, type GroupFilter, type RuleGroup, type ScenarioRules, type When } from './rules';
import { assignmentProblems } from './relational';

/** The Rules panel's own reading of a pour: what a `when` is tested against, so the panel can say how many pours a rule fits
    (the generator tests the real records, scenario-engine/core/rules.py; the two follow the same terms). The pour table has no
    "external" / "general type" column, so those terms are not tested here (they count as met). */
export interface PourFact {
  key: string;
  building: string;
  /** L1, L2 ... as the generator names it. */
  level: string;
  levelNumber: number | null;
  /** Upper case with underscores: MAIN_SLAB. */
  type: string;
  stage: string;
  zone: 'disconnected' | 'connected' | '';
  family: string;
  volume: number;
  /** The pour table's columns by name: what a condition on a model property reads. */
  values: Record<string, string>;
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/ /g, '_').toLowerCase();

export function levelNumber(value: unknown): number | null {
  const m = /-?\d+/.exec(String(value ?? ''));
  return m ? Number(m[0]) : null;
}

/** wall, slab, raft, heavyPrecast, precast, landing, stair, pedestal, column, beam, insitu (core/rules.py family_of). */
export function familyOf(type: string, stage: string): string {
  const t = type.replace(/ /g, '_').toUpperCase();
  if (t === 'HEAVY_PRECAST') return 'heavyPrecast';
  if (stage.trim().toUpperCase() === 'PRECAST') return 'precast';
  if (t.includes('WALL')) return 'wall';
  if (t === 'RAFT') return 'raft';
  if (t.includes('LANDING')) return 'landing';
  if (t.includes('STAIR')) return 'stair';
  if (['SLAB', 'PIT', 'FLOOR'].some((w) => t.includes(w))) return 'slab';
  if (t.includes('PEDESTAL')) return 'pedestal';
  if (t.includes('COLUMN')) return 'column';
  if (t.includes('BEAM')) return 'beam';
  return 'insitu';
}

/** The pours of the scenario's table as the rules see them. */
export function factsOf(headers: string[], rows: PourRow[]): PourFact[] {
  const col = (name: string) => headers.indexOf(name);
  const [b, l, t, s, z, v] = ['Building', 'Level', 'Pour Type', 'Concrete Stage', 'Building Zone', 'Pour Volume m3'].map(col);
  return rows.map((r) => {
    const type = String(r.cells[t] ?? '').trim().replace(/ /g, '_').toUpperCase();
    const stage = String(r.cells[s] ?? '').trim();
    const zoneText = String(r.cells[z] ?? '').toUpperCase();
    const level = String(r.cells[l] ?? '').trim();
    return {
      key: r.key,
      building: String(r.cells[b] ?? '').trim(),
      level,
      levelNumber: levelNumber(level),
      type,
      stage,
      zone: zoneText.includes('DISCONNECTED') ? 'disconnected' : zoneText.includes('CONNECTED') ? 'connected' : '',
      family: familyOf(type, stage),
      volume: Number(r.cells[v]) || 0,
      values: Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), String(r.cells[i] ?? '')])),
    };
  });
}

const alternatives = (v: string) => v.split('|').map(norm).filter(Boolean);

/** Whether a pour meets every term of a `when` except `group` (matchesWhen adds that). */
export function matchesTerms(when: When | undefined, f: PourFact): boolean {
  const w = when ?? {};
  const test = (term: string | undefined, have: string) => {
    if (!term || !term.trim()) return true;
    return alternatives(term).includes(norm(have));
  };
  if (!test(w.building, f.building) || !test(w.level, f.level) || !test(w.type, f.type) || !test(w.stage, f.stage) || !test(w.family, f.family)) return false;
  if (w.zone && w.zone.trim() && !alternatives(w.zone).includes(f.zone)) return false;
  if (w.typeNot?.trim() && alternatives(w.typeNot).includes(norm(f.type))) return false;
  const atLeast = w.volumeFrom?.trim() ? Number(w.volumeFrom) : NaN;
  const below = w.volumeBelow?.trim() ? Number(w.volumeBelow) : NaN;
  if ((Number.isFinite(atLeast) && f.volume < atLeast) || (Number.isFinite(below) && f.volume >= below)) return false;
  const lo = levelNumber(w.levelFrom);
  const hi = levelNumber(w.levelTo);
  if (lo !== null || hi !== null) {
    if (f.levelNumber === null || (lo !== null && f.levelNumber < lo) || (hi !== null && f.levelNumber > hi)) return false;
  }
  return true;
}

/** What a condition's field is for one pour: texts (any may match), or a number for the numeric fields; null when the panel cannot tell
    (the pour table has no external / double height / general type column: such a condition counts as met, the generator tests it). */
function fieldOf(f: PourFact, field: string): string[] | number | null | 'unknown' {
  switch (field) {
    case 'building': return [f.building];
    case 'level': return [f.level];
    case 'levelNumber': return f.levelNumber;
    case 'type': return [f.type];
    case 'family': return [f.family];
    case 'stage': return [f.stage];
    case 'zone': return [f.zone];
    case 'volume': return f.volume;
    case 'external': case 'doubleHeight': case 'general': return 'unknown';
    default: {
      if (!field.startsWith('prop:')) return null;
      const name = field.slice(5).split('/').slice(1).join('/').toLowerCase();
      return name in f.values ? [f.values[name]] : null;
    }
  }
}

function filterHolds(c: GroupFilter, f: PourFact): boolean {
  const have = fieldOf(f, c.field);
  if (have === 'unknown') return true;
  const numeric = ['lessThan', 'atMost', 'greaterThan', 'atLeast'].includes(c.op);
  if (numeric) {
    const a = typeof have === 'number' ? have : have && have[0] !== undefined && have[0] !== '' ? Number(have[0]) : NaN;
    const b = Number(c.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return c.op === 'lessThan' ? a < b : c.op === 'atMost' ? a <= b : c.op === 'greaterThan' ? a > b : a >= b;
  }
  const keep = (t: string) => (c.caseSensitive && c.field.startsWith('prop:') ? t : norm(t));
  const texts = (typeof have === 'number' ? [String(have)] : have ?? []).filter((t) => t !== '').map(keep);
  const wanted = (c.op === 'equals' || c.op === 'notEquals' ? c.value.split('|') : [c.value]).filter((w) => w.trim() !== '').map(keep);
  if (!wanted.length) return true;
  const any = (test: (t: string, w: string) => boolean) => texts.some((t) => wanted.some((w) => test(t, w)));
  switch (c.op) {
    case 'equals': return any((t, w) => t === w);
    case 'notEquals': return !any((t, w) => t === w);
    case 'contains': return any((t, w) => t.includes(w));
    case 'notContains': return !any((t, w) => t.includes(w));
    case 'startsWith': return any((t, w) => t.startsWith(w));
    default: return any((t, w) => t.endsWith(w));
  }
}

/** The conditions that count: not switched off, and with a value (as in the 4D groups). */
export const activeFilters = (filters: GroupFilter[] | undefined): GroupFilter[] => (filters ?? []).filter((c) => !c.ignore && c.value.trim() !== '');

/** A pour against a group's conditions, left to right, each joined to the result so far by its And / Or. */
export function matchesFilters(filters: GroupFilter[], f: PourFact): boolean {
  let result: boolean | null = null;
  for (const c of activeFilters(filters)) {
    const holds = filterHolds(c, f);
    result = result === null ? holds : c.conj === 'or' ? result || holds : result && holds;
  }
  return result ?? true;
}

/** The ids of the groups each pour is in (a group's own conditions, or any group it includes). */
export function groupMembership(groups: RuleGroup[], facts: PourFact[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of facts) {
    const direct = new Map<string, boolean>();
    for (const g of groups) direct.set(g.id, activeFilters(g.filters).length > 0 && matchesFilters(g.filters, f));
    for (let pass = 0; pass < groups.length; pass++) {
      let moved = false;
      for (const g of groups) {
        if (direct.get(g.id)) continue;
        if ((g.include ?? []).some((i) => direct.get(i))) {
          direct.set(g.id, true);
          moved = true;
        }
      }
      if (!moved) break;
    }
    out.set(f.key, new Set([...direct].filter(([, inside]) => inside).map(([id]) => id)));
  }
  return out;
}

export function matchesWhen(when: When | undefined, f: PourFact, groupsOf: Map<string, Set<string>>): boolean {
  if (!matchesTerms(when, f)) return false;
  const group = when?.group?.trim();
  if (group) {
    const mine = groupsOf.get(f.key);
    if (!mine || !group.split('|').map((g) => g.trim()).filter(Boolean).some((g) => mine.has(g))) return false;
  }
  return true;
}

/** How many pours each rule group has (a group made per building and level reports its instances too). */
export function groupCounts(rules: ScenarioRules, facts: PourFact[]): Map<string, { pours: number; instances: number }> {
  const membership = groupMembership(rules.groups, facts);
  const out = new Map<string, { pours: number; instances: number }>();
  for (const g of rules.groups) {
    const keys = new Set<string>();
    let pours = 0;
    for (const f of facts) {
      if (!membership.get(f.key)?.has(g.id)) continue;
      pours++;
      keys.add(g.forEach.map((k) => (k === 'building' ? f.building : k === 'level' ? f.level : k === 'zone' ? f.zone : k === 'type' ? f.type : k === 'family' ? f.family : f.stage)).join('|'));
    }
    out.set(g.id, { pours, instances: keys.size });
  }
  return out;
}

/** The pours a `when` fits, for "fits N pours". */
export function countWhen(when: When | undefined, facts: PourFact[], groupsOf: Map<string, Set<string>>): number {
  return facts.reduce((n, f) => n + (matchesWhen(when, f, groupsOf) ? 1 : 0), 0);
}

/** Problems with the rules as written, for the panel to show (a rule that names something that is not there). */
export interface RuleProblem {
  /** A fix the panel can apply for this problem. */
  fix?: 'rebarRate';
  section: string;
  id: string;
  text: string;
}

export function validateRules(rules: ScenarioRules, extraIds: string[] = []): RuleProblem[] {
  const out: RuleProblem[] = [];
  const groupIds = new Set(rules.groups.map((g) => g.id));
  const taskIds = new Set(rules.levelTasks.map((t) => t.id.toUpperCase()));
  const dupes = (section: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.trim()) out.push({ section, id: '', text: 'A row has no id' });
      else if (seen.has(id.toUpperCase())) out.push({ section, id, text: `The id ${id} is used twice` });
      seen.add(id.toUpperCase());
    }
  };
  dupes('groups', rules.groups.map((g) => g.id));
  dupes('levelTasks', rules.levelTasks.map((g) => g.id));
  dupes('sequences', rules.sequences.map((g) => g.id));
  dupes('contacts', rules.contacts.map((g) => g.id));
  dupes('levelLinks', rules.levelLinks.map((g) => g.id));
  dupes('trades', rules.trades.map((g) => g.id));
  dupes('rates', rules.rates.map((g) => g.id));
  dupes('crewTemplates', rules.crewTemplates.map((g) => g.id));
  {
    // A duration worked out from rebar tonnes needs the tonnes: the concrete volume times a rebar rate. With no rebar rate every pour has 0 t.
    const on = <T extends { enabled?: boolean }>(r: T) => r.enabled !== false;
    const rateOf = (id: string | undefined) => rules.rates.find((r) => r.id.toUpperCase() === (id ?? '').toUpperCase());
    const usesRebar = rules.productivity.some((p) => on(p) && p.basis === 'rebar')
      || rules.assignments.some((a) => on(a) && rateOf(a.rate)?.type === 'productivity' && (rateOf(a.rate)?.basis ?? 'rebar') === 'rebar');
    const hasDensity = rules.rebar.some(on) || rules.assignments.some((a) => on(a) && (rateOf(a.rate)?.type === 'rebar' || rateOf(a.density)?.type === 'rebar'));
    if (usesRebar && !hasDensity) {
      out.push({ section: 'productivity', id: '', fix: 'rebarRate', text: 'Durations are worked out from rebar tonnes but no Rebar rate gives tonnes per m³ of concrete, so every pour is taken as 0.25 t per m³ (or the Rebar_kg_per_m3 value the formula of the Rebar task reads). Add a rebar rate to the Rates and put it in the Rebar rate column of an assignment for the Rebar phase to set it yourself' });
    }
  }
  {
    const groupIds = new Set(rules.groups.map((g) => g.id.toUpperCase()));
    const seenChain = new Set<string>();
    const anchors = ['CONCRETE', 'STITCHING', 'INSTALLATION', 'RFC'];
    const byGroup = new Map<string, string[]>();
    for (const x of rules.chains) {
      const key = chainKey(x);
      if (seenChain.has(key)) out.push({ section: 'chains', id: key, text: 'The same phase is twice in this group\'s chain' });
      seenChain.add(key);
      if (x.group.trim() && !groupIds.has(x.group.trim().toUpperCase())) out.push({ section: 'chains', id: key, text: `The group "${x.group}" does not exist` });
      if (!x.phase.trim()) out.push({ section: 'chains', id: key, text: 'A phase is needed' });
      const list = byGroup.get(x.group.trim().toUpperCase()) ?? [];
      list.push(x.phase.trim().toUpperCase());
      byGroup.set(x.group.trim().toUpperCase(), list);
    }
    for (const [group, phases] of byGroup) {
      if (!phases.some((p) => anchors.some((a) => p === a || p.endsWith(a)))) out.push({ section: 'chains', id: `${group}`, text: 'The chain has none of Concrete, Stitching or Installation: the links the generator builds look for one of them' });
    }
  }
  {
    const known = {
      groups: new Set(rules.groups.map((g) => g.id.toUpperCase())),
      rates: new Set(rules.rates.map((r) => r.id.toUpperCase())),
      crews: new Set(rules.crewTemplates.map((r) => r.id.toUpperCase())),
      calendars: new Set(rules.calendars.map((r) => r.id.toUpperCase())),
    };
    const seen = new Set<string>();
    for (const x of rules.assignments) {
      const key = assignmentKey(x);
      if (x.enabled === false) { for (const text of assignmentProblems(x, known)) out.push({ section: 'assignments', id: key, text }); continue; } // (a row switched off may share a key with the one that is on)
      if (seen.has(key)) out.push({ section: 'assignments', id: key, text: 'The same group and phase is assigned twice (the higher priority, then the earlier row, wins)' });
      seen.add(key);
      for (const text of assignmentProblems(x, known)) out.push({ section: 'assignments', id: key, text });
    }
    for (const r of rules.rates) {
      if (r.type === 'productivity' && !(r.manhoursPerUnit && r.manhoursPerUnit > 0)) out.push({ section: 'rates', id: r.id, text: 'A productivity rate needs man-hours per unit' });
      if (r.type === 'productivity' && r.basis === 'property' && !(r.property ?? '').trim()) out.push({ section: 'rates', id: r.id, text: 'Takes its quantity from a model property but names none' });
      if (r.type === 'days' && r.days === undefined) out.push({ section: 'rates', id: r.id, text: 'A days rate needs its days' });
      if (r.type === 'rebar' && !(r.tonnesPerM3 && r.tonnesPerM3 > 0)) out.push({ section: 'rates', id: r.id, text: 'A rebar rate needs tonnes per m³' });
    }
    const tradeCodes = new Set(rules.trades.map((t) => t.id.toUpperCase()));
    for (const c of rules.crewTemplates) {
      if (tradeCodes.size) for (const t of c.trades) if (!tradeCodes.has(t.trade.toUpperCase())) out.push({ section: 'crewTemplates', id: c.id, text: `The trade "${t.trade}" is not in the Trade rules` });
    }
  }
  dupes('calendars', rules.calendars.map((g) => g.id));
  dupes('calendarRules', rules.calendarRules.map((g) => g.id));
  const checkWhen = (section: string, id: string, when: When | undefined) => {
    for (const g of (when?.group ?? '').split('|').map((x) => x.trim()).filter(Boolean)) {
      if (!groupIds.has(g)) out.push({ section, id, text: `Uses the rule group "${g}", which does not exist` });
    }
  };
  for (const r of [...rules.durations, ...rules.productivity, ...rules.rebar, ...rules.crews]) checkWhen('rates', r.id, r.when);
  const calendarIds = new Set(rules.calendars.filter((c) => c.enabled !== false).map((c) => c.id.toUpperCase()));
  for (const c of rules.calendars) {
    if (!c.workDays.length) out.push({ section: 'calendars', id: c.id, text: 'Has no working days' });
    if (!(c.hoursPerDay > 0 && c.hoursPerDay <= 24)) out.push({ section: 'calendars', id: c.id, text: 'Hours per day must be between 0 and 24' });
  }
  if (rules.calendars.length && rules.calendars.filter((c) => c.enabled !== false && c.default).length > 1) out.push({ section: 'calendars', id: '', text: 'More than one calendar is marked default (the first is used)' });
  for (const r of rules.calendarRules) {
    checkWhen('calendarRules', r.id, r.when);
    if (!calendarIds.has(r.calendar.toUpperCase())) out.push({ section: 'calendarRules', id: r.id, text: `The calendar "${r.calendar || '—'}" is not defined (or is switched off)` });
  }
  if (rules.calendarRules.length && !rules.calendars.length) out.push({ section: 'calendarRules', id: '', text: "There are calendar rules but no calendar: the generator's own calendars are used" });
  for (const r of rules.productivity) {
    if (r.basis === 'property' && !(r.property ?? '').trim()) out.push({ section: 'productivity', id: r.id, text: 'Takes its quantity from a model property but names none' });
  }
  for (const g of rules.groups) {
    for (const i of g.include ?? []) if (!groupIds.has(i)) out.push({ section: 'groups', id: g.id, text: `Includes the rule group "${i}", which does not exist` });
    if (!activeFilters(g.filters).length && !(g.include ?? []).length) out.push({ section: 'groups', id: g.id, text: 'Has no conditions with a value and includes no group, so it has no objects' });
  }
  for (const t of rules.levelTasks) {
    if (!groupIds.has(t.group)) out.push({ section: 'levelTasks', id: t.id, text: `Its rule group "${t.group}" does not exist` });
    else if (!rules.groups.find((g) => g.id === t.group)?.forEach.includes('level')) out.push({ section: 'levelTasks', id: t.id, text: `The group "${t.group}" is not made per level, so this gives one task per building, not per level` });
  }
  for (const s of rules.sequences) {
    if (s.steps.length < 2) out.push({ section: 'sequences', id: s.id, text: 'A sequence needs at least two steps' });
    for (const st of s.steps) if (!groupIds.has(st.group)) out.push({ section: 'sequences', id: s.id, text: `Step "${st.group}" is not a rule group` });
  }
  for (const c of rules.contacts) {
    checkWhen('contacts', c.id, c.subject);
    checkWhen('contacts', c.id, c.with);
  }
  for (const l of rules.levelLinks) {
    if (!l.tasks.length && !l.pours) out.push({ section: 'levelLinks', id: l.id, text: 'Names no level task' });
    for (const t of l.tasks) if (!taskIds.has(t.toUpperCase())) out.push({ section: 'levelLinks', id: l.id, text: `The level task "${t}" does not exist` });
    if (l.activities === 'select' && !/^select:/i.test((l.select ?? '').trim())) out.push({ section: 'levelLinks', id: l.id, text: 'The selection should be written select:{...}' });
    if (l.activities === 'extras') {
      const tagged = extraIds.filter((e) => rules.extraTags[e]?.level);
      if (extraIds.length && !tagged.length) out.push({ section: 'levelLinks', id: l.id, text: 'None of the extra activities has a level yet (set it in Extra activities)' });
    }
  }
  return out;
}

/** Each instance of a rule group (one per building / level / ... it is made for) and how many pours it has, for the panel. */
export function groupInstances(group: RuleGroup, facts: PourFact[], membership: Map<string, Set<string>>): { label: string; pours: number; level: number | null }[] {
  const out = new Map<string, { label: string; pours: number; level: number | null }>();
  for (const f of facts) {
    if (!membership.get(f.key)?.has(group.id)) continue;
    const parts = group.forEach.map((k) => (k === 'building' ? f.building : k === 'level' ? f.level : k === 'zone' ? f.zone : k === 'type' ? f.type : k === 'family' ? f.family : f.stage));
    const key = parts.join('|');
    const cur = out.get(key) ?? { label: parts.filter(Boolean).join(' · ') || 'all', pours: 0, level: group.forEach.includes('level') ? f.levelNumber : null };
    cur.pours++;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.label.localeCompare(b.label));
}

/** The order a sequence puts its steps in for the first building (labels), so the panel can show what it will do. */
export function previewSequence(rules: ScenarioRules, seqId: string, facts: PourFact[], membership: Map<string, Set<string>>): string[] {
  const seq = rules.sequences.find((s) => s.id === seqId);
  if (!seq) return [];
  const steps = seq.steps.filter((s) => s.group);
  const has = (group: string, level: string | null, building: string) => facts.some((f) => f.building === building && (level === null || f.level === level) && membership.get(f.key)?.has(group));
  const buildings = [...new Set(facts.map((f) => f.building))].filter(Boolean).sort();
  const building = buildings[0];
  if (!building) return [];
  const levelsOf = (groups: string[]) =>
    [...new Map(facts.filter((f) => f.building === building && groups.some((g) => membership.get(f.key)?.has(g))).map((f) => [f.level, f.levelNumber ?? 0])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  const out: string[] = [];
  let i = 0;
  while (i < steps.length) {
    if (!steps[i].perLevel) {
      if (has(steps[i].group, null, building)) out.push(steps[i].group);
      i++;
      continue;
    }
    let j = i;
    while (j < steps.length && steps[j].perLevel) j++;
    const block = steps.slice(i, j);
    for (const level of levelsOf(block.map((s) => s.group))) for (const s of block) if (has(s.group, level, building)) out.push(`${s.group} ${level}`);
    i = j;
  }
  return out;
}
