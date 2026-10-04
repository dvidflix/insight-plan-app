# core/resources.py
"""
Resource rules for generated activities: rebar tonnes from concrete volume,
and labour crews per activity phase (see config.REBAR_TONNES_PER_M3,
LABOUR_TRADES, CREW_TABLE). xml_builder writes the resulting resources and
assignments into the P6 XML.
"""
from config import REBAR_TONNES_PER_M3, LABOUR_TRADES, LABOUR_RESOURCE_PREFIX, CREW_TABLE


def _norm_type(value):
    return str(value or "").strip().replace(" ", "_").upper()


def rebar_tonnes(rec):
    """Rebar weight (t) for a pour: concrete volume × its pour type's rate."""
    try:
        volume = float(rec.get("volume") or 0)
    except (TypeError, ValueError):
        return 0.0
    rate = REBAR_TONNES_PER_M3.get(_norm_type(rec.get("pour_type")), REBAR_TONNES_PER_M3.get("DEFAULT", 0.25))
    return max(0.0, volume * float(rate))


def labour_resource_id(trade_code):
    return f"{LABOUR_RESOURCE_PREFIX}{trade_code}"


def crew_table_with_overrides(overrides):
    """CREW_TABLE with the scenario's "Crews" sheet rows applied: every
    (Phase, PourType) key present in the sheet replaces that key's crews."""
    table = {key: list(crews) for key, crews in CREW_TABLE.items()}
    replaced = set()
    for row in (overrides or {}).get("__crews__", []):
        phase = str(row.get("Phase", "") or "").strip()
        trade = str(row.get("Trade", "") or "").strip().upper()
        if not phase or not trade:
            continue
        if trade not in LABOUR_TRADES:
            print(f"  Warning: Crews sheet trade '{trade}' is not in LABOUR_TRADES — row skipped")
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
    row when there is one, else its phase row, else no labour."""
    phase = str(phase or "").strip()
    specific = f"{phase}|{_norm_type(rec.get('pour_type'))}"
    if specific in table:
        return table[specific]
    return table.get(phase, [])
