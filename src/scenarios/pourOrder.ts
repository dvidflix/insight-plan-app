/** A scenario's pour order: the SequenceOrder sheet's rows in play order.
    Rows sharing a `step` id that sit next to each other form one Index —
    the generator starts them together (Start-to-Start); each new Index
    waits for the previous one to finish (Finish-to-Start). Rows with a
    blank Index (`step` null) are not in the manual sequence at all — the
    generator orders those by its automatic rules — and always sit after
    the sequenced rows. */
export interface PourRow {
  key: string;
  cells: string[];
  step: number | null;
}

export interface PourOrder {
  headers: string[];
  rows: PourRow[];
}

let nextStep = 1;
const freshStep = () => nextStep++;

export function indexColumn(headers: string[]): number {
  return headers.indexOf('Index');
}

/** Sequenced rows first, unsequenced after — both in their current order. */
function normalize(rows: PourRow[]): PourRow[] {
  return [...rows.filter((r) => r.step !== null), ...rows.filter((r) => r.step === null)];
}

/** Sheet rows -> ordered rows, sorted by Index (sheet order breaks ties). */
export function fromSheet(headers: string[], sheetRows: string[][]): PourOrder {
  const idx = indexColumn(headers);
  const guid = headers.indexOf('GUID');
  const indexed = sheetRows
    .map((cells, pos) => ({ cells, pos, index: idx >= 0 && /^\s*-?\d+(\.\d+)?\s*$/.test(cells[idx] ?? '') ? Number(cells[idx]) : null }))
    .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || a.pos - b.pos);
  const stepByIndex = new Map<number, number>();
  const seen = new Set<string>();
  const rows = indexed.map(({ cells, pos, index }) => {
    let key = (guid >= 0 ? cells[guid] : '') || `row-${pos}`;
    if (seen.has(key)) key = `${key}#${pos}`;
    seen.add(key);
    let step: number | null = null;
    if (index !== null) {
      step = stepByIndex.get(index) ?? freshStep();
      stepByIndex.set(index, step);
    }
    return { key, cells, step };
  });
  return { headers, rows };
}

/** Step number (the Index to write) of every row, in order; 0 = unsequenced. */
export function stepNumbers(rows: PourRow[]): number[] {
  const out: number[] = [];
  let n = 0;
  rows.forEach((r, i) => {
    if (r.step === null) return out.push(0);
    if (i === 0 || r.step !== rows[i - 1].step) n++;
    out.push(n);
  });
  return out;
}

/** Back to sheet rows, with Index rewritten from the current order. */
export function toSheet(order: PourOrder): string[][] {
  const idx = indexColumn(order.headers);
  const steps = stepNumbers(order.rows);
  return order.rows.map((r, i) => {
    const cells = [...r.cells];
    while (cells.length < order.headers.length) cells.push('');
    if (idx >= 0) cells[idx] = steps[i] ? String(steps[i]) : '';
    return cells;
  });
}

/** Moves the selected rows (keeping their relative order) so they sit just
    before `beforeKey`, or at the end of the sequence when null. Dropped
    inside a step they join it; between steps they stay steps of their own;
    below the first unsequenced row they leave the sequence. */
export function moveTo(rows: PourRow[], selected: Set<string>, beforeKey: string | null): PourRow[] {
  const moving = rows.filter((r) => selected.has(r.key));
  if (moving.length === 0) return rows;
  const rest = rows.filter((r) => !selected.has(r.key));
  const firstUnseq = rest.findIndex((r) => r.step === null);
  const seqEnd = firstUnseq < 0 ? rest.length : firstUnseq;
  let at = beforeKey === null ? seqEnd : rest.findIndex((r) => r.key === beforeKey);
  if (at < 0) at = seqEnd;

  if (at > seqEnd) {
    const placed = moving.map((r) => ({ ...r, step: null }));
    return [...rest.slice(0, at), ...placed, ...rest.slice(at)];
  }
  const prev = rest[at - 1];
  const next = at < seqEnd ? rest[at] : undefined;
  const joinStep = prev && next && prev.step !== null && prev.step === next.step ? prev.step : null;
  // Moved rows keep their own grouping, but never share an id with the new
  // neighbours unless joining them — that would silently merge the steps.
  const remap = new Map<number, number>();
  const placed = moving.map((r) => {
    if (joinStep !== null) return { ...r, step: joinStep };
    if (r.step === null) return { ...r, step: freshStep() };
    let step = r.step;
    if ((prev && prev.step === step) || (next && next.step === step)) {
      if (!remap.has(step)) remap.set(step, freshStep());
      step = remap.get(step)!;
    }
    return { ...r, step };
  });
  return [...rest.slice(0, at), ...placed, ...rest.slice(at)];
}

/** The key of the first row of the step containing position i. */
function stepStartKey(rows: PourRow[], i: number): string {
  let s = i;
  while (s > 0 && rows[s - 1].step === rows[i].step) s--;
  return rows[s].key;
}

/** Moves the selection one whole step up (past the step just above it). */
export function moveUp(rows: PourRow[], selected: Set<string>): PourRow[] {
  const first = rows.findIndex((r) => selected.has(r.key));
  if (first <= 0) return rows;
  // From the unsequenced zone, "up" means onto the end of the sequence.
  if (rows[first].step === null) return moveTo(rows, selected, null);
  let above = first - 1;
  while (above >= 0 && selected.has(rows[above].key)) above--;
  if (above < 0) return rows;
  return moveTo(rows, selected, stepStartKey(rows, above));
}

/** Moves the selection one whole step down (past the step just below it). */
export function moveDown(rows: PourRow[], selected: Set<string>): PourRow[] {
  let last = -1;
  rows.forEach((r, i) => selected.has(r.key) && (last = i));
  if (last < 0 || last >= rows.length - 1) return rows;
  let below = last + 1;
  while (below < rows.length && selected.has(rows[below].key)) below++;
  if (below >= rows.length || rows[below].step === null) return rows;
  let end = below;
  while (end + 1 < rows.length && rows[end + 1].step === rows[below].step) end++;
  const after = rows.slice(end + 1).find((r) => !selected.has(r.key));
  return moveTo(rows, selected, after && after.step !== null ? after.key : null);
}

/** Moves the selection to become step `n` (1-based) of the resulting order. */
export function moveToStep(rows: PourRow[], selected: Set<string>, n: number): PourRow[] {
  const rest = rows.filter((r) => !selected.has(r.key));
  const steps = stepNumbers(rest);
  const target = rest.find((_, i) => steps[i] === Math.max(1, Math.floor(n)));
  return moveTo(rows, selected, target ? target.key : null);
}

/** Gathers the selection at its first row's position as one step. */
export function startTogether(rows: PourRow[], selected: Set<string>): PourRow[] {
  const firstIdx = rows.findIndex((r) => selected.has(r.key));
  if (firstIdx < 0) return rows;
  const step = freshStep();
  const picked = rows.filter((r) => selected.has(r.key)).map((r) => ({ ...r, step }));
  return normalize([...rows.slice(0, firstIdx), ...picked, ...rows.slice(firstIdx).filter((r) => !selected.has(r.key))]);
}

/** Splits every selected (sequenced) row into a step of its own. */
export function separate(rows: PourRow[], selected: Set<string>): PourRow[] {
  return rows.map((r) => (selected.has(r.key) && r.step !== null ? { ...r, step: freshStep() } : r));
}

/** Takes the selection out of the manual sequence (blank Index). */
export function unsequence(rows: PourRow[], selected: Set<string>): PourRow[] {
  return normalize(rows.map((r) => (selected.has(r.key) ? { ...r, step: null } : r)));
}

/** Puts rows back in a reference order (key -> step number, 0/absent =
    unsequenced), e.g. the project baseline. */
export function reorderLike(rows: PourRow[], stepOf: Map<string, number>): PourRow[] {
  const ids = new Map<number, number>();
  const inSeq = (r: PourRow) => (stepOf.get(r.key) ?? 0) > 0;
  const seq = rows
    .filter(inSeq)
    .sort((a, b) => stepOf.get(a.key)! - stepOf.get(b.key)!)
    .map((r) => {
      const n = stepOf.get(r.key)!;
      if (!ids.has(n)) ids.set(n, freshStep());
      return { ...r, step: ids.get(n)! };
    });
  return [...seq, ...rows.filter((r) => !inSeq(r)).map((r) => ({ ...r, step: null }))];
}

/** Keys of rows that moved relative to a reference order: everything outside
    the longest run that kept its reference order, plus rows that entered or
    left the sequence — so moving one pour flags one pour, not every pour
    whose step number shifted as a result. */
export function movedKeys(rows: PourRow[], stepOf: Map<string, number>): Set<string> {
  const moved = new Set<string>();
  const seq: { key: string; base: number }[] = [];
  for (const r of rows) {
    const base = stepOf.get(r.key) ?? 0;
    if ((r.step === null) !== (base === 0)) moved.add(r.key);
    else if (r.step !== null) seq.push({ key: r.key, base });
  }
  // Longest non-decreasing subsequence of base steps (patience sorting).
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const parent: number[] = new Array(seq.length).fill(-1);
  seq.forEach((s, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] <= s.base) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = s.base;
    tailIdx[lo] = i;
    parent[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tailIdx[tails.length - 1] : -1; i >= 0; i = parent[i]) keep.add(i);
  seq.forEach((s, i) => !keep.has(i) && moved.add(s.key));
  return moved;
}

/** The row's GlobalId (keys of repeated GUIDs carry a "#position" suffix). */
export const guidOfKey = (key: string) => key.split('#')[0];

/** Sequences the rows by steps (sets of GlobalIds, in step order): the rows
    of each step become one Index, so they start together; rows in no step
    go to the unsequenced end. A row in several steps stays in the first. */
export function applySteps(rows: PourRow[], steps: Set<string>[]): PourRow[] {
  const stepOf = (r: PourRow) => steps.findIndex((s) => s.has(guidOfKey(r.key)));
  const ids = steps.map(() => freshStep());
  const inStep = rows.map((r) => ({ r, s: stepOf(r) }));
  const seq = inStep
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => ({ ...x.r, step: ids[x.s] }));
  return [...seq, ...inStep.filter((x) => x.s < 0).map((x) => ({ ...x.r, step: null }))];
}

/** Puts the picked rows (keys, in the order they were picked) each in a step
    of its own, starting where the earliest of them sat in the order (the min
    index), not from the top; every other row keeps its place around them. */
export function orderByPicks(rows: PourRow[], picked: string[]): PourRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const first = picked.flatMap((k) => (byKey.has(k) ? [{ ...byKey.get(k)!, step: freshStep() }] : []));
  if (!first.length) return rows;
  const taken = new Set(first.map((r) => r.key));
  const at = rows.findIndex((r) => taken.has(r.key));
  const rest = [...rows.slice(0, at), ...first, ...rows.slice(at).filter((r) => !taken.has(r.key))];
  // A step the picks cut in two must not stay one step: the later part gets its own.
  const seen = new Set<number>();
  const remap = new Map<number, number>();
  const out = rest.map((r, i) => {
    if (r.step === null) return r;
    const prev = rest[i - 1];
    if (prev && prev.step === r.step) return remap.has(r.step) && seen.has(r.step) ? { ...r, step: remap.get(r.step)! } : r;
    if (seen.has(r.step)) {
      const step = freshStep();
      remap.set(r.step, step);
      return { ...r, step };
    }
    seen.add(r.step);
    remap.delete(r.step);
    return r;
  });
  return normalize(out);
}
