# core/resources.py
"""
Resource rules for generated activities: rebar tonnes from concrete volume,
and labour crews per activity phase (the rebar rates are the scenario's rules; see config.
the Overrides workbook's Crews sheet; the trades are the scenario's rules). xml_builder writes the resulting resources and
assignments into the P6 XML.
"""
import config
from config import LABOUR_RESOURCE_PREFIX, PROJECT_SHORT
from core import rules as _rules


def _norm_type(value):
    return str(value or "").strip().replace(" ", "_").upper()


def rebar_tonnes(rec):
    """Rebar weight (t) for a pour: concrete volume × its pour type's rate."""
    try:
        volume = float(rec.get("volume") or 0)
    except (TypeError, ValueError):
        return 0.0
    rate = _rules.active().rebar_rate(rec)  # the scenario's Rebar rate rules (none that fit: no rebar quantity)
    return max(0.0, volume * float(rate)) if rate else 0.0


def labour_trades():
    """The trades crews are made of: the scenario's Trade rules (none: no labour resources, and crews assign no labour)."""
    return _rules.active().trades()


def labour_resource_id(trade_code):
    return f"{LABOUR_RESOURCE_PREFIX}{trade_code}"


def crew_table_with_overrides(overrides):
    """The Overrides workbook's "Crews" sheet as a crew table: (Phase, PourType) -> [(trade, people)]. (The engine has no crew table
    of its own: the rest of the crews are the scenario's Crew rules and Assignments.)"""
    table = {}
    replaced = set()
    for row in (overrides or {}).get("__crews__", []):
        phase = str(row.get("Phase", "") or "").strip()
        trade = str(row.get("Trade", "") or "").strip().upper()
        if not phase or not trade:
            continue
        if trade not in labour_trades():
            print(f"  Warning: Crews sheet trade '{trade}' is not a known trade — row skipped")
            continue
        ptype = _norm_type(row.get("PourType"))
        key = f"{phase}|{ptype}" if ptype else phase
        if key not in replaced:
            table[key] = []
            replaced.add(key)
        try:
            crew = float(row.get("Crew") or 0)
        except (TypeError, ValueError):
            crew = 0
        if crew > 0:
            table[key].append((trade, crew))
    return table


def crews_for(phase, rec, table):
    """[(trade code, crew size)] for an activity: its "<phase>|<POUR_TYPE>"
    row when there is one, else its phase row, else no labour. A crew rule of the scenario (Rules > Crews) wins."""
    phase = str(phase or "").strip()
    ruled = _rules.active().crew_for(phase, rec)
    if ruled is not None:
        return ruled
    specific = f"{phase}|{_norm_type(rec.get('pour_type'))}"
    if specific in table:
        return table[specific]
    return table.get(phase, [])


_POOL_LETTER = {"equipment": "E", "crane": "K", "material": "M"}
# P6 types: equipment and cranes are non-labour resources, materials are material resources.
POOL_P6_TYPE = {"equipment": "Nonlabor", "crane": "Nonlabor", "material": "Material"}


def pool_resource_id(kind, code):
    """The P6 resource of a pool: <project>-E-<id> (equipment), -K- (cranes), -M- (materials)."""
    return f"{PROJECT_SHORT}-{_POOL_LETTER[kind]}-{code}"


def pools():
    """The scenario's pools: [{kind, id, name, quantity}]."""
    return _rules.active().pools()


def crew_pool_resource_id(code):
    """The P6 resource of a crew pool: <project>-G-<crew id> (a count of crews, non-labour so it does not add to the people)."""
    return f"{PROJECT_SHORT}-G-{code}"


def crew_pool_for(phase, rec):
    """(resource id, 1) when the crew of this activity is a named crew with a number of crews available, else None: the activity holds one crew."""
    pool = _rules.active().crew_pool_for(phase, rec)
    return (crew_pool_resource_id(pool["id"]), 1.0) if pool else None


def uses_for(phase, rec):
    """[(resource id, count)] the recipes give this activity: its equipment, cranes and materials (those whose pool the scenario defines)."""
    known = {(p["kind"], p["id"].upper()): p["id"] for p in pools()}
    out = []
    for use in _rules.active().resource_uses(phase, rec):
        code = known.get((use["kind"], use["type"].upper()))
        if code is not None:
            out.append((pool_resource_id(use["kind"], code), use["count"]))
    return out
