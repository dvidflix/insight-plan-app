import { freshId, type CrewTemplate, type TradeRow } from './rules';

/** Crews and trades as one table, a view over the two lists the scenario already has (nothing new is stored). A line is one trade of one crew, so a crew
    of two trades is two lines and a trade that is in several crews is repeated on each of them. A crew's own values (its ID, how many crews there are,
    the subcontractor) are on its first line; a trade's own values (its name and the people the site has of it) are the same on every line of that trade.
    A trade that no crew uses has a line of its own, so it can still be seen and edited. */

export interface CrewTradeData { trades: TradeRow[]; crewTemplates: CrewTemplate[] }

export interface CrewTradeLine {
  /** Index of the crew in crewTemplates (null: a trade no crew uses). */
  crew: number | null;
  /** Index of this trade in the crew's trades (null: the crew has no trade yet, or this is a trade of no crew). */
  at: number | null;
  /** First line of its crew: the crew's own cells are shown here. */
  first: boolean;
  crewId: string;
  trade: string;
  /** People of this trade in the crew, per day. */
  size: number | undefined;
  name: string;
  /** People per day the site has of the trade. */
  capacity: number | undefined;
  available: number | undefined;
  subcontractor: string | undefined;
  enabled: boolean;
}

export type CrewTradeEdit = Partial<{ crewId: string; trade: string; size: number; name: string; capacity: number; available: number | undefined; subcontractor: string | undefined; enabled: boolean }>;

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

export function crewTradeLines(crews: CrewTemplate[], known: { code: string; name: string; capacity?: number | null }[]): CrewTradeLine[] {
  const byCode = new Map(known.map((t) => [t.code.trim().toUpperCase(), t]));
  const info = (code: string) => { const t = byCode.get(code.trim().toUpperCase()); return { name: t?.name ?? '', capacity: t ? t.capacity ?? 0 : undefined }; };
  const out: CrewTradeLine[] = [];
  const used = new Set<string>();
  crews.forEach((c, crew) => {
    const own = { crew, crewId: c.id, available: c.available, subcontractor: c.subcontractor, enabled: c.enabled !== false };
    if (c.trades.length === 0) out.push({ ...own, at: null, first: true, trade: '', size: undefined, name: '', capacity: undefined });
    c.trades.forEach((t, at) => { used.add(t.trade.trim().toUpperCase()); out.push({ ...own, at, first: at === 0, trade: t.trade, size: t.size, ...info(t.trade) }); });
  });
  for (const t of known) {
    if (used.has(t.code.trim().toUpperCase())) continue;
    out.push({ crew: null, at: null, first: true, crewId: '', trade: t.code, size: undefined, name: t.name, capacity: t.capacity ?? 0, available: undefined, subcontractor: undefined, enabled: true });
  }
  return out;
}

/** One edit of one line, written to the crew or trade it comes from. What it does not touch is the same objects. */
export function applyCrewTradeEdit(data: CrewTradeData, line: CrewTradeLine, edit: CrewTradeEdit): CrewTradeData {
  let { trades, crewTemplates } = data;
  const code = line.trade.trim();
  const crew = line.crew;
  const setCrew = (patch: (c: CrewTemplate) => CrewTemplate) => { crewTemplates = crewTemplates.map((c, i) => (i === crew ? patch(c) : c)); };
  const upsertTrade = (patch: Partial<TradeRow>) => {
    if (!code) return;
    trades = trades.some((t) => same(t.id, code))
      ? trades.map((t) => (same(t.id, code) ? { ...t, ...patch } : t))
      : [...trades, { id: code, name: line.name, capacity: line.capacity ?? 0, ...patch }];
  };

  if (crew !== null) {
    if (edit.crewId !== undefined) {
      const id = edit.crewId.trim();
      if (id && !crewTemplates.some((c, i) => i !== crew && same(c.id, id))) setCrew((c) => ({ ...c, id }));
    }
    if ('available' in edit) setCrew((c) => { const { available: _a, ...rest } = c; return edit.available && edit.available > 0 ? { ...rest, available: edit.available } : rest; });
    if ('subcontractor' in edit) setCrew((c) => { const { subcontractor: _s, ...rest } = c; return edit.subcontractor?.trim() ? { ...rest, subcontractor: edit.subcontractor.trim() } : rest; });
    if (edit.enabled !== undefined) setCrew((c) => { const { enabled: _e, ...rest } = c; return edit.enabled ? rest : { ...rest, enabled: false }; });
    if (edit.trade !== undefined) {
      const to = edit.trade.trim();
      if (to) setCrew((c) => (line.at === null ? { ...c, trades: [...c.trades, { trade: to, size: 1 }] } : { ...c, trades: c.trades.map((t, i) => (i === line.at ? { ...t, trade: to } : t)) }));
    }
    if (edit.size !== undefined && line.at !== null) setCrew((c) => ({ ...c, trades: c.trades.map((t, i) => (i === line.at ? { ...t, size: Math.max(0, edit.size!) } : t)) }));
  }
  if (edit.name !== undefined) upsertTrade({ name: edit.name });
  if (edit.capacity !== undefined) upsertTrade({ capacity: Math.max(0, edit.capacity) });
  return { trades, crewTemplates };
}

/** A new crew with one trade line to fill in. */
export function addCrew(data: CrewTradeData): CrewTradeData {
  const id = freshId('CREW', data.crewTemplates.map((c) => c.id));
  return { ...data, crewTemplates: [...data.crewTemplates, { id, trades: [] }] };
}

/** Another trade line in a crew (a line with no trade yet, to fill in). */
export function addTradeLine(data: CrewTradeData, crew: number): CrewTradeData {
  return { ...data, crewTemplates: data.crewTemplates.map((c, i) => (i === crew ? { ...c, trades: [...c.trades, { trade: '', size: 1 }] } : c)) };
}

/** Takes a line away: a trade of a crew with other trades, the crew when it was its last line, or (a trade no crew uses) the trade, which is switched off
    (as the Trades rules do), so a trade of the generator's own does not come back. */
export function removeCrewTradeLine(data: CrewTradeData, line: CrewTradeLine): CrewTradeData {
  if (line.crew !== null) {
    const c = data.crewTemplates[line.crew];
    if (line.at === null || c.trades.length <= 1) return { ...data, crewTemplates: data.crewTemplates.filter((_, i) => i !== line.crew) };
    return { ...data, crewTemplates: data.crewTemplates.map((x, i) => (i === line.crew ? { ...x, trades: x.trades.filter((_, j) => j !== line.at) } : x)) };
  }
  const code = line.trade.trim();
  const mine = data.trades.some((t) => same(t.id, code));
  return { ...data, trades: mine ? data.trades.map((t) => (same(t.id, code) ? { ...t, enabled: false } : t)) : [...data.trades, { id: code, name: line.name, capacity: line.capacity ?? 0, enabled: false }] };
}
