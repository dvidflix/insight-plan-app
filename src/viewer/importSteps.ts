import type { ModelIndex } from './ViewerEngine';
import { runSearchSet, type SearchSet } from './searchSets';
import { elementValue } from './bimTables';

/** Steps: search sets (by GlobalId) made from a table (CSV / TXT) of objects and the
    task each belongs to, in construction order — for example a Navisworks
    TimeLiner export. Consecutive rows with the same task name are one step;
    rows without a task name are left out. */

export const STEPS_GROUP = 'Steps';

/** Comma-, semicolon- or tab-separated text -> rows of cells (quoted cells
    may hold commas, quotes and line breaks). */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export const cleanHeader = (h: string) => h.replace(/\s+/g, ' ').trim();

/** The likely key (GlobalId / pour number), task-name and date columns of a
    table's header row (-1 = no date column). */
export function guessColumns(headers: string[]): { guid: number; name: number; order: number } {
  const h = headers.map(cleanHeader);
  const isDate = (x: string) => /start|end|finish|date/i.test(x);
  const order = h.findIndex(isDate);
  let guid = h.findIndex((x) => /global\s*id|guid/i.test(x));
  if (guid < 0) guid = h.findIndex((x, i) => !isDate(x) && /(id|number|ref|code)/i.test(x) && !/task/i.test(x) && i !== order);
  if (guid < 0) guid = h.findIndex((x) => !isDate(x));
  if (guid < 0) guid = 0;
  const others = h.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== guid && !isDate(x));
  const name = (others.find(({ x }) => /task|step|activity|name/i.test(x)) ?? others[others.length - 1])?.i ?? Math.min(1, h.length - 1);
  return { guid, name, order };
}

export interface ParsedStep {
  name: string;
  guids: string[];
}

/** A date / time cell ("16/04/2030", "09:00:00 16/04/2030", "02/04/2029 09:00")
    as a number for ordering; NaN when it is not one. */
export function parseWhen(text: string): number {
  const d = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (!d) return NaN;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  return Date.UTC(+d[3], +d[2] - 1, +d[1], t ? +t[1] : 0, t ? +t[2] : 0, t && t[3] ? +t[3] : 0);
}

/** Steps from the rows; rows with an empty name or key are skipped.
    With a date column (orderCol >= 0) each task name is one step, steps in
    order of their earliest date; without, consecutive rows with the same
    name are one step, in file order (skipped rows do not break a run). */
export function stepsFromRows(rows: string[][], keyCol: number, nameCol: number, orderCol = -1): { steps: ParsedStep[]; skipped: number } {
  let skipped = 0;
  const steps: (ParsedStep & { when: number })[] = [];
  const byName = new Map<string, ParsedStep & { when: number }>();
  for (const r of rows) {
    const name = (r[nameCol] ?? '').trim();
    const key = (r[keyCol] ?? '').trim();
    if (!name || !key) { skipped++; continue; }
    const when = orderCol >= 0 ? parseWhen(r[orderCol] ?? '') : NaN;
    const w = Number.isNaN(when) ? Infinity : when;
    const last = steps[steps.length - 1];
    const step = orderCol >= 0 ? byName.get(name) : last && last.name === name ? last : undefined;
    if (step) {
      step.guids.push(key);
      step.when = Math.min(step.when, w);
    } else {
      const made = { name, guids: [key], when: w };
      steps.push(made);
      byName.set(name, made);
    }
  }
  if (orderCol >= 0) steps.sort((a, b) => (a.when === b.when ? 0 : a.when < b.when ? -1 : 1));
  return { steps: steps.map(({ name, guids }) => ({ name, guids })), skipped };
}

/** The model property a key column most likely holds: a header such as
    "BYLOR Pour / Pour ID Number" -> the property "BYLOR Pour.Pour ID Number"
    (or any property named like its last line); else GlobalId. */
export function guessField(header: string, fields: string[]): string {
  const lines = header.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
  const joined = lines.join('.').toLowerCase();
  if (/global\s*id|guid/i.test(header)) return 'Attributes.GlobalId';
  const last = (lines[lines.length - 1] ?? '').toLowerCase();
  return fields.find((f) => f.toLowerCase() === joined)
    ?? fields.find((f) => f.toLowerCase().endsWith(`.${last}`) && last !== '')
    ?? fields.find((f) => f.toLowerCase() === last)
    ?? 'Attributes.GlobalId';
}

/** Search sets in the Steps folder — "1 Name", "2 Name", … — each finding
    its objects whose `field` (GlobalId, or a property such as
    "CWA Pour.Pour ID Number") is any of the step's values, so they follow
    whatever models are loaded. `missing` counts values no loaded object has. */
export function buildStepSets(
  steps: ParsedStep[],
  indexes: ReadonlyMap<string, ModelIndex>,
  field: string,
  newId: () => string,
): { sets: SearchSet[]; missing: number } {
  const known = new Set<string>();
  for (const index of indexes.values()) for (const e of index.elements.values()) known.add(elementValue(e, field));
  let missing = 0;
  const sets = steps.map((s, i): SearchSet => {
    const values = [...new Set(s.guids)];
    for (const v of values) if (!known.has(v)) missing++;
    return {
      id: newId(),
      name: `${i + 1} ${s.name}`,
      group: STEPS_GROUP,
      kind: 'search',
      match: 'all',
      conditions: [{ id: newId(), field, op: 'anyOf', value: '', values }],
    };
  });
  return { sets, missing };
}

/** The GlobalIds of the objects a step set finds in the loaded models. */
export function stepGuids(indexes: ReadonlyMap<string, ModelIndex>, set: SearchSet): Set<string> {
  const out = new Set<string>();
  for (const [modelId, ids] of Object.entries(runSearchSet(indexes, set))) {
    const elements = indexes.get(modelId)?.elements;
    for (const id of ids) {
      const guid = elements?.get(id)?.guid;
      if (guid) out.add(guid);
    }
  }
  return out;
}

/** The Steps folder's sets in step order (by the number their name starts with). */
export function stepSetsOf(sets: SearchSet[]): SearchSet[] {
  return sets
    .filter((s) => s.group === STEPS_GROUP)
    .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10) || a.name.localeCompare(b.name));
}
