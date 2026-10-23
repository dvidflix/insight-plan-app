/** Why a link is in a generated programme, in plain words. The generator labels every link it writes with a source (scenario-engine/core/xml_builder.py
    LINK_SOURCES, written next to the XML as <xml>.why.json); this says what each source means to a planner. A source it does not know is shown as it is. */

export type WhyLink = [pred: string, succ: string, type: string, lagHours: number, source: string];
export interface WhyData { version: number; links: WhyLink[] }

const SHORT: Record<string, string> = { FinishToStart: 'FS', StartToStart: 'SS', FinishToFinish: 'FF', StartToFinish: 'SF' };
export const shortType = (t: string): string => SHORT[t] ?? t;
export const whyKey = (pred: string, succ: string, type: string): string => `${pred}|${succ}|${shortType(type)}`;

const FIXED: Record<string, string> = {
  intra: 'the order of the activities inside the object\u2019s own recipe',
  sequence: 'the order of the work breakdown: this work follows the step before it',
  slab_support: 'what supports it: objects in contact below or beside it (the contact results)',
  level_gate: 'the level gate: work waits for the objects it touches on the level below',
  stair_step: 'the steps of a stair, one after the other',
  heavy_precast_wall: 'precast that has to be in place before the wall it meets',
  heavy_precast_open_end: 'precast with nothing after it, tied to what it holds up',
  extra_activities: 'the extra activity\u2019s own predecessor',
  custom: 'a manual link you made (Rules)',
  group: 'a group milestone',
  completion: 'the building completion milestone',
  closeout: 'the completion milestone: this activity had nothing after it',
  'open-end': 'an object with nothing after it, tied to what sits on it',
  rule: 'a rule of the scenario',
  generated: 'the generator',
};
const PREFIXED: [string, string][] = [
  ['attach:', 'an extra activity attached to a search set or folder'],
  ['limit:', 'a limit on how many of these run at once'],
  ['level-link:', 'a level link: tied to the summary bar of its level'],
  ['level-task:', 'a summary bar, dated from the objects it spans'],
  ['recipe', 'a link between the recipes of two groups'],
  ['contact', 'a contact link rule (objects that touch)'],
  ['sequence:', 'a sequence rule'],
];

export function whyWords(source: string): string {
  if (FIXED[source]) return FIXED[source];
  const hit = PREFIXED.find(([p]) => source.startsWith(p));
  const detail = source.includes(':') ? source.slice(source.indexOf(':') + 1) : '';
  return hit ? `${hit[1]}${detail ? ` (${detail})` : ''}` : source;
}

/** The links of a programme by successor and by predecessor, for the activities' own panel. */
export function indexWhy(data: WhyData | null | undefined): { into: Map<string, WhyLink[]>; out: Map<string, WhyLink[]> } {
  const into = new Map<string, WhyLink[]>();
  const out = new Map<string, WhyLink[]>();
  for (const l of data?.links ?? []) {
    (into.get(l[1]) ?? into.set(l[1], []).get(l[1])!).push(l);
    (out.get(l[0]) ?? out.set(l[0], []).get(l[0])!).push(l);
  }
  return { into, out };
}
