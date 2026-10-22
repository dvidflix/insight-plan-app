import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Activity, RelationType, Relationship, ScheduleModel } from '../schedule/types';
import { recomputeCpm } from '../schedule/cpm';

/** Edits to a programme's activities, kept on top of it instead of in it: they are applied every time the programme loads,
    whether it was generated or imported from XER / XML, so re-importing or regenerating the file does not lose them, and each
    one can be reset. Kept per programme (by its file / scenario name) and per Activity ID, and saved with the project
    (the "schedule." settings go into the project database). */

/** An activity's edited fields as stored: a Date becomes { "$d": ISO }. */
type Stored = Record<string, unknown>;

const DATE_KEY = '$d';
const toStored = (patch: Partial<Activity>): Stored =>
  JSON.parse(
    JSON.stringify(patch, function (this: Record<string, unknown>, key: string, value: unknown) {
      const raw = this[key];
      return raw instanceof Date ? { [DATE_KEY]: raw.toISOString() } : value;
    }),
  );
const fromStored = (stored: Stored): Partial<Activity> =>
  JSON.parse(JSON.stringify(stored), (_k, v) => (v && typeof v === 'object' && typeof (v as Record<string, unknown>)[DATE_KEY] === 'string' ? new Date((v as Record<string, string>)[DATE_KEY]) : v));

/** An edit of one link of a programme, by the Activity IDs at its two ends (so it survives re-importing): a link added, taken
    out, or given another type / lag. */
export interface LinkOp {
  op: 'add' | 'remove' | 'set';
  /** Upper-case Activity IDs of the predecessor and the successor. */
  pred: string;
  succ: string;
  type?: RelationType;
  lagHours?: number;
}

const linkKey = (o: { pred: string; succ: string }) => `${o.pred}>${o.succ}`;

interface OverridesState {
  /** programme key -> the link edits, in the order made. */
  links: Record<string, LinkOp[]>;
  /** Records a link edit: an edit of the same link replaces the earlier one (taking out a link added here just forgets it). */
  setLink: (key: string, op: LinkOp) => void;
  /** Forgets the link edits touching these activities (every one of the programme's when no codes are given). */
  resetLinks: (key: string, codes?: string[]) => void;
  /** programme key -> upper-case Activity ID -> the fields changed. */
  byProgramme: Record<string, Record<string, Stored>>;
  /** Adds (merges) edits for activities of a programme: Activity ID -> fields. */
  set: (key: string, edits: Map<string, Partial<Activity>>) => void;
  /** Removes the edits of these activities (all of the programme's when no codes are given). */
  reset: (key: string, codes?: string[]) => void;
}

const norm = (code: string) => code.trim().toUpperCase();

export const useActivityOverridesStore = create<OverridesState>()(
  persist(
    (set) => ({
      byProgramme: {},
      links: {},
      setLink: (key, op) =>
        set((s) => {
          const mine = s.links[key] ?? [];
          const clean = { ...op, pred: norm(op.pred), succ: norm(op.succ) };
          const old = mine.find((o) => linkKey(o) === linkKey(clean));
          let next: LinkOp | null = clean;
          if (old?.op === 'add') next = clean.op === 'remove' ? null : { ...old, type: clean.type ?? old.type, lagHours: clean.lagHours ?? old.lagHours };
          else if (old?.op === 'set' && clean.op === 'set') next = { ...old, ...clean };
          const rest = mine.filter((o) => linkKey(o) !== linkKey(clean));
          const links = { ...s.links };
          const list = next ? [...rest, next] : rest;
          if (list.length) links[key] = list;
          else delete links[key];
          return { links };
        }),
      resetLinks: (key, codes) =>
        set((s) => {
          const links = { ...s.links };
          const gone = codes ? new Set(codes.map(norm)) : null;
          const list = gone ? (links[key] ?? []).filter((o) => !gone.has(o.pred) && !gone.has(o.succ)) : [];
          if (list.length) links[key] = list;
          else delete links[key];
          return { links };
        }),
      set: (key, edits) =>
        set((s) => {
          const mine = { ...(s.byProgramme[key] ?? {}) };
          for (const [code, patch] of edits) mine[norm(code)] = { ...mine[norm(code)], ...toStored(patch) };
          return { byProgramme: { ...s.byProgramme, [key]: mine } };
        }),
      reset: (key, codes) =>
        set((s) => {
          const byProgramme = { ...s.byProgramme };
          if (!codes) delete byProgramme[key];
          else {
            const mine = { ...(byProgramme[key] ?? {}) };
            for (const c of codes) delete mine[norm(c)];
            if (Object.keys(mine).length) byProgramme[key] = mine;
            else delete byProgramme[key];
          }
          return { byProgramme };
        }),
    }),
    { name: 'schedule.activityOverrides' },
  ),
);

/** Fields that move the dates: when one is edited the programme is calculated again. */
const DRIVES_DATES = ['durationHours', 'remainingDurationHours', 'calendarId', 'constraintType', 'constraintDate', 'status', 'actualStart', 'actualFinish', 'secondaryConstraintType', 'secondaryConstraintDate', 'earlyStart', 'earlyFinish', 'targetStart', 'targetFinish'];
const DATE_FIELDS = ['earlyStart', 'earlyFinish', 'targetStart', 'targetFinish', 'actualStart', 'actualFinish'] as const;

/** The programme with its edits applied (matched by Activity ID). When an edit changes what drives the dates (a duration, a
    calendar, a constraint or a date), the dates and float are calculated again from the links, each activity that no link
    drives keeping where it starts; an edited date stays as it was edited. */
export function withOverrides(m: ScheduleModel, edits: Record<string, Stored> | undefined, linkOps: LinkOp[] | undefined = undefined): ScheduleModel {
  const hasLinks = !!linkOps && linkOps.length > 0;
  if ((!edits || Object.keys(edits).length === 0) && !hasLinks) return m;
  let touched = 0;
  let drives = false;
  const patches = new Map<string, Partial<Activity>>();
  const activities = m.activities.map((a) => {
    const stored = edits?.[norm(a.code)];
    if (!stored) return a;
    const patch = fromStored(stored);
    patches.set(a.id, patch);
    touched++;
    if (Object.keys(patch).some((k) => DRIVES_DATES.includes(k))) drives = true;
    return { ...a, ...patch };
  });
  let relationships = m.relationships;
  if (hasLinks) {
    const idOf = new Map(m.activities.map((a) => [norm(a.code), a.id]));
    // Two activities may be joined by more than one link (a start-to-start and a finish-to-finish, as an overlap is written): the links are
    // kept as a list, and an edit touches the links of its own pair only, never collapses them to one.
    let list = [...m.relationships];
    for (const o of linkOps!) {
      const pred = idOf.get(o.pred);
      const succ = idOf.get(o.succ);
      if (!pred || !succ || pred === succ) continue;
      const pair = (r: Relationship) => r.predId === pred && r.succId === succ;
      if (o.op === 'remove') list = list.filter((r) => !pair(r));
      else if (o.op === 'add') {
        const type = o.type ?? 'FS';
        list = [...list.filter((r) => !(pair(r) && r.type === type)), { predId: pred, succId: succ, type, lagHours: o.lagHours ?? 0 }];
      } else {
        // An edit of the link: the one of the pair that has the type it names, else the pair's first.
        const at = list.findIndex((r) => pair(r) && r.type === o.type);
        const first = at >= 0 ? at : list.findIndex(pair);
        if (first >= 0) list[first] = { ...list[first], type: o.type ?? list[first].type, lagHours: o.lagHours ?? list[first].lagHours };
      }
    }
    relationships = list;
    touched++;
    drives = true;
  }
  if (touched === 0) return m;
  const edited = { ...m, activities, relationships };
  if (!drives) return edited;
  const calc = recomputeCpm(edited, { keepOwnStarts: true });
  return {
    ...calc,
    activities: calc.activities.map((a) => {
      const patch = patches.get(a.id);
      if (!patch) return a;
      const keep: Partial<Activity> = {};
      for (const k of DATE_FIELDS) if (k in patch) keep[k] = patch[k] as never;
      return { ...a, ...keep };
    }),
  };
}

/** The programme with these edits and link edits made in it (not kept on top): what editing an editable programme does. Dates and float
    are calculated again when the edits change what drives them, as withOverrides does. */
export function applyEdits(m: ScheduleModel, edits: Map<string, Partial<Activity>>, linkOps?: LinkOp[]): ScheduleModel {
  const stored: Record<string, Stored> = {};
  for (const [code, patch] of edits) stored[norm(code)] = toStored(patch);
  const out = withOverrides(m, stored, linkOps);
  return out === m ? m : { ...out, id: m.id, dbProgrammeId: m.dbProgrammeId, editable: m.editable, sourceFileName: m.sourceFileName };
}

/** How many activities of a programme carry edits. */
export const overrideCount = (byProgramme: OverridesState['byProgramme'], key: string, links: OverridesState['links'] = {}) => Object.keys(byProgramme[key] ?? {}).length + (links[key]?.length ?? 0);
