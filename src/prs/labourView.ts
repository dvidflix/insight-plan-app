import { freshId, type CrewTemplate, type QuantityBasis, type RateRow, type TradeRow } from './rules';
import type { Recipe } from './recipes';

/** The Labour table, as a view over data the scenario already has: nothing is stored for it. A row is a trade; its numbers come from the trade (people on
    site), from the crew its work is done by (how many crews: "gangs") and from the productivity rate of the recipe activities that crew does. Reading
    and writing go to those rows, so the generator, the saved file and the workbook are as they were.

    How a trade is tied to an activity: a recipe task names a crew and a rate. The labour's crew is a crew that has the trade in it; its work is the tasks that
    name that crew and a productivity rate; "Used for" is the phase of those tasks. Changing "Used for" moves the rate (and the crew, where the task has none)
    to the tasks of the other phase. */

export interface LabourRow {
  code: string;
  name: string;
  /** People on site (the trade's capacity). */
  number: number;
  /** How many crews of the linked crew there are (empty: not set). */
  gangs: number | undefined;
  crewId: string | undefined;
  rateId: string | undefined;
  /** Man-hours per unit. */
  productivity: number | undefined;
  basis: QuantityBasis | undefined;
  /** The phase of the recipe activities this labour's productivity is for ('' none). */
  usedFor: string;
  /** Other phases the same rate and crew are on. */
  alsoFor: string[];
}

export interface LabourData {
  trades: TradeRow[];
  crewTemplates: CrewTemplate[];
  rates: RateRow[];
  recipes: Recipe[];
}

export type LabourEdit = Partial<{ number: number; gangs: number | undefined; productivity: number | undefined; basis: QuantityBasis; usedFor: string }>;

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();
const on = <T extends { enabled?: boolean }>(x: T) => x.enabled !== false;

const crewsOf = (data: LabourData, code: string) => data.crewTemplates.filter((c) => on(c) && c.trades.some((t) => same(t.trade, code)));
const rateOf = (data: LabourData, id: string | undefined) => (id ? data.rates.find((r) => on(r) && r.type === 'productivity' && same(r.id, id)) : undefined);

/** The recipe tasks that are this labour's work: the crew has the trade in it and the task names a productivity rate. */
function workOf(data: LabourData, code: string) {
  const crews = crewsOf(data, code);
  const out: { recipe: number; task: number; crew: string; rate: string; phase: string }[] = [];
  data.recipes.forEach((r, ri) => {
    if (!on(r) || r.chain === false) return;
    r.tasks.forEach((t, ti) => {
      if (!on(t) || !t.crew || !t.rate) return;
      if (crews.some((c) => same(c.id, t.crew)) && rateOf(data, t.rate)) out.push({ recipe: ri, task: ti, crew: t.crew, rate: t.rate, phase: t.phase });
    });
  });
  return out;
}

export function labourRows(trades: { code: string; name: string; capacity?: number | null }[], data: LabourData): LabourRow[] {
  return trades.map((t) => {
    const work = workOf(data, t.code);
    const first = work[0];
    const crew = first ? data.crewTemplates.find((c) => same(c.id, first.crew)) : crewsOf(data, t.code)[0];
    const rate = first ? rateOf(data, first.rate) : undefined;
    const mine = first ? work.filter((w) => same(w.crew, first.crew) && same(w.rate, first.rate)) : [];
    const phases = [...new Set(mine.map((w) => w.phase))];
    return {
      code: t.code, name: t.name || t.code, number: t.capacity ?? 0,
      gangs: crew?.available || undefined, crewId: crew?.id, rateId: rate?.id,
      productivity: rate?.manhoursPerUnit, basis: rate ? rate.basis ?? 'rebar' : undefined,
      usedFor: first?.phase ?? '', alsoFor: phases.filter((p) => !same(p, first?.phase)),
    };
  });
}

/** The tasks of a phase that a crew and rate can be put on: no crew yet, or that crew already. */
const attachable = (t: { crew?: string; enabled?: boolean }, crew: string) => on(t) && (!t.crew || same(t.crew, crew));

/** One edit of one labour row, written to the rows it comes from. Returns new data; what it does not touch is the same objects. */
export function applyLabourEdit(data: LabourData, trade: { code: string; name: string }, edit: LabourEdit): LabourData {
  let { trades, crewTemplates, rates, recipes } = data;
  const code = trade.code;
  const row = labourRows([{ code, name: trade.name }], data)[0];

  if (edit.number !== undefined) {
    const n = Math.max(0, edit.number);
    trades = trades.some((t) => same(t.id, code))
      ? trades.map((t) => (same(t.id, code) ? { ...t, capacity: n } : t))
      : [...trades, { id: code, name: trade.name, capacity: n }];
  }

  // the crew the labour's work is done by (made when there is none and something needs one)
  let crewId = row.crewId;
  const needCrew = () => {
    if (crewId) return crewId;
    crewId = freshId(code, crewTemplates.map((c) => c.id));
    const people = edit.number ?? row.number;
    crewTemplates = [...crewTemplates, { id: crewId, trades: [{ trade: code, size: Math.max(1, Math.round(people / Math.max(1, edit.gangs ?? row.gangs ?? 1))) }] }];
    return crewId;
  };

  if ('gangs' in edit) {
    const id = needCrew();
    const n = edit.gangs && edit.gangs > 0 ? edit.gangs : undefined;
    crewTemplates = crewTemplates.map((c) => {
      if (!same(c.id, id)) return c;
      const { available: _a, ...rest } = c;
      return n === undefined ? rest : { ...rest, available: n };
    });
  }

  if (edit.productivity !== undefined || edit.basis !== undefined) {
    if (row.rateId) {
      rates = rates.map((r) => (same(r.id, row.rateId) ? { ...r, ...(edit.productivity !== undefined ? { manhoursPerUnit: edit.productivity } : {}), ...(edit.basis ? { basis: edit.basis } : {}) } : r));
    }
  }

  if (edit.usedFor !== undefined && !same(edit.usedFor, row.usedFor)) {
    const to = edit.usedFor.trim();
    // the rate the productivity is: the one it has, or a new one for the labour
    let rateId = row.rateId;
    if (to && !rateId) {
      rateId = freshId(`${code}-${to}`, rates.map((r) => r.id));
      rates = [...rates, { id: rateId, type: 'productivity', ...(edit.productivity !== undefined ? { manhoursPerUnit: edit.productivity } : {}), ...(edit.basis ? { basis: edit.basis } : {}) }];
    }
    const crew = needCrew();
    const from = row.usedFor;
    recipes = recipes.map((r) => {
      if (!on(r) || r.chain === false) return r;
      let changed = false;
      const tasks = r.tasks.map((t) => {
        // off the old phase: the tasks that were this labour's work lose the rate (the crew stays)
        if (rateId && from && same(t.phase, from) && same(t.rate, rateId) && same(t.crew, crew)) { changed = true; const { rate: _r, ...rest } = t; return rest; }
        // onto the new phase: the rate (and the crew, where the task has none)
        if (rateId && to && same(t.phase, to) && attachable(t, crew)) { changed = true; return { ...t, rate: rateId, crew }; }
        return t;
      });
      return changed ? { ...r, tasks } : r;
    });
  }
  return { trades, crewTemplates, rates, recipes };
}
