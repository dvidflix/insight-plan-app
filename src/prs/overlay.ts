import type { ScenarioCrew, ScenarioExtra, ScenarioRelation } from '../scenarios/api';
import {
  NO_RULES, WHEN_KEYS, cleanWhen, isEmptyRules, normalizeRules,
  type Assignment, type CalendarRow, type ChainRow, type CalendarRule, type ContactRule, type CrewTemplate, type RateRow, type TradeRow, type CrewRule, type DurationRow, type GroupFilter, type LevelLink, type LevelTask, type ProductivityRow, type RebarRow, type RelType, type RuleGroup,
  type RuleSequence, type ScenarioRules, type SettingValue, type When,
} from './rules';

/** A scenario's rules as a Programme Rules file (docs/programme-rules): the extra activities, manual links and crews, and the
    programme rules (settings, durations, productivity, rebar, crew rules, rule groups, level tasks, sequences, contact links,
    level links). The Rules panel exports and imports this, so a set of rules can move between scenarios and projects, or be
    kept next to the project's main rules file. */
export interface RulesOverlay {
  extras: ScenarioExtra[];
  links: ScenarioRelation[];
  crews: ScenarioCrew[];
  /** The programme rules (absent in files written by earlier versions of the panel). */
  rules?: ScenarioRules;
}

const NS = 'https://insightplan.app/prs/1.0';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** ` name="value"`, or nothing for an empty value. */
const a = (name: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : ` ${name}="${esc(v)}"`);
const flag = (name: string, v: boolean | undefined) => (v ? ` ${name}="true"` : '');

const whenXml = (tag: string, when: When | undefined, pad = '        '): string => {
  const w = cleanWhen(when ?? {});
  const attrs = WHEN_KEYS.map((k) => a(k, w[k])).join('');
  return attrs ? `\n${pad}<${tag}${attrs}/>` : '';
};
const rowHead = (r: { id: string; enabled?: boolean; note?: string }) => `id="${esc(r.id)}"${r.enabled === false ? ' enabled="false"' : ''}${a('note', r.note)}`;

export function serializeOverlay(o: RulesOverlay, title: string): string {
  const rules = o.rules ?? NO_RULES;
  const tag = (id: string) => rules.extraTags[id] ?? rules.extraTags[id.toUpperCase()] ?? {};
  const extras = o.extras
    .map((e) => `    <activity id="${esc(e.TaskID)}" name="${esc(e.Name)}" duration="${esc(e.DurationDays)}"${a('baselineStart', e.BaselineStart)}${a('baselineFinish', e.BaselineFinish)}${a('building', tag(e.TaskID).building)}${a('level', tag(e.TaskID).level)}${a('wbs', tag(e.TaskID).wbs)}${a('task', tag(e.TaskID).task)}${a('kind', tag(e.TaskID).kind)}/>`)
    .join('\n');
  const links = o.links
    .map((l, i) => `    <link id="L-${String(i + 1).padStart(2, '0')}" from="${esc(l.ActivityID1)}" to="${esc(l.ActivityID2)}" type="${esc(l.Relation)}" lag="${esc(l.Lag)}"/>`)
    .join('\n');
  const crews = o.crews.map((c) => `      <crew phase="${esc(c.Phase)}"${c.PourType ? ` pourType="${esc(c.PourType)}"` : ''} trade="${esc(c.Trade)}" size="${esc(c.Crew)}"/>`).join('\n');

  const settings = Object.entries(rules.settings)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `    <setting key="${esc(k)}" value="${esc(Array.isArray(v) ? v.join(',') : v)}"/>`)
    .join('\n');
  const durations = rules.durations
    .map((r) => `      <row ${rowHead(r)}>${whenXml('when', r.when)}\n${Object.entries(r.phases).map(([p, d]) => `        <days phase="${esc(p)}" value="${esc(d)}"/>`).join('\n')}\n      </row>`)
    .join('\n');
  const productivity = rules.productivity
    .map((r) => `      <row ${rowHead(r)} phase="${esc(r.phase)}" basis="${esc(r.basis)}"${r.basis === 'property' ? `${a('pset', r.pset)}${a('property', r.property)}${a('factor', r.factor)}${a('fallback', r.fallback)}` : ''} manhoursPerUnit="${esc(r.manhoursPerUnit)}" crew="${esc(r.crew)}" shifts="${esc(r.shifts)}" hoursPerShift="${esc(r.hoursPerShift)}" rounding="${esc(r.rounding)}" minDays="${esc(r.minDays)}">${whenXml('when', r.when)}\n      </row>`)
    .join('\n');
  const rebar = rules.rebar.map((r) => `      <row ${rowHead(r)} tonnesPerM3="${esc(r.tonnesPerM3)}">${whenXml('when', r.when)}\n      </row>`).join('\n');
  const crewRules = rules.crews
    .map((r) => `      <row ${rowHead(r)} phase="${esc(r.phase)}">${whenXml('when', r.when)}\n${r.trades.map((t) => `        <trade ref="${esc(t.trade)}" size="${esc(t.size)}"/>`).join('\n')}\n      </row>`)
    .join('\n');
  const groups = rules.groups
    .map((g) => `    <ruleGroup ${rowHead(g)}${a('name', g.name)}${a('treatAs', g.treatAs)}${a('forEach', g.forEach.join(' '))}${a('include', (g.include ?? []).join(' '))}>${g.filters.map((c) => `\n      <filter field="${esc(c.field)}" op="${esc(c.op)}" value="${esc(c.value)}"${c.conj === 'or' ? ' conj="or"' : ''}${flag('caseSensitive', c.caseSensitive)}${flag('ignore', c.ignore)}/>`).join('')}\n    </ruleGroup>`)
    .join('\n');
  const levelTasks = rules.levelTasks.map((t) => `    <task ${rowHead(t)} name="${esc(t.name)}" ruleGroup="${esc(t.group)}" dates="rollup"/>`).join('\n');
  const sequences = rules.sequences
    .map((s) => `    <sequence ${rowHead(s)}${a('name', s.name)}${a('type', s.type)}${a('lagHours', s.lagHours)}>\n${s.steps.map((st) => `      <step ruleGroup="${esc(st.group)}"${st.perLevel ? ' perLevel="true"' : ''}/>`).join('\n')}\n    </sequence>`)
    .join('\n');
  const contacts = rules.contacts
    .map(
      (c) =>
        `    <contact ${rowHead(c)}${a('name', c.name)} contact="${esc(c.contact)}"${a('position', c.position)} predEnd="${esc(c.predEnd)}" succEnd="${esc(c.succEnd)}"${a('direction', c.direction)}${a('type', c.type)}${a('lagHours', c.lagHours)}${a('maxLevelGap', c.maxLevelGap)}${flag('ignoreStage2', c.ignoreStage2)}${a('replaceBuiltIn', (c.replaceBuiltIn ?? []).join(' '))}>${whenXml('subject', c.subject, '      ')}${whenXml('with', c.with, '      ')}\n    </contact>`,
    )
    .join('\n');
  const trades = rules.trades.map((t) => `    <trade ${rowHead(t)}${a('name', t.name)}${a('capacity', t.capacity)}/>`).join('\n');
  const calendars = rules.calendars
    .map((c) => `    <calendar ${rowHead(c)}${a('name', c.name)} workDays="${esc(c.workDays.join(' '))}"${a('start', c.start)}${a('hoursPerDay', c.hoursPerDay)}${flag('default', c.default)}/>`)
    .join('\n');
  const calendarRules = rules.calendarRules
    .map((r) => `    <calendarRule ${rowHead(r)}${a('phase', r.phase)} calendar="${esc(r.calendar)}">${whenXml('when', r.when)}\n    </calendarRule>`)
    .join('\n');
  const rateRows = rules.rates
    .map((r) => `    <rate ${rowHead(r)} type="${esc(r.type)}"${a('days', r.days)}${a('tonnesPerM3', r.tonnesPerM3)}${a('basis', r.basis)}${a('pset', r.pset)}${a('property', r.property)}${a('factor', r.factor)}${a('fallback', r.fallback)}${a('manhoursPerUnit', r.manhoursPerUnit)}${a('people', r.people)}${a('shifts', r.shifts)}${a('hoursPerShift', r.hoursPerShift)}${a('rounding', r.rounding)}${a('minDays', r.minDays)}/>`)
    .join('\n');
  const crewTemplates = rules.crewTemplates
    .map((c) => `    <crew ${rowHead(c)}>\n${c.trades.map((t) => `      <trade ref="${esc(t.trade)}" size="${esc(t.size)}"/>`).join('\n')}\n    </crew>`)
    .join('\n');
  const assignmentRows = rules.assignments
    .map((x) => `    <assignment${x.enabled === false ? ' enabled="false"' : ''}${a('note', x.note)} group="${esc(x.group)}" phase="${esc(x.phase)}"${a('rate', x.rate)}${a('density', x.density)}${a('days', x.days)}${a('crew', x.crew)}${a('calendar', x.calendar)}${a('priority', x.priority)}/>`)
    .join('\n');
  const chainRows = rules.chains
    .map((x) => `    <chain${x.enabled === false ? ' enabled="false"' : ''}${a('note', x.note)} group="${esc(x.group)}" order="${esc(x.order)}" phase="${esc(x.phase)}"${a('suffix', x.suffix)}${a('label', x.label)}${a('material', x.material)}${a('follows', x.follows)}${x.finishAfter ? ' finishAfter="true"' : ''}${x.gates ? ' gates="true"' : ''}${a('priority', x.priority)}/>`)
    .join('\n');
  const levelLinks = rules.levelLinks
    .map((l) => `    <levelLink ${rowHead(l)}${a('name', l.name)} activities="${esc(l.activities)}"${a('select', l.select)}${a('pours', l.pours)} tasks="${esc(l.tasks.join(' '))}"${a('type', l.type)}${a('lagHours', l.lagHours)}${a('direction', l.direction)}/>`)
    .join('\n');

  const rates = [durations && `    <durations>\n${durations}\n    </durations>`, productivity && `    <productivity>\n${productivity}\n    </productivity>`, rebar && `    <rebar>\n${rebar}\n    </rebar>`, crewRules && `    <crewRules>\n${crewRules}\n    </crewRules>`].filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Programme rules: this scenario's extra activities, manual links, crews and programme rules. See docs/programme-rules. -->
<prs xmlns="${NS}" version="1.0">
  <info>
    <title>${esc(title)}</title>
    <date>${new Date().toISOString().slice(0, 10)}</date>
  </info>
  <extras>
${extras}
  </extras>
  <links>
${links}
  </links>
  <resources>
    <crews>
${crews}
    </crews>
  </resources>
${rateRows ? `  <rateTable>\n${rateRows}\n  </rateTable>\n` : ''}${crewTemplates ? `  <crewTemplates>\n${crewTemplates}\n  </crewTemplates>\n` : ''}${assignmentRows ? `  <assignments>\n${assignmentRows}\n  </assignments>\n` : ''}${chainRows ? `  <chains>\n${chainRows}\n  </chains>\n` : ''}${trades ? `  <trades>\n${trades}\n  </trades>\n` : ''}${calendars ? `  <calendars>\n${calendars}\n  </calendars>\n` : ''}${calendarRules ? `  <calendarRules>\n${calendarRules}\n  </calendarRules>\n` : ''}${settings ? `  <settings>\n${settings}\n  </settings>\n` : ''}${rates ? `  <rates>\n${rates}\n  </rates>\n` : ''}${groups ? `  <ruleGroups>\n${groups}\n  </ruleGroups>\n` : ''}${levelTasks ? `  <levelTasks>\n${levelTasks}\n  </levelTasks>\n` : ''}${sequences ? `  <sequences>\n${sequences}\n  </sequences>\n` : ''}${contacts ? `  <contacts>\n${contacts}\n  </contacts>\n` : ''}${levelLinks ? `  <levelLinks>\n${levelLinks}\n  </levelLinks>\n` : ''}</prs>
`;
}

const attr = (el: Element, name: string) => (el.getAttribute(name) ?? '').trim();
const has = (el: Element, name: string) => el.hasAttribute(name);
const num = (el: Element, name: string, fallback = 0) => {
  const v = attr(el, name);
  return v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v);
};
const section = (doc: Document, name: string): Element | undefined => doc.getElementsByTagName(name)[0];
const within = (doc: Document, sec: string, item: string): Element[] => {
  const s = section(doc, sec);
  return s ? [...s.getElementsByTagName(item)] : [];
};
const children = (el: Element, name: string): Element[] => [...el.children].filter((c) => c.localName === name);
const words = (v: string) => v.split(/[\s,]+/).filter(Boolean);
const readWhen = (parent: Element, tag: string): When => {
  const el = children(parent, tag)[0];
  const out: When = {};
  if (el) for (const k of WHEN_KEYS) if (attr(el, k)) out[k] = attr(el, k);
  return out;
};
const readRow = (el: Element) => ({ id: attr(el, 'id'), ...(attr(el, 'enabled') === 'false' ? { enabled: false } : {}), ...(attr(el, 'note') ? { note: attr(el, 'note') } : {}) });
const relType = (v: string): RelType | undefined => (['FS', 'SS', 'FF', 'SF'].includes(v.toUpperCase()) ? (v.toUpperCase() as RelType) : undefined);

function readRules(doc: Document): ScenarioRules {
  const settings: Record<string, SettingValue> = {};
  for (const s of within(doc, 'settings', 'setting')) {
    const key = attr(s, 'key');
    const value = attr(s, 'value');
    if (!key) continue;
    settings[key] = value === 'true' ? true : value === 'false' ? false : key === 'excludedPourTypes' ? value.split(',').map((x) => x.trim()).filter(Boolean) : Number.isFinite(Number(value)) && value !== '' ? Number(value) : undefined;
  }
  const rates = section(doc, 'rates');
  const rows = (name: string) => (rates ? [...(children(rates, name)[0]?.children ?? [])].filter((r) => r.localName === 'row') : []);
  const durations: DurationRow[] = rows('durations').map((r) => ({
    ...readRow(r),
    when: readWhen(r, 'when'),
    phases: Object.fromEntries(children(r, 'days').map((d) => [attr(d, 'phase'), num(d, 'value')]).filter(([p]) => p)),
  }));
  const productivity: ProductivityRow[] = rows('productivity').map((r) => ({
    ...readRow(r),
    when: readWhen(r, 'when'),
    phase: attr(r, 'phase'),
    basis: (['concrete', 'footprint', 'sides', 'property'].includes(attr(r, 'basis')) ? attr(r, 'basis') : 'rebar') as ProductivityRow['basis'],
    ...(attr(r, 'basis') === 'property'
      ? {
          ...(attr(r, 'pset') ? { pset: attr(r, 'pset') } : {}),
          property: attr(r, 'property'),
          ...(attr(r, 'factor') !== '' ? { factor: num(r, 'factor', 1) } : {}),
          ...(['rebar', 'concrete', 'none'].includes(attr(r, 'fallback')) ? { fallback: attr(r, 'fallback') as ProductivityRow['fallback'] } : {}),
        }
      : {}),
    manhoursPerUnit: num(r, 'manhoursPerUnit'),
    crew: num(r, 'crew'),
    shifts: num(r, 'shifts', 1),
    hoursPerShift: num(r, 'hoursPerShift', 8),
    rounding: (['ceil', 'round', 'none'].includes(attr(r, 'rounding')) ? attr(r, 'rounding') : 'ceil') as ProductivityRow['rounding'],
    minDays: num(r, 'minDays'),
  }));
  const rebar: RebarRow[] = rows('rebar').map((r) => ({ ...readRow(r), when: readWhen(r, 'when'), tonnesPerM3: num(r, 'tonnesPerM3') }));
  const crews: CrewRule[] = rows('crewRules').map((r) => ({
    ...readRow(r),
    when: readWhen(r, 'when'),
    phase: attr(r, 'phase'),
    trades: children(r, 'trade').map((t) => ({ trade: attr(t, 'ref').toUpperCase(), size: num(t, 'size') })),
  }));
  const groups: RuleGroup[] = within(doc, 'ruleGroups', 'ruleGroup').map((g) => ({
    ...readRow(g),
    ...(attr(g, 'name') ? { name: attr(g, 'name') } : {}),
    ...(['exclude', 'stairStep'].includes(attr(g, 'treatAs')) ? { treatAs: attr(g, 'treatAs') as RuleGroup['treatAs'] } : {}),
    forEach: words(attr(g, 'forEach')) as RuleGroup['forEach'],
    // (a group written with a <select> of key = value terms is read as rows by normalizeRules)
    select: readWhen(g, 'select'),
    filters: children(g, 'filter').map((c, i): GroupFilter => ({ id: `c${i + 1}`, field: attr(c, 'field'), op: (attr(c, 'op') || 'equals') as GroupFilter['op'], value: attr(c, 'value'), conj: attr(c, 'conj') === 'or' ? 'or' : 'and', ...(attr(c, 'caseSensitive') === 'true' ? { caseSensitive: true } : {}), ...(attr(c, 'ignore') === 'true' ? { ignore: true } : {}) })),
    ...(attr(g, 'include') ? { include: words(attr(g, 'include')) } : {}),
  }));
  const levelTasks: LevelTask[] = within(doc, 'levelTasks', 'task').map((t) => ({ ...readRow(t), name: attr(t, 'name'), group: attr(t, 'ruleGroup') }));
  const sequences: RuleSequence[] = within(doc, 'sequences', 'sequence').map((s) => ({
    ...readRow(s),
    ...(attr(s, 'name') ? { name: attr(s, 'name') } : {}),
    ...(relType(attr(s, 'type')) ? { type: relType(attr(s, 'type')) } : {}),
    ...(has(s, 'lagHours') ? { lagHours: num(s, 'lagHours') } : {}),
    steps: children(s, 'step').map((st) => ({ group: attr(st, 'ruleGroup'), ...(attr(st, 'perLevel') === 'true' ? { perLevel: true } : {}) })),
  }));
  const contacts: ContactRule[] = within(doc, 'contacts', 'contact').map((c) => ({
    ...readRow(c),
    ...(attr(c, 'name') ? { name: attr(c, 'name') } : {}),
    subject: readWhen(c, 'subject'),
    with: readWhen(c, 'with'),
    contact: (['below', 'above', 'side', 'any'].includes(attr(c, 'contact')) ? attr(c, 'contact') : 'below') as ContactRule['contact'],
    ...(attr(c, 'position') ? { position: attr(c, 'position') as ContactRule['position'] } : {}),
    predEnd: (['final', 'start', 'last'].includes(attr(c, 'predEnd')) ? attr(c, 'predEnd') : 'final') as ContactRule['predEnd'],
    succEnd: (['start', 'final', 'last'].includes(attr(c, 'succEnd')) ? attr(c, 'succEnd') : 'start') as ContactRule['succEnd'],
    ...(attr(c, 'direction') ? { direction: attr(c, 'direction') as ContactRule['direction'] } : {}),
    ...(relType(attr(c, 'type')) ? { type: relType(attr(c, 'type')) } : {}),
    ...(has(c, 'lagHours') ? { lagHours: num(c, 'lagHours') } : {}),
    ...(attr(c, 'maxLevelGap') !== '' ? { maxLevelGap: num(c, 'maxLevelGap') } : {}),
    ...(attr(c, 'ignoreStage2') === 'true' ? { ignoreStage2: true } : {}),
    ...(attr(c, 'replaceBuiltIn') ? { replaceBuiltIn: words(attr(c, 'replaceBuiltIn')) as ContactRule['replaceBuiltIn'] } : {}),
  }));
  const levelLinks: LevelLink[] = within(doc, 'levelLinks', 'levelLink').map((l) => ({
    ...readRow(l),
    ...(attr(l, 'name') ? { name: attr(l, 'name') } : {}),
    activities: (['extras', 'open', 'select'].includes(attr(l, 'activities')) ? attr(l, 'activities') : 'extras') as LevelLink['activities'],
    ...(attr(l, 'select') ? { select: attr(l, 'select') } : {}),
    ...(attr(l, 'pours') ? { pours: attr(l, 'pours') } : {}),
    tasks: words(attr(l, 'tasks')),
    ...(relType(attr(l, 'type')) ? { type: relType(attr(l, 'type')) } : {}),
    ...(has(l, 'lagHours') ? { lagHours: num(l, 'lagHours') } : {}),
    ...(attr(l, 'direction') ? { direction: attr(l, 'direction') as LevelLink['direction'] } : {}),
  }));
  const rateTable: RateRow[] = within(doc, 'rateTable', 'rate').map((r) => ({
    ...readRow(r),
    type: (['productivity', 'rebar'].includes(attr(r, 'type')) ? attr(r, 'type') : 'days') as RateRow['type'],
    ...(attr(r, 'days') !== '' ? { days: num(r, 'days') } : {}),
    ...(attr(r, 'tonnesPerM3') !== '' ? { tonnesPerM3: num(r, 'tonnesPerM3') } : {}),
    ...(attr(r, 'basis') ? { basis: attr(r, 'basis') as RateRow['basis'] } : {}),
    ...(attr(r, 'pset') ? { pset: attr(r, 'pset') } : {}),
    ...(attr(r, 'property') ? { property: attr(r, 'property') } : {}),
    ...(attr(r, 'factor') !== '' ? { factor: num(r, 'factor', 1) } : {}),
    ...(attr(r, 'fallback') ? { fallback: attr(r, 'fallback') as RateRow['fallback'] } : {}),
    ...(attr(r, 'manhoursPerUnit') !== '' ? { manhoursPerUnit: num(r, 'manhoursPerUnit') } : {}),
    ...(attr(r, 'people') !== '' ? { people: num(r, 'people') } : {}),
    ...(attr(r, 'shifts') !== '' ? { shifts: num(r, 'shifts', 1) } : {}),
    ...(attr(r, 'hoursPerShift') !== '' ? { hoursPerShift: num(r, 'hoursPerShift', 8) } : {}),
    ...(attr(r, 'rounding') ? { rounding: attr(r, 'rounding') as RateRow['rounding'] } : {}),
    ...(attr(r, 'minDays') !== '' ? { minDays: num(r, 'minDays') } : {}),
  }));
  const crewTemplates: CrewTemplate[] = within(doc, 'crewTemplates', 'crew').map((c) => ({
    ...readRow(c),
    trades: children(c, 'trade').map((t) => ({ trade: attr(t, 'ref').toUpperCase(), size: num(t, 'size') })),
  }));
  const assignments: Assignment[] = within(doc, 'assignments', 'assignment').map((x) => ({
    id: `${attr(x, 'group')}|${attr(x, 'phase')}`.toUpperCase(),
    ...(attr(x, 'enabled') === 'false' ? { enabled: false } : {}),
    ...(attr(x, 'note') ? { note: attr(x, 'note') } : {}),
    group: attr(x, 'group'),
    phase: attr(x, 'phase'),
    ...(attr(x, 'rate') ? { rate: attr(x, 'rate') } : {}),
    ...(attr(x, 'density') ? { density: attr(x, 'density') } : {}),
    ...(attr(x, 'days') !== '' ? { days: num(x, 'days') } : {}),
    ...(attr(x, 'crew') ? { crew: attr(x, 'crew') } : {}),
    ...(attr(x, 'calendar') ? { calendar: attr(x, 'calendar') } : {}),
    ...(attr(x, 'priority') !== '' ? { priority: num(x, 'priority') } : {}),
  }));
  const chains: ChainRow[] = within(doc, 'chains', 'chain').map((x) => ({
    id: `${attr(x, 'group')}|${attr(x, 'phase')}`.toUpperCase(),
    ...(attr(x, 'enabled') === 'false' ? { enabled: false } : {}),
    ...(attr(x, 'note') ? { note: attr(x, 'note') } : {}),
    group: attr(x, 'group'),
    order: num(x, 'order'),
    phase: attr(x, 'phase'),
    ...(attr(x, 'suffix') ? { suffix: attr(x, 'suffix') } : {}),
    ...(attr(x, 'label') ? { label: attr(x, 'label') } : {}),
    ...(['rebar', 'concrete'].includes(attr(x, 'material')) ? { material: attr(x, 'material') as ChainRow['material'] } : {}),
    ...(attr(x, 'follows') ? { follows: attr(x, 'follows') } : {}),
    ...(attr(x, 'finishAfter') === 'true' ? { finishAfter: true } : {}),
    ...(attr(x, 'gates') === 'true' ? { gates: true } : {}),
    ...(attr(x, 'priority') !== '' ? { priority: num(x, 'priority') } : {}),
  }));
  const trades: TradeRow[] = within(doc, 'trades', 'trade').map((t) => ({ ...readRow(t), name: attr(t, 'name'), capacity: num(t, 'capacity') }));
  const calendars: CalendarRow[] = within(doc, 'calendars', 'calendar').map((c) => ({
    ...readRow(c),
    name: attr(c, 'name'),
    workDays: words(attr(c, 'workDays')).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    start: attr(c, 'start') || '09:00',
    hoursPerDay: num(c, 'hoursPerDay', 8),
    ...(attr(c, 'default') === 'true' ? { default: true } : {}),
  }));
  const calendarRules: CalendarRule[] = within(doc, 'calendarRules', 'calendarRule').map((r) => ({
    ...readRow(r),
    when: readWhen(r, 'when'),
    ...(attr(r, 'phase') ? { phase: attr(r, 'phase') } : {}),
    calendar: attr(r, 'calendar'),
  }));
  const extraTags: ScenarioRules['extraTags'] = {};
  for (const e of within(doc, 'extras', 'activity')) {
    const id = attr(e, 'id');
    const tag = Object.fromEntries((['building', 'level', 'wbs', 'task', 'kind'] as const).filter((k) => attr(e, k)).map((k) => [k, attr(e, k)]));
    if (id && Object.keys(tag).length) extraTags[id] = tag;
  }
  const rules = normalizeRules({ version: 1, settings, durations, productivity, rebar, crews, rates: rateTable, crewTemplates, assignments, chains, trades, calendars, calendarRules, groups, levelTasks, sequences, contacts, levelLinks, extraTags });
  return isEmptyRules(rules) ? NO_RULES : rules;
}

/** What is in a Programme Rules file. A file with none of the sections is refused. */
export function parseOverlay(xml: string): RulesOverlay {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This is not a readable XML file.');
  if (doc.documentElement.localName !== 'prs') throw new Error('This is not a Programme Rules file (its root is not <prs>).');
  const extras = within(doc, 'extras', 'activity').map((e) => ({
    TaskID: attr(e, 'id'),
    Name: attr(e, 'name'),
    DurationDays: Number(attr(e, 'duration')) || 0,
    BaselineStart: attr(e, 'baselineStart'),
    BaselineFinish: attr(e, 'baselineFinish'),
  }));
  const links = within(doc, 'links', 'link').map((l) => ({
    ActivityID1: attr(l, 'from'),
    ActivityID2: attr(l, 'to'),
    Relation: (attr(l, 'type') || 'FS').toUpperCase(),
    Lag: Number(attr(l, 'lag')) || 0,
  }));
  const crews = within(doc, 'crews', 'crew').map((c) => ({ Phase: attr(c, 'phase'), PourType: attr(c, 'pourType'), Trade: attr(c, 'trade').toUpperCase(), Crew: attr(c, 'size') }));
  const rules = readRules(doc);
  const known = ['extras', 'links', 'crews', 'rateTable', 'crewTemplates', 'assignments', 'chains', 'trades', 'calendars', 'calendarRules', 'settings', 'rates', 'ruleGroups', 'levelTasks', 'sequences', 'contacts', 'levelLinks'];
  if (!extras.length && !links.length && !crews.length && isEmptyRules(rules) && !known.some((k) => doc.getElementsByTagName(k).length)) {
    throw new Error('The file has no extra activities, links, crews or rules.');
  }
  return {
    extras: extras.filter((e) => e.TaskID),
    links: links.filter((l) => l.ActivityID1 && l.ActivityID2),
    crews: crews.filter((c) => c.Phase && c.Trade),
    rules,
  };
}
