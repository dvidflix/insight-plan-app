/** How the rules of a filter combine, written with their numbers: "(1 and 2) or (3 and 4) and 5". Words and, or, not (also & && | || !),
    and brackets; and binds tighter than or, as in a spreadsheet. A rule that is not complete yet (no value picked) is left out of its
    and / or, as if it were not there. */

type Node =
  | { t: 'rule'; n: number }
  | { t: 'not'; a: Node }
  | { t: 'and' | 'or'; a: Node; b: Node };

export type Compiled = { ok: true; run: (rules: (boolean | null)[]) => boolean; uses: Set<number> } | { ok: false; error: string };

const TOKEN = /\s*(\d+|\(|\)|&&|\|\||&|\||!|[A-Za-z]+)/y;

function tokens(text: string): string[] | string {
  const out: string[] = [];
  let at = 0;
  TOKEN.lastIndex = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(text);
    if (!m) return `Unexpected “${text.slice(at).trim().slice(0, 8)}”`;
    out.push(m[1]);
    at = TOKEN.lastIndex;
  }
  return out;
}

/** Reads a formula over rules 1…`count`. */
export function compileLogic(text: string, count: number): Compiled {
  const toks = tokens(text);
  if (typeof toks === 'string') return { ok: false, error: toks };
  if (toks.length === 0) return { ok: false, error: 'Write how the rules combine, e.g. 1 and 2' };
  let i = 0;
  const uses = new Set<number>();
  const word = (t: string | undefined) => (t ?? '').toLowerCase();
  const isAnd = (t?: string) => word(t) === 'and' || t === '&' || t === '&&';
  const isOr = (t?: string) => word(t) === 'or' || t === '|' || t === '||';
  const isNot = (t?: string) => word(t) === 'not' || t === '!';

  const atom = (): Node => {
    const t = toks[i];
    if (t === undefined) throw new Error('The formula ends too soon');
    if (t === '(') {
      i++;
      const e = or();
      if (toks[i] !== ')') throw new Error('A bracket is not closed');
      i++;
      return e;
    }
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > count) throw new Error(`There is no rule ${n} (the rules are 1 to ${count})`);
      i++;
      uses.add(n);
      return { t: 'rule', n };
    }
    throw new Error(`Unexpected “${t}”`);
  };
  const not = (): Node => {
    if (isNot(toks[i])) { i++; return { t: 'not', a: not() }; }
    return atom();
  };
  const and = (): Node => {
    let a = not();
    while (isAnd(toks[i])) { i++; a = { t: 'and', a, b: not() }; }
    return a;
  };
  function or(): Node {
    let a = and();
    while (isOr(toks[i])) { i++; a = { t: 'or', a, b: and() }; }
    return a;
  }
  let root: Node;
  try {
    root = or();
    if (i < toks.length) throw new Error(`Unexpected “${toks[i]}”: join rules with and / or`);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // null: nothing to say (a rule that is not complete); it drops out of the and / or it is in.
  const ev = (n: Node, rules: (boolean | null)[]): boolean | null => {
    if (n.t === 'rule') return rules[n.n - 1] ?? null;
    if (n.t === 'not') { const v = ev(n.a, rules); return v === null ? null : !v; }
    const a = ev(n.a, rules);
    const b = ev(n.b, rules);
    if (a === null) return b;
    if (b === null) return a;
    return n.t === 'and' ? a && b : a || b;
  };
  return { ok: true, uses, run: (rules) => ev(root, rules) ?? true };
}

/** The formula the plain "all" / "any" choice stands for ("1 and 2 and 3"). */
export const defaultLogic = (count: number, match: 'all' | 'any') => Array.from({ length: count }, (_, i) => String(i + 1)).join(match === 'all' ? ' and ' : ' or ');

/** One test from a filter's rules: by the formula when there is a good one, else all / any of them. `tests` has one entry per rule, in
    order, null for a rule that is not complete. Null when no rule is complete (nothing to filter on). */
export function combineTests<T>(tests: (((x: T) => boolean) | null)[], match: 'all' | 'any', logic: string): ((x: T) => boolean) | null {
  if (!tests.some((t) => t !== null)) return null;
  const compiled = logic.trim() ? compileLogic(logic, tests.length) : null;
  if (compiled?.ok) {
    return (x) => compiled.run(tests.map((t) => (t ? t(x) : null)));
  }
  const active = tests.filter((t): t is (x: T) => boolean => t !== null);
  return (x) => (match === 'all' ? active.every((t) => t(x)) : active.some((t) => t(x)));
}
