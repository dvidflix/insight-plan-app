# core/formula.py
"""Duration formulas (src/schedule/durationFormula.ts is the same language in the browser): a duration written as a formula of the pour's
quantities and the scenario's named parameters, in working days, such as `Rebar_kg / Rebar_Rate` or `max(1, Concrete_m3 / Concrete_Rate)`.
Numbers, + - * / ^, brackets, names (not case sensitive) and the functions min, max, abs, ceil, floor, round, sqrt. Nothing is evaluated as
code: the text is read by a small parser."""
import math
import re

_FUNCTIONS = {"min": min, "max": max, "abs": abs, "ceil": math.ceil, "floor": math.floor, "round": round, "sqrt": math.sqrt}
_TOKEN = re.compile(r"\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_.]*)|(.))")


class FormulaError(Exception):
    pass


def _tokens(src):
    out, pos = [], 0
    src = str(src)
    while pos < len(src):
        m = _TOKEN.match(src, pos)
        if not m:
            break
        pos = m.end()
        if m.group(1) is not None:
            out.append(("num", float(m.group(1))))
        elif m.group(2) is not None:
            out.append(("id", m.group(2)))
        elif m.group(3).strip():
            if m.group(3) not in "+-*/^(),":
                raise FormulaError(f"“{m.group(3)}” is not allowed in a formula.")
            out.append(("op", m.group(3)))
    return out


def names_in(src):
    """The names a formula uses (lower case), apart from the functions."""
    try:
        return {v.lower() for t, v in _tokens(src) if t == "id" and v.lower() not in _FUNCTIONS}
    except FormulaError:
        return set()


def evaluate(src, values):
    """The formula's value with these names ({name: number}, any case). Raises FormulaError, naming what is wrong or missing."""
    toks = _tokens(src)
    if not toks:
        raise FormulaError("The formula is empty.")
    names = {str(k).lower(): v for k, v in values.items()}
    at = [0]

    def peek():
        return toks[at[0]] if at[0] < len(toks) else None

    def op(v):
        t = peek()
        if t and t == ("op", v):
            at[0] += 1
            return True
        return False

    def expr():
        v = term()
        while True:
            if op("+"):
                v += term()
            elif op("-"):
                v -= term()
            else:
                return v

    def term():
        v = power()
        while True:
            if op("*"):
                v *= power()
            elif op("/"):
                d = power()
                if d == 0:
                    raise FormulaError("Division by zero.")
                v /= d
            else:
                return v

    def power():
        v = unary()
        return v ** power() if op("^") else v

    def unary():
        return -unary() if op("-") else atom()

    def atom():
        t = peek()
        if t is None:
            raise FormulaError("The formula ends too soon.")
        at[0] += 1
        if t[0] == "num":
            return t[1]
        if t == ("op", "("):
            v = expr()
            if not op(")"):
                raise FormulaError("A bracket is not closed.")
            return v
        if t[0] == "id":
            key = t[1].lower()
            if key in _FUNCTIONS and op("("):
                args = []
                if not op(")"):
                    while True:
                        args.append(expr())
                        if op(")"):
                            break
                        if not op(","):
                            raise FormulaError(f"{t[1]}( is not closed.")
                try:
                    return float(_FUNCTIONS[key](*args))
                except (ValueError, TypeError) as e:
                    raise FormulaError(f"{t[1]}: {e}")
            if key not in names or names[key] is None:
                raise FormulaError(f"“{t[1]}” has no value here.")
            return float(names[key])
        raise FormulaError(f"Unexpected “{t[1]}”.")

    value = expr()
    if peek() is not None:
        raise FormulaError(f"Unexpected “{peek()[1]}”.")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise FormulaError("The result is not a number.")
    return value
