"""
Classifies walls (and later slabs) from their measurements with the rules in the
SeaTable "Wall Classes" table: the first rule, in Priority order, that every one of
its conditions fits wins. Empty condition cells are not tested.

Conditions (a minimum is inclusive, a maximum exclusive):
  Min/Max height (m), Min/Max thickness (m), Min/Max length (m),
  Min/Max opening ratio, Shape (one of STRAIGHT, PIER, L_CORNER, T_U_Z, COMPLEX, CURVED).
"""
from __future__ import annotations

UNCLASSIFIED = ""

# (rule column, feature key, "min" | "max")
_BOUNDS = [
    ("Min height (m)", "height_m", "min"),
    ("Max height (m)", "height_m", "max"),
    ("Min thickness (m)", "thickness_m", "min"),
    ("Max thickness (m)", "thickness_m", "max"),
    ("Min length (m)", "length_m", "min"),
    ("Max length (m)", "length_m", "max"),
    ("Min opening ratio", "opening_ratio", "min"),
    ("Max opening ratio", "opening_ratio", "max"),
]


def _blank(v) -> bool:
    return v is None or v == ""


def _shape_of(rule) -> str | None:
    v = rule.get("Shape")
    if isinstance(v, dict):  # a single-select cell can come back as {"name": ...}
        v = v.get("name")
    return None if _blank(v) else str(v)


def sort_rules(rules):
    return sorted((r for r in rules if not _blank(r.get("Class"))), key=lambda r: (float(r.get("Priority") or 1e9), str(r.get("Class"))))


def matches(rule, f) -> bool:
    shape = _shape_of(rule)
    if shape is not None and f.get("plan_shape") != shape:
        return False
    for col, key, kind in _BOUNDS:
        bound = rule.get(col)
        if _blank(bound):
            continue
        value = f.get(key)
        if value is None:
            return False
        if kind == "min" and not value >= float(bound):
            return False
        if kind == "max" and not value < float(bound):
            return False
    return True


def classify(f, rules) -> str:
    """The Class of the first matching rule ('' when none fits). `rules` come from sort_rules()."""
    for rule in rules:
        if matches(rule, f):
            return str(rule["Class"])
    return UNCLASSIFIED
