/** Duration formulas, after ALICE's parametric durations: a duration written as a formula of quantity, productivity and the number of crews, such
    as `qty / (rate * crews)` or `ceil(qty / rate / crews)`, in working days. Numbers, + - * / ^, brackets, the names given, and a few functions:
    min, max, abs, ceil, floor, round, sqrt. Nothing is evaluated as code: the text is read by a small parser. */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokens(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    return `“${c}” is not allowed in a formula.`;
  }
  return out;
}

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, sqrt: Math.sqrt,
};

export type FormulaResult = { value: number } | { error: string };

/** Evaluates the formula with the names given (`qty`, `rate`, `crews` …; names are not case sensitive). A name with no value is an error that says which. */
export function evaluateFormula(src: string, vars: Record<string, number | null | undefined>): FormulaResult {
  const toks = tokens(src);
  if (typeof toks === 'string') return { error: toks };
  if (!toks.length) return { error: 'The formula is empty.' };
  const names = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  let at = 0;
  const peek = () => toks[at];
  const op = (v: string) => { const t = peek(); if (t && t.t === 'op' && t.v === v) { at++; return true; } return false; };
  class Fail extends Error {}

  // expr := term (('+' | '-') term)* ; term := power (('*' | '/') power)* ; power := unary ('^' power)? ; unary := '-' unary | atom
  const expr = (): number => {
    let v = term();
    for (;;) { if (op('+')) v += term(); else if (op('-')) v -= term(); else return v; }
  };
  const term = (): number => {
    let v = power();
    for (;;) {
      if (op('*')) v *= power();
      else if (op('/')) { const d = power(); if (d === 0) throw new Fail('The formula divides by zero.'); v /= d; } else return v;
    }
  };
  const power = (): number => { const b = unary(); return op('^') ? Math.pow(b, power()) : b; };
  const unary = (): number => (op('-') ? -unary() : atom());
  const atom = (): number => {
    const t = toks[at++];
    if (!t) throw new Fail('The formula ends too soon.');
    if (t.t === 'num') return t.v;
    if (t.t === 'op') {
      if (t.v === '(') { const v = expr(); if (!op(')')) throw new Fail('A bracket is not closed.'); return v; }
      throw new Fail(`“${t.v}” is not expected here.`);
    }
    const fn = FUNCTIONS[t.v.toLowerCase()];
    if (fn && peek()?.t === 'op' && (peek() as { v: string }).v === '(') {
      at++;
      const args: number[] = [];
      if (!op(')')) { do args.push(expr()); while (op(',')); if (!op(')')) throw new Fail('A bracket is not closed.'); }
      return fn(...args);
    }
    const key = t.v.toLowerCase();
    if (!names.has(key)) throw new Fail(`“${t.v}” is not known. Use ${[...names.keys()].map((n) => `“${n}”`).join(', ')}.`);
    const v = names.get(key);
    if (v === null || v === undefined || !Number.isFinite(v)) throw new Fail(`“${t.v}” has no value on this activity.`);
    return v;
  };

  try {
    const v = expr();
    if (at < toks.length) throw new Fail('The formula has more than it can read.');
    if (!Number.isFinite(v)) throw new Fail('The formula does not give a number.');
    if (v < 0) throw new Fail('The formula gives a negative duration.');
    return { value: v };
  } catch (e) {
    if (e instanceof Fail) return { error: e.message };
    throw e;
  }
}

/** The names a formula uses (as written), apart from the functions: for checking them against the names that exist. A text that cannot be read has none. */
export function formulaNames(src: string): string[] {
  const toks = tokens(src);
  if (typeof toks === 'string') return [];
  return [...new Set(toks.filter((t): t is { t: 'id'; v: string } => t.t === 'id' && !(t.v.toLowerCase() in FUNCTIONS)).map((t) => t.v))];
}
