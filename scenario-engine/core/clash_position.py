# core/clash_position.py
"""
Classifies where one clashing pour sits vertically relative to another,
using each pour record's min_elevation/max_elevation bounding Z-range
(falling back to a single coord_z point when a range isn't available).

Used by excel_exporter.py to add a "Position" column to the Group
Clashes / Clash Relations sheets, and by main.py to write the same
classification onto the IFC model as a property set InsightPlan's Blender
addon can read directly off each pour object.
"""

from collections import defaultdict

from config import CLASH_POSITION_SIDE_OVERLAP_THRESHOLD

DEFINITELY_BELOW = "Definitely Below"
MAJORITY_BELOW = "Majority Below"
SIDE = "Side"
MAJORITY_ABOVE = "Majority Above"
DEFINITELY_ABOVE = "Definitely Above"
UNDETERMINED = "Undetermined"


def _safe_float(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _elevation_range(rec):
    """Returns (min_z, max_z) for rec, falling back to a single coord_z
    point (min_z == max_z) when min_elevation/max_elevation aren't both
    present. None if there's no usable elevation data at all."""
    z_min = _safe_float(rec.get("min_elevation"))
    z_max = _safe_float(rec.get("max_elevation"))
    if z_min is None or z_max is None:
        z = _safe_float(rec.get("coord_z"))
        if z is None:
            return None
        return (z, z)
    if z_min > z_max:
        z_min, z_max = z_max, z_min
    return (z_min, z_max)


def classify_vertical_position(rec_a, rec_b):
    """Classify where B sits vertically relative to A. Returns one of
    DEFINITELY_BELOW / MAJORITY_BELOW / SIDE / MAJORITY_ABOVE /
    DEFINITELY_ABOVE / UNDETERMINED (missing elevation data on either
    side)."""
    a_range = _elevation_range(rec_a)
    b_range = _elevation_range(rec_b)
    if a_range is None or b_range is None:
        return UNDETERMINED

    a_min, a_max = a_range
    b_min, b_max = b_range

    overlap = min(a_max, b_max) - max(a_min, b_min)

    if overlap <= 0:
        return DEFINITELY_BELOW if b_max <= a_min else DEFINITELY_ABOVE

    a_height = a_max - a_min
    b_height = b_max - b_min
    positive_heights = [h for h in (a_height, b_height) if h > 0]
    reference_height = min(positive_heights) if positive_heights else 0.0

    overlap_fraction = min(overlap / reference_height, 1.0) if reference_height > 0 else 1.0

    if overlap_fraction >= CLASH_POSITION_SIDE_OVERLAP_THRESHOLD:
        return SIDE

    a_center = (a_min + a_max) / 2.0
    b_center = (b_min + b_max) / 2.0
    return MAJORITY_BELOW if b_center < a_center else MAJORITY_ABOVE


_INVERSE = {
    DEFINITELY_BELOW: DEFINITELY_ABOVE,
    MAJORITY_BELOW: MAJORITY_ABOVE,
    SIDE: SIDE,
    MAJORITY_ABOVE: MAJORITY_BELOW,
    DEFINITELY_ABOVE: DEFINITELY_BELOW,
    UNDETERMINED: UNDETERMINED,
}


def invert_position(position):
    """Where A sits relative to B, given classify_vertical_position(a, b)
    (B relative to A)."""
    return _INVERSE.get(position, UNDETERMINED)


def _bucket(position):
    if position in (DEFINITELY_BELOW, MAJORITY_BELOW):
        return "Below"
    if position in (DEFINITELY_ABOVE, MAJORITY_ABOVE):
        return "Above"
    if position == SIDE:
        return "Side"
    return "Undetermined"


def build_position_groups(clash_results, pour_lookup):
    """For every pour GUID involved in a clash, groups every OTHER pour it
    clashes with into "Below"/"Above"/"Side"/"Undetermined" GUID lists (the
    other pour's position relative to this one). Returns
    {guid: {"Below": [...], "Above": [...], "Side": [...], "Undetermined": [...]}}
    — one entry per pour that has at least one clash.

    pour_lookup: {GlobalId: rec} as built elsewhere (see excel_exporter.py's
    identical pour_lookup comprehension over records)."""
    groups = defaultdict(lambda: {"Below": [], "Above": [], "Side": [], "Undetermined": []})

    for c in clash_results or []:
        a_guid = str(c.get("Pour A GUID") or c.get("a_global_id", "") or "").strip()
        b_guid = str(c.get("Pour B GUID") or c.get("b_global_id", "") or "").strip()
        if not a_guid or not b_guid:
            continue
        a = pour_lookup.get(a_guid)
        b = pour_lookup.get(b_guid)
        if not a or not b:
            continue

        position_b_rel_a = classify_vertical_position(a, b)
        groups[a_guid][_bucket(position_b_rel_a)].append(b_guid)
        groups[b_guid][_bucket(invert_position(position_b_rel_a))].append(a_guid)

    return groups
